# Inkfall

An on-rails ink-painting shooter. See `GAME_DESIGN.md` for design, `TECH_SPEC.md` for architecture.

## Run

```
npm install
npm run dev
```

## Build

```
npm run build
```

Output is written to `dist/`, deployable to any static host (Vercel zero-config Vite detection applies).

## Verify

```
npm run verify
```

Runs typecheck, lint, unit tests, and a production build — the gate for every task in `TASKS.md`.

## Balance harness

```
npm run sim -- --runs 2000 --strategy mixed --upgrades 0 --seed 12345
```

Writes `BALANCE_REPORT.md`. See `TECH_SPEC.md` §6.

## Performance

```
npm run perf
```

Writes `PERF.md`. See `TECH_SPEC.md` §8.

## Android

Documented once Task 5.4 lands.
