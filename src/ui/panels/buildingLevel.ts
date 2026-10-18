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
import { assign, managerAt } from '../../sim/logistics/managers';
import { payText, skillChips } from './managers';
import { buyHubTruck, hubAttached, hubCap, hubTier, hubTruckRefusal, hubTrucks, balancingWith, setHubAutoSize, setHubMaxTrucks } from '../../sim/logistics/hubs';
import { hubRange } from '../../sim/logistics/levels';
import { newestModel } from '../../sim/logistics/models';
import { vehiclePrice } from '../../sim/vehicles';
import { iconEl } from '../icon';

/**
 * The warehouse's "Hub" section (spec §8.5): range and attached buildings, trucks and cap with "Buy hub
 * truck", the auto-size switch, yesterday's dispatch and the no-manager warning.
 */
export function hubSection(host: { ctx: SimContext }, id: number): { el: HTMLElement; refresh(): void } {
  const range = h('div', { class: 'p-row insp-hub-range' });
  const trucks = h('div', { class: 'p-row insp-hub-trucks' });
  const buy = h('button', {
    class: 'btn insp-hub-truck',
    'data-act': 'hub-truck',
    onClick: () => {
      const r = buyHubTruck(host.ctx, 'player', id);
      host.ctx.bus.emit(r.ok ? { type: 'toast', message: 'Hub truck bought', tone: 'good' } : { type: 'toast', message: r.error, tone: 'bad' });
      refresh();
    },
  }) as HTMLButtonElement;
  const auto = h('input', {
    type: 'checkbox',
    'data-act': 'hub-autosize',
    onChange: () => {
      const r = setHubAutoSize(host.ctx, id, 'player', auto.checked);
      if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      refresh();
    },
  }) as HTMLInputElement;
  const cap = h('input', {
    type: 'number',
    min: '1',
    class: 'insp-hub-cap',
    'data-act': 'hub-cap',
    title: 'Most trucks auto-sizing may run',
    onChange: () => {
      const r = setHubMaxTrucks(host.ctx, id, 'player', Number(cap.value));
      if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      refresh();
    },
  }) as HTMLInputElement;
  const autoRow = h('div', { class: 'p-row insp-hub-auto' }, h('label', { title: 'Buy a truck when work waits, sell one when trucks idle (monthly)' }, auto, ' Auto-size the hub fleet, up to '), cap);
  const balancing = h('div', { class: 'p-row insp-muted insp-hub-balance' });
  const yesterday = h('div', { class: 'p-row insp-muted insp-hub-yesterday' });
  const warn = h('div', { class: 'insp-warn insp-hub-warn' }, iconEl('warning', 14), ' Hire a manager to run this hub');
  const el = h('div', { class: 'p-section insp-hub' }, h('div', { class: 'p-head' }, iconEl('hub', 14), ' Hub'), range, trucks, buy, autoRow, yesterday, balancing, warn);

  function refresh(): void {
    const { state } = host.ctx;
    const b = state.buildings[id];
    el.hidden = !b || b.typeId !== 'warehouse';
    if (!b || el.hidden) return;
    const mine = b.ownerId === 'player';
    const full = hubRange(b);
    const tier = hubTier(state, b);
    const used = tier ? Math.round(full * tier.rangeShare * 10) / 10 : 0;
    const attached = hubAttached(state, b, full).length;
    setText(range, `Range ${full} tiles${tier ? ` (${used} used)` : ''}: ${attached} ${attached === 1 ? 'building' : 'buildings'} attached`);
    const n = hubTrucks(state, id).length;
    setText(trucks, `Trucks ${n} / ${hubCap(b)}`);
    buy.hidden = !mine;
    setText(buy, `Buy hub truck ${formatMoney(vehiclePrice(state, newestModel(state)))}`);
    const why = mine ? hubTruckRefusal(state, b, 'player') : null;
    if (buy.disabled !== (why !== null)) buy.disabled = why !== null;
    const tip = why ?? 'A truck of this warehouse, dispatched by its manager';
    if (buy.title !== tip) buy.title = tip;
    autoRow.hidden = !b.hub;
    auto.disabled = !mine;
    if (b.hub && auto.checked !== b.hub.autoSize) auto.checked = b.hub.autoSize;
    cap.disabled = !mine;
    if (b.hub) {
      cap.max = String(hubCap(b));
      if (document.activeElement !== cap && cap.value !== String(b.hub.maxTrucks)) cap.value = String(b.hub.maxTrucks);
    }
    const partners = b.hub ? balancingWith(state, b) : [];
    balancing.hidden = partners.length === 0;
    if (partners.length) setText(balancing, `Balancing with ${partners.map((o) => `Warehouse at ${o.pos.x},${o.pos.y}`).join(', ')}`);
    yesterday.hidden = !b.hub;
    if (b.hub) {
      const y = b.hub.yesterday;
      setText(yesterday, `Yesterday: ${y.jobs} ${y.jobs === 1 ? 'job' : 'jobs'}, ${y.idle} ${y.idle === 1 ? 'truck' : 'trucks'} idle`);
    }
    warn.hidden = !mine || tier !== null;
  }
  refresh();
  return { el, refresh };
}

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
  const mgrInfo = h('div', { class: 'p-row insp-manager-info' });
  const mgrSelect = h('select', {
    class: 'insp-manager-select',
    'aria-label': 'Assign a manager',
    onChange: () => {
      const v = Number(mgrSelect.value);
      if (!v) return;
      const r = assign(host.ctx, 'player', v, id);
      if (!r.ok) host.ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
      refresh();
    },
  }) as HTMLSelectElement;
  const mgrUnassign = h('button', {
    class: 'btn insp-manager-unassign',
    onClick: () => {
      const m = managerAt(host.ctx.state, id);
      if (m) assign(host.ctx, 'player', m.id, null);
      refresh();
    },
  }, 'Unassign') as HTMLButtonElement;
  const mgrBox = h('div', { class: 'p-section insp-manager' }, h('div', { class: 'p-head' }, 'Manager'), mgrInfo, h('div', { class: 'mgr-acts' }, mgrSelect, mgrUnassign));
  const hub = hubSection(host, id);
  const el = h('div', { class: 'p-section insp-section insp-level' }, h('div', { class: 'p-head' }, 'Level'), cols, progress, btn, why, mgrBox, hub.el);

  const fill = (col: HTMLElement, title: string, lines: string[]): void => {
    const sig = [title, ...lines].join('|');
    if (col.dataset.sig === sig) return;
    col.dataset.sig = sig;
    col.replaceChildren(h('div', { class: 'p-row insp-muted' }, title), ...lines.map((l) => h('div', { class: 'p-row' }, l)));
  };

  /** The manager slot: who runs the building, and the staff who could. Rebuilt only when its content changes. */
  function managerSlot(live: Building): void {
    const { state } = host.ctx;
    const mine = live.ownerId === 'player';
    const m = managerAt(state, id);
    const idle = mine ? state.logistics.managers.filter((x) => x.employer === 'player' && x.post === null) : [];
    mgrBox.hidden = !m && idle.length === 0 && !mine;
    const sig = `${m?.id ?? 0}|${m?.salary ?? 0}|${mine}|${idle.map((x) => x.id).join(',')}`;
    if (mgrBox.dataset.sig === sig) return;
    mgrBox.dataset.sig = sig;
    mgrInfo.replaceChildren(
      m ? h('span', null, m.name) : h('span', { class: 'insp-muted' }, mine ? 'No manager posted' : 'No manager'),
      m ? skillChips(m) : '',
      m ? h('span', null, payText(state, m)) : '',
    );
    mgrSelect.replaceChildren(
      h('option', { value: '' }, idle.length ? 'Assign a manager' : 'No idle managers'),
      ...idle.map((x) => h('option', { value: x.id }, `${x.name} (L${x.skills.logistics} P${x.skills.production} F${x.skills.frugality})`)),
    );
    mgrSelect.hidden = !mine || m !== null;
    mgrSelect.disabled = idle.length === 0;
    mgrUnassign.hidden = !mine || !m;
  }

  function refresh(): void {
    const { state } = host.ctx;
    const live = state.buildings[id];
    if (!live) return;
    const lv = levelDef(live);
    el.hidden = !lv;
    if (!lv) return;
    managerSlot(live);
    hub.refresh();
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
