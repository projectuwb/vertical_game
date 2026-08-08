// The single source of truth for every gameplay-tunable number (TECH_SPEC.md §13).
// Every field here mirrors a number in GAME_DESIGN.md; the section reference in each
// comment is where to look when a value needs re-deriving. Nothing else under /sim may
// contain a numeric literal other than 0, 1, or an array index — the balance harness
// (TECH_SPEC.md §6) sweeps by building overridden copies of this object, never by
// reaching into code elsewhere.
//
// Percentages are stored as fractional multipliers (0.04, not 4), so every "per level"
// or "bonus" field can be applied as `base * (1 + n * field)` without a stray /100.

/** GAME_DESIGN.md gives Phrase spreads in degrees (e.g. §4's "45° spread"); /sim's own
 *  math wants radians. A bare `/ 180` in any other /sim file would trip the
 *  no-magic-numbers scanner above, so the conversion factor lives here once, in the one
 *  file the scanner exempts. */
export const DEG_TO_RAD = Math.PI / 180;

function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const balance = {
  // §3 Camera, lane, and control
  lane: {
    width: 9,
    halfWidth: 4.5,
    brushClampX: 4.0,
  },
  forwardSpeed: {
    baseUPerS: 22,
    rampUPerSPer10s: 0.35,
    capUPerS: 34,
  },
  control: {
    /** World-units-per-pixel applied to raw drag delta. */
    dragUnitsPerPixel: 0.028,
    /** Critical-damping time constant, seconds, smoothing the Brush toward its target. */
    dampingTimeConstantS: 0.07,
    /** Desktop keyboard fallback: A/D or arrows move at this rate. */
    keyboardUPerS: 14,
  },

  // §4 Strokes — the three classes
  strokes: {
    hane: {
      fireRatePerS: 6.0,
      damage: 1,
      projectileSpeedUPerS: 60,
      rangeU: 26,
      vsCrust: 0.5,
      vsSlips: 1.0,
    },
    tome: {
      fireRatePerS: 1.6,
      damage: 9,
      projectileSpeedUPerS: 34,
      splashRadiusU: 1.2,
      rangeU: 20,
      vsCrust: 1.0,
      vsSlips: 1.0,
    },
    harai: {
      fireRatePerS: 3.0,
      damage: 3,
      projectileSpeedUPerS: 48,
      pierceCount: 2,
      rangeU: 34,
      vsCrust: 0.5,
      vsSlips: 2.0,
    },
  },

  // §4 Phrase bonus — front-row-of-5 composition mechanic
  phrase: {
    rowSize: 5,
    minSameClassInFrontRow: 3,
    cycleS: 3.0,
    fiveOfKindCycleS: 2.0,
    fiveOfKindDamageMult: 1.5,
    hane: { scatterCount: 9, scatterSpreadDeg: 45, scatterDamage: 2 },
    tome: { pressWidthU: 3, pressTravelU: 18, pressDamage: 20, staggerS: 0.4 },
    harai: { sweepDurationS: 0.5, sweepDamagePerTick: 6, sweepTicksPerS: 10 },
  },

  // §5 The Line — formation, growth, and loss
  line: {
    startCount: 3,
    maxCount: 999,
    rowSize: 5,
    lateralSpacingU: 0.85,
    longitudinalSpacingU: 0.75,
    /** Shallow forward arc: how far the front row leads at lane centre. */
    arcBulgeU: 0.3,
    /** Rows beyond this are drawn as density blocks (rowSize * this = N threshold of 60). */
    densityBlockRowThreshold: 12,
    individualRowsDrawn: 3,
    /** DPS contribution of each row beyond the first, as a fraction of one Stroke's DPS. */
    extraRowDpsContribution: 0.55,
    maxVisibleProjectilesPerClassPerS: 24,
    normalContactStrokeLoss: 1,
    crustContactStrokeLoss: 3,
  },

  // §6 Wetness and the Flourish
  wetness: {
    max: 100,
    drainPerSWhileFiring: 6.0,
    refillPerSAfterDelay: 25,
    refillDelayS: 0.8,
    poolRestoreAmount: 40,
    poolSpacingU: 140,
    dryFireRateMult: 0.5,
    dryDesaturateFraction: 0.6,
    // Neither given a number in GAME_DESIGN.md §6. Hit radius wider than the projectile
    // hit radius (0.6u) since this is the Brush's own footprint passing over a puddle,
    // not a pinpoint shot; lateral range keeps pools off the very edge of the lane so
    // they're always reachable without hugging a verge. Logged in DECISIONS.md.
    poolHitRadiusU: 1.2,
    poolLateralRangeFraction: 0.85,
  },
  flourish: {
    chargeTimeS: 0.35,
    damageBase: 28,
    damagePerRow: 0.15,
    radiusU: 5,
    knockbackU: 4,
    cost: 40,
    cooldownS: 6.0,
    minWetnessToCharge: 40,
  },

  // §7 The road
  road: {
    segmentLengthU: 120,
  },
  slips: {
    plusOne: { hp: 1, runMin: 4, runMax: 14, recruitCount: 1 },
    plusFive: { hp: 6, recruitCount: 5 },
    plusTwentyFive: { hp: 40, laneSpanFraction: 1 / 3, recruitCount: 25 },
    /** The class currently least-held is this much more likely to appear. */
    leastHeldWeightMultiplier: 1.5,
    // Not given a number in GAME_DESIGN.md ("the runner-joins-the-back animation") —
    // 0.6s reads clearly as a run without feeling laggy, comfortably under the Task
    // 2.5 acceptance bar of a Stroke landing within 1.2s of the kill. Logged in
    // DECISIONS.md.
    recruitTravelDurationS: 0.6,
    // A run is staked along one verge at increasing z, not spread across the lane at one
    // instant — GAME_DESIGN.md §7.1 says "staked along... the verges" but gives no
    // spacing/offset numbers. 3.5u between Slips gives a clean one-at-a-time read at
    // forward speed; 0.75 of the half-width keeps a run visibly off to one side without
    // hugging the very edge. Logged in DECISIONS.md.
    runZSpacingU: 3.5,
    vergeOffsetFraction: 0.75,
    // "Missing them costs nothing but opportunity" (GAME_DESIGN.md §7.1) — but nothing
    // in the spec says an unshot Slip should occupy its pool slot forever. Despawning it
    // once it's scrolled this far past the Brush keeps `pools.slipCapacity` from being a
    // silent, run-length-dependent ceiling on how many Slip runs a Passage can ever
    // offer (see DECISIONS.md).
    missDespawnMarginU: 2,
  },
  gates: {
    pairIntervalU: 220,
    sealed: { goodChance: 0.6, badChance: 0.4 },
    arithmetic: { mul2: 2, mul3: 3, addTwelve: 12, addTwentyFive: 25, subTen: -10, divTwo: 0.5 },
    temper: {
      stackCap: 5,
      rateBonus: 0.2,
      rangeBonus: 0.25,
      splashBonus: 0.3,
      wetnessCapBonus: 25,
    },
    /** At least this fraction of pairs must be a genuine dilemma (spec: "1 in 4"). */
    minDilemmaFraction: 0.25,
    // Pair-generation archetype mix — not named numerically in GAME_DESIGN.md, which
    // only states the ≥1-in-4 dilemma floor; these are the implementation's chosen
    // weights (20% Sealed-vs-modest, 30% safety-valve, 50% explicit dilemma) that
    // satisfy it with margin. See DECISIONS.md.
    pairArchetype: {
      sealedThreshold: 0.2,
      safetyValveThreshold: 0.5,
    },
    /** Fair coin flip, reused anywhere a 50/50 choice is needed (which side a gate
     *  lands on, which "good" sub-outcome a Sealed reveal picks). */
    fiftyFifty: 0.5,
    /** Defensive retry bound for the vanishingly-rare case a dilemma pair's two random
     *  draws land on the same gate; not a balance number, just a loop guard. */
    identicalRetryGuard: 10,
  },
  sealstacks: {
    /** Strokes lost on impact = ceil(remainingHP / this). */
    hpToStrokeLossDivisor: 12,
    // Neither given a number in GAME_DESIGN.md §7.3. hp=60 asks for sustained fire
    // (comparable to a Crust) without being a boss fight; thicknessU=1.0 gives the
    // "stacked column of discs" enough hit-depth to read as a solid object rather
    // than a knife-edge plane. Logged in DECISIONS.md.
    hp: 60,
    thicknessU: 1.0,
  },

  // §8.1 Blot units
  blot: {
    smudge: { hp: 3, speedUPerS: 8 },
    runner: { hp: 2, speedUPerS: 16 },
    crust: { hp: 25, speedUPerS: 6, contactStrokeLoss: 3 },
    splitter: { hp: 12, speedUPerS: 9, spawnOnDeathCount: 3, spawnOffsetU: 1 },
    blotter: { hp: 8, speedUPerS: 5, stopDistanceU: 18, lobIntervalS: 2.2, contactStrokeLoss: 1 },
    // strafeUPerS isn't given a number in GAME_DESIGN.md ("strafes laterally, forcing
    // you to lead your shots") — chosen at 40% of forward speed: fast enough to matter,
    // slow enough not to look erratic. Logged in DECISIONS.md.
    drifter: { hp: 6, speedUPerS: 10, strafeUPerS: 4 },
  },

  // §8.2 Seals (bosses)
  seals: {
    order: ['smear', 'press', 'blank'] as const,
    approachTelegraphS: 6,
    minAttackTelegraphS: 0.7,
    phaseStaggerWindowS: 1.5,
    phaseStaggerDamageMult: 2,
    hpBase: 420,
    hpGrowthPerIndex: 1.62,
    arcadeCadenceS: 75,
    // Not named anywhere in GAME_DESIGN.md, which describes the fight's choreography but
    // never a physical stand-off distance: 16u sits comfortably inside all three Stroke
    // classes' ranges (Hane 26u, Tome 20u, Harai 34u) so no class is locked out of the
    // fight, and the hit radius reads as a real boss-sized presence next to a Blot's
    // 0.6u. Logged in DECISIONS.md.
    engagementZU: 16,
    hitRadiusU: 1.5,
    // gatherPullS/residuePhase3S/phases are named exactly in GAME_DESIGN.md §8.2.
    // sweepReachFraction ("sweeps an arm laterally across two thirds of the lane") is
    // named too, just given in words — it's the sweep's *total footprint* (leftmost
    // reach to rightmost reach, centred on the lane), not the arm's own instantaneous
    // width: an arm literally two thirds of the lane wide would leave only a
    // one-third-wide gap that itself keeps moving, which is a reflex check, not the
    // "correct answer that is a position" rule §8.2 explicitly requires of every Seal
    // attack. armWidthU (2u, comfortably narrower than its own reach) is what makes a
    // single stationary position near either lane edge safe for the attack's entire
    // duration. sweepDurationS/attackIntervalS aren't given a number anywhere — 1.2s
    // keeps the sweep itself clearly slower/more readable than the 0.9s telegraph that
    // precedes it (the telegraph should never be the fastest part of an attack), and a
    // 2.5s cooldown leaves clear breathing room between attacks across a 3-phase fight.
    // Logged in DECISIONS.md.
    smear: {
      phases: 3,
      gatherPullS: 0.9,
      residuePhase3S: 2,
      sweepReachFraction: 2 / 3,
      armWidthU: 2,
      sweepDurationS: 1.2,
      attackIntervalS: 2.5,
    },
    press: { phases: 3, summonPerSlamCount: 8 },
    blank: { phases: 4, eraseDurationS: 3 },
  },

  // §9 The Spawn Director
  director: {
    pressureTimeDivisorS: 38,
    pressureLineLogMultiplier: 0.55,
    waveIntervalMinS: 2.4,
    waveIntervalBaseS: 7.5,
    waveIntervalTimeDivisorS: 32,
    waveSizeBase: 4,
    waveSizeMultiplier: 3.2,
    waveSizeCap: 240,
    composition: {
      pressureLowBand: 3,
      pressureMidBand: 6,
      pressureHighBand: 10,
      runnerChance: 0.2,
      crustChance: 0.1,
      blotterChance: 0.12,
      splitterChanceHigh: 0.15,
      drifterChanceHigh: 0.15,
      crustChanceHigh: 0.18,
    },
    slipBudget: {
      base: 18,
      pressureMultiplier: 6,
      perU: 100,
    },
    mercy: {
      lineThreshold: 2,
      durationS: 4,
      suppressDurationS: 8,
      slipDensityBonus: 0.6,
    },
    antiSnowball: {
      lineThreshold: 400,
      waveSizeMult: 1.35,
      crustShareBonus: 0.08,
    },
    // Not given a number anywhere: how far ahead of the Brush new road content first
    // appears. 45u gives just over 2s of warning at base forward speed (22u/s) —
    // enough to react, short enough to stay readable at higher speeds. Also used as the
    // Gate/Sealstack spawn distance so everything appears at a consistent range.
    spawnDistanceU: 45,
    // GAME_DESIGN.md §7.3 gives no Sealstack cadence at all; ~500u (roughly 2x a Gate
    // pair's ~220u interval) reads as a heavier, rarer obstacle. Logged in
    // DECISIONS.md. ±jitterFraction softens both this and the Gate interval so
    // "roughly every Xu" doesn't read as a metronome.
    sealstackIntervalU: 500,
    intervalJitterFraction: 0.1,
    /** Blot within a wave land at a shallow range of depths, not a flat wall. */
    waveScatterDepthU: 8,
    /** planSlipSpawn's chance of spending a mid-size budget on a +5 Slip instead of a
     *  +1 run — GAME_DESIGN.md §9 gives the HP budget formula but not the spend split. */
    slipSpendFiveChance: 0.3,
  },

  // §10 Structure — arcade + meta
  economy: {
    goldLeafPerBlotKilled: 1,
    goldLeafPerDistanceU: 8,
    goldLeafPerSealBroken: 120,
  },
  inkstone: {
    levelsPerTrack: 10,
    costGrowthPerLevel: 1.38,
    openingStroke: { strokesPerLevel: 1, baseCost: 40 },
    grind: { damagePerLevel: 0.04, baseCost: 30 },
    nib: { fireRatePerLevel: 0.03, baseCost: 30 },
    well: { wetnessCapPerLevel: 8, baseCost: 25 },
    leaf: { goldLeafPerLevel: 0.05, baseCost: 35 },
    reach: { rangePerLevel: 0.04, slipDamagePerLevel: 0.02, baseCost: 25 },
    flourishStudy: { cooldownReductionPerLevelS: 0.4, cooldownFloorS: 2.0, baseCost: 45 },
    secondDraft: { reviveLevels: [1, 4, 8], revivePeakFraction: 0.35, baseCost: 200 },
  },

  // §11 Balance targets — thresholds the harness (TECH_SPEC.md §6) checks runs against.
  balanceTargets: {
    passageLengthSZeroUpgrades: { min: 55, max: 85 },
    passageLengthSMaxUpgrades: { min: 150, max: 230 },
    firstSealReachedZeroUpgradesMinFraction: 0.7,
    firstSealBrokenZeroUpgradesFraction: { min: 0.25, max: 0.45 },
    peakLineZeroUpgrades: { min: 25, max: 60 },
    peakLineMaxUpgrades: { min: 90, max: 250 },
    runsToAffordFirstUpgrade: { min: 2, max: 3 },
    runsToUpgradeLevel40: { min: 55, max: 90 },
    deathsFromCrustFraction: { min: 0.15, max: 0.3 },
    deathsWithin8sOfGateMaxFraction: 0.12,
    strategyDominanceMaxFraction: 0.2,
  },

  // Pool capacities (TECH_SPEC.md §5) — engineering/perf budget numbers rather than
  // GAME_DESIGN.md ones, but still tunable and still exclusively /sim's concern, so they
  // live here too rather than becoming untracked literals in projectiles.ts etc.
  pools: {
    projectileCapacity: 2048,
    blotCapacity: 1200,
    strokeCapacity: 999,
    particleCapacity: 600,
    floatingNumberCapacity: 64,
    // Not named in TECH_SPEC.md §5's pool list (it predates Slips/recruits existing as
    // pooled entities) — sized generously above the largest single Slip run (14) and a
    // busy moment of in-flight recruits, with headroom to spare.
    slipCapacity: 64,
    joiningRecruitCapacity: 64,
    // At most one or two Sealstack pairs are ever in flight at once (§7.2's ~220u
    // spacing); 16 is generous headroom.
    sealstackCapacity: 16,
    // Ink pools spawn every ~140u (wetness.poolSpacingU) and are consumed the instant
    // they're passed (hit or missed) — at most one or two are ever in flight; 8 is
    // generous headroom.
    inkPoolCapacity: 8,
  },

  // Projectile-vs-Blot hit radius: not given a number anywhere in either spec (neither
  // doc models collision as circle-vs-circle explicitly). 0.6u is comfortably larger
  // than a Blot's smallest silhouette and smaller than the Line's row spacing (0.85u),
  // so hits feel fair without adjacent-row splash-like false positives. Logged in
  // DECISIONS.md.
  collision: {
    hitRadiusU: 0.6,
  },

  // Above this many active Blot, only those within massRenderDistanceU of the Brush
  // draw with full individual detail; farther ones drop to a cheaper silhouette so a
  // wave of hundreds still reads as "one advancing stain" (GAME_DESIGN.md §8.1) at 60fps
  // (TECH_SPEC.md §5's "individuals within 30u, silhouetted mass beyond").
  blotRender: {
    massThresholdCount: 150,
    massRenderDistanceU: 30,
  },
} as const;

/** Every gameplay-tunable number in the game. Frozen — sweeps build overridden copies, never mutate this. */
export const BALANCE = deepFreeze(balance);

export type Balance = typeof BALANCE;
