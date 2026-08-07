# PROGRESS

Append one line per completed task. Newest at the bottom. This file is how a fresh
session recovers context after a usage limit — write it for a reader with no memory
of what you just did.

Format:
`- [YYYY-MM-DD] <task id> — <what landed> — <anything the next session must know>`

## Current state

- Phase: 1
- Next task: 1.2
- Blockers: none

## Log

- [2026-08-07] 1.1 — Scaffolded Vite+TS strict project: tsconfig (app + a NodeNext `tsconfig.cli.json` for the headless `sim`/`perf` CLIs), ESLint flat config with a `Math.random` ban outside `/render`, Prettier, Vitest (node env, no jsdom dep), full `/src` folder skeleton per `TECH_SPEC.md` §3 with placeholder modules, `vercel.json` headers, minimal `manifest.webmanifest`, `README.md`. `npm run verify` green. — Next session: real per-file implementations start with 1.2 (fixed-timestep loop); CLI scripts import only `/core`, `/sim`, `/meta`, `/balance` and must use explicit `.js` extensions in relative imports for NodeNext resolution to work under `npm run sim`/`npm run perf`.

