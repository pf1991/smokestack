// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachAutosave, listSaves, loadFrom, saveTo, SLOTS } from './saves';
import { runDays } from '../sim/simulation';
import { createGame } from '../sim/state';
import { testCtx, testState } from '../sim/testkit';

beforeEach(() => localStorage.clear());

describe('saves', () => {
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
});
