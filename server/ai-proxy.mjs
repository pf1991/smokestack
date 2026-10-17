// Decision proxy for TypeSafe JEV. Zero dependencies (Node built-ins only).
// The API key lives only in this process; it is never returned, logged or echoed.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const MAX_STATE_BYTES = 12 * 1024;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 64;
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 3000;
const RATE_PER_MINUTE = 120;

function send(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns an error string for a bad request body, or null when it is acceptable. */
function validate(b) {
  if (!isObj(b)) return 'body';
  if ('model' in b && b.model !== MODEL) return 'model';
  if (!('state' in b) || JSON.stringify(b.state ?? null).length > MAX_STATE_BYTES) return 'state';
  if (!isObj(b.questions)) return 'questions';
  const ids = Object.keys(b.questions);
  if (ids.length < 1 || ids.length > MAX_QUESTIONS) return 'questions';
  for (const id of ids) {
    const q = b.questions[id];
    if (!isObj(q) || q.type !== 'choice' || typeof q.instructions !== 'string') return 'question';
    if (!isObj(q.criteria)) return 'criteria';
    const n = Object.keys(q.criteria).length;
    if (n < 1 || n > MAX_OPTIONS) return 'criteria';
    if (!Object.values(q.criteria).every((d) => typeof d === 'string')) return 'criteria';
  }
  return null;
}

export function createProxy(opts) {
  const { apiKey, upstream = DEFAULT_UPSTREAM, fetchImpl = fetch, now = () => Date.now() } = opts;
  const buckets = new Map(); // ip -> { tokens, at }

  function allow(ip) {
    const t = now();
    let b = buckets.get(ip);
    if (!b) {
      if (buckets.size > 5000) buckets.clear();
      b = { tokens: RATE_PER_MINUTE, at: t };
      buckets.set(ip, b);
    }
    b.tokens = Math.min(RATE_PER_MINUTE, b.tokens + ((t - b.at) * RATE_PER_MINUTE) / 60000);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  return async (req, res) => {
    try {
      // nginx sets X-Real-IP; the proxy is only reachable on the compose network.
      const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? 'unknown');
      if (!allow(ip)) return send(res, 429, { error: 'rate' });
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { enabled: Boolean(apiKey) });
      if (req.method !== 'POST' || path !== '/api/decide') return send(res, 404, { error: 'not found' });

      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: 'bad request' });
      }
      if (validate(parsed) !== null) return send(res, 400, { error: 'bad request' });
      if (!apiKey) return send(res, 503, { error: 'disabled' });

      try {
        const up = await fetchImpl(upstream, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ state: parsed.state, model: MODEL, questions: parsed.questions }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (!up.ok) return send(res, 502, { error: 'upstream' });
        const json = await up.json();
        if (!isObj(json) || !isObj(json.answers)) return send(res, 502, { error: 'upstream' });
        return send(res, 200, { answers: json.answers });
      } catch {
        return send(res, 502, { error: 'upstream' });
      }
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  const apiKey = process.env.TYPESAFE_API_KEY || undefined;
  http.createServer(createProxy({ apiKey })).listen(port, () => {
    console.log(`ai-proxy listening on ${port} (${apiKey ? 'enabled' : 'disabled: no key'})`);
  });
}
