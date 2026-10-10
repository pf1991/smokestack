import { BUILDINGS } from '../../data/buildings';
import { DEMAND_PER_1000, GOODS } from '../../data/goods';
import { loadSource } from '../../sim/inventory';
import { monthlyDemand, salePrice, satisfaction, supplyRatio } from '../../sim/market';
import { demandModifier } from '../../sim/production';
import type { City, GameState } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber, formatPercent } from '../format';
import './panels.css';
import { bar, type Bar, KeyedList, openInspector, setText, type InspectorHost, type InspectorView } from './inspect';
import type { PanelDef } from './index';

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
    h('td', null, `${g.icon} ${g.name}`, crave),
    demand,
    h('td', null, sat.el),
    price,
    stores,
  );
  return { el, demand, sat, price, stores, crave, storeSig: '\0' };
}

function buildView(host: InspectorHost, cityId: number): InspectorView {
  const pop = h('span');
  const trend = h('span', { class: 'insp-trend' });
  const happy = bar('#e0b43a');
  const smog = bar('#6b6b70');
  const tbody = h('tbody');
  const rows = new KeyedList<GoodRow>(tbody, makeRow);
  const el = h(
    'div',
    { class: 'insp' },
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Population'), h('span', null, pop, ' ', trend)),
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Happiness'), happy.el),
    h('div', { class: 'insp-stat' }, h('span', { class: 'insp-label' }, 'Pollution'), smog.el),
    h(
      'table',
      { class: 'insp-table' },
      h('thead', null, h('tr', null, h('th', null, 'Good'), h('th', null, 'Demand/mo'), h('th', null, 'Supplied'), h('th', null, 'Price'), h('th', null, 'Stores'))),
      tbody,
    ),
  );
  return {
    el,
    update() {
      const { state } = host.ctx;
      const city = state.cities[cityId];
      if (!city) return false;
      setText(pop, formatNumber(city.population));
      const diff = city.population - city.prevPopulation;
      setText(trend, diff > 0 ? `▲ ${formatNumber(diff)}` : diff < 0 ? `▼ ${formatNumber(-diff)}` : '–');
      trend.className = `insp-trend ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`.trim();
      happy.set(city.happiness, formatPercent(city.happiness));
      smog.set(city.pollution, formatPercent(city.pollution));

      const demand = cityDemand(state, city);
      rows.sync(demand.map((d) => d.goodId));
      const craved = new Set(demand.filter((d) => d.unmetValue > 0).slice(0, 3).map((d) => d.goodId));
      const stores = Object.values(state.buildings).filter((b) => b.cityId === cityId && BUILDINGS[b.typeId].category === 'retail');
      for (const d of demand) {
        const row = rows.items.get(d.goodId)!;
        setText(row.demand, formatNumber(d.demand));
        row.sat.set(d.satisfaction, formatPercent(d.satisfaction));
        setText(row.price, formatMoney(d.price));
        setText(row.crave, craved.has(d.goodId) ? ' ★ Craves' : '');
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
