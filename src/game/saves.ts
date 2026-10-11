import { err, ok, type Result } from '../core/result';
import { formatDate } from '../sim/clock';
import { SAVE_VERSION } from '../sim/migrations';
import { deserialize, serialize } from '../sim/simulation';
import type { GameState, OwnerId, SimContext, Terrain, Tile } from '../sim/types';

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SaveSlot = (typeof SLOTS)[number];

export interface SaveInfo {
  slot: SaveSlot;
  date: string;
  company: string;
  money: number;
}

const KEY = (slot: string) => `smokestack:save:${slot}`;
const META_KEY = (slot: string) => `smokestack:save:${slot}:meta`;

// A raw GameState is ~1.7 MB (12,288 tile objects), so four slots would not fit the usual 5 MB
// localStorage quota. Tiles are stored as small tuples instead and expanded again on load.
const TERRAIN: Terrain[] = ['water', 'sand', 'grass', 'forest', 'hills', 'mountain'];
const OWNERS: (OwnerId | null)[] = [null, 'player', 'rival'];

type PackedTile = [number, string | 0, number, number, number, number, number, number];

function packTile(t: Tile): PackedTile {
  return [
    TERRAIN.indexOf(t.terrain),
    t.deposit ?? 0,
    (t.road ? 1 : 0) | (t.rail ? 2 : 0),
    OWNERS.indexOf(t.roadOwner),
    OWNERS.indexOf(t.railOwner),
    t.buildingId ?? -1,
    t.cityId ?? -1,
    t.pollution,
  ];
}

function unpackTile(p: PackedTile): Tile {
  if (!Array.isArray(p) || p.length < 8 || !Number.isInteger(p[0]) || p[0] < 0 || p[0] >= TERRAIN.length) {
    throw new Error('bad tile');
  }
  return {
    terrain: TERRAIN[p[0]],
    deposit: p[1] === 0 ? null : p[1],
    road: (p[2] & 1) !== 0,
    rail: (p[2] & 2) !== 0,
    roadOwner: OWNERS[p[3]] ?? null,
    railOwner: OWNERS[p[4]] ?? null,
    buildingId: p[5] < 0 ? null : p[5],
    cityId: p[6] < 0 ? null : p[6],
    pollution: p[7],
  };
}

function errorText(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'QuotaExceededError' || /quota/i.test(String(e))) return 'Browser storage is full - delete an old save or free some space';
  return 'Browser storage is unavailable';
}

/** Serializes a state to the compact save format (tiles as tuples). */
export function packState(state: GameState): string {
  const packed = { ...state, map: { ...state.map, tiles: state.map.tiles.map(packTile) } };
  return serialize(packed as unknown as GameState);
}

/** Parses, migrates and validates a save string, expanding packed tiles. */
export function unpackState(raw: string): Result<GameState> {
  const r = deserialize(raw);
  if (!r.ok) return r;
  const state = r.value;
  const tiles = state.map.tiles as unknown[];
  // a plain object tile means a save that predates tile packing
  if (tiles.length > 0 && typeof tiles[0] !== 'object') return err('Save file is corrupted');
  if (Array.isArray(tiles[0])) {
    try {
      state.map.tiles = (tiles as PackedTile[]).map(unpackTile);
    } catch {
      return err('Save file is corrupted');
    }
  }
  return ok(state);
}

/** Writes `state` to a slot. Never throws; a full or blocked storage returns an error. */
export function saveTo(slot: SaveSlot, state: GameState): Result {
  try {
    localStorage.setItem(KEY(slot), packState(state));
    const meta: SaveInfo & { v: number } = {
      v: SAVE_VERSION,
      slot,
      date: formatDate(state.date),
      company: state.companies.player.name,
      money: state.companies.player.money,
    };
    try {
      localStorage.setItem(META_KEY(slot), JSON.stringify(meta));
    } catch {
      // a stale meta key would describe the previous save; listSaves then reads the save itself
      try {
        localStorage.removeItem(META_KEY(slot));
      } catch {
        /* nothing more to do */
      }
    }
    return ok();
  } catch (e) {
    return err(errorText(e));
  }
}

export function loadFrom(slot: SaveSlot): Result<GameState> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY(slot));
  } catch {
    return err('Browser storage is unavailable');
  }
  if (raw === null) return err('Empty slot');
  return unpackState(raw);
}

function readInfo(slot: SaveSlot): SaveInfo | null {
  try {
    const meta = localStorage.getItem(META_KEY(slot));
    if (meta !== null) {
      const m = JSON.parse(meta) as SaveInfo & { v?: number };
      // metas without the current version (e.g. SMOKESTACK I) are not trusted; the full read decides
      if (m.v === SAVE_VERSION && typeof m.company === 'string' && typeof m.date === 'string' && typeof m.money === 'number' && localStorage.getItem(KEY(slot)) !== null) {
        return { slot, date: m.date, company: m.company, money: m.money };
      }
    }
  } catch {
    /* fall through to the full read */
  }
  const r = loadFrom(slot);
  if (!r.ok) return null;
  return { slot, date: formatDate(r.value.date), company: r.value.companies.player.name, money: r.value.companies.player.money };
}

/** Metadata of every non-empty, readable slot, in SLOTS order. */
export function listSaves(): SaveInfo[] {
  const out: SaveInfo[] = [];
  for (const slot of SLOTS) {
    const info = readInfo(slot);
    if (info) out.push(info);
  }
  return out;
}

/** Saves to the `auto` slot at the start of every in-game January. Returns an unsubscribe. */
export function attachAutosave(ctx: SimContext): () => void {
  return ctx.bus.on('dayStart', (e) => {
    if (e.date.month !== 1 || e.date.day !== 1) return;
    const r = saveTo('auto', ctx.state);
    if (!r.ok) ctx.bus.emit({ type: 'toast', message: `Autosave failed: ${r.error}`, tone: 'bad' });
  });
}
