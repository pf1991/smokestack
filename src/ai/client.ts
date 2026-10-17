/**
 * The game-layer JEV client. It polls the sim's decision mailbox every 2 s of real time, asks the
 * local proxy (server/ai-proxy.mjs) about each pending request and hands the answer back through
 * answerDecision, the only write it makes. It never blocks the game and swallows every error.
 */
import { answerDecision } from '../sim/ai/mailbox';
import type { GameState } from '../sim/types';

export type AiStatus = 'connected' | 'not configured' | 'offline' | 'unknown';

const INTERVAL_MS = 2000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const QUESTION_ID = 'pick';

const TIMEOUT_MS = 4500; // above the proxy's own 3 s upstream limit, so the proxy answers first

let lastStatus: AiStatus = 'unknown';
const listeners = new Set<() => void>();
function setStatus(s: AiStatus): void {
  lastStatus = s;
  for (const fn of [...listeners]) fn();
}
/** Calls `fn` whenever the health result changes; returns an unsubscribe. */
export function onAiStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
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
  /** every request id gets exactly one attempt per client, success or failure */
  const tried = new Set<string>();

  /** fetch with a 4.5 s abort (a fake-timer friendly stand-in for AbortSignal.timeout) */
  const timed = async <T>(url: string, init: RequestInit | undefined, read: (r: Response) => Promise<T>): Promise<T> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await read(await doFetch!(url, { ...init, signal: ctl.signal }));
    } finally {
      clearTimeout(t);
    }
  };
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
      const data = await timed('/api/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, async (res) => {
        if (!res.ok) throw new Error('decide');
        return (await res.json()) as { answers?: Record<string, { probabilities?: unknown }> };
      });
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
      if (inFlight.has(req.id) || tried.has(req.id)) continue;
      if (sent.length >= MAX_PER_WINDOW) break;
      sent.push(now);
      inFlight.add(req.id);
      tried.add(req.id);
      void ask(state, req.id);
    }
  };

  const timer = setInterval(tick, INTERVAL_MS);

  void (async () => {
    try {
      if (!doFetch) throw new Error('no fetch');
      const data = await timed('/api/health', undefined, async (res) => {
        if (!res.ok) throw new Error('health');
        return (await res.json()) as { enabled?: unknown };
      });
      if (stopped) return;
      ready = data?.enabled === true;
      setStatus(ready ? 'connected' : 'not configured');
    } catch {
      if (!stopped) setStatus('offline');
      fail();
    }
  })();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
