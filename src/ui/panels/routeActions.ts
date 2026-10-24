import { BUILDINGS } from '../../data/buildings';
import { CATEGORY_ICON } from '../buildingIcons';
import { GOODS } from '../../data/goods';
import type { GameController } from '../../game/controller';
import type { IconId } from '../../render/icons';
import type { Selection } from '../../render/world';
import { earn } from '../../sim/finance';
import { acceptsGood, handlesCargo, noCargoError } from '../../sim/inventory';
import { buyTrain, STATION_TYPE } from '../../sim/rail';
import { appendStop, offeredGoods } from '../../sim/routeHelpers';
import type { Building, GameState, Route, RouteStop } from '../../sim/types';
import { buyTruck, createRoute, deleteRoute, sellRefund, VEHICLE_KINDS, vehiclePrice } from '../../sim/vehicles';

export type Kind = Route['kind'];


export const buildingName = (b: Building | undefined): string => (b ? (BUILDINGS[b.typeId]?.name ?? b.typeId) : 'Missing building');
/** Atlas icon for a building's category ('warning' when it is gone). */
export const buildingIcon = (b: Building | undefined): IconId => (b ? (CATEGORY_ICON[BUILDINGS[b.typeId]?.category] ?? 'factory') : 'warning');

/** Words and icon for the vehicles of a route kind (sim/vehicles.ts vehiclePrice gives the price). */
export const KIND_INFO = {
  truck: { one: 'truck', many: 'trucks', icon: 'truck', way: 'road', buy: buyTruck },
  train: { one: 'train', many: 'trains', icon: 'train', way: 'track', buy: buyTrain },
} as const;

/** Access tiles for a stop of a route kind (road for trucks, rail for trains). */
export function stopAccess(state: GameState, b: Building, kind: Kind) {
  return VEHICLE_KINDS[kind]?.access(state, b) ?? [];
}

/** One-line summary of a stop's cargo, e.g. "loads Wood · unloads —". */
export function stopSummary(stop: RouteStop): string {
  const list = (ids: string[]) => (ids.length > 0 ? ids.map((g) => GOODS[g]?.name ?? g).join(', ') : '—');
  return `loads ${list(stop.load)} · unloads ${list(stop.unload)}`;
}

/** Why a building cannot be a stop of a `kind` route (null when it can). */
export function stopProblem(state: GameState, b: Building, kind: Kind): string | null {
  if (b.ownerId !== 'player') return 'Not your building';
  if (!handlesCargo(b)) return noCargoError(b);
  if (kind === 'train') {
    if (b.typeId !== STATION_TYPE) return 'Trains only stop at train stations';
    if (stopAccess(state, b, 'train').length === 0) return `${buildingName(b)} has no rail access`;
  } else if (stopAccess(state, b, 'truck').length === 0) return `${buildingName(b)} has no road access`;
  return null;
}

export interface PickSet {
  valid: number[];
  blocked: number[];
}

/** Map outlines while picking stops for a `kind` route: reachable own buildings green, the rest of own buildings grey. */
export function stopPickSet(state: GameState, kind: Kind, exclude: number | null): PickSet {
  const out: PickSet = { valid: [], blocked: [] };
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'player' || b.id === exclude || !handlesCargo(b)) continue;
    if (kind === 'train' && b.typeId !== STATION_TYPE) continue;
    (stopProblem(state, b, kind) === null ? out.valid : out.blocked).push(b.id);
  }
  return out;
}

/** Own buildings that accept what `src` offers (green) or would but lack access (grey). */
export function sendTargets(state: GameState, src: Building): PickSet & { kind: Kind } {
  const kind: Kind = src.typeId === STATION_TYPE ? 'train' : 'truck';
  const goods = offeredGoods(src);
  const out: PickSet & { kind: Kind } = { kind, valid: [], blocked: [] };
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== 'player' || b.id === src.id || !handlesCargo(b)) continue;
    if (kind === 'train') {
      if (b.typeId !== STATION_TYPE) continue;
    } else if (!goods.some((g) => acceptsGood(b, g))) continue;
    (stopProblem(state, b, kind) === null ? out.valid : out.blocked).push(b.id);
  }
  return out;
}

/** The slice of the GameController the send-goods flow needs. */
export type SendHost = Pick<GameController, 'ctx' | 'tools' | 'renderer' | 'setTool' | 'onToolChange'>;

export const UNDO_MS = 10_000;

/**
 * Pick mode started from a building inspector: click one of the green buildings to create a
 * two-stop route (with load/unload pre-filled) and buy one vehicle for it.
 */
export function startSendGoods(game: SendHost, sourceId: number): void {
  const { ctx } = game;
  const toast = (message: string, tone: 'info' | 'good' | 'bad', action?: { label: string; run: () => void }, duration?: number) =>
    ctx.bus.emit({ type: 'toast', message, tone, action, duration });
  const src = ctx.state.buildings[sourceId];
  if (!src || src.ownerId !== 'player') return;
  const srcKind: Kind = src.typeId === STATION_TYPE ? 'train' : 'truck';
  const own = stopProblem(ctx.state, src, srcKind);
  if (own) return toast(own, 'bad');
  const targets = sendTargets(ctx.state, src);
  if (targets.valid.length === 0) {
    return toast(
      srcKind === 'train' ? 'No other connected train station to send to' : `Nothing of yours accepts what ${buildingName(src)} makes`,
      'bad',
    );
  }
  const sel = (): Selection => ({ buildingId: sourceId, pick: { valid: targets.valid, blocked: targets.blocked } });

  const finish = () => {
    off();
    if (game.tools.onPick === onPick) game.tools.onPick = null;
  };
  const onPick = (id: number) => {
    const t = ctx.state.buildings[id];
    if (!t || id === sourceId) return;
    if (!targets.valid.includes(id)) {
      const why = stopProblem(ctx.state, t, targets.kind) ?? `${buildingName(t)} does not accept ${buildingName(src)}'s goods`;
      return toast(why, 'bad');
    }
    const stops = appendStop(ctx.state, appendStop(ctx.state, [], sourceId), id);
    const name = `${buildingName(src)} → ${buildingName(t)}`;
    const r = createRoute(ctx, 'player', name, stops, targets.kind);
    if (!r.ok) return toast(r.error, 'bad');
    const info = KIND_INFO[targets.kind];
    const v = info.buy(ctx, 'player', r.value.id);
    if (!v.ok) {
      deleteRoute(ctx, r.value.id);
      return toast(`Could not buy a ${info.one}: ${v.error}`, 'bad');
    }
    finish();
    game.setTool({ kind: 'inspect' });
    game.renderer.setSelection({ routeId: r.value.id });
    const made = { routeId: r.value.id, vehicleId: v.value.id, at: Date.now(), stops: JSON.stringify(r.value.stops) };
    toast(`Route "${name}" created with a ${info.one}`, 'good', {
      label: 'Undo',
      run: () => undoSendGoods(game, made),
    }, UNDO_MS);
  };
  const off = game.onToolChange((t) => {
    // another feature took over pick mode: just let go
    if (game.tools.onPick !== onPick) return finish();
    if (t.kind !== 'pickStop') {
      finish();
      game.renderer.setSelection(ctx.state.buildings[sourceId] ? { buildingId: sourceId } : null);
    }
  });
  game.tools.onPick = onPick;
  game.setTool({ kind: 'pickStop', routeId: null });
  game.renderer.setSelection(sel());
  toast(`Click where ${buildingName(src)} should send its goods (Esc cancels)`, 'info');
}

function undoSendGoods(
  game: SendHost,
  made: { routeId: number; vehicleId: number; at: number; stops: string },
): void {
  const { ctx } = game;
  const { state } = ctx;
  const bad = (m: string) => ctx.bus.emit({ type: 'toast', message: m, tone: 'bad' });
  const route = state.routes[made.routeId];
  if (!route) return bad('Nothing to undo');
  if (Date.now() - made.at > UNDO_MS) return bad('Too late to undo — delete the route in the Routes window');
  const onRoute = Object.values(state.vehicles).filter((v) => v.routeId === made.routeId);
  if (JSON.stringify(route.stops) !== made.stops || onRoute.length !== 1 || onRoute[0].id !== made.vehicleId) {
    return bad('The route has changed since — delete it in the Routes window');
  }
  const sold = state.vehicles[made.vehicleId];
  deleteRoute(ctx, made.routeId); // refunds half
  earn(state.companies.player, 'vehicles', vehiclePrice(state, sold.model) - sellRefund(state, sold), state.date); // the rest: a full refund
  ctx.bus.emit({ type: 'toast', message: 'Route undone, vehicle refunded', tone: 'info' });
}
