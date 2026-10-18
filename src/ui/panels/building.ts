import { BUILDINGS, HOUSING_POOL, HOUSING_RADIUS } from '../../data/buildings';

import { buildingStorage, levelSmoke } from '../../sim/logistics/levels';
import { getGood } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import { addDays, dateToDays, formatDate, isWinter } from '../../sim/clock';
import { FINE_RATE, LAWS, type LawId } from '../../data/laws';
import { monthIndex } from '../../sim/politics/elections';
import { priceIndex } from '../../sim/society/economy';
import { enforcedLaws, scrubberTier } from '../../sim/society/lawState';
import {
  buyUpgrade,
  canAbate,
  hasTallChimney,
  nextScrubber,
  SCRUBBER_TIERS,
  TALL_CHIMNEY_REACH,
  upgradeCost,
  upgradeRefusal,
  type UpgradeKind,
} from '../../sim/society/upgrades';
import { isWorks, SLOWDOWN_FACTOR, SLOWDOWN_OPINION, strikeActive, strikeEnd } from '../../sim/society/strikeState';
import { loadSource } from '../../sim/inventory';
import { STATION_TYPE, stationAccess } from '../../sim/rail';
import { accessTiles, demolishBuilding, demolitionRefund, footprint } from '../../sim/state';
import { assetAge, assetEfficiency, assetUpkeep, renewBuilding, renewCost, renewRefusal } from '../../sim/society/aging';
import type { GameController } from '../../game/controller';
import { offeredGoods } from '../../sim/routeHelpers';
import { housingFactory, workCity } from '../../sim/politics/workforce';
import type { Building, GameState, Route } from '../../sim/types';
import { type Child, h } from '../dom';
import { iconEl } from '../icon';
import { formatMoney, formatNumber } from '../format';
import './panels.css';
import { bar, type Bar, KeyedList, openInspector, setClass, setOwnerBadge, setText, type InspectorHost, type InspectorView } from './inspect';
import type { PanelDef } from './index';
import { startSendGoods } from './routeActions';
import { levelCard } from './buildingLevel';

const STATUS_LABEL: Record<Building['status'], string> = {
  ok: 'Running',
  no_input: 'Waiting',
  output_full: 'Full',
  halted: 'Halted',
  idle: 'Idle',
  upgrading: 'Upgrading',
};

const goodLabel = (id: string): Child[] => [iconEl(id, 16), ` ${getGood(id).name}`];

/**
 * The inspector's staffing line: "Staff 100%", "Staff 85% — short of hands in Ashford", "Staff 75% — remote works",
 * with a go-slow appended: "Staff 85% — short of hands in Ashford; go-slow (×0.9)" or "Staff 100% — go-slow in Ashford (×0.9)".
 */
export function staffingText(state: GameState, b: Building): string {
  // floored, so a building one hand short never reads "100%"
  const pct = `Staff ${Math.floor(b.staffing * 100 + 1e-9)}%`;
  const city = workCity(state, b);
  // a go-slow (society/strikeState.ts): the player's works hired from a town below 30 workers' opinion
  const slow = isWorks(b) && city !== null && city.opinion.workers < SLOWDOWN_OPINION;
  const parts: string[] = [];
  if (b.staffing < 1) parts.push(city ? `short of hands in ${city.name}` : 'remote works');
  if (slow) parts.push(parts.length > 0 ? `go-slow (×${SLOWDOWN_FACTOR})` : `go-slow in ${city!.name} (×${SLOWDOWN_FACTOR})`);
  return parts.length > 0 ? `${pct} — ${parts.join('; ')}` : pct;
}

/** Company housing's line: who it houses hands for, or a warning when its factory is gone (null for other buildings). */
export function housingText(state: GameState, b: Building): { text: string; orphan: boolean } | null {
  if (b.typeId !== 'company_housing') return null;
  const f = housingFactory(state, b.ownerId, b.typeId, b.pos);
  if (!f) return { text: `No factory within ${HOUSING_RADIUS} tiles — housing stands empty`, orphan: true };
  const town = workCity(state, f);
  return { text: `Houses ${HOUSING_POOL} hands for ${BUILDINGS[f.typeId].name} (${town ? town.name : 'no town nearby'})`, orphan: false };
}

/** Why an extractor produces nothing right now, or null when it is productive. */
function extractorProblem(state: GameState, b: Building): string | null {
  const def = BUILDINGS[b.typeId];
  if (def.category !== 'extractor') return null;
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  const outs = recipe ? Object.keys(recipe.outputs) : [];
  const tiles = footprint(b).map((p) => state.map.tiles[p.y * state.map.width + p.x]);
  if (b.typeId === 'lumber_camp') return tiles.some((t) => t.terrain === 'forest') ? null : 'No forest here';
  if (def.requiresDeposit) {
    const has = tiles.some((t) => t.deposit !== null && outs.includes(t.deposit));
    return has ? null : `No ${outs.map((g) => getGood(g).name).join(' / ') || 'deposit'} here`;
  }
  if (b.typeId === 'farm' && isWinter(state.date.month) && outs.some((g) => g === 'grain' || g === 'cotton' || g === 'fruit')) {
    return 'Fallow for the winter';
  }
  return null;
}

/** "On strike until <date> — <reason>" while `b` is on strike, else null. */
export function strikeText(state: GameState, b: Building): string | null {
  const today = dateToDays(state.date);
  if (!b.strike || !strikeActive(b.strike, today)) return null;
  return `On strike until ${formatDate(addDays(state.date, strikeEnd(b.strike) - today))} — ${b.strike.reason}`;
}

/** "Scrubber: none" or "Scrubber: tier 2 (smoke ×0.45, upkeep ×1.2)". */
export function scrubberText(b: Building): string {
  const t = scrubberTier(b);
  if (t === 0) return 'Scrubber: none';
  const d = SCRUBBER_TIERS[t - 1];
  return `Scrubber: tier ${t} (smoke ×${d.emission}, upkeep ×${d.upkeep})`;
}

/** Label of the next-scrubber button: "Fit tier 1 scrubber $9,000 — smoke ×0.7, upkeep ×1.1", or null at tier 3. */
export function scrubberOffer(state: GameState, b: Building): string | null {
  const next = nextScrubber(b);
  if (!next) return null;
  return `Fit tier ${next.tier} scrubber ${formatMoney(upgradeCost(state, b, 'scrubber'))} — smoke ×${next.emission}, upkeep ×${next.upkeep}`;
}

/**
 * One line per enforced smoke law for the player's polluting works: "Compliant with the Clean Air
 * Act", "Fined $2,400/mo under the Clean Air Act" for the strictest law it fails (R-S7: one fine per
 * works), and "Below the Smoke Abatement Act's tier 1" for laxer laws it also fails.
 */
export function complianceLines(state: GameState, b: Building): { text: string; ok: boolean }[] {
  const tier = scrubberTier(b);
  const laws = enforcedLaws(state, monthIndex(state.date)).sort((x, y) => LAWS[y].tier - LAWS[x].tier);
  let fined = false;
  return laws.map((id: LawId) => {
    const law = LAWS[id];
    if (tier >= law.tier) return { text: `Compliant with the ${law.title}`, ok: true };
    if (fined) return { text: `Below the ${law.title}'s tier ${law.tier}`, ok: false };
    fined = true;
    const fine = Math.round(BUILDINGS[b.typeId].pollution * levelSmoke(b) * FINE_RATE * priceIndex(state));
    return { text: `Fined ${formatMoney(fine)}/mo under the ${law.title}`, ok: false };
  });
}

/**
 * "Built 1912 (age 41): 74% efficiency" for works (age slows production); stores, stations and
 * warehouses produce nothing, so theirs reads "Built 1912 (age 41): upkeep +52%" (exported for tests).
 */
export function ageLine(state: GameState, b: Building): string {
  const head = `Built ${b.builtYear} (age ${assetAge(state, b)})`;
  const cat = BUILDINGS[b.typeId]?.category;
  if (cat !== 'extractor' && cat !== 'factory') return `${head}: upkeep +${Math.round((assetUpkeep(state, b) - 1) * 100)}%`;
  return `${head}: ${Math.round(assetEfficiency(state, b) * 100)}% efficiency`;
}

/** Plain-language explanation of what the building is doing (exported for tests). */
export function statusReason(state: GameState, b: Building, routes: Route[]): string {
  const def = BUILDINGS[b.typeId];
  const strike = strikeText(state, b);
  if (strike) return strike;
  if (b.works) return `Upgrading to level ${b.works.toLevel}: output paused`;
  if (b.status === 'halted') return `Halted until ${b.haltedUntil ? formatDate(b.haltedUntil) : 'further notice'}`;
  const problem = extractorProblem(state, b);
  if (problem) return problem;
  switch (b.status) {
    case 'no_input': {
      const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
      const missing = recipe
        ? Object.entries(recipe.inputs)
            .filter(([g, q]) => (b.input[g] ?? 0) < q)
            .map(([g]) => getGood(g).name)
        : [];
      return missing.length > 0 ? `Waiting for ${missing.join(', ')}` : 'Waiting for supplies';
    }
    case 'output_full':
      return 'Storage full — needs a truck route';
    case 'idle':
      if (def.category === 'retail') return 'No sales today';
      return routes.length === 0 ? 'Not on any route' : 'Idle';
    default: {
      if (def.category === 'retail') return 'Open for business';
      if (def.category === 'logistics') return 'Handling cargo';
      return `Producing — ${Math.round(b.progress * 100)}% of this batch`;
    }
  }
}

function routesServing(state: GameState, id: number): Route[] {
  return Object.values(state.routes).filter((r) => r.stops.some((s) => s.buildingId === id));
}

function recipeLabel(id: string): string {
  const r = RECIPES[id];
  const side = (inv: Record<string, number>) =>
    Object.entries(inv)
      .map(([g, q]) => `${q} ${getGood(g).name}`)
      .join(' + ');
  const ins = side(r.inputs);
  return `${ins ? `${ins} → ` : ''}${side(r.outputs)}`;
}

interface Row {
  el: HTMLElement;
  bar: Bar;
}

function makeRow(goodId: string): Row {
  const g = getGood(goodId);
  const b = bar(g.color);
  return { el: h('div', { class: 'insp-row' }, h('span', { class: 'insp-row-name' }, goodLabel(goodId)), b.el), bar: b };
}

function buildView(host: InspectorHost, id: number): InspectorView {
  const state0 = host.ctx.state.buildings[id];
  const def0 = BUILDINGS[state0.typeId];
  const owner = h('span', { class: 'insp-badge' });
  const statusBadge = h('span', { class: 'insp-badge' });
  const reason = h('div', { class: 'insp-reason' });
  const staff = h('div', { class: 'insp-muted insp-staff' });
  const noRoad = h('div', { class: 'insp-warn' }, iconEl('warning', 14), ' No road access — trucks cannot reach this building');
  const housingLine = h('span');
  const housing = h('div', { class: 'insp-housing' }, housingLine);
  housing.hidden = true;
  const noRail = h('div', { class: 'insp-warn' }, iconEl('warning', 14), ' No track alongside — lay rail next to the station for trains');
  noRail.hidden = true;
  const recipeSel = h('select', {
    class: 'insp-recipe',
    onChange: () => {
      const b = host.ctx.state.buildings[id];
      if (!b || b.ownerId !== 'player') return;
      const v = recipeSel.value;
      if (v === b.recipeId || !RECIPES[v]) return;
      b.recipeId = v;
      b.progress = 0;
      view.update();
    },
  }) as HTMLSelectElement;
  const recipeBox = h('div', { class: 'p-section insp-section' }, h('div', { class: 'p-head' }, 'Recipe'), recipeSel);
  const routesSection = h('div', { class: 'p-section insp-section' });
  const inBox = h('div', { class: 'insp-list' });
  const outBox = h('div', { class: 'insp-list' });
  const inSection = h('div', { class: 'p-section insp-section' }, h('div', { class: 'p-head' }, 'Inputs'), inBox);
  const outSection = h('div', { class: 'p-section insp-section' }, h('div', { class: 'p-head' }, 'Output'), outBox);
  const produced = h('div', { class: 'insp-muted' });
  const routeBox = h('div', { class: 'insp-routes' });
  const send = h('button', {
    class: 'btn insp-send',
    'data-act': 'send-goods',
    title: 'Pick a destination on the map: creates a route and buys a vehicle',
    onClick: () => startSendGoods(host as unknown as GameController, id),
  });
  const buy = (kind: UpgradeKind) => {
    const r = buyUpgrade(host.ctx, id, kind);
    host.ctx.bus.emit(
      r.ok
        ? { type: 'toast', message: kind === 'tallChimney' ? 'Tall chimney built' : 'Scrubber fitted', tone: 'good' }
        : { type: 'toast', message: r.error, tone: 'bad' },
    );
    view.update();
  };
  const scrubLine = h('div', { class: 'insp-muted insp-scrubber' });
  const scrubBtn = h('button', { class: 'btn insp-upgrade', 'data-act': 'scrubber', onClick: () => buy('scrubber') }) as HTMLButtonElement;
  const scrubWhy = h('div', { class: 'insp-muted insp-upgrade-why' });
  const chimneyBtn = h('button', { class: 'btn insp-upgrade', 'data-act': 'tall-chimney', onClick: () => buy('tallChimney') }) as HTMLButtonElement;
  const chimneyWhy = h('div', { class: 'insp-muted insp-upgrade-why' });
  const lawBox = h('div', { class: 'insp-laws' });
  const upgradesSection = h(
    'div',
    { class: 'p-section insp-section insp-upgrades' },
    h('div', { class: 'p-head' }, iconEl('scrubber', 14), ' Upgrades'),
    scrubLine,
    scrubBtn,
    scrubWhy,
    chimneyBtn,
    chimneyWhy,
    lawBox,
  );
  const inList = new KeyedList<Row>(inBox, makeRow);
  const outList = new KeyedList<Row>(outBox, makeRow);

  const level = levelCard(host, state0);
  const ageText = h('div', { class: 'insp-age-line' });
  const renew = h('button', {
    class: 'btn insp-renew',
    onClick: () => {
      const r = renewBuilding(host.ctx, id, 'player');
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `${def0.name} renewed for ${formatMoney(r.value.cost)}`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' },
      );
      view.update();
    },
  }) as HTMLButtonElement;
  const ageSection = h('div', { class: 'p-section insp-section insp-age' }, h('div', { class: 'p-head' }, 'Age'), ageText, renew);

  let confirming = false;
  let confirmTimer = 0;
  const demolish = h('button', {
    class: 'btn insp-demolish',
    onClick: () => {
      const b = host.ctx.state.buildings[id];
      if (!b) return;
      if (!confirming) {
        confirming = true;
        confirmTimer = window.setTimeout(() => {
          confirming = false;
          view.update();
        }, 4000);
        view.update();
        return;
      }
      clearTimeout(confirmTimer);
      const refund = demolitionRefund(host.ctx.state, b);
      const r = demolishBuilding(host.ctx, id, 'player');
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `${def0.name} demolished — refunded ${formatMoney(refund)}`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' },
      );
    },
  });

  const el = h(
    'div',
    { class: 'insp' },
    h('div', { class: 'insp-head' }, owner, statusBadge),
    reason,
    staff,
    housing,
    noRoad,
    noRail,
    recipeBox,
    inSection,
    outSection,
    produced,
    routesSection,
    level.el,
    upgradesSection,
    ageSection,
    demolish,
  );

  routesSection.append(h('div', { class: 'p-head' }, 'Routes'), routeBox, send);
  let recipeSig = '';
  let routeSig = '\0';
  const view: InspectorView = {
    el,
    dispose: () => clearTimeout(confirmTimer),
    update() {
      const { state } = host.ctx;
      const b = state.buildings[id];
      if (!b) return false;
      const def = BUILDINGS[b.typeId];
      const mine = b.ownerId === 'player';
      setOwnerBadge(owner, state, b.ownerId);
      const striking = strikeActive(b.strike, dateToDays(state.date));
      setText(statusBadge, striking ? 'On strike' : STATUS_LABEL[b.status]);
      setClass(statusBadge, `insp-badge status-${b.status}`);
      const routes = routesServing(state, id);
      setText(reason, statusReason(state, b, routes));
      // staffing scales production only; stores and depots still draw on the pool but show no row
      staff.hidden = def.category === 'retail' || def.category === 'logistics';
      if (!staff.hidden) setText(staff, staffingText(state, b));
      noRoad.hidden = accessTiles(state, b).length > 0;
      if (b.typeId === STATION_TYPE) {
        const railOk = stationAccess(state, b).length > 0;
        noRail.hidden = railOk;
        if (railOk) noRoad.hidden = true; // a rail-only station is fine
      }

      // recipe selector: unlocked recipes only (plus the current one)
      const hasRecipes = (def.category === 'extractor' || def.category === 'factory') && def.recipes.length > 0;
      recipeBox.hidden = !hasRecipes;
      if (hasRecipes) {
        const ids = def.recipes.filter((r) => r === b.recipeId || state.unlocked.includes(r));
        const sig = ids.join('|');
        if (sig !== recipeSig) {
          recipeSig = sig;
          recipeSel.replaceChildren(...ids.map((r) => h('option', { value: r }, recipeLabel(r))));
        }
        if (b.recipeId && recipeSel.value !== b.recipeId) recipeSel.value = b.recipeId;
        recipeSel.disabled = !mine || ids.length < 2;
      }

      // inventory
      const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
      const shared = def.category === 'retail' || def.category === 'logistics';
      const keys = (want: string[], inv: Record<string, number>) => [
        ...want,
        ...Object.keys(inv).filter((g) => !want.includes(g) && (inv[g] ?? 0) > 0.5),
      ];
      inSection.hidden = def.category === 'extractor';
      outSection.hidden = shared;
      const inKeys = shared ? Object.keys(loadSource(b)).filter((g) => (loadSource(b)[g] ?? 0) > 0.5) : keys(Object.keys(recipe?.inputs ?? {}), b.input);
      const outKeys = keys(Object.keys(recipe?.outputs ?? {}), b.output);
      inList.sync(inKeys);
      outList.sync(outKeys);
      if (shared && inKeys.length === 0) setText(inBox, 'Nothing in stock');
      const cap = buildingStorage(b);
      for (const [g, row] of inList.items) {
        const q = b.input[g] ?? 0;
        row.bar.set(q / cap, `${formatNumber(q)} / ${cap}`);
      }
      for (const [g, row] of outList.items) {
        const q = b.output[g] ?? 0;
        row.bar.set(q / cap, `${formatNumber(q)} / ${cap}`);
      }
      const made = Object.entries(b.producedThisMonth).filter(([, q]) => q > 0);
      produced.hidden = shared;
      setText(
        produced,
        made.length > 0
          ? `Produced this month: ${made.map(([g, q]) => `${formatNumber(q)} ${getGood(g).name}`).join(', ')}`
          : 'Produced this month: nothing yet',
      );

      const rsig = routes.map((r) => `${r.id}:${r.name}:${r.color}`).join('|');
      if (rsig !== routeSig) {
        routeSig = rsig;
        routeBox.replaceChildren(
          ...(routes.length > 0
            ? routes.map((r) => h('button', {
              class: 'insp-route insp-route-link',
              'data-route': r.id,
              title: 'Open this route in the Routes window',
              onClick: () => (host as unknown as GameController).openPanel('routes', r.id),
            }, h('span', { class: 'swatch', style: { background: r.color } }), r.name))
            : [h('span', { class: 'insp-muted' }, 'Not on any route')]),
        );
      }

      const isStation = b.typeId === STATION_TYPE;
      send.hidden = !mine || (!isStation && offeredGoods(b).length === 0);
      if (send.dataset.kind !== (isStation ? 'train' : 'truck')) {
        send.dataset.kind = isStation ? 'train' : 'truck';
        send.replaceChildren(iconEl(send.dataset.kind, 16), ' Send goods to…');
      }
      // smoke abatement: the player's polluting works only
      upgradesSection.hidden = !mine || !canAbate(b);
      if (!upgradesSection.hidden) {
        setText(scrubLine, scrubberText(b));
        const offer = scrubberOffer(state, b);
        scrubBtn.hidden = offer === null;
        const scrubNo = offer === null ? null : upgradeRefusal(state, b, 'scrubber');
        if (offer) setText(scrubBtn, offer);
        scrubBtn.disabled = scrubNo !== null;
        scrubWhy.hidden = scrubNo === null;
        if (scrubNo) setText(scrubWhy, scrubNo);
        const tall = hasTallChimney(b);
        setText(
          chimneyBtn,
          tall
            ? 'Tall chimney built'
            : `Build tall chimney ${formatMoney(upgradeCost(state, b, 'tallChimney'))} — smoke lands ${TALL_CHIMNEY_REACH}+ tiles downwind`,
        );
        const chimneyNo = tall ? null : upgradeRefusal(state, b, 'tallChimney');
        chimneyBtn.disabled = tall || chimneyNo !== null;
        chimneyWhy.hidden = chimneyNo === null;
        if (chimneyNo) setText(chimneyWhy, chimneyNo);
        const lines = complianceLines(state, b);
        const lsig = lines.map((l) => l.text).join('|') || '-';
        if (lawBox.dataset.sig !== lsig) {
          lawBox.dataset.sig = lsig;
          lawBox.replaceChildren(
            ...(lines.length > 0
              ? lines.map((l) => h('div', { class: l.ok ? 'insp-muted insp-law' : 'insp-warn insp-law' }, l.text))
              : [h('div', { class: 'insp-muted insp-law' }, 'No smoke law in force yet')]),
          );
        }
      }
      level.refresh();
      // aging (sim/society/aging.ts): efficiency falls and upkeep rises after 15 years; renewing resets it
      setText(ageText, ageLine(state, b));
      const upkeepF = assetUpkeep(state, b);
      setClass(ageText, upkeepF > 1 ? 'insp-age-line insp-warn' : 'insp-age-line insp-muted');
      renew.hidden = !mine;
      if (mine) {
        const why = renewRefusal(state, b, 'player');
        setText(renew, `Renew ${formatMoney(renewCost(state, b))}${upkeepF > 1 ? ` — upkeep ×${upkeepF.toFixed(2)} now` : ''}`);
        if (renew.disabled !== (why !== null)) renew.disabled = why !== null;
        const tip = why ?? 'Overhaul the works: as good as new again';
        if (renew.title !== tip) renew.title = tip;
      }
      demolish.hidden = !mine;
      setText(
        demolish,
        confirming ? `Confirm demolish (+${formatMoney(demolitionRefund(state, b))} refund)` : 'Demolish',
      );
      setClass(demolish, `btn insp-demolish${confirming ? ' confirm' : ''}`);
      // company housing takes no cargo: its line replaces the status, stock and route rows
      const home = housingText(state, b);
      housing.hidden = home === null;
      if (home) {
        setText(housingLine, home.text);
        setClass(housing, home.orphan ? 'insp-housing insp-warn' : 'insp-housing insp-muted');
        reason.hidden = true;
        noRoad.hidden = true;
        inSection.hidden = true;
        outSection.hidden = true;
        produced.hidden = true;
        routesSection.hidden = true;
        statusBadge.hidden = true;
      }
      return true;
    },
  };
  return view;
}

export const buildingPanel: PanelDef = {
  id: 'building',
  open(game, arg) {
    const host = game as unknown as InspectorHost;
    const id = Number(arg);
    const b = host.ctx.state.buildings[id];
    if (!b) return;
    openInspector(host, {
      id: `building-${id}`,
      title: BUILDINGS[b.typeId].name,
      width: 340,
      selection: { buildingId: id },
      build: () => buildView(host, id),
    });
  },
};
