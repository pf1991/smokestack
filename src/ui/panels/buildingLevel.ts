import { BUILDINGS } from '../../data/buildings';
import { RECIPES } from '../../data/recipes';
import type { LevelDef } from '../../data/levels';
import { dateToDays } from '../../sim/clock';
import { atPrices } from '../../sim/society/economy';
import { levelDef, nextLevel, upgradeCost, upgradeRefusal, startUpgrade } from '../../sim/logistics/levels';
import type { Building, SimContext } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { setText } from './inspect';

/** One column of the card: the catalogue value times the level's factors, as readable lines. */
export function levelLines(ctx: SimContext, b: Building, lv: LevelDef): string[] {
  const def = BUILDINGS[b.typeId];
  const store = `Storage ${formatNumber(Math.round(def.storage * lv.storage))}`;
  const upkeep = `Upkeep ${formatMoney(Math.round(atPrices(ctx.state, def.maintenance) * lv.upkeep))}/mo`;
  if (b.typeId === 'warehouse') {
    return [`Range ${lv.range ?? 0} tiles`, store, `Hub trucks ${lv.hubTrucks ?? 0}`, upkeep];
  }
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  const perBatch = recipe ? Object.values(recipe.outputs).reduce((a, q) => a + q, 0) : 0;
  const perDay = recipe ? (def.category === 'extractor' ? perBatch : perBatch / recipe.days) * lv.rate : 0;
  return [
    `Output ${perDay.toFixed(1)}/day`,
    `Workers ${formatNumber(Math.round(def.workers * lv.workers))}`,
    upkeep,
    `Smoke ×${lv.smoke}`,
    store,
  ];
}

/** The "Level" inspector section: current and next level side by side, and the upgrade button. */
export function levelCard(host: { ctx: SimContext }, b: Building): { el: HTMLElement; refresh(): void } {
  const id = b.id;
  const cur = h('div', { class: 'lv-col' });
  const nxt = h('div', { class: 'lv-col' });
  const cols = h('div', { class: 'lv-cols' }, cur, nxt);
  const progress = h('div', { class: 'insp-muted lv-progress' });
  const why = h('div', { class: 'insp-muted lv-why' });
  const btn = h('button', {
    class: 'btn insp-upgrade-level',
    'data-act': 'upgrade-level',
    onClick: () => {
      const r = startUpgrade(host.ctx, id, 'player');
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `Upgrade begun: ${r.value.days} days`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' },
      );
      refresh();
    },
  }) as HTMLButtonElement;
  const el = h('div', { class: 'p-section insp-section insp-level' }, h('div', { class: 'p-head' }, 'Level'), cols, progress, btn, why);

  const fill = (col: HTMLElement, title: string, lines: string[]): void => {
    const sig = [title, ...lines].join('|');
    if (col.dataset.sig === sig) return;
    col.dataset.sig = sig;
    col.replaceChildren(h('div', { class: 'p-row insp-muted' }, title), ...lines.map((l) => h('div', { class: 'p-row' }, l)));
  };

  function refresh(): void {
    const { state } = host.ctx;
    const live = state.buildings[id];
    if (!live) return;
    const lv = levelDef(live);
    el.hidden = !lv;
    if (!lv) return;
    const next = nextLevel(live);
    fill(cur, `Level ${live.level}`, levelLines(host.ctx, live, lv));
    fill(nxt, next ? `Level ${next.level}` : 'Top level', next ? levelLines(host.ctx, live, next) : ['Nothing further']);
    const mine = live.ownerId === 'player';
    btn.hidden = !mine || !next;
    progress.hidden = !live.works;
    if (live.works) {
      const left = Math.max(0, live.works.untilDay - dateToDays(state.date));
      setText(progress, `Upgrading to level ${live.works.toLevel}: ${left} days left`);
    }
    if (!next) {
      why.hidden = true;
      return;
    }
    const refusal = upgradeRefusal(state, live, 'player');
    setText(btn, `Upgrade ${formatMoney(upgradeCost(state, live))}: ${next.days} days, output paused`);
    if (btn.disabled !== (refusal !== null)) btn.disabled = refusal !== null;
    const tip = refusal ?? 'Rebuild to the next level: output pauses while the works run';
    if (btn.title !== tip) btn.title = tip;
    why.hidden = refusal === null;
    if (refusal) setText(why, refusal);
  }
  refresh();
  return { el, refresh };
}
