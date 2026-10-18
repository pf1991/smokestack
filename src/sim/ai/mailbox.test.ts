import { describe, expect, it } from 'vitest';
import { packState, unpackState } from '../../game/saves';
import { dateToDays } from '../clock';
import { random } from '../rng';
import { checkInvariants } from '../invariants';
import { deserialize, serialize } from '../simulation';
import { testState } from '../testkit';
import type { AiRequest, GameState } from '../types';
import { answerDecision, postDecision, takeDecision } from './mailbox';

const opts = [
  { key: 'a', weight: 1 },
  { key: 'b', weight: 1 },
  { key: 'c', weight: 1 },
  { key: 'd', weight: 1 },
];

function req(s: GameState, id: string, dueIn = 5): AiRequest {
  return {
    id,
    question: 'q',
    options: opts.map((o) => ({ key: o.key, label: o.key })),
    context: {},
    dueDay: dateToDays(s.date) + dueIn,
  };
}

function posted(id = 'card:1'): GameState {
  const s = testState();
  postDecision(s, req(s, id));
  return s;
}

/** the pick for each of many seeds, to show which option an answer favours */
function histogram(answer: Record<string, number> | null, blend = 0.5, n = 2000): Record<string, number> {
  const h: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < n; i++) {
    const s = posted();
    s.rngState = i * 2654435761;
    if (answer) answerDecision(s, 'card:1', { probabilities: answer });
    h[takeDecision(s, 'card:1', opts, blend)!]++;
  }
  return h;
}

describe('decision mailbox', () => {
  it('creates state.ai lazily and posts idempotently', () => {
    const s = testState();
    expect(s.ai).toBeUndefined();
    postDecision(s, req(s, 'x'));
    postDecision(s, req(s, 'x'));
    expect(s.ai!.pending).toHaveLength(1);
  });

  it('drops requests already past due, keeps ones due today', () => {
    const s = testState();
    postDecision(s, req(s, 'late', -1));
    expect(s.ai?.pending ?? []).toHaveLength(0);
    postDecision(s, req(s, 'today', 0));
    expect(s.ai!.pending).toHaveLength(1);
  });

  it('caps pending at 8, dropping the oldest', () => {
    const s = testState();
    for (let i = 0; i < 10; i++) postDecision(s, req(s, `r${i}`));
    expect(s.ai!.pending.map((r) => r.id)).toEqual(['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('refuses answers for unknown, late (already answered) or never-posted ids', () => {
    const s = posted();
    expect(answerDecision(s, 'nope', { probabilities: { a: 1 } })).toBe(false);
    expect(answerDecision(testState(), 'card:1', { probabilities: { a: 1 } })).toBe(false);
    expect(answerDecision(s, 'card:1', { probabilities: { a: 1 } })).toBe(true);
    expect(s.ai!.pending).toHaveLength(0);
    expect(answerDecision(s, 'card:1', { probabilities: { b: 1 } })).toBe(false);
    takeDecision(s, 'card:1', opts);
    expect(answerDecision(s, 'card:1', { probabilities: { b: 1 } })).toBe(false);
  });

  it('blends a one-hot answer over 4 equal options to a top probability of 0.625', () => {
    const h = histogram({ a: 1 });
    expect(h.a / 2000).toBeGreaterThan(0.58);
    expect(h.a / 2000).toBeLessThan(0.67);
    expect(h.b / 2000).toBeGreaterThan(0.1);
  });

  it('uses the authored weights alone when there is no answer', () => {
    const h = histogram(null);
    for (const k of ['a', 'b', 'c', 'd']) expect(Math.abs(h[k] / 2000 - 0.25)).toBeLessThan(0.05);
  });

  it('draws the rng exactly once with or without an answer', () => {
    const a = posted();
    const b = posted();
    answerDecision(b, 'card:1', { probabilities: { a: 1 } });
    const c = posted();
    takeDecision(a, 'card:1', opts);
    takeDecision(b, 'card:1', opts);
    expect(a.rngState).toBe(b.rngState);
    const before = c.rngState;
    takeDecision(c, 'unposted', opts);
    expect(c.rngState).not.toBe(before);
    expect(c.rngState).toBe(a.rngState);
    // and once even without a mailbox at all
    const d = testState();
    d.rngState = a.rngState;
    const e = testState();
    e.rngState = a.rngState;
    random(e);
    expect(takeDecision(d, 'x', opts)).not.toBeNull();
    expect(d.rngState).toBe(e.rngState);
  });

  it('returns null for empty options without drawing', () => {
    const s = posted();
    const before = s.rngState;
    expect(takeDecision(s, 'card:1', [])).toBeNull();
    expect(s.rngState).toBe(before);
  });

  it('survives garbage answers: NaN, negatives, unknown keys, all zeros', () => {
    const garbage: Record<string, number>[] = [
      { a: NaN, b: NaN },
      { a: -5, b: -1 },
      { zzz: 1 },
      { a: 0, b: 0, c: 0, d: 0 },
      { a: Infinity, b: -Infinity },
      {},
    ];
    for (const g of garbage) {
      const s = posted();
      const start = s.rngState;
      expect(answerDecision(s, 'card:1', { probabilities: g })).toBe(true);
      expect(checkInvariants(s)).toEqual([]);
      const plain = posted();
      plain.rngState = start;
      const got = takeDecision(s, 'card:1', opts);
      expect(got).toBe(takeDecision(plain, 'card:1', opts));
      expect(s.ai!.log.at(-1)).toEqual({ id: 'card:1', picked: got, usedAi: false });
    }
    // a partly good answer drops the bad part and keeps the rest
    const s = posted();
    answerDecision(s, 'card:1', { probabilities: { a: NaN, b: -1, zzz: 9, c: 2 } });
    takeDecision(s, 'card:1', opts);
    expect(s.ai!.log.at(-1)!.usedAi).toBe(true);
  });

  it('survives a non-object answer without throwing', () => {
    const s = posted();
    expect(() => answerDecision(s, 'card:1', null as never)).not.toThrow();
    expect(() => takeDecision(s, 'card:1', opts)).not.toThrow();
  });

  it('handles all-zero authored weights as uniform', () => {
    const s = posted();
    expect(takeDecision(s, 'card:1', opts.map((o) => ({ ...o, weight: 0 })))).toMatch(/^[abcd]$/);
  });

  it('consumes the request and answer, and logs the last 20', () => {
    const s = testState();
    for (let i = 0; i < 25; i++) {
      postDecision(s, req(s, `r${i}`));
      answerDecision(s, `r${i}`, { probabilities: { a: 1 } });
      takeDecision(s, `r${i}`, opts);
    }
    expect(s.ai!.pending).toHaveLength(0);
    expect(s.ai!.answers).toEqual({});
    expect(s.ai!.log).toHaveLength(20);
    expect(s.ai!.log[0].id).toBe('r5');
    expect(s.ai!.log.every((l) => l.usedAi)).toBe(true);
  });

  it('invariants flag a corrupt mailbox', () => {
    const s = posted();
    s.ai!.answers.bad = { probabilities: { a: NaN } };
    expect(checkInvariants(s).some((m) => m.includes('ai:'))).toBe(true);
  });

  it('gives the same pick after a save and load round trip', () => {
    const make = () => {
      const s = posted();
      answerDecision(s, 'card:1', { probabilities: { c: 0.9, a: 0.1 } });
      return s;
    };
    const direct = make();
    const viaPlain = deserialize(serialize(make()));
    if (!viaPlain.ok) throw new Error('load failed');
    const viaPacked = unpackState(packState(make()));
    if (!viaPacked.ok) throw new Error('unpack failed');
    const expected = takeDecision(direct, 'card:1', opts);
    for (const loaded of [viaPlain.value.state, viaPacked.value]) {
      expect(loaded.ai!.answers['card:1']).toBeDefined();
      expect(takeDecision(loaded, 'card:1', opts)).toBe(expected);
      expect(loaded.rngState).toBe(direct.rngState);
    }
  });

  it('loads old saves with no ai field', () => {
    const r = unpackState(packState(testState()));
    if (!r.ok) throw new Error('unpack failed');
    expect(r.value.ai).toBeUndefined();
    expect(checkInvariants(r.value)).toEqual([]);
  });
});

describe('takeDecision maxShare', () => {
  it('caps a dominant option and spreads the excess; no answer means no cap', () => {
    const o = [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }, { key: 'd', weight: 1 }];
    let hitsAi = 0;
    let hitsPlain = 0;
    for (let i = 0; i < 3000; i++) {
      const s = posted();
      s.rngState = i * 2654435761;
      answerDecision(s, 'card:1', { probabilities: { a: 1 } });
      if (takeDecision(s, 'card:1', o, 1, 0.6) === 'a') hitsAi++;
      const t = posted();
      t.rngState = i * 2654435761;
      if (takeDecision(t, 'card:1', [{ key: 'a', weight: 9 }, { key: 'b', weight: 1 }], 0.5, 0.6) === 'a') hitsPlain++;
    }
    expect(hitsAi / 3000).toBeGreaterThan(0.56);
    expect(hitsAi / 3000).toBeLessThan(0.64);
    expect(hitsPlain / 3000).toBeGreaterThan(0.86);
  });
});
