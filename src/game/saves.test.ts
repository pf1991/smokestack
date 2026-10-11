// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachAutosave, listSaves, loadFrom, packState, saveTo, SLOTS, unpackState } from './saves';
import { runDays } from '../sim/simulation';
import { addCompany } from '../sim/companies';
import { createGame } from '../sim/state';
import { testCtx, testState } from '../sim/testkit';

beforeEach(() => localStorage.clear());

describe('saves', () => {
  it('packState/unpackState round-trip', () => {
    const state = createGame({ seed: 7 });
    const r = unpackState(packState(state));
    expect(r.ok && r.value).toEqual(state);
  });

  it('round-trips arbitrary owner ids on tiles', () => {
    const s = createGame({ seed: 5 });
    addCompany(s, { id: 'r_a', name: 'R', money: 1, loan: 0, kind: 'regional' });
    for (let i = 0; i < 3; i++) { s.map.tiles[i].road = true; s.map.tiles[i].roadOwner = 'r_a'; }
    const r = unpackState(packState(s));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const idx = r.value.map.tiles.flatMap((t, i) => (t.roadOwner === 'r_a' ? [i] : []));
      expect(idx).toEqual([0, 1, 2]);
    }
  });

  it('a SMOKESTACK I save is refused by loadFrom and skipped by listSaves', () => {
    const v1 = JSON.stringify({ version: 1, map: { tiles: [] } });
    localStorage.setItem('smokestack:save:slot1', v1);
    localStorage.setItem('smokestack:save:slot1:meta', JSON.stringify({ slot: 'slot1', date: '1 Jan 1900', company: 'Old', money: 5 }));
    localStorage.setItem('smokestack:save:slot2', v1);
    expect(loadFrom('slot1')).toEqual({ ok: false, error: 'Save from SMOKESTACK I cannot be loaded in this version' });
    expect(() => listSaves()).not.toThrow();
    expect(listSaves()).toEqual([]);
  });

  it('save/load round-trip in jsdom localStorage', () => {
    const state = createGame({ seed: 11, companyName: 'Round Trip Ltd' });
    state.companies.player.money = 123_456;
    expect(saveTo('slot1', state).ok).toBe(true);
    expect(localStorage.getItem('smokestack:save:slot1')).not.toBeNull();
    const r = loadFrom('slot1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(state);
    const list = listSaves();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slot: 'slot1', date: '1 Jan 1900', company: 'Round Trip Ltd', money: 123_456 });
    expect(SLOTS).toEqual(['auto', 'slot1', 'slot2', 'slot3']);
  });

  it('a full save stays small enough for four slots in a 5M-character quota', () => {
    saveTo('slot1', createGame({ seed: 11 }));
    expect(localStorage.getItem('smokestack:save:slot1')!.length).toBeLessThan(1_000_000);
  });

  it('loadFrom empty slot -> err Empty slot', () => {
    expect(loadFrom('slot2')).toEqual({ ok: false, error: 'Empty slot' });
  });

  it('corrupt storage is reported, not thrown', () => {
    localStorage.setItem('smokestack:save:slot3', '{nope');
    expect(loadFrom('slot3').ok).toBe(false);
    expect(listSaves()).toEqual([]);
  });

  it('quota exceeded handled -> err', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const r = saveTo('slot1', testState());
    spy.mockRestore();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/full|space|quota/i);
  });

  it('unavailable storage is handled', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadFrom('auto').ok).toBe(false);
    expect(listSaves()).toEqual([]);
    spy.mockRestore();
  });

  it('old saves without scenarioId load as sandbox', () => {
    const s = createGame({ seed: 2 }) as unknown as Record<string, unknown>;
    delete s.scenarioId;
    delete s.flags;
    localStorage.setItem('smokestack:save:auto', JSON.stringify(s));
    const r = loadFrom('auto');
    expect(r.ok && r.value.scenarioId).toBe('sandbox');
  });

  it('autosaves every January', () => {
    const ctx = testCtx(testState({ year: 1900 }));
    const off = attachAutosave(ctx);
    runDays(ctx, 359);
    expect(listSaves()).toEqual([]);
    runDays(ctx, 2);
    expect(listSaves().map((s) => s.slot)).toEqual(['auto']);
    off();
  });

  it('a failed meta write removes the stale meta key', () => {
    saveTo('slot1', testState());
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.endsWith(':meta')) throw new Error('full');
      real.call(this, k, v);
    });
    const next = testState();
    next.companies.player.name = 'Second Co';
    expect(saveTo('slot1', next).ok).toBe(true);
    spy.mockRestore();
    expect(localStorage.getItem('smokestack:save:slot1:meta')).toBeNull();
    expect(listSaves()[0].company).toBe('Second Co');
  });

  it('malformed packed tiles load as corrupted', () => {
    saveTo('slot1', createGame({ seed: 5 }));
    const raw = JSON.parse(localStorage.getItem('smokestack:save:slot1')!);
    raw.map.tiles[3] = [99, 0, 0, 0, 0, -1, -1, 0];
    localStorage.setItem('smokestack:save:slot1', JSON.stringify(raw));
    expect(loadFrom('slot1')).toEqual({ ok: false, error: 'Save file is corrupted' });
    raw.map.tiles[3] = 'x';
    localStorage.setItem('smokestack:save:slot1', JSON.stringify(raw));
    expect(loadFrom('slot1').ok).toBe(false);
  });

  it('round-trips layers and rejects a corrupted one', () => {
    const s = testState({ width: 8, height: 6 });
    s.layers.smog = Array.from({ length: 48 }, (_, i) => (i % 7 === 0 ? 1.5 : 0));
    const r = unpackState(packState(s));
    expect(r.ok && r.value.layers).toEqual(s.layers);
    const raw = JSON.parse(packState(s));
    raw.layers.smog = [-1, 99];
    localStorage.setItem('smokestack:save:slot1', JSON.stringify(raw));
    const bad = loadFrom('slot1');
    expect(!bad.ok && bad.error).toBe('Save file is corrupted');
  });
});
