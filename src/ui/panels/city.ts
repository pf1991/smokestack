import { BUILDINGS } from '../../data/buildings';
import { LANDMARKS, PHILANTHROPY_IDS, type PhilanthropyId } from '../../data/landmarks';
import { buyPhilanthropy, philanthropyBlocker } from '../../sim/politics/edicts';
import { DEMAND_PER_1000, GOODS } from '../../data/goods';
import { FACTION_IDS, FACTIONS, factionName, type FactionId } from '../../data/factions';
import { endorse, ENDORSE_WINDOW, monthIndex } from '../../sim/politics/elections';
import { loadSource } from '../../sim/inventory';
import { monthlyDemand, salePrice, satisfaction, supplyRatio } from '../../sim/market';
import { demandModifier } from '../../sim/production';
import type { City, GameState } from '../../sim/types';
import { h } from '../dom';
import { iconEl } from '../icon';
import { formatMoney, formatNumber, formatPercent } from '../format';
import './panels.css';
import './politics.css';
import { bar, type Bar, KeyedList, openInspector, setText, type InspectorHost, type InspectorView } from './inspect';
import type { PanelDef } from './index';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLAYER_COLOR = '#2f6fb5';
const RIVAL_COLOR = '#b5302f';

export interface GoodDemand {
  goodId: string;
  demand: number;
  satisfaction: number;
  price: number;
  /** unmet monthly demand x price */
  unmetValue: number;
}

/** Tier-2 goods the city currently wants, most-craved first (exported for tests). */
export function cityDemand(state: GameState, city: City): GoodDemand[] {
  const out: GoodDemand[] = [];
  for (const goodId of Object.keys(DEMAND_PER_1000)) {
    const g = GOODS[goodId];
    if (!g || g.tier !== 2 || !state.unlocked.includes(goodId)) continue;
    const demand = monthlyDemand(city, goodId, state.date.year, demandModifier(state, city.id, goodId));
    if (demand <= 0) continue;
    const sat = satisfaction(city, goodId);
    const price = salePrice(goodId, supplyRatio(city.market[goodId]));
    out.push({ goodId, demand, satisfaction: sat, price, unmetValue: demand * (1 - sat) * price });
  }
  return out.sort((a, b) => b.unmetValue - a.unmetValue || a.goodId.localeCompare(b.goodId));
}

interface GoodRow extends Record<string, unknown> {
  el: HTMLElement;
  demand: HTMLElement;
  sat: Bar;
  price: HTMLElement;
  stores: HTMLElement;
  crave: HTMLElement;
  storeSig: string;
}

function makeRow(goodId: string): GoodRow {
  const g = GOODS[goodId];
  const demand = h('td', { class: 'num' });
  const sat = bar('#6fae5a');
  const price = h('td', { class: 'num' });
  const stores = h('td', { class: 'insp-dots' });
  const crave = h('span', { class: 'insp-crave' });
  const el = h(
    'tr',
    { class: 'insp-good', 'data-good': goodId },
    h('td', null, iconEl(goodId, 16), ` ${g.name}`, crave),
    demand,
    h('td', null, sat.el),
    price,
    stores,
  );
  return { el, demand, sat, price, stores, crave, storeSig: '\0' };
}

/** "Church +6, Reformers +6, Workers +2": a philanthropy landmark's one-off opinion gains. */
function effectsLine(id: PhilanthropyId, year: number): string {
  const effects = LANDMARKS[id].philanthropy?.effects ?? {};
  return FACTION_IDS.filter((f) => effects[f])
    .sort((a, b) => effects[b]! - effects[a]! || FACTION_IDS.indexOf(a) - FACTION_IDS.indexOf(b))
    .map((f) => `${factionName(f, year)} +${effects[f]}`)
    .join(', ');
}

function buildView(host: InspectorHost, cityId: number): InspectorView {
  const pop = h('span');
  const trend = h('span', { class: 'insp-trend' });
  const happy = bar('#e0b43a');
  const smog = bar('#6b6b70');
  const landmarks = h('ul', { class: 'insp-landmarks' });
  let landmarkSig = '\0';
  const opinion = FACTION_IDS.map((f: FactionId) => {
    const label = h('span', { class: 'insp-label' });
    const b = bar(FACTIONS[f].color);
    const el = h('div', { class: 'insp-stat insp-opinion', 'data-faction': f, title: `Likes: ${FACTIONS[f].likes}. Hates: ${FACTIONS[f].hates}.` }, label, b.el);
    return { f, label, bar: b, el };
  });
  const gifts = PHILANTHROPY_IDS.map((id: PhilanthropyId) => {
    const def = LANDMARKS[id];
    const btn = h('button', {
      class: 'insp-endow',
      'data-endow': id,
      onClick: () => {
        const r = buyPhilanthropy(host.ctx, cityId, id);
        host.ctx.bus.emit(r.ok
          ? { type: 'toast', message: `You endowed a ${def.name.toLowerCase()} in ${host.ctx.state.cities[cityId]?.name ?? 'the town'}`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' });
        view.update();
      },
    }, iconEl(id, 16), ` Endow a ${def.name.toLowerCase()} — ${formatMoney(def.philanthropy!.cost)}`);
    return { id, btn };
  });
  const mayorName = h('span', { class: 'insp-mayor-name' });
  const mayorChip = h('span', { class: 'insp-chip' });
  const councilChip = h('span', { class: 'insp-chip' });
  const electionRow = h('span');
  const endorseSel = h(
    'select',
    { class: 'insp-endorse-select', 'aria-label': 'Faction to endorse' },
    ...FACTION_IDS.map((f) => h('option', { value: f }, FACTIONS[f].name)),
  ) as HTMLSelectElement;
  const endorseBtn = h('button', {
    class: 'insp-endorse-btn',
    onClick: () => {
      const r = endorse(host.ctx, cityId, endorseSel.value as FactionId);
      host.ctx.bus.emit(r.ok
        ? { type: 'toast', message: `You endorsed the ${FACTIONS[endorseSel.value as FactionId].name} candidate`, tone: 'good' }
        : { type: 'toast', message: r.error, tone: 'bad' });
      view.update();
    },
  }, 'Endorse') as HTMLButtonElement;
  const endorseRow = h('div', { class: 'insp-stat insp-endorse' }, h('span', { class: 'insp-label' }, 'Endorse'), h('span', null, endorseSel, ' ', endorseBtn));
  const tbody = h('tbody');
  const rows = new KeyedList<GoodRow>(tbody, makeRow);
  const el = h(
    'div',
    { class: 'insp' },
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Population'), h('span', null, pop, ' ', trend)),
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Happiness'), happy.el),
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Pollution'), smog.el),
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Landmarks'), landmarks),
    h('div', { class: 'insp-stat insp-mayor' }, h('span', { class: 'insp-label' }, 'Mayor'), h('span', null, mayorName, ' ', mayorChip)),
    h('div', { class: 'insp-stat insp-council' }, h('span', { class: 'insp-label' }, 'Council'), councilChip),
    h('div', { class: 'insp-stat insp-election' }, h('span', { class: 'insp-label' }, 'Next election'), electionRow),
    endorseRow,
    h('div', { class: 'insp-section insp-opinions' }, h('div', { class: 'insp-label' }, 'Opinion of your company'), ...opinion.map((o) => o.el)),
    h('div', { class: 'insp-section insp-philanthropy' }, h('div', { class: 'insp-label' }, 'Philanthropy'), ...gifts.map((g) => g.btn)),
    h(
      'table',
      { class: 'insp-table' },
      h('thead', null, h('tr', null, h('th', null, 'Good'), h('th', null, 'Demand/mo'), h('th', null, 'Supplied'), h('th', null, 'Price'), h('th', null, 'Stores'))),
      tbody,
    ),
  );
  const view: InspectorView = {
    el,
    update() {
      const { state } = host.ctx;
      const city = state.cities[cityId];
      if (!city) return false;
      for (const g of gifts) {
        const why = philanthropyBlocker(state, city.id, g.id);
        const disabled = why !== null;
        if ((g.btn as HTMLButtonElement).disabled !== disabled) (g.btn as HTMLButtonElement).disabled = disabled;
        const tip = why ?? `Opinion in ${city.name}: ${effectsLine(g.id, state.date.year)}`;
        if (g.btn.title !== tip) g.btn.title = tip;
      }
      const pol = city.politics;
      const year = state.date.year;
      setText(mayorName, pol.mayor.name);
      for (const [chip, f] of [[mayorChip, pol.mayor.faction], [councilChip, pol.council]] as const) {
        setText(chip, factionName(f, year));
        chip.style.background = FACTIONS[f].color;
      }
      const due = pol.nextElection;
      setText(electionRow, `${MONTH_NAMES[due % 12]} ${Math.floor(due / 12)}`);
      const open = due - monthIndex(state.date) <= ENDORSE_WINDOW;
      endorseRow.hidden = !open;
      if (open) {
        const done = pol.endorsed !== null;
        if (endorseSel.disabled !== done) endorseSel.disabled = endorseBtn.disabled = done;
        if (done && endorseSel.value !== pol.endorsed) endorseSel.value = pol.endorsed!;
        setText(endorseBtn, done ? 'Endorsed' : 'Endorse');
      }
      setText(pop, formatNumber(city.population));
      const diff = city.population - city.prevPopulation;
      setText(trend, diff > 0 ? `▲ ${formatNumber(diff)}` : diff < 0 ? `▼ ${formatNumber(-diff)}` : '–');
      trend.className = `insp-trend ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`.trim();
      happy.set(city.happiness, formatPercent(city.happiness));
      smog.set(city.pollution, formatPercent(city.pollution));
      for (const o of opinion) {
        const v = city.opinion?.[o.f] ?? 50;
        setText(o.label, factionName(o.f, state.date.year));
        o.bar.set(v / 100, String(Math.round(v)));
      }
      const sig = city.landmarks.map((l) => l.id).join(',');
      if (sig !== landmarkSig) {
        landmarkSig = sig;
        landmarks.replaceChildren(
          ...(city.landmarks.length > 0
            ? city.landmarks.map((l) => h('li', { 'data-landmark': l.id }, iconEl(l.id, 16), LANDMARKS[l.id].name))
            : [h('li', { class: 'insp-none' }, 'None yet')]),
        );
      }

      const demand = cityDemand(state, city);
      rows.sync(demand.map((d) => d.goodId));
      const craved = new Set(demand.filter((d) => d.unmetValue > 0).slice(0, 3).map((d) => d.goodId));
      const stores = Object.values(state.buildings).filter((b) => b.cityId === cityId && BUILDINGS[b.typeId].category === 'retail');
      for (const d of demand) {
        const row = rows.items.get(d.goodId)!;
        setText(row.demand, formatNumber(d.demand));
        row.sat.set(d.satisfaction, formatPercent(d.satisfaction));
        setText(row.price, formatMoney(d.price));
        const craves = craved.has(d.goodId);
        if (craves !== (row.crave.childNodes.length > 0)) {
          row.crave.replaceChildren(...(craves ? [' ', iconEl('star', 12), ' Craves'] : []));
        }
        const sellers = stores.filter((s) => (loadSource(s)[d.goodId] ?? 0) >= 1);
        const sig = sellers.map((s) => `${s.id}${s.ownerId}`).join(',');
        if (sig !== row.storeSig) {
          row.storeSig = sig;
          row.stores.replaceChildren(
            ...(sellers.length > 0
              ? sellers.map((s) =>
                  h('span', {
                    class: 'dot',
                    title: `${s.ownerId === 'player' ? 'Your' : 'Rival'} store`,
                    style: { background: s.ownerId === 'player' ? PLAYER_COLOR : RIVAL_COLOR },
                  }),
                )
              : ['—']),
          );
        }
      }
      return true;
    },
  };
  return view;
}

export const cityPanel: PanelDef = {
  id: 'city',
  open(game, arg) {
    const host = game as unknown as InspectorHost;
    const id = Number(arg);
    const city = host.ctx.state.cities[id];
    if (!city) return;
    openInspector(host, { id: `city-${id}`, title: city.name, width: 520, build: () => buildView(host, id) });
  },
};
