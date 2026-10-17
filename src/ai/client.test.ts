import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateToDays } from '../sim/clock';
import { postDecision } from '../sim/ai/mailbox';
import { testState } from '../sim/testkit';
import type { GameState } from '../sim/types';
import { aiStatus, startAiClient } from './client';

function setup(n = 1) {
  const state = testState();
  for (let i = 0; i < n; i++) {
    postDecision(state, {
      id: `card:${i}`, question: 'Which card?',
      options: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }],
      context: { year: 1900 }, dueDay: dateToDays(state.date) + 60,
    });
  }
  return state;
}

interface Fake { fetchImpl: typeof fetch; posts: { body: any }[]; calls: string[] }
function fake(opts: { health?: unknown; decide?: (body: any) => unknown; hold?: boolean } = {}): Fake & { release: () => void } {
  const posts: { body: any }[] = [];
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/health')) {
      if (opts.health === 'fail') throw new Error('down');
      return new Response(JSON.stringify(opts.health ?? { enabled: true }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body));
    posts.push({ body });
    if (opts.hold) await new Promise<void>((r) => waiting.push(r));
    const out = opts.decide ? opts.decide(body) : { answers: { pick: { type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 0.9, b: 0.1 } } } };
    return new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, posts, calls, release: () => waiting.splice(0).forEach((r) => r()) };
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function tick(ms = 2000) { await vi.advanceTimersByTimeAsync(ms); await flush(); }

describe('startAiClient', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('answers a pending request', async () => {
    const state = setup();
    const f = fake();
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush();
    await tick();
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].body.questions.pick).toEqual({ type: 'choice', instructions: 'Which card?', criteria: { a: 'Alpha', b: 'Beta' } });
    expect(f.posts[0].body.state).toEqual({ year: 1900 });
    expect(state.ai!.pending).toHaveLength(0);
    expect(state.ai!.answers['card:0'].probabilities).toEqual({ a: 0.9, b: 0.1 });
    expect(aiStatus()).toBe('connected');
    stop();
  });

  it('reports not configured when health says disabled, and posts nothing', async () => {
    const state = setup();
    const f = fake({ health: { enabled: false } });
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush(); await tick(); await tick();
    expect(f.posts).toHaveLength(0);
    expect(aiStatus()).toBe('not configured');
    stop();
  });

  it('a failed health check means no posts', async () => {
    const state = setup();
    const f = fake({ health: 'fail' });
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush(); await tick(); await tick();
    expect(f.posts).toHaveLength(0);
    expect(aiStatus()).toBe('offline');
    expect(console.info).toHaveBeenCalledTimes(1);
    stop();
  });

  it('the setting off means no posts', async () => {
    const state = setup();
    const f = fake();
    let on = false;
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => on });
    await flush(); await tick(); await tick();
    expect(f.posts).toHaveLength(0);
    on = true;
    await tick();
    expect(f.posts).toHaveLength(1);
    stop();
  });

  it('two ticks while one request is in flight give one post', async () => {
    const state = setup();
    const f = fake({ hold: true });
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush(); await tick(); await tick(); await tick();
    expect(f.posts).toHaveLength(1);
    f.release(); await flush();
    expect(state.ai!.pending).toHaveLength(0);
    stop();
  });

  it('holds the rate limit of 30 a minute', async () => {
    const state = setup(2); // two unanswered requests: 2 posts per tick without a limit
    const f = fake({ decide: () => ({ nope: true }) });
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush();
    for (let i = 0; i < 29; i++) await tick(); // 58 s: would be 58 posts unlimited
    expect(f.posts).toHaveLength(30);
    await tick(); // 60 s: the window is still full
    expect(f.posts).toHaveLength(30);
    await tick(); // 62 s: the first posts have aged out
    expect(f.posts.length).toBeGreaterThan(30);
    expect(f.posts.length).toBeLessThanOrEqual(32);
    stop();
  });

  it('a malformed response gives no answer', async () => {
    const state = setup();
    const f = fake({ decide: () => ({ answers: { pick: { probabilities: 'x' } } }) });
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush(); await tick();
    expect(f.posts).toHaveLength(1);
    expect(state.ai!.pending).toHaveLength(1);
    expect(state.ai!.answers).toEqual({});
    stop();
  });

  it('teardown stops the timers', async () => {
    const state = setup();
    const f = fake();
    const stop = startAiClient({ state }, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush();
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await tick(); await tick();
    expect(f.posts).toHaveLength(0);
  });

  it('reads game.state each tick (a loaded save replaces it)', async () => {
    const game: { state: GameState } = { state: testState() };
    const f = fake();
    const stop = startAiClient(game, { fetchImpl: f.fetchImpl, enabled: () => true });
    await flush(); await tick();
    expect(f.posts).toHaveLength(0);
    game.state = setup();
    await tick();
    expect(f.posts).toHaveLength(1);
    expect(game.state.ai!.pending).toHaveLength(0);
    stop();
  });
});
