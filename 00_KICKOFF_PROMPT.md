# Kickoff — paste this into Claude Code

**Before you paste:** put the four spec files (`CLAUDE.md`, `GAME_DESIGN.md`, `TECH_SPEC.md`, `TASKS.md`) plus the two empty logs (`PROGRESS.md`, `DECISIONS.md`) into an empty folder, `cd` into it, run `claude`, then run `/model opus` to select the strongest model available on your plan.

---

## Paste this:

Ultrathink. You are building a complete, shippable game solo and autonomously.

Read `CLAUDE.md`, `GAME_DESIGN.md`, `TECH_SPEC.md`, and `TASKS.md` in full before writing any code. `CLAUDE.md` governs how you work; the other three are the brief. They are complete by design — every open question has already been answered in them.

**Do not ask me any questions.** Not about design, not about scope, not about which library, not about tradeoffs, not for confirmation before a big step. If something is genuinely undefined, choose the option that best serves the design goals in `GAME_DESIGN.md`, record the choice as a one-line entry in `DECISIONS.md`, and keep building. Treat "I'll wait for the user" as a bug in your process.

Work through `TASKS.md` in order. After each task: run `npm run verify`, tick the checkbox, append a line to `PROGRESS.md`, commit, and **push to `claude/build`** — my Vercel deployment watches that branch, so every push puts the current build on my phone. Follow the Git workflow section in `CLAUDE.md` exactly: one branch, always the same one, pushed after every task, no pull requests, no asking me to merge anything. Then start the next task immediately in the same response — do not stop to report, do not summarise progress back to me, do not end your turn to check in. Keep going until you hit the end of Phase 5 or you run out of usage.

If you run out of usage mid-task, that's fine — `PROGRESS.md` is how you pick the thread back up. When I return I will say "continue" and nothing else, and you will re-read `CLAUDE.md`, `PROGRESS.md` and `TASKS.md`, work out where you were, and resume without asking me anything.

Think hard on the design-heavy tasks — the projection maths, the balance sweeps, the boss patterns, and the feel-tuning pass. This should end up genuinely good to play, not merely complete.

Start with Task 1.1 now.

---

## On subsequent sessions

Just type:

```
continue
```

That's the whole message. `CLAUDE.md` contains the resume protocol.

## If it stops and asks you something anyway

```
Decide it yourself, log it in DECISIONS.md, and continue. Do not ask me again.
```

## When Phase 5 is done and you want the roguelite layer

```
Ultrathink. Phase 6 in TASKS.md is now live. Same rules — autonomous, no questions, log decisions, commit per task. Begin.
```
