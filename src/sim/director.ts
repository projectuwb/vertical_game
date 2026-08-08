// The Spawn Director (GAME_DESIGN.md §9, Task 2.7): pure functions computing what the
// road should offer, given Passage time and Line size. World (world.ts) owns the actual
// timers and calls these each step — nothing here is frame-dependent, and every roll
// draws from the seeded PRNG via the 'director' concern.

import type { RngRegistry } from '../core/rng.js';
import { BALANCE } from './config.js';
import type { BlotClass } from './blot.js';
import type { SlipKind } from './slips.js';

const ALL_BLOT_CLASSES: readonly BlotClass[] = [
  'smudge',
  'runner',
  'crust',
  'splitter',
  'blotter',
  'drifter',
];

/** GAME_DESIGN.md §9: `P = 1 + t/38 + log2(max(N,1)) × 0.55`. */
export function computePressure(timeS: number, lineCount: number): number {
  const d = BALANCE.director;
  return (
    1 + timeS / d.pressureTimeDivisorS + Math.log2(Math.max(lineCount, 1)) * d.pressureLineLogMultiplier
  );
}

/** GAME_DESIGN.md §9: `max(2.4, 7.5 − t/32)` seconds. */
export function computeWaveIntervalS(timeS: number): number {
  const d = BALANCE.director;
  return Math.max(d.waveIntervalMinS, d.waveIntervalBaseS - timeS / d.waveIntervalTimeDivisorS);
}

/** GAME_DESIGN.md §9: `round(4 + P × 3.2)`, capped 240; anti-snowball scales it up further. */
export function computeWaveSize(pressure: number, lineCount: number): number {
  const d = BALANCE.director;
  let size = d.waveSizeBase + pressure * d.waveSizeMultiplier;
  if (lineCount > d.antiSnowball.lineThreshold) {
    size *= d.antiSnowball.waveSizeMult;
  }
  return Math.min(d.waveSizeCap, Math.round(size));
}

/**
 * GAME_DESIGN.md §9's pressure-band composition table, plus anti-snowball's Crust bump
 * and the mercy rule's Crust/Splitter suppression. Bands are cumulative — reaching a
 * higher band doesn't remove the classes unlocked by lower ones.
 */
export function computeComposition(
  pressure: number,
  lineCount: number,
  mercyActive: boolean,
): Record<BlotClass, number> {
  const c = BALANCE.director.composition;
  const weights: Record<BlotClass, number> = {
    smudge: 1,
    runner: 0,
    crust: 0,
    splitter: 0,
    blotter: 0,
    drifter: 0,
  };

  if (pressure >= c.pressureLowBand) {
    weights.runner = c.runnerChance;
  }
  if (pressure >= c.pressureMidBand) {
    weights.crust = c.crustChance;
    weights.blotter = c.blotterChance;
  }
  if (pressure >= c.pressureHighBand) {
    weights.crust = c.crustChanceHigh;
    weights.splitter = c.splitterChanceHigh;
    weights.drifter = c.drifterChanceHigh;
  }
  if (lineCount > BALANCE.director.antiSnowball.lineThreshold) {
    weights.crust += BALANCE.director.antiSnowball.crustShareBonus;
  }
  if (mercyActive) {
    weights.crust = 0;
    weights.splitter = 0;
  }

  const specifiedTotal = weights.runner + weights.crust + weights.blotter + weights.splitter + weights.drifter;
  weights.smudge = Math.max(0, 1 - specifiedTotal);
  return weights;
}

export function pickBlotClass(weights: Record<BlotClass, number>, rng: RngRegistry): BlotClass {
  const total = ALL_BLOT_CLASSES.reduce((sum, cls) => sum + weights[cls], 0);
  let roll = rng.next('director') * total;
  for (const cls of ALL_BLOT_CLASSES) {
    roll -= weights[cls];
    if (roll <= 0) return cls;
  }
  return 'smudge';
}

/** GAME_DESIGN.md §9: total Slip HP offered per 100u ≈ `18 + P × 6`; the mercy rule
 *  raises it 60% while active. */
export function computeSlipBudgetPer100U(pressure: number, mercyActive: boolean): number {
  const b = BALANCE.director.slipBudget;
  const base = b.base + pressure * b.pressureMultiplier;
  return mercyActive ? base * (1 + BALANCE.director.mercy.slipDensityBonus) : base;
}

export interface SlipSpawnPlan {
  readonly kind: SlipKind;
  /** Individual slips for `plusOne`; always 1 for the other kinds (a Banner is singular
   *  by definition, and `plusFive` "singly or in pairs" is decided by the same roll
   *  that decides whether to spend on it at all — see planSlipSpawn). */
  readonly count: number;
}

/**
 * Turns a HP budget into a concrete run (GAME_DESIGN.md §7.1's variants). Not specified
 * numerically beyond the budget formula itself — this spend order (Banner if it fully
 * fits, then an occasional +5, otherwise a +1 run sized to the budget) is this
 * implementation's choice, logged in DECISIONS.md, and is exactly what Task 4.6's
 * balance pass will tune.
 */
export function planSlipSpawn(budgetHp: number, rng: RngRegistry): SlipSpawnPlan {
  const s = BALANCE.slips;
  if (budgetHp >= s.plusTwentyFive.hp) {
    return { kind: 'plusTwentyFive', count: 1 };
  }
  if (budgetHp >= s.plusFive.hp && rng.chance('director', BALANCE.director.slipSpendFiveChance)) {
    const pair = budgetHp >= s.plusFive.hp * 2 && rng.chance('director', BALANCE.gates.fiftyFifty);
    return { kind: 'plusFive', count: pair ? 2 : 1 };
  }
  const maxByBudget = Math.floor(budgetHp / s.plusOne.hp);
  const count = Math.max(s.plusOne.runMin, Math.min(s.plusOne.runMax, maxByBudget));
  return { kind: 'plusOne', count };
}

// --- Mercy rule (GAME_DESIGN.md §9): "if N ≤ 2 for more than 4s, suppress Crust and
// Splitter spawns and raise Slip density 60% for 8s. Once per Passage. Never announce it." ---

export interface MercyState {
  readonly lowLineSinceS: number | null;
  readonly usedThisPassage: boolean;
  readonly activeUntilS: number | null;
}

export function createMercyState(): MercyState {
  return { lowLineSinceS: null, usedThisPassage: false, activeUntilS: null };
}

export function isMercyActive(mercy: MercyState, timeS: number): boolean {
  return mercy.activeUntilS !== null && timeS < mercy.activeUntilS;
}

export function updateMercyState(mercy: MercyState, timeS: number, lineCount: number): MercyState {
  const m = BALANCE.director.mercy;
  if (isMercyActive(mercy, timeS) || mercy.usedThisPassage) {
    return mercy;
  }

  if (lineCount > m.lineThreshold) {
    return mercy.lowLineSinceS === null ? mercy : { ...mercy, lowLineSinceS: null };
  }

  const since = mercy.lowLineSinceS ?? timeS;
  if (timeS - since > m.durationS) {
    return { lowLineSinceS: since, usedThisPassage: true, activeUntilS: timeS + m.suppressDurationS };
  }
  return mercy.lowLineSinceS === since ? mercy : { ...mercy, lowLineSinceS: since };
}
