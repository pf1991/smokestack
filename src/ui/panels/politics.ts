/**
 * The politics window (Phase 2 Task 3): company edicts as segmented controls, national opinion of
 * each faction with a trend against the last yearly sample, the national Black Lung toll (Phase 3
 * smog escalation) and the latest political log entries.
 */
import type { GameController } from '../../game/controller';
import { FACTION_IDS, FACTIONS, factionName, type FactionId } from '../../data/factions';
import { PLAYER_ID } from '../../sim/companies';
import { companyEdictFactor, EDICT_KEYS, EDICTS, MAX_EDICT_DRIVE, setEdict, type EdictDef, type EdictOption } from '../../sim/politics/edicts';
import { playerBuildingUpkeep } from '../../sim/politics/mayorEdicts';
import { buildingMaintenance } from '../../sim/society/upgrades';
import { nationalOpinion, opinionTrend } from '../../sim/politics/factions';
import { nationalBlackLung } from '../../sim/society/escalation';
import { LAWS, LAW_IDS } from '../../data/laws';
import { monthIndex } from '../../sim/politics/elections';
import { nonCompliant } from '../../sim/society/lawState';
import type { CompanyEdicts, PoliticsLogEntry } from '../../sim/politics/types';
import type { GameState, SimContext } from '../../sim/types';
import { h } from '../dom';
import { formatMoney, formatNumber } from '../format';
import { dataTable, emptyState, meter, panelHeader, section } from '../kit';
import { createWindow } from '../window';
import { setMeter, setText, swap } from './inspect';
import type { PanelDef } from './index';
import './panels.css';
import './politics.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Log entries shown under "Recent political news". */
export const LOG_SHOWN = 8;
/** A trend smaller than this (opinion points) shows as steady. */
const STEADY = 0.5;

const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}`;

/** "Workers +0.2/mo, Old Money −0.1/mo", or "No effect on opinion". */
export function effectsText(opt: EdictOption, year: number): string {
  const parts = FACTION_IDS.filter((f) => opt.effects[f]).map((f) => `${factionName(f, year)} ${signed(opt.effects[f]!)}/mo`);
  return parts.length ? parts.join(', ') : 'No effect on opinion';
}

/** The player's building upkeep before edicts, per month. */
function baseUpkeep(state: GameState): number {
  let total = 0;
  for (const b of Object.values(state.buildings)) if (b.ownerId === PLAYER_ID) total += buildingMaintenance(state, b);
  return total;
}

/** The player's monthly building upkeep were edict `key` set to `value`, mayors' minimum wage included. */
export function upkeepWith<K extends keyof CompanyEdicts>(state: GameState, key: K, value: CompanyEdicts[K]): number {
  const edicts = { ...state.politics.edicts, [key]: value };
  return playerBuildingUpkeep({ ...state, politics: { ...state.politics, edicts } });
}

/** What mayors' minimum wage adds to the player's building upkeep this month (0 when no town has one). */
export function minimumWageSurcharge(state: GameState): number {
  return playerBuildingUpkeep(state) - baseUpkeep(state) * companyEdictFactor(state);
}

/**
 * "Upkeep ×1.25 (+$1,200/mo)" for one edict option; `delta` is its monthly upkeep change against
 * the neutral option (upkeepWith both), so minimum-wage towns are counted.
 */
export function costText(opt: EdictOption, delta: number): string {
  if (opt.cost === 1) return 'Upkeep unchanged';
  return `Upkeep ×${opt.cost} (${delta >= 0 ? '+' : '−'}${formatMoney(Math.abs(Math.round(delta)))}/mo)`;
}

/** "Next election: Ashford in 5 months" (the soonest town), or a quiet line when no town votes. */
export function nextElectionText(state: GameState): string {
  let next: GameState['cities'][number] | undefined;
  for (const c of state.cities) if (!next || c.politics.nextElection < next.politics.nextElection) next = c;
  if (!next) return 'No town elections scheduled';
  const months = Math.max(0, next.politics.nextElection - monthIndex(state.date));
  return `Next election: ${next.name} ${months === 0 ? 'this month' : `in ${months} ${months === 1 ? 'month' : 'months'}`}`;
}

function when(e: PoliticsLogEntry): string {
  return `${MONTHS[(e.date.month - 1 + 12) % 12]} ${e.date.year}`;
}

interface EdictControl {
  key: keyof CompanyEdicts;
  el: HTMLElement;
  buttons: Map<string, HTMLElement>;
  cost: HTMLElement;
  effects: HTMLElement;
}

function edictControl(ctx: SimContext, key: keyof CompanyEdicts, refresh: () => void): EdictControl {
  const def = EDICTS[key] as EdictDef<string>;
  const buttons = new Map<string, HTMLElement>();
  const seg = h('div', { class: 'p-chips pol-seg', role: 'group', 'aria-label': def.title, 'data-edict': key });
  for (const v of def.values) {
    const btn = h('button', {
      'data-value': v,
      'aria-pressed': 'false',
      onClick: () => {
        const r = setEdict(ctx, key, v as never);
        if (!r.ok) ctx.bus.emit({ type: 'toast', message: r.error, tone: 'bad' });
        refresh();
      },
    }, def.options[v].label);
    buttons.set(v, btn);
    seg.appendChild(btn);
  }
  const cost = h('span', { class: 'pol-cost' });
  const effects = h('div', { class: 'pol-effects' });
  const el = h('div', { class: 'pol-edict' },
    h('div', { class: 'p-row pol-edict-head' }, h('span', { class: 'pol-edict-title' }, def.title), cost),
    seg,
    effects);
  return { key, el, buttons, cost, effects };
}

interface OpinionRow {
  f: FactionId;
  label: HTMLElement;
  meter: HTMLElement;
  value: HTMLElement;
  trend: HTMLElement;
}

function opinionRow(f: FactionId): OpinionRow {
  const label = h('span', { class: 'pol-faction' });
  const m = meter(50, 100, { tone: 'info' });
  // each faction's bar wears its own colour (kit meters fill with --tone)
  m.style.setProperty('--tone', FACTIONS[f].color);
  const value = h('span', { class: 'pol-opinion-val' });
  const trend = h('span', { class: 'pol-trend' });
  return { f, label, meter: m, value, trend };
}

/** The opinion table: one row per faction, its cells the live elements `update()` refreshes. */
function opinionTable(rows: OpinionRow[]): HTMLElement {
  const table = dataTable<OpinionRow>({
    columns: [
      { key: 'faction', label: 'Faction', render: (r) => r.label },
      { key: 'opinion', label: 'Opinion', render: (r) => h('span', { class: 'pol-opinion-bar' }, r.meter, r.value) },
      { key: 'trend', label: 'Trend', align: 'right', render: (r) => r.trend },
    ],
    rows,
    rowKey: (r) => r.f,
    emptyText: 'No factions',
  });
  table.classList.add('pol-opinions');
  table.querySelectorAll<HTMLElement>('tbody tr').forEach((tr, i) => {
    const f = rows[i].f;
    tr.classList.add('pol-opinion');
    tr.dataset.faction = f;
    tr.title = `Likes: ${FACTIONS[f].likes}. Hates: ${FACTIONS[f].hates}.`;
  });
  return table;
}

interface LawRow {
  id: (typeof LAW_IDS)[number];
  status: HTMLElement;
  detail: HTMLElement;
}

function lawTable(rows: LawRow[]): HTMLElement {
  const table = dataTable<LawRow>({
    columns: [
      { key: 'law', label: 'Law', render: (r) => h('span', { class: 'pol-law-name' }, h('strong', null, LAWS[r.id].title), r.detail) },
      { key: 'status', label: 'Status', align: 'right', render: (r) => r.status },
    ],
    rows,
    rowKey: (r) => r.id,
    emptyText: 'No laws on the books',
  });
  table.classList.add('pol-law-table');
  table.querySelectorAll<HTMLElement>('tbody tr').forEach((tr, i) => {
    tr.classList.add('pol-law');
    tr.dataset.law = rows[i].id;
  });
  return table;
}

/** Builds the window body; `update()` refreshes it in place from state. */
export function buildPolitics(ctx: SimContext): { el: HTMLElement; update(): void } {
  const controls: EdictControl[] = [];
  const update = (): void => {
    const { state } = ctx;
    const year = state.date.year;
    const surcharge = minimumWageSurcharge(state);
    for (const c of controls) {
      const def = EDICTS[c.key] as EdictDef<string>;
      const current = state.politics.edicts[c.key];
      const neutral = upkeepWith(state, c.key, def.values[1] as never);
      const delta = (v: string) => upkeepWith(state, c.key, v as never) - neutral;
      for (const [v, btn] of c.buttons) {
        const on = String(v === current);
        if (btn.getAttribute('aria-pressed') !== on) btn.setAttribute('aria-pressed', on);
        const tip = `${costText(def.options[v], delta(v))}. ${effectsText(def.options[v], year)}.`;
        if (btn.title !== tip) btn.title = tip;
      }
      const opt = def.options[current];
      if (!opt) continue;
      const mw = c.key === 'wage' && surcharge >= 0.5 ? ` · minimum wage +${formatMoney(Math.round(surcharge))}/mo` : '';
      setText(c.cost, costText(opt, delta(current)) + mw);
      const parts = FACTION_IDS.filter((f) => opt.effects[f]);
      const sig = `${current}|${year >= 1960}`;
      if (c.effects.dataset.sig !== sig) {
        c.effects.dataset.sig = sig;
        c.effects.replaceChildren(
          ...(parts.length
            ? parts.flatMap((f, i) => [
                i ? ', ' : '',
                h('span', { class: opt.effects[f]! > 0 ? 'pos' : 'neg' }, `${factionName(f, year)} ${signed(opt.effects[f]!)}/mo`),
              ])
            : ['No effect on opinion']),
        );
      }
    }
    const head = nextElectionText(state);
    swap(header, head, () => panelHeader({ title: 'Politics', summary: head }));
    for (const r of rows) {
      const v = nationalOpinion(state, r.f);
      setText(r.label, factionName(r.f, year));
      setMeter(r.meter, v, 100, 'info', `${factionName(r.f, year)}: ${Math.round(v)} of 100`);
      setText(r.value, String(Math.round(v)));
      const t = opinionTrend(state, r.f);
      const dir = t === null || Math.abs(t.delta) < STEADY ? '' : t.delta > 0 ? 'up' : 'down';
      setText(r.trend, t === null ? 'Too soon' : dir === '' ? 'Steady' : `${dir === 'up' ? '▲' : '▼'} ${signed(t.delta)}`);
      const cls = `pol-trend ${dir}`.trim();
      if (r.trend.className !== cls) r.trend.className = cls;
      const tip = t === null ? 'Not enough history yet' : `Change since ${t.since}`;
      if (r.trend.title !== tip) r.trend.title = tip;
    }
    const dead = nationalBlackLung(state);
    setText(blackLung, dead > 0 ? `${formatNumber(dead)} dead of smog` : 'None yet');
    const now = monthIndex(state.date);
    for (const r of lawRows) {
      const law = state.society.laws[r.id];
      const def = LAWS[r.id];
      let status = 'Pending';
      if (law.passed !== null && law.enforcedFrom !== null) {
        const f = law.enforcedFrom;
        status = now >= f ? `Passed ${law.passed}` : `Passed ${law.passed}, enforced from ${MONTHS[f % 12]} ${Math.floor(f / 12)}`;
      }
      const n = law.passed !== null ? nonCompliant(state, r.id).length : 0;
      setText(r.status, status);
      setText(r.detail, `Needs scrubber tier ${def.tier}${law.passed !== null ? ` · ${n} of your works non-compliant` : ''}`);
    }
    const entries = state.politics.log.slice(-LOG_SHOWN).reverse();
    const sig = `${state.politics.log.length}|${entries.map((e) => `${e.date.year}.${e.date.month}.${e.faction}.${e.delta}`).join(',')}`;
    if (log.dataset.sig !== sig) {
      log.dataset.sig = sig;
      log.hidden = entries.length === 0;
      logEmpty.hidden = entries.length > 0;
      log.replaceChildren(
        ...entries.map((e) => {
          const place = e.scope === 'national' ? 'Nationwide' : state.cities.find((c) => c.id === e.scope)?.name ?? 'A town';
          return h('li', null,
            h('span', { class: 'when' }, when(e)),
            h('span', { class: `delta ${e.delta > 0 ? 'pos' : 'neg'}` }, `${factionName(e.faction, e.date.year)} ${signed(e.delta)}`),
            h('span', { class: 'pol-log-text' }, `${place}: ${e.reason}`));
        }),
      );
    }
  };
  for (const k of EDICT_KEYS) controls.push(edictControl(ctx, k, update));
  const rows = FACTION_IDS.map(opinionRow);
  const lawRows: LawRow[] = LAW_IDS.map((id) => ({ id, status: h('span', { class: 'pol-law-status' }), detail: h('span', { class: 'pol-law-detail' }) }));
  const header = h('div', { class: 'pol-header' });
  const log = h('ul', { class: 'pol-log' });
  const logEmpty = emptyState({ title: 'Nothing yet', body: 'The factions are watching. Contracts, gifts, smog and edicts all move them.' });
  logEmpty.classList.add('pol-none');
  const blackLung = h('span', { class: 'pol-blacklung-count' });
  const block = (title: string, cls: string, children: HTMLElement[]) => {
    const el = section(title, children);
    el.classList.add(...cls.split(' '));
    return el;
  };
  const toll = block('Black Lung toll', 'pol-blacklung', [blackLung,
    h('div', { class: 'pol-note' }, 'Deaths from smog in towns at smog tier 2 or worse, since records began')]);
  toll.title = 'Deaths from smog in towns at smog tier 2 or worse, since records began';
  const el = h('div', { class: 'pol' },
    header,
    block('Company edicts', 'pol-edicts', [...controls.map((c) => c.el),
      h('div', { class: 'pol-note' }, `Together, edicts move a faction at most ±${MAX_EDICT_DRIVE} a month; opinion drifts back toward 50.`)]),
    block('National opinion', 'pol-national', [opinionTable(rows)]),
    toll,
    block('Law of the land', 'pol-laws', [lawTable(lawRows)]),
    block('Recent political news', 'pol-news', [log, logEmpty]));
  update();
  return { el, update };
}

let isOpen = false;

export const politicsPanel: PanelDef = {
  id: 'politics',
  open(game: GameController) {
    if (isOpen) {
      createWindow({ id: 'politics', title: 'Politics', content: h('div') }); // raises it
      return;
    }
    const view = buildPolitics(game.ctx);
    const off = game.ctx.bus.on('dayStart', view.update);
    isOpen = true;
    createWindow({
      id: 'politics',
      title: 'Politics',
      content: view.el,
      width: 400,
      onClose: () => {
        off();
        isOpen = false;
      },
    });
  },
};
