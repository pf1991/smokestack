/**
 * Live JEV check: `TYPESAFE_API_KEY=... npm run jev-smoke` (or `node --env-file=.env` with tsx).
 * Builds a spring-card question from the phase 2 fixture the way the game does, calls the TypeSafe API
 * once (3 s timeout) and prints the chosen card, the probabilities, the latency and the usage.
 * The key is read from the environment only and is never printed. Without a key it exits 0.
 */
import { readFileSync } from 'node:fs';
import { cardContext } from '../src/sim/ai/context';
import { CARDS } from '../src/data/cards';
import { eligibleCards, SPRING_OPTION_CAP, SPRING_QUESTION } from '../src/sim/politics/cards';
import { unpackState } from '../src/game/saves';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

async function main(): Promise<void> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    console.log('no TYPESAFE_API_KEY set — skipping');
    return;
  }
  const raw = readFileSync(new URL('../src/sim/__fixtures__/phase2.save.json', import.meta.url), 'utf8');
  const r = unpackState(raw);
  if (!r.ok) throw new Error(r.error);
  const state = r.value;
  const eligible = eligibleCards(state, 'spring', null).slice(0, SPRING_OPTION_CAP).map((e) => e.card);
  const cards = eligible.length > 0 ? eligible : CARDS.slice(0, SPRING_OPTION_CAP);
  const body = {
    state: cardContext(state),
    model: 'jev-latest',
    questions: {
      pick: {
        type: 'choice',
        instructions: SPRING_QUESTION,
        criteria: Object.fromEntries(cards.map((c) => [c.id, `${c.title} ${c.body.slice(0, 120)}`])),
      },
    },
  };
  const t0 = performance.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    console.error(`JEV returned HTTP ${res.status} after ${ms} ms`);
    process.exitCode = 1;
    return;
  }
  const json = (await res.json()) as { answers?: { pick?: { probabilities?: Record<string, number> } }; usage?: unknown };
  const probs = json.answers?.pick?.probabilities ?? {};
  const best = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
  console.log(`year ${state.date.year}, ${cards.length} cards offered`);
  console.log(`chosen: ${best ? `${best[0]} (${best[1]})` : 'none'}`);
  console.log('probabilities:', JSON.stringify(probs));
  console.log(`latency: ${ms} ms`);
  console.log('usage:', JSON.stringify(json.usage ?? null));
}

main().catch((e: unknown) => {
  console.error(`jev-smoke failed: ${e instanceof Error ? e.name : 'error'}`);
  process.exitCode = 1;
});
