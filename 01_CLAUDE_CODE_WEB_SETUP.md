# Setup for Claude Code on the web

Claude Code on the web works from a GitHub repository, not from chat uploads. It clones your repo into a cloud VM, works there, and pushes a branch. Five minutes of setup, and then it's actually the better tool for this job — the repo is what makes the work survive a usage limit.

---

## One-time setup

**1. Make a free GitHub account** if you don't have one, at github.com. Free tier is all you need.

**2. Create a new repository.** Name it `inkfall`. Private is fine. Tick "Add a README file" so the repo isn't empty — an empty repo can't be cloned.

**3. Upload the spec files.** On the repo page: **Add file → Upload files**, drag in all seven files (`CLAUDE.md`, `GAME_DESIGN.md`, `TECH_SPEC.md`, `TASKS.md`, `PROGRESS.md`, `DECISIONS.md`, and `00_KICKOFF_PROMPT.md`), then **Commit changes**. They go in the repo root — no subfolder.

**4. Connect GitHub to Claude Code.** Go to claude.ai/code, follow the prompt to connect GitHub, and grant access to the `inkfall` repo (you can grant "only select repositories").

**5. Set up the environment.** When creating the environment for this repo, you'll be asked about network access. **Choose the option that allows network access** — trusted domains including the npm registry, or all domains. Claude Code needs to run `npm install` to get Vite and TypeScript. Without network, the build cannot start at all.

---

## Running it

**6. Select the repo** in the repository selector below the input box.

**7. Check the mode dropdown says "Accept edits", not "Plan".** Accept edits lets it work without stopping for approval — which is the whole point here. Plan mode will stop and ask you things.

**8. Pick the strongest model available on your plan** in the model selector.

**9. Paste the kickoff prompt** from `00_KICKOFF_PROMPT.md` and send it.

---

## Hands-off deploys — the important bit

You should never have to merge anything or watch for events. The setup that achieves this:

Claude Code's cloud sandbox will not let it push to your default branch (`main`). That's a platform guardrail, not something a prompt can talk it out of. So instead of making Claude push to `main`, **we point Vercel at the branch Claude is allowed to push to.**

`CLAUDE.md` now pins Claude to one fixed branch, `claude/build`, forever — not a new branch per session — and tells it to push after every completed task.

**In Vercel: Project → Settings → Git → Production Branch. Change `main` to `claude/build` and save.**

That's the whole trick. From then on, every task Claude finishes pushes to `claude/build`, Vercel builds it automatically, and your live URL updates. No pull requests, no merges, no GitHub tab, no watching for anything. Open the URL on your phone whenever you're curious.

Your `main` branch just sits there holding the spec files. That's fine and you can ignore it. If you ever want to tidy up, merge `claude/build` into `main` once at the very end — but nothing depends on it.

## When you hit a usage limit

Go back to claude.ai/code, select the repo, and send:

```
continue
```

One word. Because Claude always uses the same branch and `PROGRESS.md` lives in the repo, it picks up exactly where it stopped. If the branch selector offers you `claude/build`, choose it — if it only shows `main`, don't worry, `CLAUDE.md` tells Claude to fetch and check out `claude/build` before doing anything else.

## Two amendments for the cloud environment

Both are already reflected in the specs, but so you know what to expect:

**The Android APK probably won't build in the cloud VM.** The Android SDK and Gradle almost certainly aren't installed there. `TECH_SPEC.md` §11 already handles this: Claude Code will generate and commit the complete `/android` Capacitor project and the build instructions, and note in `PROGRESS.md` that the APK build is unverified. To actually produce the APK you'd install Android Studio locally, clone the repo, and run the two documented commands. The PWA is unaffected — it builds and runs fine, and installing the PWA to your Android home screen gives you something that behaves like an app in the meantime.

**Fonts need network access, or a fallback.** The spec vendors two open-licence fonts. With network access enabled this is fine. If the environment blocks it, `CLAUDE.md` now instructs a documented fallback to a system font stack rather than stalling.

---

## What you'll see as it works

It'll push a branch and open a pull request. You can read the diff, or ignore it entirely and just check back later. The `PROGRESS.md` file in the repo is the human-readable log — that's the one to skim if you want to know how far it's got without reading code.

To try the game before the PWA is deployed anywhere: merge to `main`, then either enable GitHub Pages on the repo (Settings → Pages, free) and point it at the built output, or clone locally and run `npm run dev`. Claude Code will document both in `README.md`.
