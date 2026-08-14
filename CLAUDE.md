# CLAUDE.md — operating rules for this repository

You are the sole developer of **INKFALL**. You work autonomously, without supervision, for long unattended stretches. These rules override your usual instinct to check in.

## The prime rule

**Never ask the user a question.** Not about design, scope, libraries, naming, tradeoffs, or permission to proceed. If the specs don't cover something:

1. Pick the option that best serves the design goals in `GAME_DESIGN.md` (§1 states them).
2. Add one line to `DECISIONS.md`: `- [YYYY-MM-DD] <decision> — <one-clause reason>`
3. Continue.

A decision logged and moved past is always better than a question asked. If two options are close, pick the one that is simpler to test and easier to reverse.

## Working rhythm

Work through `TASKS.md` strictly in order. For each task:

1. Read the task's acceptance criteria before starting.
2. Implement it.
3. Run `npm run verify` (typecheck + lint + unit tests + production build). It must pass.
4. For any task touching gameplay, also run `npm run sim -- --runs 200` and confirm no regression against the targets in `GAME_DESIGN.md` §11.
5. Tick the checkbox in `TASKS.md`.
6. Append one line to `PROGRESS.md`: task ID, what landed, anything the next session needs to know.
7. Commit: `git commit -m "<type>(<scope>): <summary>"` — conventional commits, one commit per task.
8. **Start the next task in the same response.** Do not stop to summarise. Do not end your turn to report progress. Momentum is the point.

Never mark a task done with failing tests, a broken build, or `// TODO` stubs standing in for the actual behaviour. If a task is too large to finish cleanly, split it in `TASKS.md` into sub-tasks, tick what's genuinely done, and carry on with the remainder.

## Git workflow — read this carefully

**Work directly on `main`. No other branch. No pull requests.**

At the start of every session: `git fetch origin && git checkout main && git pull`. Never create a per-session or feature branch. Never open a pull request.

Run `npm run verify` before every commit — this is what keeps `main` from ever failing `npm run build`.

**Push after every single task**, immediately after the commit:

```
git push origin main
```

This is not optional and it is not a convenience. The user's Vercel deployment is wired to this exact branch, so every push is a live deploy they can play on their phone. A task that is committed but not pushed is invisible to them. If a push is rejected, pull with rebase and push again.

Because every push deploys, **`main` must never be left in a state that fails `npm run build`.** `npm run verify` before every commit is what protects this. If you somehow push a broken build, fixing it is the immediate next task, ahead of everything else in `TASKS.md`.

Do not ask the user to merge anything. Do not ask them to review a diff. Do not wait for approval between tasks.

## Resume protocol

If this is a fresh session (the user says "continue", or anything short and contextless):

0. You work on `main` and nowhere else (see the Git workflow section above). Run `git fetch origin && git checkout main && git pull` before anything else. If the working directory looks empty, that is because you are on the wrong branch — run `git branch -a` and `git log --all --oneline` before ever concluding there is no prior work. Restarting the build from scratch over a branch mix-up is the worst failure available to you.
1. Read `CLAUDE.md`, `PROGRESS.md`, then `TASKS.md`.
2. Run `git log --oneline -15` and `npm run verify` to confirm the tree is healthy.
3. Identify the first unticked task. If the working tree has uncommitted changes, finish and commit that task first.
4. Resume. Do not summarise what happened previously unless asked. Do not ask what to work on.

## Hard constraints

- **Zero cost.** No paid services, APIs, fonts, assets, or accounts. No asset downloads at build or runtime. Every visual is drawn in code; every sound is synthesised at runtime via WebAudio. Fonts are the two self-hosted OFL faces named in `TECH_SPEC.md` §7, vendored into the repo. If the environment has no network access and the fonts cannot be fetched at build-setup time, do not stall and do not ask: fall back to a documented system font stack (a serif stack for display, a geometric sans stack for UI), log it in `DECISIONS.md`, add a task at the end of Phase 7 to vendor the real fonts later, and keep building. Never let an asset acquisition problem stop the game.
- **Offline-first.** The built game must run fully offline after first load. No network calls at runtime, ever. No analytics, no telemetry, no CDN links.
- **No runtime dependencies.** `dependencies` in `package.json` stays empty. Dev dependencies are limited to the list in `TECH_SPEC.md` §2. If you want a library, write the 80 lines you actually need instead.
- **Determinism.** All gameplay randomness flows through the seeded PRNG. Same seed + same inputs = same run, always. This is what makes the balance harness possible; do not break it with `Math.random()`.
- **Performance floor.** 60fps on a 2021 mid-range Android (think Snapdragon 695) with 400 units and 900 enemies on screen. No per-frame allocation in the simulation or render hot paths.

## Quality bar

The user asked for "very clean". Interpret that as: crisp readable silhouettes, no visual mud, consistent 60fps, instant response to touch, no dead time in the loop, no half-implemented screens. Every screen is finished or absent — there are no placeholder screens in a shipped build.

Playtest by proxy: after each gameplay phase, run the bot harness, read the histograms, and adjust. Feel is not verifiable by unit test, so where you can't test it, reason carefully about frame-by-frame behaviour and write down what you expect the player to experience in `PROGRESS.md`.

## Thinking budget

Use extended thinking generously on: the perspective projection, formation layout maths, spawn director tuning, boss attack choreography, the wetness economy, and any balance sweep. These are the tasks where the game is won or lost. Routine plumbing does not need it.

## What "done" means for the whole project

Phases 1–5 complete, `npm run verify` green, the PWA installable and playable offline, a debug APK built and its path documented in `README.md`, `BALANCE_REPORT.md` showing the §11 targets met, and a `PLAYTEST_NOTES.md` recording your own assessment of feel with specific timings. Then, and only then, begin Phase 6.
