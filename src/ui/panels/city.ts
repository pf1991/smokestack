import { BUILDINGS } from '../../data/buildings';
import { LANDMARKS, PHILANTHROPY_IDS, type PhilanthropyId } from '../../data/landmarks';
import { buyPhilanthropy, philanthropyBlocker, philanthropyCost } from '../../sim/politics/edicts';
import {
  activeEdicts,
  CHURCH_OBJECTION,
  churchFactor,
  landPriceFactor,
  MAYOR_EDICTS,
  mayorEdictEffect,
  reformersDemandPermits,
} from '../../sim/politics/mayorEdicts';
import { DEMAND_PER_1000, GOODS } from '../../data/goods';
import { FACTION_IDS, FACTIONS, factionName, type FactionId } from '../../data/factions';
import { endorse, ENDORSE_WINDOW, monthIndex, paySlush, slushBlocker, slushCost, slushOdds } from '../../sim/politics/elections';
import { loadSource } from '../../sim/inventory';
import { monthlyDemand, salePrice, satisfaction, supplyRatio } from '../../sim/market';
import { demandModifier } from '../../sim/production';
import { priceIndex } from '../../sim/society/economy';
import { forcedEdicts, SMOG_HINT, SMOG_TIER_NAMES, SMOG_TIER_THRESHOLDS } from '../../sim/society/tiers';
import type { City, GameState, OwnerId } from '../../sim/types';
import { ownerColor } from '../../render/ownerColors';
import { h } from '../dom';
import { nowCard, progressiveDisclosure, type NowItem } from '../disclosure';
import { iconEl } from '../icon';
import { formatMoney, formatNumber, formatPercent } from '../format';
import './panels.css';
import { openInspector, setMeter, setText, swap, type InspectorHost, type InspectorView } from './inspect';
import { dataTable, meter, panelHeader, section, statRow, statTile, type Tone } from '../kit';
import { laborPool } from '../../sim/politics/workforce';
import type { PanelDef } from './index';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLAYER_COLOR = '#2f6fb5';
const RIVAL_COLOR = '#b5302f';

/** A store dot's tooltip: yours, the Baron's ("Rival store") or a regional firm's ("<Firm name> store"). */
export function storeTitle(state: GameState, ownerId: OwnerId): string {
  if (ownerId === 'player') return 'Your store';
  if (ownerId === 'rival') return 'Rival store';
  return `${state.companies[ownerId]?.name ?? ownerId} store`;
}

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
    if (!g || g.kind !== 'consumer' || !state.unlocked.includes(goodId)) continue;
    const demand = monthlyDemand(city, goodId, state.date.year, demandModifier(state, city.id, goodId));
    if (demand <= 0) continue;
    const sat = satisfaction(city, goodId);
    const price = salePrice(goodId, supplyRatio(city.market[goodId]), priceIndex(state));
    out.push({ goodId, demand, satisfaction: sat, price, unmetValue: demand * (1 - sat) * price });
  }
  return out.sort((a, b) => b.unmetValue - a.unmetValue || a.goodId.localeCompare(b.goodId));
}

/** 1–3 city decisions for the Now card: top unmet demand / empty shelves (E5). */
export function cityNow(state: GameState, city: City): NowItem[] {
  const demand = cityDemand(state, city);
  const unmet = demand.filter((d) => d.unmetValue > 0).slice(0, 3);
  if (unmet.length === 0) {
    return [{ label: 'Shelves look stocked', detail: 'No big unmet demand right now', tone: 'positive' }];
  }
  return unmet.map((d) => ({
    label: `${GOODS[d.goodId]?.name ?? d.goodId} unmet`,
    detail: `${formatPercent(1 - d.satisfaction)} short · ${formatMoney(d.price)} each`,
    tone: d.satisfaction < 0.4 ? 'negative' : 'warning',
  }));
}

/** One demand row's figures, also the table's refresh key. */
interface DemandRow {
  goodId: string;
  demand: number;
  sat: number;
  price: number;
  craves: boolean;
  sellers: { id: number; ownerId: OwnerId }[];
}

/** The goods the town buys as a kit table: rows keep `tr.insp-good[data-good]` for tests and the tutorial. */
function demandTable(state: GameState, rows: DemandRow[]): HTMLElement {
  const table = dataTable<DemandRow>({
    rowKey: (r) => r.goodId,
    emptyText: 'No demand for manufactured goods yet',
    rows,
    columns: [
      {
        key: 'good',
        label: 'Good',
        title: (r) => (r.craves ? `${GOODS[r.goodId].name}: craved (big unmet demand)` : GOODS[r.goodId].name),
        render: (r) =>
          h('span', { class: 'insp-good-name' }, iconEl(r.goodId, 16), h('span', { class: 'insp-good-label' }, GOODS[r.goodId].name),
            h('span', { class: 'insp-crave' }, ...(r.craves ? [iconEl('star', 12), ' Craves'] : []))),
      },
      { key: 'demand', label: 'Demand', align: 'right', render: (r) => formatNumber(r.demand) },
      {
        key: 'sat',
        label: 'Supplied',
        render: (r) => h('span', { class: 'insp-sat' }, meter(r.sat, 1, { tone: r.sat >= 0.8 ? 'positive' : r.sat >= 0.4 ? 'warning' : 'negative', label: `Supplied ${formatPercent(r.sat)}` }), h('span', { class: 'insp-sat-val' }, formatPercent(r.sat))),
      },
      { key: 'price', label: 'Price', align: 'right', render: (r) => formatMoney(r.price) },
      {
        key: 'stores',
        label: 'Stores',
        render: (r) =>
          h('span', { class: 'insp-dots' }, ...(r.sellers.length > 0
            ? r.sellers.map((s) => h('span', {
                class: 'dot',
                title: storeTitle(state, s.ownerId),
                style: { background: s.ownerId === 'player' ? PLAYER_COLOR : s.ownerId === 'rival' ? RIVAL_COLOR : ownerColor(s.ownerId) },
              }))
            : ['—'])),
      },
    ],
  });
  const body = (table as HTMLTableElement).tBodies[0];
  if (rows.length > 0) {
    [...body.rows].forEach((tr, i) => {
      tr.classList.add('insp-good');
      tr.dataset.good = rows[i].goodId;
    });
  }
  return table;
}

/** "Church +6, Reformers +6, Workers +2": a philanthropy landmark's one-off opinion gains. */
function effectsLine(id: PhilanthropyId, year: number): string {
  const effects = LANDMARKS[id].philanthropy?.effects ?? {};
  return FACTION_IDS.filter((f) => effects[f])
    .sort((a, b) => effects[b]! - effects[a]! || FACTION_IDS.indexOf(a) - FACTION_IDS.indexOf(b))
    .map((f) => `${factionName(f, year)} +${effects[f]}`)
    .join(', ');
}

export interface SmogTierLine {
  tier: number;
  name: string;
  /** the smog level (3-month average) as shown, e.g. "4.2%" */
  level: string;
  trend: 'up' | 'down' | '';
  /** what the tier does, then what lowers it */
  hint: string;
}

const TIER_EFFECTS = [
  'Clear skies.',
  'Reformers and workers sour each month; the papers grumble.',
  'Black Lung deaths, slower growth and fewer hands for the works.',
  'Marchers slow your smokestacks near town to 80%.',
  'The town imposes a smog limit and permits; reformers surge at the polls.',
];

/** The city panel's smog tier row (exported for tests). Trend: this month's smog against the 3-month level. */
export function smogTierLine(city: City): SmogTierLine {
  const s = city.smog;
  const tier = s?.tier ?? 0;
  const level = s?.level ?? city.pollution;
  const gap = city.pollution - level;
  const trend = gap > 0.001 ? 'up' : gap < -0.001 ? 'down' : '';
  const next = tier < 4 ? ` Next tier above ${formatPercent(SMOG_TIER_THRESHOLDS[tier + 1])}.` : '';
  return { tier, name: SMOG_TIER_NAMES[tier], level: `${(level * 100).toFixed(1)}%`, trend, hint: `${TIER_EFFECTS[tier]}${next} ${SMOG_HINT}.` };
}

export interface ClassSegment {
  key: 'working' | 'middle' | 'upper';
  label: string;
  share: number;
  color: string;
}

const CLASS_LABELS: readonly ClassSegment['key'][] = ['working', 'middle', 'upper'];
const CLASS_NAMES: Record<ClassSegment['key'], string> = { working: 'Working', middle: 'Middle', upper: 'Upper' };
const CLASS_COLORS: Record<ClassSegment['key'], string> = { working: '#8a5a3c', middle: '#c9a24a', upper: '#6d4f8f' };

/** The city panel's class bar: Working / Middle / Upper shares (exported for tests). */
export function classSegments(city: City): ClassSegment[] {
  const c = city.classes ?? { working: 1, middle: 0, upper: 0 };
  return CLASS_LABELS.map((key) => ({ key, label: CLASS_NAMES[key], share: c[key], color: CLASS_COLORS[key] }));
}

/** Where a town's edicts and levers reach (siteCity zone vs workCity staffing, sim/politics/mayorEdicts.ts). */
export const EDICT_REACH = "Permits and land prices apply within the town's zone (its urban area plus 4 tiles). Wages and tolls apply to works staffed from the town.";

interface EdictLine {
  key: string;
  icon: string;
  name: string;
  effect: string;
}

/** The town's edicts in force, then the faction levers on construction (exported for tests). */
export function cityEdictLines(city: City, year: number, index = 1): EdictLine[] {
  const out: EdictLine[] = activeEdicts(city).map((id) => {
    const info = MAYOR_EDICTS[id];
    const own = city.politics.edicts.includes(id);
    const forced = id === 'permits_required' && !own && reformersDemandPermits(city);
    const revolt = !own && !forced && forcedEdicts(city).includes(id);
    const by = revolt ? 'smog revolt' : forced ? `${factionName('reformers', year)} demand` : `${factionName(city.politics.mayor.faction, year)} mayor`;
    return { key: id, icon: info.icon, name: info.name, effect: `${mayorEdictEffect(id, index)} (${by})` };
  });
  const land = landPriceFactor(city);
  if (Math.abs(land - 1) >= 0.005) {
    out.push({ key: 'land', icon: 'top_hat', name: 'Land price', effect: `Building here costs ×${land.toFixed(2)} (Old Money)` });
  }
  if (churchFactor(city) !== 1) {
    out.push({
      key: 'church', icon: 'church', name: 'Community objections',
      effect: `Building here costs +${Math.round((CHURCH_OBJECTION - 1) * 100)}% (${factionName('church', year)})`,
    });
  }
  return out;
}

const trendText = (diff: number) => (diff > 0 ? `▲ ${formatNumber(diff)}` : diff < 0 ? `▼ ${formatNumber(-diff)}` : '–');

function buildView(host: InspectorHost, cityId: number): InspectorView {
  const headerBox = h('div', { class: 'insp-header' });
  const statsBox = h('div', { class: 'insp-city-stats' });
  const smogTierName = h('b', { class: 'insp-smog-tier' });
  const smogTierLevel = h('span', { class: 'insp-smog-level' });
  const smogTierTrend = h('span', { class: 'insp-trend' });
  const smogTierHint = h('small', { class: 'insp-smog-hint' });
  const pollutionNow = h('span', { class: 'insp-muted insp-pollution' });
  const smogTierRow = h('div', { class: 'insp-smog' },
    h('div', { class: 'insp-smog-line' }, smogTierName, ' ', smogTierLevel, ' ', smogTierTrend, pollutionNow),
    smogTierHint);
  const classParts = CLASS_LABELS.map((key) => {
    const text = h('span', { class: 'insp-class-text' });
    const el = h('div', { class: 'insp-class-seg', 'data-class': key, style: { background: CLASS_COLORS[key], width: '0%' } }, text);
    return { key, el, text };
  });
  const classRow = h('div', { class: 'p-row insp-stat insp-classes' },
    h('span', { class: 'insp-label' }, 'Classes'),
    h('div', { class: 'insp-class-bar', role: 'img' }, ...classParts.map((p) => p.el)));
  const landmarks = h('ul', { class: 'insp-landmarks' });
  let landmarkSig = '\0';
  const edictList = h('ul', { class: 'insp-edicts' });
  let edictSig = '\0';
  const opinion = FACTION_IDS.map((f: FactionId) => {
    const label = h('span', { class: 'insp-label' });
    const m = meter(50, 100, { label: FACTIONS[f].name });
    (m.firstElementChild as HTMLElement).style.background = FACTIONS[f].color;
    const val = h('span', { class: 'insp-opinion-val' });
    const el = h('div', { class: 'insp-opinion', 'data-faction': f, title: `Likes: ${FACTIONS[f].likes}. Hates: ${FACTIONS[f].hates}.` }, label, m, val);
    return { f, label, meter: m, val, el };
  });
  const gifts = PHILANTHROPY_IDS.map((id: PhilanthropyId) => {
    const def = LANDMARKS[id];
    // the price follows inflation: refreshed in update()
    const label = h('span', { class: 'kit-btn-label' }, `Endow a ${def.name.toLowerCase()} — ${formatMoney(philanthropyCost(host.ctx.state, id))}`);
    const btn = h('button', {
      class: 'btn kit-btn kit-btn--secondary insp-endow',
      type: 'button',
      'data-endow': id,
      onClick: () => {
        const r = buyPhilanthropy(host.ctx, cityId, id);
        host.ctx.bus.emit(r.ok
          ? { type: 'toast', message: `You endowed a ${def.name.toLowerCase()} in ${host.ctx.state.cities[cityId]?.name ?? 'the town'}`, tone: 'good' }
          : { type: 'toast', message: r.error, tone: 'bad' });
        view.update();
      },
    }, iconEl(id, 16), label);
    return { id, btn, label };
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
    class: 'btn kit-btn kit-btn--primary insp-endorse-btn',
    type: 'button',
    onClick: () => {
      const r = endorse(host.ctx, cityId, endorseSel.value as FactionId);
      host.ctx.bus.emit(r.ok
        ? { type: 'toast', message: `You endorsed the ${FACTIONS[endorseSel.value as FactionId].name} candidate`, tone: 'good' }
        : { type: 'toast', message: r.error, tone: 'bad' });
      view.update();
    },
  }, 'Endorse') as HTMLButtonElement;
  const slushBtn = h('button', {
    class: 'btn kit-btn kit-btn--secondary insp-slush-btn',
    type: 'button',
    onClick: () => {
      const r = paySlush(host.ctx, cityId);
      host.ctx.bus.emit(r.ok
        ? { type: 'toast', message: 'Slush paid. Keep it quiet.', tone: 'good' }
        : { type: 'toast', message: r.error, tone: 'bad' });
      view.update();
    },
  }, 'Slush') as HTMLButtonElement;
  const slushInfo = h('div', { class: 'insp-muted insp-slush-info' });
  const endorseRow = h('div', { class: 'insp-endorse' },
    h('div', { class: 'insp-endorse-acts' }, h('span', { class: 'insp-label' }, 'Endorse'), endorseSel, endorseBtn, slushBtn),
    slushInfo);
  const demandBox = h('div', { class: 'insp-demand p-scroll' });
  const stat = (label: string, v: HTMLElement, cls = '') => h('div', { class: `p-row insp-stat ${cls}`.trim() }, h('span', { class: 'insp-label' }, label), v);
  const full = h(
    'div',
    { class: 'insp-city-full' },
    section('Smog', [smogTierRow]),
    section('Town', [classRow, stat('Landmarks', landmarks)]),
    section('Politics', [
      stat('Mayor', h('span', null, mayorName, ' ', mayorChip), 'insp-mayor'),
      stat('Council', councilChip, 'insp-council'),
      stat('Next election', electionRow, 'insp-election'),
      endorseRow,
    ]),
    h('div', { class: 'p-section insp-section insp-mayor-edicts' },
      h('div', { class: 'p-head' }, 'Edicts'),
      h('small', { class: 'insp-edict-reach' }, EDICT_REACH),
      edictList),
    h('div', { class: 'p-section insp-section insp-opinions' }, h('div', { class: 'p-head' }, 'Opinion of your company'), ...opinion.map((o) => o.el)),
    h('div', { class: 'p-section insp-section insp-demand-section' }, h('div', { class: 'p-head' }, 'What the town buys each month'), demandBox),
    h('div', { class: 'p-section insp-section insp-philanthropy' }, h('div', { class: 'p-head' }, 'Philanthropy'), ...gifts.map((g) => g.btn)),
  );
  const city0 = host.ctx.state.cities[cityId];
  const disc = progressiveDisclosure({
    panelId: 'city',
    expandLabel: 'Show full City',
    coachText: 'Top unmet demand leads. Open the full town sheet for smog, politics, every good and philanthropy.',
    now: nowCard(city0 ? cityNow(host.ctx.state, city0) : []),
    full,
  });
  const el = h('div', { class: 'insp insp-city' }, headerBox, statsBox, disc.el);
  const view: InspectorView = {
    el,
    update() {
      const { state } = host.ctx;
      const city = state.cities[cityId];
      if (!city) return false;
      const year = state.date.year;
      const pol = city.politics;
      const mayorLine = `${pol.mayor.name} (${factionName(pol.mayor.faction, year)})`;
      const summary = `Pop ${formatNumber(city.population)} · Mayor ${mayorLine}`;
      swap(headerBox, `${city.name}|${summary}`, () => panelHeader({ title: city.name, summary }));
      disc.setNow(nowCard(cityNow(state, city)));
      const diff = city.population - city.prevPopulation;
      const st = smogTierLine(city);
      const workers = Math.round(laborPool(city));
      const tiles = [
        { label: 'Population', value: formatNumber(city.population), delta: trendText(diff), tone: (diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral') as Tone, title: 'Change at the last monthly count' },
        { label: 'Workers', value: formatNumber(workers), title: 'Hands the town can offer the works around it' },
        { label: 'Smog tier', value: st.name, delta: `${st.level} ${st.trend === 'up' ? '▲' : st.trend === 'down' ? '▼' : ''}`.trim(), tone: (st.tier >= 3 ? 'negative' : st.tier >= 1 ? 'warning' : 'positive') as Tone, title: `Smog level (3-month average); this month ${formatPercent(city.pollution)}` },
        { label: 'Happiness', value: formatPercent(city.happiness), tone: 'neutral' as Tone },
      ];
      swap(statsBox, JSON.stringify(tiles), () => statRow(tiles.map((t) => statTile(t))));
      for (const g of gifts) {
        const why = philanthropyBlocker(state, city.id, g.id);
        const disabled = why !== null;
        if ((g.btn as HTMLButtonElement).disabled !== disabled) (g.btn as HTMLButtonElement).disabled = disabled;
        const tip = why ?? `Opinion in ${city.name}: ${effectsLine(g.id, state.date.year)}`;
        if (g.btn.title !== tip) g.btn.title = tip;
        setText(g.label, `Endow a ${LANDMARKS[g.id].name.toLowerCase()} — ${formatMoney(philanthropyCost(state, g.id))}`);
      }
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
        const odds = slushOdds(city);
        const why = slushBlocker(state, city.id);
        const cost = formatMoney(slushCost(state));
        setText(slushBtn, `Slush ${cost}`);
        if (slushBtn.disabled !== (why !== null)) slushBtn.disabled = why !== null;
        const tip = why ?? `Pay ${cost} to tilt the vote. Raises scandal risk.`;
        if (slushBtn.title !== tip) slushBtn.title = tip;
        const pct = (x: number) => `${Math.round(x * 100)}%`;
        setText(slushInfo, odds ? `Win odds ${pct(odds.now)} \u2192 ${pct(odds.after)} | Scandal risk: ${pct(pol.scandalRisk)}` : '');
        slushInfo.hidden = !odds;
      }
      const lines = cityEdictLines(city, year, priceIndex(state));
      const esig = lines.map((l) => `${l.key}:${l.effect}`).join('|');
      if (esig !== edictSig) {
        edictSig = esig;
        edictList.replaceChildren(
          ...(lines.length > 0
            ? lines.map((l) =>
                h('li', { 'data-edict': l.key, title: `${l.name}: ${l.effect}` },
                  iconEl(l.icon, 16),
                  h('span', null, h('b', null, l.name), h('small', { class: 'insp-edict-effect' }, l.effect))),
              )
            : [h('li', { class: 'insp-none' }, 'None in force')]),
        );
      }
      setText(smogTierName, st.name);
      smogTierRow.dataset.tier = String(st.tier);
      setText(smogTierLevel, st.level);
      setText(smogTierTrend, st.trend === 'up' ? '▲' : st.trend === 'down' ? '▼' : '–');
      // rising smog is bad news: the 'down' (red) class for up, 'up' (green) for falling
      const tcls = `insp-trend ${st.trend === 'up' ? 'down' : st.trend === 'down' ? 'up' : ''}`.trim();
      if (smogTierTrend.className !== tcls) smogTierTrend.className = tcls;
      setText(pollutionNow, ` · this month ${formatPercent(city.pollution)}`);
      setText(smogTierHint, st.hint);
      const segs = classSegments(city);
      const tips: string[] = [];
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        const part = classParts[i];
        const w = `${Number((sg.share * 100).toFixed(1))}%`;
        if (part.el.style.width !== w) part.el.style.width = w;
        const pct = `${Math.round(sg.share * 100)}%`;
        // the label shows when the segment has room for it; the tooltip always names all three
        setText(part.text, sg.share >= 0.12 ? `${sg.label} ${pct}` : '');
        tips.push(`${sg.label} ${pct}`);
      }
      const tip = tips.join(' / ');
      const barEl = classRow.lastElementChild as HTMLElement;
      if (barEl.title !== tip) { barEl.title = tip; barEl.setAttribute('aria-label', `Classes: ${tip}`); }
      for (const o of opinion) {
        const v = city.opinion?.[o.f] ?? 50;
        const name = factionName(o.f, year);
        setText(o.label, name);
        setMeter(o.meter, Math.round(v), 100, 'neutral', `${name}: ${Math.round(v)} / 100`);
        setText(o.val, String(Math.round(v)));
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
      const craved = new Set(demand.filter((d) => d.unmetValue > 0).slice(0, 3).map((d) => d.goodId));
      const stores = Object.values(state.buildings).filter((b) => b.cityId === cityId && BUILDINGS[b.typeId].category === 'retail');
      const rows: DemandRow[] = demand.map((d) => ({
        goodId: d.goodId,
        demand: Math.round(d.demand),
        sat: Math.round(d.satisfaction * 100) / 100,
        price: Math.round(d.price),
        craves: craved.has(d.goodId),
        sellers: stores.filter((s) => (loadSource(s)[d.goodId] ?? 0) >= 1).map((s) => ({ id: s.id, ownerId: s.ownerId })),
      }));
      swap(demandBox, JSON.stringify(rows), () => demandTable(state, rows));
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
