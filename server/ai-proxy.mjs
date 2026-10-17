// Decision proxy for TypeSafe JEV. Zero dependencies (Node built-ins only).
// The API key lives only in this process; it is never returned, logged or echoed.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const MAX_STATE_BYTES = 12 * 1024;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 64;
const MAX_INSTRUCTIONS = 1024;
const MAX_DESCRIPTION = 256;
const MAX_QUESTIONS_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 3000;
const RATE_PER_MINUTE = 120;
const GLOBAL_PER_MINUTE = 600;

function send(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/** Resolves the body text, or null when it exceeds MAX_BODY_BYTES (caller replies 413). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return resolve(null);
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        over = true;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
const ID_RE = /^[a-z0-9_]{1,40}$/;

/**
 * Validates the body and returns the sanitised payload (whitelisted fields only),
 * or null when it is unacceptable.
 */
function sanitise(b) {
  if (!isObj(b)) return null;
  if ('model' in b && b.model !== MODEL) return null;
  if (!('state' in b) || bytes(b.state) > MAX_STATE_BYTES) return null;
  if (!isObj(b.questions)) return null;
  const ids = Object.keys(b.questions);
  if (ids.length < 1 || ids.length > MAX_QUESTIONS) return null;
  const questions = {};
  for (const id of ids) {
    const q = b.questions[id];
    if (!ID_RE.test(id) || !isObj(q) || q.type !== 'choice') return null;
    if (typeof q.instructions !== 'string' || q.instructions.length > MAX_INSTRUCTIONS) return null;
    if (!isObj(q.criteria)) return null;
    const keys = Object.keys(q.criteria);
    if (keys.length < 1 || keys.length > MAX_OPTIONS) return null;
    const criteria = {};
    for (const k of keys) {
      const d = q.criteria[k];
      if (!ID_RE.test(k) || typeof d !== 'string' || d.length > MAX_DESCRIPTION) return null;
      criteria[k] = d;
    }
    questions[id] = { type: 'choice', instructions: q.instructions, criteria };
  }
  if (bytes(questions) > MAX_QUESTIONS_BYTES) return null;
  return { state: b.state, questions };
}

export function createProxy(opts) {
  const {
    apiKey,
    upstream = DEFAULT_UPSTREAM,
    fetchImpl = fetch,
    now = () => Date.now(),
    trustProxy = false,
  } = opts;
  const buckets = new Map(); // ip -> { tokens, at }
  const global = { tokens: GLOBAL_PER_MINUTE, at: now() };

  function refill(b, cap, t) {
    b.tokens = Math.min(cap, b.tokens + ((t - b.at) * cap) / 60000);
    b.at = t;
  }

  function allow(ip) {
    const t = now();
    if (buckets.size > 5000) {
      // Evict only stale buckets (idle for a full minute, i.e. completely refilled).
      for (const [k, v] of buckets) if (t - v.at >= 60000) buckets.delete(k);
    }
    refill(global, GLOBAL_PER_MINUTE, t);
    let b = buckets.get(ip);
    if (!b) {
      b = { tokens: RATE_PER_MINUTE, at: t };
      buckets.set(ip, b);
    }
    refill(b, RATE_PER_MINUTE, t);
    if (global.tokens < 1 || b.tokens < 1) return false;
    global.tokens -= 1;
    b.tokens -= 1;
    return true;
  }

  return async (req, res) => {
    try {
      // X-Real-IP is only trusted behind nginx (trustProxy); otherwise it is client-controlled.
      const real = trustProxy ? req.headers['x-real-ip'] : undefined;
      const ip = String(real ?? req.socket.remoteAddress ?? 'unknown');
      if (!allow(ip)) return send(res, 429, { error: 'rate' });
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { enabled: Boolean(apiKey) });
      if (req.method !== 'POST' || path !== '/api/decide') return send(res, 404, { error: 'not found' });

      let text;
      try {
        text = await readBody(req);
      } catch {
        return send(res, 400, { error: 'bad request' });
      }
      if (text === null) {
        res.setHeader('connection', 'close');
        send(res, 413, { error: 'too large' });
        req.resume();
        return;
      }
      let payload = null;
      try {
        payload = sanitise(JSON.parse(text));
      } catch {
        payload = null;
      }
      if (payload === null) return send(res, 400, { error: 'bad request' });
      if (!apiKey) return send(res, 503, { error: 'disabled' });

      try {
        const up = await fetchImpl(upstream, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ state: payload.state, model: MODEL, questions: payload.questions }),
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
  // Local run: export TYPESAFE_API_KEY=... first (the container gets it via compose env_file).
  const port = Number(process.env.PORT ?? 8787);
  const apiKey = process.env.TYPESAFE_API_KEY || undefined;
  const host = process.env.HOST || '127.0.0.1';
  const trustProxy = Boolean(process.env.HOST); // HOST is set only in the container, behind nginx
  http.createServer(createProxy({ apiKey, trustProxy })).listen(port, host, () => {
    console.log(`ai-proxy listening on ${host}:${port} (${apiKey ? 'enabled' : 'disabled: no key'})`);
  });
}
