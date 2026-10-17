// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProxy } from './ai-proxy.mjs';

type FetchImpl = typeof fetch;
const servers: http.Server[] = [];

async function start(opts: Parameters<typeof createProxy>[0]): Promise<string> {
  const server = http.createServer(createProxy(opts));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const question = { type: 'choice', instructions: 'pick', criteria: { a: 'A', b: 'B' } };
const body = (over: Record<string, unknown> = {}) => ({ state: { x: 1 }, questions: { q1: question }, ...over });
const post = (base: string, b: unknown, path = '/api/decide') =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

interface Call { url: string; init: RequestInit }
function okFetch(calls: Call[] = []): FetchImpl {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ model: 'jev-latest', answers: { q1: { type: 'choice', choice: 'a', confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } }, usage: { t: 1 } }),
      { status: 200 },
    );
  }) as unknown as FetchImpl;
}

describe('ai-proxy', () => {
  it('health reports enabled or disabled and never the key', async () => {
    const on = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
    const off = await start({ apiKey: undefined, fetchImpl: okFetch() });
    const a = await (await fetch(on + '/api/health')).text();
    expect(JSON.parse(a)).toEqual({ enabled: true });
    expect(a).not.toContain('test-key');
    expect(await (await fetch(off + '/api/health')).json()).toEqual({ enabled: false });
  });

  it('forwards model and auth, returns answers only', async () => {
    const calls: Call[] = [];
    const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(calls), upstream: 'http://up.test/x' });
    const res = await post(base, body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json)).toEqual(['answers']);
    expect(json.answers.q1.choice).toBe('a');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://up.test/x');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.model).toBe('jev-latest');
    expect(sent.state).toEqual({ x: 1 });
    expect(sent.questions.q1.criteria).toEqual({ a: 'A', b: 'B' });
  });

  it('does not forward extra question fields and uses a 3000 ms timeout', async () => {
    const calls: Call[] = [];
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(calls) });
    await post(base, body({ questions: { q1: { ...question, evil: 'x', extra: { a: 1 } } }, junk: 1 }));
    const sent = JSON.parse(calls[0].init.body as string);
    expect(Object.keys(sent).sort()).toEqual(['model', 'questions', 'state']);
    expect(Object.keys(sent.questions.q1).sort()).toEqual(['criteria', 'instructions', 'type']);
    expect(spy).toHaveBeenCalledWith(3000);
    spy.mockRestore();
  });

  it('uses the TypeSafe endpoint by default', async () => {
    const calls: Call[] = [];
    const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(calls) });
    await post(base, body());
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
  });

  describe('guards return 400', () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, 'd']));
    const cases: Record<string, unknown> = {
      'oversized state': body({ state: { blob: 'x'.repeat(13 * 1024) } }),
      '5 questions': body({ questions: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k) => [k, question])) }),
      '65 options': body({ questions: { q: { ...question, criteria: many(65) } } }),
      'non-choice type': body({ questions: { q: { ...question, type: 'text' } } }),
      'client model': body({ model: 'other-model' }),
      'no questions': body({ questions: {} }),
      'array body': [],
    };
    for (const [name, b] of Object.entries(cases)) {
      it(name, async () => {
        const calls: Call[] = [];
        const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(calls) });
        expect((await post(base, b)).status).toBe(400);
        expect(calls).toHaveLength(0);
      });
    }
    it('non-string criteria value', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      expect((await post(base, body({ questions: { q: { ...question, criteria: { a: 5 } } } }))).status).toBe(400);
    });
    it('missing instructions', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      const { instructions: _i, ...q } = question;
      expect((await post(base, body({ questions: { q } }))).status).toBe(400);
    });
    it('long instructions, bad ids, long descriptions, oversized questions', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      const bad = [
        { q: { ...question, instructions: 'x'.repeat(1025) } },
        { 'Bad Id': question },
        { q: { ...question, criteria: { 'Bad Key': 'd' } } },
        { q: { ...question, criteria: { a: 'x'.repeat(257) } } },
        // 4 questions x 20 options x 256 chars exceeds 16 KB
        Object.fromEntries(['a', 'b', 'c', 'd'].map((k) => [k, { ...question, criteria: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`o${i}`, "x".repeat(256)])) }])),
      ];
      for (const questions of bad) expect((await post(base, body({ questions }))).status).toBe(400);
    });
    it('state cap is measured in bytes', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      // 5000 chars of 3-byte glyphs = 15000 bytes > 12 KB, but only ~5 KB of chars
      expect((await post(base, body({ state: { s: '€'.repeat(5000) } }))).status).toBe(400);
    });
    it('oversized streamed body gets 413, not a reset', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      const status = await new Promise<number>((resolve, reject) => {
        const r = http.request(base + '/api/decide', { method: 'POST' }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        r.on('error', reject);
        r.write('x'.repeat(40 * 1024));
        r.write('x'.repeat(40 * 1024));
        r.end();
      });
      expect(status).toBe(413);
    });
    it('invalid JSON', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      const res = await fetch(base + '/api/decide', { method: 'POST', body: '{nope' });
      expect(res.status).toBe(400);
    });
    it('64 options is allowed', async () => {
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
      expect((await post(base, body({ questions: { q1: { ...question, criteria: many(64) } } }))).status).toBe(200);
    });
  });

  it('no key returns 503', async () => {
    const calls: Call[] = [];
    const base = await start({ apiKey: undefined, fetchImpl: okFetch(calls) });
    expect((await post(base, body())).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  describe('upstream failures return 502 without leaking', () => {
    const failures: Record<string, FetchImpl> = {
      'http 500': (async () => new Response('secret-upstream test-key', { status: 500 })) as unknown as FetchImpl,
      timeout: (async () => { throw new DOMException('timed out test-key', 'TimeoutError'); }) as unknown as FetchImpl,
      'invalid json': (async () => new Response('not json test-key', { status: 200 })) as unknown as FetchImpl,
      'no answers': (async () => new Response('{"model":"x"}', { status: 200 })) as unknown as FetchImpl,
    };
    for (const [name, fetchImpl] of Object.entries(failures)) {
      it(name, async () => {
        const base = await start({ apiKey: 'test-key', fetchImpl });
        const res = await post(base, body());
        expect(res.status).toBe(502);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ error: 'upstream' });
        expect(text).not.toContain('test-key');
      });
    }
    it('passes a 3 s abort signal', async () => {
      const calls: Call[] = [];
      const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(calls) });
      await post(base, body());
      expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('rate limits the 121st request in a minute', async () => {
    let t = 1000;
    const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(), now: () => t });
    for (let i = 0; i < 120; i++) expect((await fetch(base + '/api/health')).status).toBe(200);
    expect((await fetch(base + '/api/health')).status).toBe(429);
    t += 60_000;
    expect((await fetch(base + '/api/health')).status).toBe(200);
  });

  it('enforces a global ceiling across IPs and only trusts X-Real-IP when asked', async () => {
    const base = await start({ apiKey: 'test-key', fetchImpl: okFetch(), now: () => 5, trustProxy: true });
    for (let i = 0; i < 600; i++) {
      const r = await fetch(base + '/api/health', { headers: { 'x-real-ip': `10.0.${i % 250}.${Math.floor(i / 250)}` } });
      expect(r.status).toBe(200);
    }
    expect((await fetch(base + '/api/health', { headers: { 'x-real-ip': '9.9.9.9' } })).status).toBe(429);
    // untrusted: spoofed header must not give a fresh bucket
    const plain = await start({ apiKey: 'test-key', fetchImpl: okFetch(), now: () => 5 });
    for (let i = 0; i < 120; i++) await fetch(plain + '/api/health', { headers: { 'x-real-ip': `1.1.1.${i}` } });
    expect((await fetch(plain + '/api/health', { headers: { 'x-real-ip': '2.2.2.2' } })).status).toBe(429);
  });

  it('unknown paths and methods return 404', async () => {
    const base = await start({ apiKey: 'test-key', fetchImpl: okFetch() });
    expect((await fetch(base + '/nope')).status).toBe(404);
    expect((await fetch(base + '/api/decide')).status).toBe(404);
    expect((await fetch(base + '/api/health', { method: 'POST' })).status).toBe(404);
  });
});
