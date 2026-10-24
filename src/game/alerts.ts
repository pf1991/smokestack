/**
 * The alerts model: a pure, read-only scan of the player's affairs for things that need attention
 * (starved or backed-up works, strikes, idle vehicles, a losing month, a waiting decision, a Baron
 * move, a contract falling due). The top-bar tray and the map badges read it. It never writes to
 * `state` and uses no rng; the only memory is the tracker's first-seen days.
 */
import { BUILDINGS } from '../data/buildings';
import { dateToDays } from '../sim/clock';
import { monthProfit } from '../sim/finance';
import { modelRow } from '../sim/logistics/models';
import type { GameState } from '../sim/types';
import { formatMoney } from '../core/money';
import type { IconId } from '../render/icons';
import { statusAdvice } from '../ui/panels/building';

export type AlertTone = 'warning' | 'negative' | 'info';
export type AlertTarget =
  | { kind: 'building'; id: number }
  | { kind: 'vehicle'; id: number }
  | { kind: 'panel'; panel: string };
export interface Alert {
  id: string;
  tone: AlertTone;
  icon: IconId;
  title: string;
  detail: string;
  target: AlertTarget;
  /** the day (dateToDays) the condition was first seen; the tray shows today minus this as its age */
  since: number;
}

export const MAX_ALERTS = 50;
const BUILDING_DAYS = 7;
const VEHICLE_DAYS = 14;
const CONTRACT_WINDOW = 30;
const TONE_RANK: Record<AlertTone, number> = { negative: 0, warning: 1, info: 2 };


export class AlertTracker {
  private seen = new Map<string, number>();

  /** first day (dateToDays) each condition id was seen; ids not seen this call are forgotten */
  collect(state: GameState): Alert[] {
    const today = dateToDays(state.date);
    const now = new Map<string, number>();
    const found: Alert[] = [];
    /** records a live condition; returns the days it has lasted */
    const see = (id: string): number => {
      const first = this.seen.get(id) ?? today;
      now.set(id, first);
      return today - first;
    };
    const add = (alert: Omit<Alert, 'since'>, since: number) => found.push({ ...alert, since });

    for (const b of Object.values(state.buildings)) {
      if (b.ownerId !== 'player') continue;
      const name = BUILDINGS[b.typeId]?.name ?? 'Building';
      const target: AlertTarget = { kind: 'building', id: b.id };
      const detail = () => statusAdvice(state, b).text;
      const struck = b.status === 'halted' && !!b.strike && today < b.strike.until;
      if (struck) {
        const id = `b:${b.id}:strike`;
        see(id);
        add({ id, tone: 'negative', icon: 'strike', title: `Strike at ${name}`, detail: detail(), target }, b.strike!.since);
        continue;
      }
      const rule =
        b.status === 'no_input' ? { key: 'no_input', tone: 'warning' as const, icon: 'warning', title: `${name} is starved` }
        : b.status === 'output_full' ? { key: 'output_full', tone: 'warning' as const, icon: 'warning', title: `${name} is backed up` }
        : b.status === 'idle' ? { key: 'idle', tone: 'info' as const, icon: 'info', title: `${name} is idle` }
        : null;
      if (!rule) continue;
      const id = `b:${b.id}:${rule.key}`;
      const days = see(id);
      if (days >= BUILDING_DAYS) add({ id, tone: rule.tone, icon: rule.icon, title: rule.title, detail: detail(), target }, now.get(id)!);
    }

    for (const v of Object.values(state.vehicles)) {
      if (v.ownerId !== 'player' || v.state !== 'idle') continue;
      const id = `v:${v.id}:idle`;
      const days = see(id);
      if (days >= VEHICLE_DAYS) {
        const model = modelRow(v.model).name;
        add({ id, tone: 'info', icon: v.kind === 'train' ? 'train' : 'truck', title: `${model} idle`, detail: `Idle for ${days} days: give it a route or sell it`, target: { kind: 'vehicle', id: v.id } }, now.get(id)!);
      }
    }

    // the last closed month: the newest ledger entry before the current one
    const ledger = state.companies.player?.ledger ?? [];
    const cur = state.date.year * 12 + state.date.month;
    let last: (typeof ledger)[number] | undefined;
    for (const m of ledger) {
      const k = m.year * 12 + m.month;
      if (k < cur && (!last || k > last.year * 12 + last.month)) last = m;
    }
    if (last) {
      const p = monthProfit(last);
      if (p < 0) {
        add({ id: `loss:${last.year}-${last.month}`, tone: 'negative', icon: 'chart_down', title: `Last month lost ${formatMoney(-p)}`, detail: 'Open the books to see where the money went', target: { kind: 'panel', panel: 'finance' } }, today);
      }
    }

    if (state.politics.cards.pending.length > 0) {
      add({ id: 'card', tone: 'info', icon: 'scroll', title: 'A decision awaits', detail: 'An event card is waiting for your answer', target: { kind: 'panel', panel: 'newspaper' } }, today);
    }

    const act = state.nemesis.lastAction;
    if (act && act.year === state.date.year && act.month === state.date.month) {
      add({ id: `baron:${act.year}-${act.month}`, tone: 'negative', icon: 'crown', title: 'The Baron has made a move', detail: 'See what the Baron did this month', target: { kind: 'panel', panel: 'rival' } }, today);
    }

    for (const c of state.contracts) {
      if (c.status !== 'active' || c.delivered >= c.qty) continue;
      const left = dateToDays(c.deadline) - today;
      if (left < 0 || left > CONTRACT_WINDOW) continue;
      const town = state.cities.find((x) => x.id === c.cityId)?.name ?? 'town';
      add({ id: `c:${c.id}`, tone: 'warning', icon: 'permit', title: `Contract for ${town} due in ${left} days`, detail: `${c.delivered} of ${c.qty} delivered`, target: { kind: 'panel', panel: 'contracts' } }, today);
    }

    this.seen = now;
    return found
      .map((f, i) => ({ f, i }))
      .sort((a, b) => TONE_RANK[a.f.tone] - TONE_RANK[b.f.tone] || a.f.since - b.f.since || a.i - b.i)
      .slice(0, MAX_ALERTS)
      .map((x) => x.f);
  }
}
