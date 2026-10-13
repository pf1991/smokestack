import { BUILDINGS, HOUSING_POOL, HOUSING_RADIUS } from '../../data/buildings';
import { getGood } from '../../data/goods';
import { RECIPES } from '../../data/recipes';
import { formatDate, isWinter } from '../../sim/clock';
import { loadSource } from '../../sim/inventory';
import { STATION_TYPE, stationAccess } from '../../sim/rail';
import { accessTiles, DEMOLITION_REFUND, demolishBuilding, footprint } from '../../sim/state';
import type { GameController } from '../../game/controller';
import { offeredGoods } from '../../sim/routeHelpers';
import { housingFactory, workCity } from '../../sim/politics/workforce';
import type { Building, GameState, Route } from '../../sim/types';
import { type Child, h } from '../dom';
import { iconEl } from '../icon';
import { formatMoney, formatNumber } from '../format';
import './panels.css';
import { bar, type Bar, KeyedList, openInspector, setClass, setText, type InspectorHost, type InspectorView } from './inspect';
import type { PanelDef } from './index';
import { startSendGoods } from './routeActions';

const STATUS_LABEL: Record<Building['status'], string> = {
  ok: 'Running',
  no_input: 'Waiting',
  output_full: 'Full',
  halted: 'Halted',
  idle: 'Idle',
};

const goodLabel = (id: string): Child[] => [iconEl(id, 16), ` ${getGood(id).name}`];

/** The inspector's staffing line: "Staff 100%", "Staff 85% — short of hands in Ashford", or "Staff 75% — remote works". */
export function staffingText(state: GameState, b: Building): string {
  // floored, so a building one hand short never reads "100%"
  const pct = `Staff ${Math.floor(b.staffing * 100 + 1e-9)}%`;
  if (b.staffing >= 1) return pct;
  const city = workCity(state, b);
  return city ? `${pct} — short of hands in ${city.name}` : `${pct} — remote works`;
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

/** Plain-language explanation of what the building is doing (exported for tests). */
export function statusReason(state: GameState, b: Building, routes: Route[]): string {
  const def = BUILDINGS[b.typeId];
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
  const recipeBox = h('div', { class: 'insp-section' }, h('div', { class: 'insp-label' }, 'Recipe'), recipeSel);
  const routesSection = h('div', { class: 'insp-section' });
  const inBox = h('div', { class: 'insp-list' });
  const outBox = h('div', { class: 'insp-list' });
  const inSection = h('div', { class: 'insp-section' }, h('div', { class: 'insp-label' }, 'Inputs'), inBox);
  const outSection = h('div', { class: 'insp-section' }, h('div', { class: 'insp-label' }, 'Output'), outBox);
  const produced = h('div', { class: 'insp-muted' });
  const routeBox = h('div', { class: 'insp-routes' });
  const send = h('button', {
    class: 'btn insp-send',
    'data-act': 'send-goods',
    title: 'Pick a destination on the map: creates a route and buys a vehicle',
    onClick: () => startSendGoods(host as unknown as GameController, id),
  });
  const inList = new KeyedList<Row>(inBox, makeRow);
  const outList = new KeyedList<Row>(outBox, makeRow);

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
      const r = demolishBuilding(host.ctx, id, 'player');
      host.ctx.bus.emit(
        r.ok
          ? { type: 'toast', message: `${def0.name} demolished — refunded ${formatMoney(def0.cost * DEMOLITION_REFUND)}`, tone: 'good' }
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
    demolish,
  );

  routesSection.append(h('div', { class: 'insp-label' }, 'Routes'), routeBox, send);
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
      setText(owner, mine ? state.companies.player.name : state.companies.rival.name);
      setClass(owner, `insp-badge ${mine ? 'owner-player' : 'owner-rival'}`);
      setText(statusBadge, STATUS_LABEL[b.status]);
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
      for (const [g, row] of inList.items) {
        const q = b.input[g] ?? 0;
        row.bar.set(q / def.storage, `${formatNumber(q)} / ${def.storage}`);
      }
      for (const [g, row] of outList.items) {
        const q = b.output[g] ?? 0;
        row.bar.set(q / def.storage, `${formatNumber(q)} / ${def.storage}`);
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
      demolish.hidden = !mine;
      setText(
        demolish,
        confirming ? `Confirm demolish (+${formatMoney(def.cost * DEMOLITION_REFUND)} refund)` : 'Demolish',
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
