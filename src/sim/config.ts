// The single source of truth for every gameplay-tunable number (TECH_SPEC.md §13).
// Every field here mirrors a number in GAME_DESIGN.md; the section reference in each
// comment is where to look when a value needs re-deriving. Nothing else under /sim may
// contain a numeric literal other than 0, 1, or an array index — the balance harness
// (TECH_SPEC.md §6) sweeps by building overridden copies of this object, never by
// reaching into code elsewhere.
//
// Percentages are stored as fractional multipliers (0.04, not 4), so every "per level"
// or "bonus" field can be applied as `base * (1 + n * field)` without a stray /100.

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
    plusOne: { hp: 1, runMin: 4, runMax: 14 },
    plusFive: { hp: 6 },
    plusTwentyFive: { hp: 40, laneSpanFraction: 1 / 3 },
    /** The class currently least-held is this much more likely to appear. */
    leastHeldWeightMultiplier: 1.5,
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
  },
  sealstacks: {
    /** Strokes lost on impact = ceil(remainingHP / this). */
    hpToStrokeLossDivisor: 12,
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
    smear: { phases: 3, gatherPullS: 0.9, residuePhase3S: 2 },
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
