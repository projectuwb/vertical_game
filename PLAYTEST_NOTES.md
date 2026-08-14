# PLAYTEST_NOTES

My own assessment of how INKFALL actually feels to play, written after Phase 5 (Tasks
5.1-5.4) landed. Per CLAUDE.md: "feel is not verifiable by unit test," so this is a
first-person account grounded in two real sources, not invented — a genuine headless-
Chromium playthrough with real keyboard input (not the `?debug=1` shortcuts, not the
harness bots), and `BALANCE_REPORT.md`'s 2000-run statistics, which represent thousands
of real simulated Passages under the exact same rules a human plays under. Where I
report a number, it came from one of those two places.

## Method

Played through `vite preview`'s served production build in a real (headless) Chromium
tab at a 390×844 viewport (a typical phone screen), driving `ArrowLeft`/`ArrowRight`/
`Space` exactly as a human's keyboard would, no debug hooks. Screenshotted at intervals,
read the death summary screen's real numbers off the DOM afterward. This is one
concrete data point, not a statistical sample — `BALANCE_REPORT.md`'s bot-driven
2000-run batches are what the balance *claims* are actually checked against; this
section is about how a single real attempt *feels* moment to moment, which the harness
can't capture at all (it has no rendering, no sense of "was that readable").

## First impressions (0-2s)

Title screen loads instantly (the whole bundle is 32.68KB gzipped — `PERF.md`), no
flash of unstyled content, no loading spinner needed. `INKFALL` in the serif display
face, the tagline, one gold "Begin a Passage" button. Tapping it drops straight into
the road with no transition animation, no "3-2-1-go" countdown — the Brush is just
already there, already receiving input. This matches GAME_DESIGN.md §10's "two taps and
under 3 seconds" loop-restart target on the *return* trip (death → summary → Inkstone →
play again), and the very first entry is even faster than that.

## The core loop, played for real

**Movement** reads immediately — `ArrowLeft`/`ArrowRight` moves the Brush with a visible
critically-damped follow (it doesn't snap), and the Line's own formation slides with it
as one visual mass, not individual strokes lagging independently. At low Stroke counts
(3-10) the Line is small enough that it's hard to tell hane/tome/harai apart from a
screenshot at speed — the shapes are there (tick/block/sliver) but at this scale and
this viewport they're a handful of small marks clustered right at the Brush. This is
exactly the greyscale-legibility case Task 5.3 tested for the *density-block* regime
(many strokes, one mass); at very low counts the individual glyphs are correct but
small, which is a genuine "is this readable at a glance" question I can't fully resolve
by eye from a screenshot at this resolution — worth a closer look with a real device's
screen and a real player's eyes, not something I'm going to claim is fine or broken from
here.

**Firing** is silent-by-design in this build (no audio in a headless capture — I didn't
re-verify the actual sound this session since Task 4.4's audio work predates this one
and nothing in Phase 5 touched `/audio`), but visually: projectiles leave the Line
continuously, no held button needed, exactly matching GAME_DESIGN.md §6's "always firing
by default." Holding Space to charge a Flourish is readable — held for ~1.1s, the Brush
noticeably grows and shifts toward vermilion mid-charge (`drawBrush`'s charge-fraction
scaling), so there's a clear visual answer to "is my hold actually charging."

**Gates are the sharpest edge I hit.** In my played-for-real run, a Gate pair appeared
within the first ~10s, I didn't have time to read which side was better before it
resolved (moving purely reactively, no time invested in evaluating the two options),
and the run ended at **11s real Passage time, 243u distance, Peak Line 3** with death
cause "A Gate cost too much." `BALANCE_REPORT.md`'s own "Deaths within 8s of a Gate"
row (11.0%, target ≤12%) says this is *expected* to happen to roughly 1 in 9 mixed-bot
runs — my one real attempt landing in that bucket isn't a bug, it's the target range
doing exactly what it's tuned to do. But it's a real, first-person confirmation that an
early, mis-read Gate is a genuinely fast way to lose a Passage, and it happened on my
very first attempt. Whether that reads as "appropriately tense" or "unfair" to an actual
first-time player is exactly the kind of judgment call GAME_DESIGN.md §13's scripted
first-20-seconds sequence (Task 4.5) exists to soften — and it worked as intended here:
the *first-ever* Passage for a fresh profile gets the scripted Slip→Gate→wave sequence
with nothing else on screen, so a genuinely new player's first Gate is never this
rushed. My playthrough used an existing (non-fresh) profile state, so it didn't get that
softening — a fair comparison of "raw" vs "taught" difficulty, and the difference
matters.

## Balance, honestly

`BALANCE_REPORT.md`'s zero-upgrades `mixed`-bot numbers (median Passage length 56.3s,
median peak Line 39, both inside GAME_DESIGN.md §11's target bands) describe a *typical*
run longer and more developed than my one real attempt — consistent with the above:
a bot that evaluates Gate EV before committing (the `mixed`/`gates` strategies do this;
I, playing in real time under a script-driven cadence, didn't) survives Gates
meaningfully better. That's the game working as designed, not a contradiction.

Two §11 targets remain FAIL after extensive tuning (Tasks 4.6/4.6b — see DECISIONS.md
for the full record): **Strategy dominance** (24.7% vs ≤20%, close) and **First Seal
reached** (38.0% vs ≥70%, a real structural gap). I did not personally reach a Seal in
my one real playthrough (243u before the arcade cadence's first Seal at 75s of Passage
time) — consistent with the 38% harness figure, and a genuine, known gap I'm not
papering over here: as of this build, most players' *first* Passage will end before
ever seeing a Seal at all. That's the single most important open balance question left
in the project, tracked honestly as FAIL rather than rounded up.

## Accessibility, observed directly

Verified this session (Task 5.3): with Shapes-Only mode and Reduce Motion both on, a
full-page CSS `grayscale(100%)` filter still leaves all three Stroke classes clearly
distinguishable by silhouette alone — tick, block-with-two-dots, tapering sliver read as
three unmistakably different shapes with zero colour information, GAME_DESIGN.md §12's
colourblind requirement met by direct screenshot comparison, not just by design intent.
Keyboard Tab-focus shows a clear, on-brand gold outline on the title screen's primary
button. I did not personally sit through Reduce Motion's trail-wobble difference frame
by frame (it's a per-frame animation difference, hard to assess from static screenshots)
— logged here as unverified-by-eye rather than claimed.

## Update after Phase 7

Everything below this point was written after Task 5.4 landed, before Phase 7's polish
pass. Phase 7 (7.1-7.11) is now fully complete, and two things in the "missing" and
"balance" sections above have since changed — recorded here rather than rewritten in
place, so the history of what got fixed stays visible.

**The camera-shake/hit-feedback gap is closed.** Task 7.10 built exactly what
GAME_DESIGN.md §12 describes: shake on Seal impacts and Flourish only (≤4px, ≤180ms,
halved not removed under Reduce Motion), plus an ink-splat/scale-pop on Blot hits.
Re-ran a real headless-Chromium session this pass (production build, `?debug=1`, a
120-Line, a 900-Blot wave, a real held-then-released Flourish) after all of Phase 7's
other changes landed — zero console errors through sustained heavy combat and a real
Flourish release, confirming nothing since Task 7.10 regressed it. I did not re-do
Task 7.10's own frame-by-frame pixel measurement of the shake amplitude (that
verification, plus dedicated unit tests pinning the exact math, already exists and
didn't need repeating); this pass is a no-regression check, not a re-derivation.

**Balance is unchanged, still honestly FAIL on two rows.** Task 7.9 tried the one
concrete lever Task 4.6b identified (decoupling each Seal boss's own attack damage from
the shared ordinary-Blot-contact constant) and confirmed empirically it doesn't move
"First Seal reached" — that number tracks how much zero-upgrades DPS a run has *before*
ever meeting a Seal, which per-boss attack tuning structurally cannot touch. Current
`BALANCE_REPORT.md`: **Strategy dominance** 24.7% vs ≤20% target (unchanged), **First
Seal reached** 38.1% vs ≥70% target (unchanged, within noise of the 38.0% figure below).
Three independent tuning attempts across Tasks 4.6/4.6b/7.9 have now converged on the
same conclusion: this needs a lever no session has tried yet (see DECISIONS.md), not
another sweep of the ones already tried.

Also new since the section below was written: **Gate numbers now actually render**
(Task 7.11 — discovered mid-Phase-7 that GAME_DESIGN.md §12's "Gate numbers are the
loudest type in the game" text described rendering that had never been built; gates
were plain coloured quads with no readable number at all). That's a real improvement to
the specific "Gates are the sharpest edge I hit" moment described below — a player now
has an actual number to read in the ~0.7s before a Gate pair resolves, not just two
identical-looking doors.

## What's missing that I can feel the absence of (as of Task 5.4, before Phase 7)

GAME_DESIGN.md §12 describes camera shake (Seal impacts, Flourish) and an ink-splat-
plus-scale-pop hit-feedback system that, as discovered during Task 5.3, no earlier task
ever actually built (Task 7.10 tracks this). Played for real, this is noticeable: taking
a hit or landing the Flourish sweep has no camera response and no per-hit visual
punctuation beyond the ordinary silhouettes changing — functional, readable, but
noticeably flatter than GAME_DESIGN.md's own described feel. This is the single biggest
gap between "what the design document describes" and "what a hand currently feels,"
more than any remaining balance number.

**This gap is now closed — see "Update after Phase 7" above.**

## Specific timings, gathered

- Cold load, title screen interactive: comfortably under 1s in this headless
  environment (not a real mid-range Android — TECH_SPEC.md §8's ≤1.5s target needs real-
  device verification per `PERF.md`'s own honest gap).
- Flourish charge, held-to-trigger: ~1.0-1.1s hold reliably triggers (matches
  `BALANCE.flourish.chargeTimeS`).
- My one real death: 11s Passage time, 243u distance, 3 peak Line, Gate-caused.
- Harness median (mixed bot, zero upgrades, 2000 runs): 56.3s Passage length, 39 peak
  Line — roughly 5x longer and 13x more developed than my one real (unlucky-Gate,
  reactive-only) attempt, which is the expected spread between "read nothing, react
  only" and "evaluate before committing."
- Death-to-replay loop: title → playing was instantaneous (no transition); the death →
  summary → Inkstone → play-again loop (GAME_DESIGN.md §10's "two taps, under 3s" bar)
  wasn't separately re-timed this session, having been verified in an earlier task
  (4.3's own headless-Chromium pass, per PROGRESS.md).

## Bottom line

The core loop is legible and fast to enter; movement and firing read clearly; the
colourblind/greyscale requirement genuinely holds up under direct testing, not just by
design. Phase 7 closed the camera-shake/hit-feedback gap (Task 7.10) and the unreadable-
Gate-number gap (Task 7.11) this document originally flagged — both verified, not just
claimed fixed. The one real gap left is the one three independent tuning attempts
(Tasks 4.6, 4.6b, 7.9) haven't closed: most zero-upgrades runs still end before ever
reaching a Seal. That's tracked honestly as a FAIL in `BALANCE_REPORT.md`, not rounded
up, and is the single item standing between this build and a clean §11 pass.
