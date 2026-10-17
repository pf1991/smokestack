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
 * Picks an option with exactly one random(state) draw, blending authored weights with the JEV
 * answer when a usable one exists. Consumes the request and the answer.
 */
export function takeDecision(
  state: GameState,
  id: string,
  options: { key: string; weight: number }[],
  blend = 0.5,
): string | null {
  if (options.length === 0) return null;
  const w = options.map((o) => (Number.isFinite(o.weight) && o.weight > 0 ? o.weight : 0));
  const wSum = w.reduce((a, b) => a + b, 0);
  const base = options.map((_, i) => (wSum > 0 ? w[i] / wSum : 1 / options.length));

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
  const b = Math.min(1, Math.max(0, blend));
  const final = p ? base.map((x, i) => (1 - b) * x + b * p![i]) : base;

  let r = random(state);
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
