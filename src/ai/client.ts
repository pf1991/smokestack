/**
 * The game-layer JEV client. It polls the sim's decision mailbox every 2 s of real time, asks the
 * local proxy (server/ai-proxy.mjs) about each pending request and hands the answer back through
 * answerDecision, the only write it makes. It never blocks the game and swallows every error.
 */
import { answerDecision } from '../sim/ai/mailbox';
import type { GameState } from '../sim/types';

export type AiStatus = 'connected' | 'not configured' | 'offline';

const INTERVAL_MS = 2000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const QUESTION_ID = 'pick';

let lastStatus: AiStatus = 'offline';
/** The last health result, for the settings screen. */
export function aiStatus(): AiStatus {
  return lastStatus;
}

export interface AiClientOptions {
  fetchImpl?: typeof fetch;
  enabled: () => boolean;
}

export function startAiClient(game: { state: GameState }, opts: AiClientOptions): () => void {
  const doFetch: typeof fetch | undefined = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  let stopped = false;
  let ready = false;
  let logged = false;
  const inFlight = new Set<string>();
  const sent: number[] = [];

  const fail = (): void => {
    if (logged) return;
    logged = true;
    console.info('JEV client: unavailable');
  };

  const ask = async (state: GameState, id: string): Promise<void> => {
    const req = state.ai?.pending.find((r) => r.id === id);
    if (!req || !doFetch) return;
    const body = {
      state: req.context,
      questions: {
        [QUESTION_ID]: {
          type: 'choice',
          instructions: req.question.slice(0, 1024),
          criteria: Object.fromEntries(req.options.map((o) => [o.key, o.label.slice(0, 256)])),
        },
      },
    };
    try {
      const res = await doFetch('/api/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return fail();
      const data = (await res.json()) as { answers?: Record<string, { probabilities?: unknown }> };
      const p = data?.answers?.[QUESTION_ID]?.probabilities;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      if (stopped) return;
      answerDecision(state, id, { probabilities: p as Record<string, number> });
    } catch {
      fail();
    } finally {
      inFlight.delete(id);
    }
  };

  const tick = (): void => {
    if (stopped || !ready || !opts.enabled()) return;
    const state = game.state;
    const pending = state.ai?.pending;
    if (!pending) return;
    const now = Date.now();
    while (sent.length > 0 && now - sent[0] >= WINDOW_MS) sent.shift();
    for (const req of pending) {
      if (inFlight.has(req.id)) continue;
      if (sent.length >= MAX_PER_WINDOW) break;
      sent.push(now);
      inFlight.add(req.id);
      void ask(state, req.id);
    }
  };

  const timer = setInterval(tick, INTERVAL_MS);

  void (async () => {
    try {
      if (!doFetch) throw new Error('no fetch');
      const res = await doFetch('/api/health');
      const data = (await res.json()) as { enabled?: unknown };
      if (stopped) return;
      if (!res.ok) throw new Error('health');
      ready = data?.enabled === true;
      lastStatus = ready ? 'connected' : 'not configured';
    } catch {
      if (!stopped) lastStatus = 'offline';
      fail();
    }
  })();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
