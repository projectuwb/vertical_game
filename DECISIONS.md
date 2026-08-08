# DECISIONS

Every choice made that the specs did not settle. One line each, no discussion,
no waiting for approval.

Format:
`- [YYYY-MM-DD] <decision> — <one-clause reason>`

- [2026-08-07] `npm run sim`/`npm run perf` compile via a dedicated `tsconfig.cli.json` (NodeNext) + plain `node`, not `tsx` — keeps devDependencies to exactly the `TECH_SPEC.md` §2 list.
- [2026-08-07] Vitest runs in the `node` test environment, not `jsdom` — `/sim` and `/meta` (the tested code) are headless by rule, and `jsdom` isn't in the §2 dependency list.
- [2026-08-07] Desktop hold-to-Flourish is bound to the Space key — GAME_DESIGN.md §3 requires a keyboard hold-to-Flourish input but doesn't name a key, and Space is the least likely to collide with A/D/arrow movement.
- [2026-08-07] Drifter's lateral strafe speed is set to 4 u/s (40% of its forward speed) — GAME_DESIGN.md §8.1 says it "strafes laterally" without a number; fast enough to force leading shots, slow enough not to look erratic.
- [2026-08-07] Projectile-vs-Blot hit radius set to 0.6u — neither spec models collision as circle-vs-circle explicitly; chosen larger than a Blot's silhouette but smaller than the Line's 0.85u row spacing so hits feel fair without adjacent-row false positives.
- [2026-08-07] The runner-joins-the-back animation (GAME_DESIGN.md §7.1) travels for 0.6s — not given a number in the spec; reads as a clear run without lagging, comfortably inside Task 2.5's 1.2s acceptance bar.
- [2026-08-08] Sealstack HP set to 60, hit-depth to 1.0u — GAME_DESIGN.md §7.3 gives the impact-loss formula but not the stack's own HP or collision thickness; 60 asks for sustained fire (comparable to a Crust) without being a boss fight.
- [2026-08-08] A Sealed gate's revealed effect can combine an arithmetic op with a conversion (GAME_DESIGN.md §7.2's "gate maths order: multiply before add within a single gate; conversion applies after count changes" only has observable meaning if a single gate can carry both) — plain Arithmetic/Conversion/Temper gates stay single-effect; the compound path exists specifically for Sealed's reveal table and is what makes the ordering rule testable.
- [2026-08-08] Gate-pair archetype mix set to 20% Sealed-vs-modest / 30% safety-valve / 50% explicit dilemma — GAME_DESIGN.md §7.2 only states the ≥1-in-4 dilemma floor, not how pairs are chosen; this mix satisfies it with comfortable margin (~70% actual dilemma rate).

