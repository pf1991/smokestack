import { BUILDINGS, HOUSING_POOL, HOUSING_RADIUS } from '../../data/buildings';

import { buildingStorage, levelSmoke } from '../../sim/logistics/levels';
import { getGood, SEASONAL_CROPS } from '../../data/goods';
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
import { loadSource, storeStocked } from '../../sim/inventory';
import { STATION_TYPE, stationAccess } from '../../sim/rail';
import { accessTiles, demolishBuilding, demolitionRefund, footprint } from '../../sim/state';
import { assetAge, assetEfficiency, assetUpkeep, renewBuilding, renewCost, renewRefusal } from '../../sim/society/aging';
import type { GameController } from '../../game/controller';
import { offeredGoods } from '../../sim/routeHelpers';
import { TRADE_FACTOR, TRADE_GOODS, tradePrice } from '../../sim/trade';
import { housingFactory, workCity } from '../../sim/politics/workforce';
import type { Building, GameState, Route } from '../../sim/types';
import { h } from '../dom';
import { card, dataTable, emptyState, meter, panelHeader, pill, type Tone } from '../kit';
import { goodIcon, goodTip } from '../goodTooltip';
import { iconEl } from '../icon';
import { formatMoney, formatNumber } from '../format';
import './panels.css';
import { inspCard, KeyedList, openInspector, setClass, setMeter, setOwnerBadge, setText, swap, type InspectorHost, type InspectorView } from './inspect';
import type { PanelDef } from './index';
import { startSendGoods } from './routeActions';
import { levelCard } from './buildingLevel';

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
  if (b.typeId === 'farm' && isWinter(state.date.month) && outs.some((g) => SEASONAL_CROPS.includes(g))) {
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

export { storeStocked };

const TRADE_SELLING = 'Selling to the national market';
const TRADE_EMPTY = 'Nothing to sell: route materials or components here';

/** Plain-language explanation of what the building is doing (exported for tests). */
export function statusReason(state: GameState, b: Building, routes: Route[]): string {
  const def = BUILDINGS[b.typeId];
  const strike = strikeText(state, b);
  if (strike) return strike;
  if (b.works) return `Upgrading to level ${b.works.toLevel}: output paused`;
  if (b.status === 'halted') return `Halted until ${b.haltedUntil ? formatDate(b.haltedUntil) : 'further notice'}`;
  const problem = extractorProblem(state, b);
  if (problem) return problem;
  if (def.category === 'retail') return storeStocked(b) ? 'Open for business' : 'Shelves empty — route goods here';
  if (def.category === 'trade') return storeStocked(b) ? TRADE_SELLING : TRADE_EMPTY;
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
      return routes.length === 0 ? 'Not on any route' : 'Idle';
    default: {
      if (def.category === 'logistics') return 'Handling cargo';
      return `Producing — ${Math.min(100, Math.round(b.progress * 100))}% of this batch`;
    }
  }
}

/**
 * The building's state in one line that says what is wrong and how to fix it, with its tone: the
 * inspector's header summary and the alert tray's detail line. Pure: reads `state` and `b` only.
 */
export function statusAdvice(state: GameState, b: Building): { text: string; tone: Tone } {
  const def = BUILDINGS[b.typeId];
  const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
  const today = dateToDays(state.date);
  const works = def?.category === 'extractor' || def?.category === 'factory';
  if (!works && b.status !== 'halted' && b.status !== 'upgrading') {
    // stores, depots and stations have no recipe: the sim leaves them 'idle' most days, so their
    // line comes from what is on the shelves, not from the status
    if (def?.category === 'retail') {
      return storeStocked(b)
        ? { text: 'Open for business', tone: 'positive' }
        : { text: 'Shelves empty: route goods here', tone: 'warning' };
    }
    if (def?.category === 'trade') return storeStocked(b) ? { text: TRADE_SELLING, tone: 'positive' } : { text: TRADE_EMPTY, tone: 'warning' };
    return { text: 'Handling cargo', tone: 'neutral' };
  }
  switch (b.status) {
    case 'ok':
      return { text: 'Producing', tone: 'positive' };
    case 'no_input': {
      const ins = Object.entries(recipe?.inputs ?? {});
      const missing = ins.find(([g, q]) => (b.input[g] ?? 0) < q) ?? ins[0];
      const name = missing ? getGood(missing[0]).name : 'its inputs';
      return { text: `Starved of ${name}: connect a route that delivers it`, tone: 'warning' };
    }
    case 'output_full': {
      const cap = buildingStorage(b);
      const outs = Object.entries(recipe?.outputs ?? {});
      const full = outs.find(([g, q]) => (b.output[g] ?? 0) + q > cap) ?? outs[0];
      const name = full ? getGood(full[0]).name : 'its goods';
      return { text: `Storage full: add a route to carry ${name} away`, tone: 'warning' };
    }
    case 'halted':
      if (b.strike && strikeActive(b.strike, today)) return { text: `On strike: ${b.strike.reason}`, tone: 'negative' };
      return { text: 'Halted', tone: 'negative' };
    case 'upgrading': {
      const left = b.works ? Math.max(0, b.works.untilDay - today) : 0;
      return { text: `Upgrading: ${left} ${left === 1 ? 'day' : 'days'} left`, tone: 'info' };
    }
    case 'idle':
    default:
      return { text: 'Idle: choose a recipe', tone: 'neutral' };
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

/** One good in the production card: icon, name, "75 / 112" and a stock meter. */
interface FlowRow {
  el: HTMLElement;
  qty: HTMLElement;
  meter: HTMLElement;
  /** removes the codex tooltip (called when the row leaves the card) */
  dispose: () => void;
}

function makeFlowRow(goodId: string): FlowRow {
  const g = getGood(goodId);
  const qty = h('span', { class: 'insp-flow-qty' });
  const m = meter(0, 1, { label: g.name });
  const el = h(
    'div',
    { class: 'insp-flow-row', 'data-good': goodId },
    goodIcon(goodId, 20),
    h('div', { class: 'insp-flow-info' }, h('div', { class: 'insp-flow-line' }, h('span', { class: 'insp-flow-name' }, g.name), qty), m),
  );
  return { el, qty, meter: m, dispose: goodTip(el, goodId) };
}

/** One row of a Trading House's national prices: a good it holds, its stock and today's price. */
interface PriceRow {
  goodId: string;
  stock: number;
  price: number;
  /** today's price over base × TRADE_FACTOR at today's prices, minus 1 */
  rel: number;
  factor: number;
}

/** The goods a Trading House holds, each with today's national price (exported for tests). */
export function tradeRows(state: GameState, b: Building): PriceRow[] {
  const idx = priceIndex(state);
  return TRADE_GOODS.filter((g) => (b.input[g] ?? 0) > 0.5).map((g) => {
    const price = tradePrice(state, g);
    return { goodId: g, stock: b.input[g], price, rel: price / (getGood(g).basePrice * TRADE_FACTOR * idx) - 1, factor: state.trade.factor[g] ?? 1 };
  });
}

/** The trend pill: ▲ when the drift factor is above 1.05, ▼ below 0.95; a sagging (saturated) price warns. */
function trendPill(r: PriceRow): HTMLElement {
  const pct = Math.round(r.rel * 100);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  const arrow = r.factor > 1.05 ? '▲ ' : r.factor < 0.95 ? '▼ ' : '';
  const tone: Tone = r.factor > 1.05 ? 'positive' : r.factor < 0.95 ? 'negative' : pct <= -10 ? 'warning' : 'neutral';
  const el = pill(`${arrow}${sign}${Math.abs(pct)}%`, tone);
  el.title = pct <= -10 ? 'Against the usual national price: the market is glutted with it' : 'Against the usual national price';
  return el;
}

function priceTable(rows: PriceRow[]): HTMLElement {
  if (rows.length === 0) return emptyState({ icon: 'money', title: 'Route materials or components here to sell them' });
  return dataTable<PriceRow>({
    rowKey: (r) => r.goodId,
    emptyText: 'Route materials or components here to sell them',
    rows,
    columns: [
      { key: 'good', label: 'Good', render: (r) => h('span', { class: 'insp-good-name' }, iconEl(r.goodId, 16), h('span', { class: 'insp-good-label' }, getGood(r.goodId).name)) },
      { key: 'stock', label: 'Stock', align: 'right', render: (r) => formatNumber(Math.floor(r.stock)) },
      { key: 'price', label: 'Price', align: 'right', title: () => 'Paid per unit today', render: (r) => formatMoney(r.price) },
      { key: 'trend', label: 'vs usual', align: 'right', render: trendPill },
    ],
  });
}

const btnClass = (variant: 'primary' | 'secondary' | 'quiet' | 'danger', extra: string) => `btn kit-btn kit-btn--${variant} ${extra}`;

function buildView(host: InspectorHost, id: number): InspectorView {
  const state0 = host.ctx.state.buildings[id];
  const def0 = BUILDINGS[state0.typeId];
  const headerBox = h('div', { class: 'insp-header' });
  const owner = h('span', { class: 'insp-badge' });
  const levelPill = h('span', { class: 'insp-level-pill' });
  const reason = h('div', { class: 'insp-reason' });
  const staff = h('span', { class: 'insp-muted insp-staff' });
  const staffMeter = meter(1, 1, { label: 'Staffing' });
  const staffRow = h('div', { class: 'insp-staff-row' }, staff, staffMeter);
  const noRoad = h('div', { class: 'insp-warn' }, iconEl('warning', 14), ' No road access — trucks cannot reach this building');
  const housingLine = h('span');
  const housing = h('div', { class: 'insp-housing' }, housingLine);
  housing.hidden = true;
  const noRail = h('div', { class: 'insp-warn' }, iconEl('warning', 14), ' No track alongside — lay rail next to the station for trains');
  noRail.hidden = true;
  const recipeSel = h('select', {
    class: 'insp-recipe',
    'aria-label': 'Recipe',
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
  const recipeBox = h('label', { class: 'insp-recipe-box' }, h('span', { class: 'insp-label' }, 'Recipe'), recipeSel);
  // the production card: inputs → outputs, each a stock meter (Factorio/Anno style)
  const inBox = h('div', { class: 'insp-flow-side insp-flow-in' });
  const arrow = h('div', { class: 'insp-flow-arrow', 'aria-hidden': 'true' }, '→');
  const outBox = h('div', { class: 'insp-flow-side insp-flow-out' });
  const emptyStock = h('div', { class: 'insp-muted insp-flow-empty' }, 'Nothing in stock');
  const flow = h('div', { class: 'insp-flow' }, inBox, arrow, outBox);
  const produced = h('div', { class: 'insp-muted insp-produced' });
  const production = inspCard('Production', 'insp-production', [recipeBox, flow, emptyStock, produced]);
  const productionTitle = production.querySelector<HTMLElement>('.kit-card-title')!;
  // a Trading House's national prices for the goods it holds (sim/trade.ts)
  const pricesBox = h('div', { class: 'insp-trade-prices' });
  const prices = card({ title: 'National prices', children: [pricesBox] });
  prices.classList.add('insp-trade');
  prices.querySelector<HTMLElement>('.kit-card-title')!.classList.add('p-head');
  const routeBox = h('div', { class: 'insp-routes' });
  const send = h('button', {
    class: btnClass('secondary', 'insp-send'),
    type: 'button',
    'data-act': 'send-goods',
    title: 'Pick a destination on the map: creates a route and buys a vehicle',
    onClick: () => startSendGoods(host as unknown as GameController, id),
  });
  const routesSection = inspCard('Routes', 'insp-routes-card', [routeBox, send]);
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
  const scrubBtn = h('button', { class: btnClass('secondary', 'insp-upgrade'), type: 'button', 'data-act': 'scrubber', onClick: () => buy('scrubber') }) as HTMLButtonElement;
  const scrubWhy = h('div', { class: 'insp-muted insp-upgrade-why' });
  const chimneyBtn = h('button', { class: btnClass('secondary', 'insp-upgrade'), type: 'button', 'data-act': 'tall-chimney', onClick: () => buy('tallChimney') }) as HTMLButtonElement;
  const chimneyWhy = h('div', { class: 'insp-muted insp-upgrade-why' });
  const lawBox = h('div', { class: 'insp-laws' });
  const upgradesSection = inspCard('Upgrades', 'insp-upgrades', [scrubLine, scrubBtn, scrubWhy, chimneyBtn, chimneyWhy, lawBox], 'scrubber');
  const inList = new KeyedList<FlowRow>(inBox, makeFlowRow, (r) => r.dispose());
  const outList = new KeyedList<FlowRow>(outBox, makeFlowRow, (r) => r.dispose());

  const level = levelCard(host, state0);
  const ageText = h('div', { class: 'insp-age-line' });
  const renew = h('button', {
    class: btnClass('secondary', 'insp-renew'),
    type: 'button',
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
  const ageSection = inspCard('Age', 'insp-age', [ageText, renew]);

  let confirming = false;
  let confirmTimer = 0;
  const demolish = h('button', {
    class: btnClass('danger', 'danger insp-demolish'),
    type: 'button',
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
  const footer = h('div', { class: 'p-actions insp-footer' }, demolish);

  const el = h(
    'div',
    { class: 'insp insp-building' },
    headerBox,
    h('div', { class: 'insp-head' }, owner, levelPill),
    reason,
    staffRow,
    housing,
    noRoad,
    noRail,
    production,
    prices,
    routesSection,
    level.el,
    upgradesSection,
    ageSection,
    footer,
  );

  let recipeSig = '';
  let routeSig = '\0';
  const view: InspectorView = {
    el,
    dispose: () => {
      clearTimeout(confirmTimer);
      for (const list of [inList, outList]) for (const row of list.items.values()) row.dispose();
    },
    update() {
      const { state } = host.ctx;
      const b = state.buildings[id];
      if (!b) return false;
      const def = BUILDINGS[b.typeId];
      const mine = b.ownerId === 'player';
      const home = housingText(state, b);
      const advice = home ? { text: home.orphan ? 'Standing empty' : 'Housing hands', tone: (home.orphan ? 'warning' : 'neutral') as Tone } : statusAdvice(state, b);
      swap(headerBox, `${def.name}|${advice.tone}|${advice.text}`, () => panelHeader({ title: def.name, summary: advice.text, tone: advice.tone }));
      setOwnerBadge(owner, state, b.ownerId);
      setText(levelPill, b.level ? `Level ${b.level}` : '');
      levelPill.hidden = !b.level;
      setClass(levelPill, 'kit-pill kit-pill--neutral insp-level-pill');
      const routes = routesServing(state, id);
      setText(reason, statusReason(state, b, routes));
      // staffing scales production only; stores and depots still draw on the pool but show no row
      staff.hidden = staffRow.hidden = def.category === 'retail' || def.category === 'trade' || def.category === 'logistics';
      if (!staff.hidden) {
        const text = staffingText(state, b);
        setText(staff, text);
        setMeter(staffMeter, Number(b.staffing.toFixed(2)), 1, b.staffing >= 1 && !text.includes('go-slow') ? 'positive' : b.staffing < 0.6 ? 'negative' : 'warning', text);
      }
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
        if (b.recipeId && recipeSel.value !== b.recipeId && document.activeElement !== recipeSel) recipeSel.value = b.recipeId;
        recipeSel.disabled = !mine || ids.length < 2;
      }

      // the production card: stores and depots show their shelves instead of a recipe
      const recipe = b.recipeId ? RECIPES[b.recipeId] : undefined;
      const shared = def.category === 'retail' || def.category === 'trade' || def.category === 'logistics';
      setText(productionTitle, shared ? 'Stock' : 'Production');
      const keys = (want: string[], inv: Record<string, number>) => [
        ...want,
        ...Object.keys(inv).filter((g) => !want.includes(g) && (inv[g] ?? 0) > 0.5),
      ];
      const stock = shared ? loadSource(b) : b.input;
      const inKeys = shared ? Object.keys(stock).filter((g) => (stock[g] ?? 0) > 0.5) : keys(Object.keys(recipe?.inputs ?? {}), b.input);
      const outKeys = shared ? [] : keys(Object.keys(recipe?.outputs ?? {}), b.output);
      inList.sync(inKeys);
      outList.sync(outKeys);
      inBox.hidden = inKeys.length === 0;
      outBox.hidden = outKeys.length === 0;
      arrow.hidden = inBox.hidden || outBox.hidden;
      flow.classList.toggle('insp-flow--single', arrow.hidden);
      emptyStock.hidden = !shared || inKeys.length > 0;
      const cap = buildingStorage(b);
      for (const [g, row] of inList.items) {
        const q = stock[g] ?? 0;
        const need = recipe?.inputs[g] ?? 0;
        setText(row.qty, `${formatNumber(q)} / ${cap}`);
        setMeter(row.meter, Math.round(q), cap, need > 0 && q < need ? 'warning' : 'neutral', `${getGood(g).name}: ${formatNumber(q)} / ${cap}`);
      }
      for (const [g, row] of outList.items) {
        const q = b.output[g] ?? 0;
        const batch = recipe?.outputs[g] ?? 0;
        setText(row.qty, `${formatNumber(q)} / ${cap}`);
        setMeter(row.meter, Math.round(q), cap, q + batch > cap ? 'warning' : 'positive', `${getGood(g).name}: ${formatNumber(q)} / ${cap}`);
      }
      produced.hidden = shared;
      prices.hidden = def.category !== 'trade';
      if (!prices.hidden) {
        const rows = tradeRows(state, b);
        const sig = rows.map((r) => `${r.goodId}:${Math.floor(r.stock)}:${r.price}:${Math.round(r.rel * 100)}:${r.factor > 1.05 ? 1 : r.factor < 0.95 ? -1 : 0}`).join('|');
        swap(pricesBox, sig || '-', () => priceTable(rows));
      }
      const made = Object.values(b.producedThisMonth).reduce((n, q) => n + (q > 0 ? q : 0), 0);
      setText(produced, `Produced this month: ${formatNumber(made)}`);

      const rsig = routes.map((r) => `${r.id}:${r.name}:${r.color}`).join('|');
      if (rsig !== routeSig) {
        routeSig = rsig;
        routeBox.replaceChildren(
          ...(routes.length > 0
            ? routes.map((r) => h('button', {
              class: 'insp-route insp-route-link',
              type: 'button',
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
        send.replaceChildren(iconEl(send.dataset.kind, 16), h('span', { class: 'kit-btn-label' }, 'Send goods to…'));
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
      demolish.hidden = footer.hidden = !mine;
      setText(
        demolish,
        confirming ? `Confirm demolish (+${formatMoney(demolitionRefund(state, b))} refund)` : 'Demolish',
      );
      setClass(demolish, btnClass('danger', `danger insp-demolish${confirming ? ' confirm' : ''}`));
      // company housing takes no cargo: its line replaces the status, stock and route rows
      housing.hidden = home === null;
      if (home) {
        setText(housingLine, home.text);
        setClass(housing, home.orphan ? 'insp-housing insp-warn' : 'insp-housing insp-muted');
        reason.hidden = true;
        noRoad.hidden = true;
        production.hidden = true;
        routesSection.hidden = true;
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
