# INKFALL — Task backlog

Work top to bottom. Tick a box only when its acceptance criteria are met and `npm run verify` passes. One commit per task. Append one line to `PROGRESS.md` per task.

Phases 1–5 are the shippable game. **Phase 6 is not live until the user says so** — do not begin it, even if you have capacity left. Phase 7 is polish you may pull from whenever Phases 1–5 are done and you're waiting on nothing.

---

## Phase 1 — Foundation

- [x] **1.1 Scaffold.** Vite + TS strict, ESLint flat config + Prettier, Vitest, folder skeleton per `TECH_SPEC.md` §3, `npm run verify` script, git init, first commit. *Done when: `npm run verify` passes on an empty project and the repo layout matches the spec.*
- [x] **1.2 Core loop.** Fixed-timestep accumulator at 60Hz, interpolated render, pause/resume, visibility handling, an FPS/step debug overlay behind a flag. *Done when: a test drives 10,000 steps and asserts exact step count and no drift; the overlay shows a steady 60 steps/s.*
- [ ] **1.3 Determinism kit.** mulberry32, per-concern generator registry, `Math.random` lint ban, world-hash utility. *Done when: the determinism test in `TECH_SPEC.md` §12 exists and passes.*
- [ ] **1.4 Pools and events.** Typed object pools with no allocation on acquire/release; a tiny synchronous event bus for sim→render/audio signalling. *Done when: the allocation test passes.*
- [ ] **1.5 Viewport and input.** Portrait-first responsive canvas with device-pixel-ratio handling and safe-area insets; drag-relative lateral input per `GAME_DESIGN.md` §3, keyboard fallback, hold detection for Flourish. *Done when: dragging moves a debug marker with the specified damping on a phone-sized viewport, and input is delivered to the sim as `InputFrame` only.*
- [ ] **1.6 Config object.** `/sim/config.ts` frozen `BALANCE` object containing every number in `GAME_DESIGN.md`, typed and commented with section references. *Done when: grepping `/sim` finds no numeric literals outside `config.ts` except 0, 1, and array indices.*

## Phase 2 — The run

- [ ] **2.1 Projection and road.** Perspective projection per `TECH_SPEC.md` §5, layered canvases, scrolling road with markings, water, horizon, vignette. Palette from `GAME_DESIGN.md` §12. *Done when: the road scrolls at 22 u/s with no shimmer or seam, and resizing preserves proportions across 9:21 to 3:4.*
- [ ] **2.2 The Brush and the Line.** Formation layout, arc, rows of 5, growth and loss from the front, density blocks above 60. *Done when: a debug control setting N to 1/5/37/120/400 produces correct, readable formations at 60fps.*
- [ ] **2.3 Strokes and firing.** Three classes with the stats in §4, projectile pools, per-class visuals and behaviour (splash, pierce), row-scaled DPS with the visible-projectile cap. *Done when: unit tests confirm DPS scaling and armour multipliers, and the cap holds at N=400.*
- [ ] **2.4 The Blot.** All six unit types, marching behaviour, contact resolution, mass rendering above 150. *Done when: 900 units render at 60fps and contact kills resolve exactly per §5.*
- [ ] **2.5 Slips.** Slip runs, +1/+5/+25 variants, class assignment with the least-held weighting, shoot-to-recruit with the runner-joins-the-back animation. *Done when: shooting a Slip reliably adds a Stroke of that class within 1.2s and the class weighting is unit-tested.*
- [ ] **2.6 Gates and Sealstacks.** All four gate families, pairing rules, contact resolution and maths order, Sealstack HP and impact penalty. *Done when: gate maths is unit-tested including conversion-after-count, and no illegal pair can be generated across 10,000 seeded rolls.*
- [ ] **2.7 Spawn Director + balance harness.** Director per §9; headless harness and all five bot strategies per `TECH_SPEC.md` §6; first `BALANCE_REPORT.md`. *Done when: `npm run sim -- --runs 2000` completes and writes a report. Targets need not pass yet.*
- [ ] **2.8 Wetness and Flourish.** Meter, drain/refill, ink pools, dry state, charge-and-release Flourish with its costs and effects. *Done when: the economy is unit-tested and the dry state is visibly obvious without reading a bar.*
- [ ] **2.9 Phrases.** Front-row detection, three Phrase attacks, 5-of-a-kind escalation. *Done when: phrase detection is unit-tested against 30 hand-written formations and each Phrase is visually distinct at a glance.*
- [ ] **2.10 The ink trail.** The signature element per §12 — width by N, colour by class mix, bleeding edges, capillary wobble, 6%-alpha accumulation layer. *Done when: a Line of 5 and a Line of 300 produce visibly different, beautiful trails at 60fps. Spend real effort here.*
- [ ] **2.11 Death and restart.** Line-to-zero end state, freeze frame, ink bleeding out across the road, straight to summary. *Done when: death to next Passage is two taps and under 3s.*

## Phase 3 — The Seals

- [ ] **3.1 Seal framework.** Phased HP, segmented bar, telegraph system with the 0.7s minimum, stagger windows, approach sequence, Slip continuation during the fight. *Done when: a stub Seal cycles phases correctly and every attack fires its telegraph first.*
- [ ] **3.2 The Smear.** Three phases per §8.2. *Done when: the bot beats it at ~40% with level-5 upgrades and every attack has a positional answer.*
- [ ] **3.3 The Press.** Three phases, rhythmic slams, ring gaps. *Done when: ring gaps are always reachable from any starting lateral position — assert this in a test over 5,000 seeds.*
- [ ] **3.4 The Blank.** Four phases, road erasure, Stroke conversion. *Done when: erasure never leaves the player with zero navigable information — the trail must remain.*
- [ ] **3.5 Seal scaling.** Index-based HP curve, cycling order, 75s cadence in arcade. *Done when: the harness shows Seal encounters at the expected rate and difficulty ramps smoothly.*

## Phase 4 — Meta and shell

- [ ] **4.1 Profile and persistence.** Schema, migrations, safe storage wrapper, export/import. *Done when: migration tests pass and the game runs correctly with storage throwing on every call.*
- [ ] **4.2 Economy.** Gold Leaf formula, all eight Inkstone tracks with cost curves, application of every effect into the sim. *Done when: each upgrade's effect is unit-tested end to end, not just stored.*
- [ ] **4.3 Screens.** Title, run summary, Inkstone, settings — per `GAME_DESIGN.md` §10 and §12, keyboard-navigable, no confirmation dialogs. *Done when: every screen is finished, responsive, and reachable; no placeholder text anywhere.*
- [ ] **4.4 Audio.** WebAudio synthesis for all SFX and the generative music per §12, with a mixer, mute persistence, and a hard rule that audio never blocks the loop. *Done when: no audio file exists in the repo and every event in §12 has a distinct sound.*
- [ ] **4.5 First-run teaching.** The scripted opening 20 seconds per §13. *Done when: a fresh profile produces exactly that sequence and no text panel appears.*
- [ ] **4.6 Balance pass.** Sweep the director and Slip budget until every target in §11 passes, especially the greedy-slips vs greedy-kill row. Commit the report. *Done when: `BALANCE_REPORT.md` shows all rows passing.*

## Phase 5 — Ship

- [ ] **5.1 PWA.** Manifest, hand-written service worker, generated icons, install prompt, offline verification test. *Done when: the built app loads and plays with the network disabled and Lighthouse PWA checks pass locally.*
- [ ] **5.2 Performance.** Adaptive quality manager, `npm run perf`, `PERF.md` with percentiles at max entity counts. *Done when: the §8 budget is met or the shortfall is documented with the measurement.*
- [ ] **5.3 Accessibility.** Shapes-Only toggle, greyscale legibility check, reduced-motion handling, focus states, hit targets ≥44px. *Done when: a greyscale screenshot still distinguishes all three classes.*
- [ ] **5.4 Android.** Capacitor project, portrait lock, back-button handling, zero permissions, haptics, debug APK, `README.md` build docs. *Done when: the merged manifest declares no permissions and the APK path is documented.*
- [ ] **5.5 Ship review.** `README.md` complete, `PLAYTEST_NOTES.md` with your own frame-level assessment of feel and at least five specific tuning observations, `DECISIONS.md` tidy, verify green, tag `v1.0.0`. *Done when: all of that is committed.*

---

## Phase 6 — Roguelite (LOCKED — begin only when told)

- [ ] **6.1** Stage/Scroll structure, fixed-length stages, five stage themes, Scroll progression and persistence.
- [ ] **6.2** Technique system: 24 run-scoped perks, the 1-of-3 between-stage choice screen, stacking rules, per-technique unit tests.
- [ ] **6.3** Four Brushes with starting compositions and passives; unlock conditions.
- [ ] **6.4** Relics: Seal rewards persisting within a Scroll.
- [ ] **6.5** Endless mode gated behind Scroll 8, sharing the Inkstone.
- [ ] **6.6** Balance pass for the roguelite layer with new harness targets; extend `BALANCE_REPORT.md`.
- [ ] **6.7** Mode select on the title screen; both modes share the Inkstone; ship review as 5.5.

## Phase 7 — Optional polish (pull from freely once 1–5 are done)

- [ ] **7.1** Daily seed with a shareable result string (no network — copy to clipboard).
- [ ] **7.2** Replay from seed + input tape, playable back in-engine.
- [ ] **7.3** Statistics screen driven by the rolling run history.
- [ ] **7.4** A photo mode that renders the ink trail of your best Passage as a downloadable PNG scroll.
- [ ] **7.5** Palette variants unlocked by milestones (must keep §12 legibility rules).
- [ ] **7.6** Colour-blind simulation dev tool for verifying 5.3 automatically.
