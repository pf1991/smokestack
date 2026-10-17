# SMOKESTACK II: JEV Decision Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let TypeSafe's JEV decision model make some of the game's choices, starting with which spring event card fits the moment. The game stays deterministic, playable offline and safe with the API key.

**Architecture:**
- **Proxy.** A small dependency-free Node proxy (`server/ai-proxy.mjs`) runs next to nginx in `docker compose`. It holds `TYPESAFE_API_KEY`, validates and caps requests, and forwards them to `POST https://api.typesafe.ai/v1/systemone`. The browser only ever calls `/api/decide`.
- **Decision mailbox.** The sim never awaits the network. It posts a decision request into an optional `state.ai` mailbox one month ahead. The game layer (`src/ai/client.ts`) answers requests in the background and writes JEV's probabilities back into the mailbox. That is game-layer input, like a player click.
- **Choosing.** When the decision is due, the sim blends JEV's probabilities with the authored weights and picks with the state rng. With no answer (offline, disabled, headless, slow) it falls back to the authored weights alone.
- **Saves.** Saves keep the answers, so a load replays identically.
- **First consumer:** the spring card dealer.
- **Later consumers:** the Baron's retaliation choice (`src/sim/nemesis/retaliation.ts` on `v2/phase4`) is wired in a follow-up task once Phase 4 merges.

**Tech Stack:** TypeScript 5.6 strict, Vitest, Node 22 (proxy only; built-in `fetch` and `http`, no npm dependencies), nginx, docker compose.

**Spec:** JEV docs at https://docs.typesafe.ai (quickstart: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, body `{ state, model: "jev-latest", questions: { <id>: { type: "choice", instructions, criteria: { <option>: <description> } } } }`, response `{ model, answers: { <id>: { type, choice, confidence, probabilities: { <option>: p } } }, usage }`). There are owner decisions from 2026-10-17:
- the owner has JEV API access;
- JEV makes decisions and authored content keeps the words;
- the cards come first, and the Baron follows after Phase 4.

## Global Constraints

- **Browser bundle.** No runtime dependencies in the browser bundle. The proxy has no npm dependencies.
- **The API key:**
  - It never reaches the browser, a commit or a log.
  - It is read from `TYPESAFE_API_KEY` in a git-ignored `.env` at the repo root, through the compose `env_file`.
  - `.env` is added to `.gitignore`, and an `.env.example` with an empty `TYPESAFE_API_KEY=` is committed.
  - The proxy never echoes the key in errors.
- **Determinism:**
  - `src/sim` stays deterministic and synchronous, and never imports `src/ai`.
  - JEV answers enter the sim only through the mailbox, written by the game layer between ticks.
  - Every draw uses the state rng.
  - Headless runs (tests, soak) never call the network.
- **Saves.** `state.ai` is optional and created lazily. `SAVE_VERSION` is not bumped: Phase 4 owns version 7. Old saves have no `state.ai`.
- **Offline-first:**
  - The game must play identically with the proxy down, the key missing or the setting off.
  - Each request has a 3 s timeout and no retries.
  - At most 1 request is in flight per decision, and at most 30 requests a minute from one client.
- **Cost guards.** The proxy rejects:
  - a `state` over 12 KB of JSON;
  - more than 4 questions;
  - more than 64 options per choice;
  - any model other than `jev-latest`;
  - more than 120 requests a minute per IP (HTTP 429).
- No emoji in `src`. Use `docker compose`. Run `chown -R freire:freire /home/freire/projects/industry` after merges. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A late, failed or garbage answer never breaks the game.** All of these must fall back to the authored weights without throwing:
   - probabilities that are missing, NaN, negative or unnormalised;
   - an unknown option key;
   - an HTTP error;
   - a timeout;
   - an answer that arrives after the decision was made.

   Pinned in Task 2 and Task 3.
2. **The key cannot leak:**
   - no `TYPESAFE_API_KEY` string in `dist/`;
   - proxy errors are generic;
   - `.env` is git-ignored.

   Pinned in Task 1 and Task 5.
3. **Saves replay identically.** A game saved after an answer arrived reloads and draws the same card. Pinned in Task 2.
4. **JEV doesn't flatten variety.** With the blend, no single eligible card exceeds 60% pick probability when JEV is certain, and cooldowns and conditions still apply. Pinned in Task 3.
5. **The proxy can't be abused as an open relay.** It accepts only `POST /api/decide` with the validated shape, only `jev-latest`, and caps sizes and rates. Pinned in Task 1.

---

### Task 1: AI proxy service

**Files:**
- Create:
  - `server/ai-proxy.mjs`;
  - `server/ai-proxy.test.ts` (Vitest, Node environment: `// @vitest-environment node`);
  - `.env.example`.
- Modify:
  - `docker-compose.yml`: a service `ai-proxy`, `image: node:22-alpine`, `working_dir: /srv`, a read-only volume `./server:/srv`, `command: node ai-proxy.mjs`, `env_file: [{ path: .env, required: false }]`, `restart: unless-stopped`. Expose it only on the compose network (no host port).
  - `nginx.conf`: `location /api/ { proxy_pass http://ai-proxy:8787; proxy_read_timeout 5s; }`.
  - `vite.config.ts`: a dev `server.proxy` sending `/api` to `http://localhost:8787`.
  - `.gitignore`: add `.env`.
  - `package.json`: add `"ai-proxy": "node server/ai-proxy.mjs"`.

**Interfaces:**
- `export function createProxy(opts: { apiKey: string | undefined; upstream?: string; fetchImpl?: typeof fetch; now?: () => number }): http.RequestListener`. The default upstream is `https://api.typesafe.ai/v1/systemone`. When run as main, it listens on `PORT ?? 8787`.
- `GET /api/health` returns `{ enabled: boolean }`, which is true when a key is set. It never returns the key.
- `POST /api/decide` takes body `{ state: unknown; questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> }`. The proxy:
  - validates the guards in Global Constraints and returns 400 on a violation;
  - returns 503 when there is no key;
  - injects `model: "jev-latest"`;
  - forwards with `Authorization: Bearer <key>` and a 3 s `AbortSignal.timeout`;
  - on success returns `{ answers }` (the upstream's `answers` only);
  - on any upstream failure returns `502 { error: "upstream" }`, with no upstream body.
- **Rate limit:** an in-memory token bucket per IP, 120 per minute, returning 429.

- [ ] **Step 1: Write the failing tests** in `server/ai-proxy.test.ts`, using a fake `fetchImpl` and a real `http.createServer` on port 0:
  - `/api/health` reports enabled or disabled.
  - A valid request forwards the injected model and the auth header, and returns `answers` only.
  - Every guard returns 400: an oversized state, 5 questions, 65 options, a non-choice type, a model field set by the client.
  - No key returns 503.
  - An upstream 500, a timeout or invalid JSON returns 502 with a body that doesn't contain the key.
  - The 121st request in a minute returns 429.
  - Unknown paths and methods return 404.
- [ ] **Step 2:** Run `npx vitest run server/ai-proxy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `server/**/*.test.ts` to the Vitest `include` in `vite.config.ts`.
- [ ] **Step 4:** Run `npm test`. Then run `docker compose config` and check that the service and env_file resolve with no `.env` present.
- [ ] **Step 5: Commit** with `feat(ai): decision proxy for TypeSafe JEV`.

### Task 2: Decision mailbox in the sim

**Files:**
- Create: `src/sim/ai/mailbox.ts`, `src/sim/ai/mailbox.test.ts`
- Modify: `src/sim/types.ts` (`GameState.ai?: AiMailbox`), `src/sim/invariants.ts`

**Interfaces:**
```ts
export interface AiOption { key: string; label: string }          // key: [a-z0-9_]{1,40}
export interface AiRequest {
  id: string;            // e.g. "card:1923"; unique per decision
  question: string;      // instructions text
  options: AiOption[];   // 2..64
  context: Record<string, unknown>; // compact state summary, JSON-serialisable, ≤ 12 KB
  dueDay: number;        // dateToDays when the sim will decide
}
export interface AiAnswer { probabilities: Record<string, number> }
export interface AiMailbox { pending: AiRequest[]; answers: Record<string, AiAnswer> }
```
- `postDecision(state, req)` creates `state.ai` lazily. It is idempotent per id. It drops requests whose `dueDay` has passed. Pending is capped at 8, dropping the oldest first.
- `answerDecision(state, id, answer): boolean` is the game layer's only write. It accepts an answer only for a pending id and removes that id from `pending`.
- `takeDecision(state, id, options: { key: string; weight: number }[], blend = 0.5): string | null`:
  - It sanitises the answer: unknown keys are dropped, and NaN or negative values become 0, then the rest is renormalised.
  - When a valid answer exists, it computes `w_i = (1 − blend) × weight_i / Σweight + blend × p_i` and picks with one `random(state)` draw.
  - Otherwise it picks with the authored weights alone, also with one draw, so the rng draw count is the same either way.
  - It deletes the request and the answer, and keeps the last 20 answered ids in `state.ai.log` (`{ id, picked, usedAi }[]`) for the UI.
  - It returns null for empty options.
- Invariants: `pending.length` is at most 8, the answers' probabilities are finite, and every answer has a pending or a just-due id.

- [ ] **Step 1: Write the failing tests:**
  - Post, answer, take uses the blend.
  - No answer uses the weights only.
  - The draw count is identical with and without an answer: compare `rngState` after.
  - Each garbage answer falls back or sanitises, never throws: NaN, a negative value, an unknown key, all zeros.
  - An answer to an unknown or late id is refused.
  - Save and load: `serialize` then load then take gives the same pick as no save.
  - With blend 0.5 and one-hot AI over 4 equal-weight options, the top probability is 0.625. The cap for Review Focus 4 is enforced in Task 3.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5: Commit** with `feat(ai): deterministic decision mailbox`.

### Task 3: The spring card dealer asks JEV

**Files:**
- Modify:
  - `src/sim/politics/cards.ts`:
    - On 1 March (the month before `SPRING_MONTH`), when cards are due next spring, post a request `card:<year>` with up to 32 eligible spring cards (in table order, ignoring randomness);
    - on 1 April, `drawSpringCard` picks through `takeDecision` with the cards' authored weights.
  - `src/sim/ai/context.ts` (create): `cardContext(state): Record<string, unknown>`. It holds:
    - the year;
    - the player's real money band (`'struggling' | 'steady' | 'rich'`);
    - for each town: name, smog tier, workers, oldmoney and reformers opinion, and mayor faction;
    - active strikes;
    - laws passed;
    - the last 6 news headlines.

    It stays at or under 12 KB, which a test pins.
- Test: `src/sim/politics/cards.test.ts`, `src/sim/ai/context.test.ts`

**Interfaces:**
- Request `question`: "Pick the event card that would make the most interesting, fitting story for this company right now. Prefer cards that react to what is happening in the towns."
- Option `label`: the card title plus the first 120 characters of its body, with `{city}` left as is.
- Option keys are card ids. The condition-filtered eligibility at draw time is the source of truth: options that became ineligible are dropped before `takeDecision`.
- **Review Focus 4 cap:** after blending, no option's weight exceeds 0.6 of the total. Clamp it and redistribute the excess proportionally to the rest.

- [ ] **Step 1: Write the failing tests:**
  - The March request is posted with the eligible card ids.
  - An April draw with no answer equals the old weighted draw on a fixed seed: a snapshot of the picked id for seeds 1–20 against the pre-change code. Record it first.
  - A one-hot answer for card X raises X's pick rate to between 0.55 and 0.6 over 2,000 seeded draws.
  - An answer for a card that became ineligible is ignored.
  - The context is at or under 12 KB on a 1990 fixture.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the soak (`npm run soak -- --seeds 7,42,1234 --years 101`). The soak has no client, so its results must equal main's card counts.
- [ ] **Step 5: Commit** with `feat(ai): spring card dealer consults JEV`.

### Task 4: Game-layer client and setting

**Files:**
- Create: `src/ai/client.ts`, `src/ai/client.test.ts`
- Modify:
  - `src/game/controller.ts`: start the client with the game and stop it on teardown;
  - `src/game/settings.ts`: `smartEvents: boolean`, default true;
  - `src/ui/menu.ts`: a settings row "Smart events (JEV)" with a status line: "connected", "not configured" (health enabled false) or "offline".

**Interfaces:**
- `startAiClient(game: { state: GameState }, opts: { fetchImpl?: typeof fetch; enabled: () => boolean }): () => void`. It works like this:
  - On start, it calls `GET /api/health` once. When that fails, the client stays idle until the next start.
  - Every 2 s of real time, while the game is not paused (and also while paused, which is fine), for each pending request not already in flight, it posts `{ state: req.context, questions: { pick: { type: 'choice', instructions: req.question, criteria: Object.fromEntries(options.map(o => [o.key, o.label])) } } }`.
  - On success it calls `answerDecision(state, req.id, { probabilities: answers.pick.probabilities })`.
  - It keeps a per-client limit of 30 a minute. Failures are swallowed and logged once to `console.info` with no details.
- The client writes only through `answerDecision`.
- A tiny "Why this card?" line in the card modal, when the last take used AI, reading "Chosen by the editor's instinct (JEV)". It reads `state.ai.log`.

- [ ] **Step 1: Write the failing tests** with a fake `fetch`:
  - A pending request is answered.
  - A failed health check means no posts.
  - The setting off means no posts.
  - Two ticks while one request is in flight still give one post.
  - The rate limit holds.
  - A malformed response gives no answer.
  - Teardown stops the timers.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5: Commit** with `feat(ai): background JEV client and setting`.

### Task 5: Live check and gate

**Files:**
- Create: `scripts/jev-smoke.mjs`. It reads `TYPESAFE_API_KEY` from the environment only, calls the real API once with a card context from a 1925 fixture, and prints the chosen card, the probabilities, the latency and the token usage. It never prints the key.
- Modify: `README.md`, adding a "Smart events (JEV)" section: put your key in `.env`, run `docker compose up -d --build`, and how to turn the setting off.

- [ ] **Step 1:** Run `npm test && npm run build`, then `grep -r TYPESAFE_API_KEY dist/`. Expected: no match.
- [ ] **Step 2:** Run `docker compose build`. Then, when `.env` has a key, run `docker compose up -d`, check that `curl localhost:8080/api/health` returns `{"enabled":true}`, and run `node --env-file=.env scripts/jev-smoke.mjs`. Report the latency and the token usage. Without a key, report that and skip.
- [ ] **Step 3: Commit** with `test: jev decision layer gate`.

### Follow-up (after Phase 4 merges): the Baron's brain
This is a separate task on top of merged `main`:
- `retaliateMonth` posts `baron:<year>-<month>` a month ahead, listing the eligible retaliation kinds with target towns;
- `retaliate` picks through `takeDecision` with the trait weights.

It gets its own plan when it is scheduled.
