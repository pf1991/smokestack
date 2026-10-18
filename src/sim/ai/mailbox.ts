import { dateToDays } from '../clock';
import { random } from '../rng';
import type { AiAnswer, AiMailbox, AiRequest, GameState } from '../types';

export const MAX_PENDING = 8;
export const MAX_LOG = 20;

function mailbox(state: GameState): AiMailbox {
  if (!state.ai) state.ai = { pending: [], answers: {}, log: [] };
  return state.ai;
}

/** Queues a decision for the game layer to ask JEV about. Idempotent per id; expired requests are dropped. */
export function postDecision(state: GameState, req: AiRequest): void {
  if (req.dueDay < dateToDays(state.date)) return;
  const box = mailbox(state);
  if (box.pending.some((r) => r.id === req.id)) return;
  box.pending.push(req);
  while (box.pending.length > MAX_PENDING) {
    const dropped = box.pending.shift()!;
    delete box.answers[dropped.id];
  }
}

/** The game layer's only write: accepts an answer for a pending id and clears it from pending. */
export function answerDecision(state: GameState, id: string, answer: AiAnswer): boolean {
  const box = state.ai;
  if (!box) return false;
  const i = box.pending.findIndex((r) => r.id === id);
  if (i < 0) return false;
  const probabilities: Record<string, number> = {};
  const src = answer && typeof answer === 'object' ? answer.probabilities : null;
  if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) {
      probabilities[k] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    }
  }
  box.pending.splice(i, 1);
  box.answers[id] = { probabilities };
  // answers never outlive MAX_PENDING: drop the oldest-inserted
  const keys = Object.keys(box.answers);
  for (let j = 0; j < keys.length - MAX_PENDING; j++) delete box.answers[keys[j]];
  return true;
}

/**
 * Caps every share at `cap` of the total, giving the excess to the options still under it in
 * proportion to their share (evenly if they have none). Left alone when the cap cannot hold (cap * n < 1).
 */
function capShares(shares: number[], cap: number): number[] {
  const out = shares.slice();
  if (!(cap > 0) || cap * out.length < 1) return out;
  for (let round = 0; round < out.length; round++) {
    let excess = 0;
    let room = 0;
    let under = 0;
    for (const x of out) {
      if (x > cap) excess += x - cap;
      else { room += x; under++; }
    }
    if (excess <= 1e-12 || under === 0) break;
    // in proportion to what they hold; evenly when they hold nothing
    for (let i = 0; i < out.length; i++) {
      if (out[i] > cap) out[i] = cap;
      else out[i] += room > 0 ? (excess * out[i]) / room : excess / under;
    }
  }
  return out;
}

/**
 * Picks an option with exactly one random(state) draw, blending authored weights with the JEV
 * answer when a usable one exists. Consumes the request and the answer. `maxShare` (0..1) caps
 * any one option's share of the blended total; it applies only when an answer was blended.
 * Without a usable answer the draw is `random * Σw` against the raw weights, as a plain weighted pick.
 */
export function takeDecision(
  state: GameState,
  id: string,
  options: { key: string; weight: number }[],
  blend = 0.5,
  maxShare?: number,
): string | null {
  if (options.length === 0) return null;
  const w = options.map((o) => (Number.isFinite(o.weight) && o.weight > 0 ? o.weight : 0));
  const wSum = w.reduce((a, b) => a + b, 0);

  const ans = state.ai?.answers[id];
  let p: number[] | null = null;
  if (ans) {
    const raw = options.map((o) => {
      const v = ans.probabilities[o.key];
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    });
    const s = raw.reduce((a, b) => a + b, 0);
    if (s > 0) p = raw.map((v) => v / s);
  }
  let final = w;
  let total = wSum;
  if (p) {
    const b = Math.min(1, Math.max(0, blend));
    const base = options.map((_, i) => (wSum > 0 ? w[i] / wSum : 1 / options.length));
    final = base.map((x, i) => (1 - b) * x + b * p![i]);
    if (maxShare !== undefined) final = capShares(final, maxShare);
    total = final.reduce((a, c) => a + c, 0);
  } else if (wSum <= 0) {
    final = options.map(() => 1);
    total = options.length;
  }

  let r = random(state) * total;
  let picked = options[options.length - 1].key;
  for (let i = 0; i < options.length; i++) {
    r -= final[i];
    if (r < 0) { picked = options[i].key; break; }
  }

  if (state.ai) {
    const box = state.ai;
    box.pending = box.pending.filter((q) => q.id !== id);
    delete box.answers[id];
    box.log.push({ id, picked, usedAi: p !== null });
    if (box.log.length > MAX_LOG) box.log.splice(0, box.log.length - MAX_LOG);
  }
  return picked;
}
