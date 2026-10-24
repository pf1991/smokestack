import { GOODS } from '../../data/goods';
import type { GameState, GoodId, Route, Vehicle } from '../types';
import type { HubJob } from './types';

/**
 * Leaf helpers for hub trucks (spec §8.2): the two-stop route a hub truck's saved job stands for, and
 * the job's progress at each dwell end. No sim imports, so vehicles.ts can use it without a cycle.
 * With hubs.ts, autoRoutes.ts and release.ts, the only writers of a vehicle's `job` and `hubId`.
 */

/**
 * Bumped whenever a vehicle joins or leaves a route or a hub, or is sold (assignVehicle, sellVehicle,
 * joinHub, leaveHub, release.ts, buyHubTruck). With `state.nextId` (a new vehicle takes a new id) and the
 * vehicles record's identity (a load makes a new one) it keys the daily by-route and by-hub truck lists
 * (autoRoutes.ts, hubs.ts), so the daily systems do not enumerate the whole fleet. Lives outside GameState.
 */
let fleetRev = 0;
export function fleetChanged(): void {
  fleetRev++;
}
export const fleetRevision = (): number => fleetRev;

/** Every good: a stop at the hub takes back whatever the truck carries (as storage allows). */
const ALL_GOODS = Object.keys(GOODS) as GoodId[];
const NONE: GoodId[] = [];

/** Routes by job object: a job never changes after it is made (progress lives in `stopIndex`). */
const routes = new WeakMap<HubJob, Route>();

/** A hub truck's job (hub trucks only ever carry HubJobs). */
const hubJob = (veh: Vehicle): HubJob | null => (veh.job as HubJob | null | undefined) ?? null;

function buildRoute(veh: Vehicle, j: HubJob): Route {
  const hub = veh.hubId as number;
  const stops =
    j.kind === 'return'
      ? [{ buildingId: hub, load: NONE, unload: ALL_GOODS }]
      : [
          { buildingId: j.from, load: j.good ? [j.good] : NONE, unload: NONE },
          { buildingId: j.to, load: NONE, unload: j.to === hub ? ALL_GOODS : j.good ? [j.good] : NONE },
        ];
  return { id: -hub, ownerId: veh.ownerId, name: 'Hub', color: '#c9a13a', stops, kind: 'truck', mode: 'manual' };
}

/** The truck heads home to unload: its job becomes `return` and it re-plans from where it stands. */
function sendHome(veh: Vehicle): HubJob {
  const hub = veh.hubId as number;
  const j: HubJob = { kind: 'return', from: hub, to: hub, good: null, qty: 0 };
  veh.job = j;
  veh.stopIndex = 0;
  veh.path = [];
  veh.pathIndex = 0;
  return j;
}

/**
 * The route of a hub truck's job: pickup then drop for collect/deliver/balance, `[hub]` for a return,
 * undefined with no job (the truck idles where it stands, which is home after a return). A truck on
 * the road whose job names a building that has since gone turns for home at once; one dwelling at a
 * stop is left to advanceHubJob at its dwell end.
 */
export function hubRoute(state: GameState, veh: Vehicle): Route | undefined {
  let j = hubJob(veh);
  if (!j) return undefined;
  if (j.kind !== 'return' && veh.state !== 'loading' && (!state.buildings[j.from] || !state.buildings[j.to])) j = sendHome(veh);
  let r = routes.get(j);
  if (!r) routes.set(j, (r = buildRoute(veh, j)));
  return r;
}

/**
 * The end of a hub truck's dwell: the pickup leads to the drop; after the drop the truck returns home
 * (or is done when the drop was home); a return ends the job. When the job's other building is gone
 * the truck goes home, where its cargo unloads into the hub as far as storage allows.
 */
export function advanceHubJob(state: GameState, veh: Vehicle): void {
  const j = hubJob(veh);
  if (!j) return;
  if (j.kind === 'return') {
    veh.job = null;
    return;
  }
  if (!state.buildings[j.from] || !state.buildings[j.to]) {
    sendHome(veh);
    return;
  }
  if (veh.stopIndex === 0) {
    veh.stopIndex = 1;
    return;
  }
  if (j.to === veh.hubId) veh.job = null;
  else sendHome(veh);
}

/** The building a hub truck heads for or dwells at: the job's pickup, then its drop, or home on a return (read-only). */
export function hubTarget(veh: Vehicle): number | null {
  const j = hubJob(veh);
  if (!j) return null;
  if (j.kind === 'return') return veh.hubId ?? null;
  return veh.stopIndex === 0 ? j.from : j.to;
}

/** Most units a hub truck may load at its current stop: its job's quantity at the pickup (undefined elsewhere). */
export function hubLoadCap(veh: Vehicle): number | undefined {
  const j = hubJob(veh);
  return j && j.kind !== 'return' && veh.stopIndex === 0 ? j.qty : undefined;
}

/** Puts a (new) truck on hub `hubId`, optionally carrying on with `job` (a replacement). */
export function joinHub(veh: Vehicle, hubId: number, job: HubJob | null = null): void {
  veh.hubId = hubId;
  veh.job = job;
  fleetChanged();
}

/** The truck leaves its hub (reassigned to a route or to none). */
export function leaveHub(veh: Vehicle): void {
  if (veh.hubId == null) return;
  veh.hubId = null;
  veh.job = null;
  fleetChanged();
}
