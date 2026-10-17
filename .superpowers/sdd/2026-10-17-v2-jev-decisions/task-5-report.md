# Task 5 report
- Added scripts/jev-smoke.ts (env-only key, skips with exit 0, 3 s timeout, prints card/probs/latency/usage, never key/headers) and npm script jev-smoke. No-key path verified: prints "no TYPESAFE_API_KEY set — skipping", exit 0.
- README: "Smart events (JEV)" section.
- Gate: npm test 99 files / 1197 tests pass; npm run build OK; grep -r TYPESAFE_API_KEY dist/ no match; docker compose build OK (not run up).
- Live run NOT done (no key, per controller ruling); latency/usage unreported. Live path untested; scripts/ is outside tsconfig typecheck (no @types/node).
