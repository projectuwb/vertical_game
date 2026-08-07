# PROGRESS

Append one line per completed task. Newest at the bottom. This file is how a fresh
session recovers context after a usage limit — write it for a reader with no memory
of what you just did.

Format:
`- [YYYY-MM-DD] <task id> — <what landed> — <anything the next session must know>`

## Current state

- Phase: 1
- Next task: 1.4
- Blockers: none

## Log

- [2026-08-07] 1.1 — Scaffolded Vite+TS strict project: tsconfig (app + a NodeNext `tsconfig.cli.json` for the headless `sim`/`perf` CLIs), ESLint flat config with a `Math.random` ban outside `/render`, Prettier, Vitest (node env, no jsdom dep), full `/src` folder skeleton per `TECH_SPEC.md` §3 with placeholder modules, `vercel.json` headers, minimal `manifest.webmanifest`, `README.md`. `npm run verify` green. — Next session: real per-file implementations start with 1.2 (fixed-timestep loop); CLI scripts import only `/core`, `/sim`, `/meta`, `/balance` and must use explicit `.js` extensions in relative imports for NodeNext resolution to work under `npm run sim`/`npm run perf`.
- [2026-08-07] 1.2 — `FixedStepLoop` in `src/core/loop.ts`: pure `advance(nowMs)` accumulator (no internal clock reads, so tests can feed fabricated timestamps), 60Hz fixed step, max 5 catch-up steps with remainder folded away on overrun, render alpha interpolation, pause/resume (resume re-primes `lastNowMs` so it doesn't burst-catch-up), `reset()`. `runInBrowser()` wraps it in `requestAnimationFrame`; `attachVisibilityAutoPause()` pauses on tab hidden; `mountDebugOverlay()` is a DOM-only fps/steps overlay gated behind `?debug=1` in `main.ts`. Determinism test drives 10,000 then 20,000 frames of exact fixed-dt length and asserts step count doesn't drift more than 1 step and the second identical-length segment matches the first — bit-exact equality against `N` isn't achievable with IEEE-754 timestamps at 1/60s, so the test asserts the property that actually matters (error doesn't compound). — Next session: `main.ts`'s `update`/`render` callbacks are still no-ops; they get wired to `/sim` and `/render` starting Task 2.1.
- [2026-08-07] 1.3 — `RngRegistry` in `src/core/rng.ts`: mulberry32 generator, one independent stream per concern (director/gates/slips/seals/cosmetic) each derived from the Passage seed via FNV-1a salting, plus `hashState()` (cyrb53 over a key-sorted canonical JSON stringify) for the determinism test. `Math.random` ESLint ban from 1.1 verified to actually fire outside `/render` (manually checked with a throwaway violating file). Determinism test drives a synthetic 5000-step RNG tape (standing in for the real World, which doesn't exist until Phase 2) and asserts byte-identical `hashState` at steps 100/1000/5000 for a replayed seed; a companion test confirms a cosmetic draw never perturbs another concern's sequence. — Next session: once `/sim/world.ts` lands (Task 2.x), point `hashState` at the real World snapshot for the full TECH_SPEC.md §12 determinism test instead of the synthetic tape.

