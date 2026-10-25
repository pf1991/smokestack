# SMOKESTACK UI Appeal (U1–U5)

Status: **U1–U2 shipped; Market glance (U3 slice) shipped** (2026-10-25). Follow-on to E5.

## Intent

Panels invite decisions; the map stays the stage. Default views fit without
whole-panel scroll. Color hierarchy (paper content / walnut chrome / brass CTAs)
makes the Brass & Ledger fantasy readable.

## Slices

| Id | Scope |
|---|---|
| **U1** | No-scroll shell: `.window-body` does not scroll; Now sticky; at most one inner scroller (`.disc-full`, `.p-scroll`, `.cx-list`, …) |
| **U2** | Color hierarchy: deeper chrome, brighter brass CTAs, paper-backed tables |
| **U3** | Market & Finance glance modes (filters / tabs) — Market filter chips ship with U1 |
| **U4** | Building inspector compact (later) |
| **U5** | Motion + empty-state polish (panel enter ease with U2; coaches later) |

## Constraints

- Tokens only (`cssGate`); no emoji; no new web fonts.
- Do not break E5 disclosure API or side-panel tab behaviour.
- Full `npm test` + `tsc` before every commit.
