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

