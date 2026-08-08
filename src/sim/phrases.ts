// Phrase detection + attacks (GAME_DESIGN.md §4/§5, Task 2.9). "If the front row
// contains 3 or more Strokes of the same class, that class's Phrase fires on a 3.0s
// cycle" — front-row composition is arrival-order-determined, not player-chosen, so
// detection here is a pure function of the same front-row counts firing already
// computes (line.ts's computeRowClassCounts), not a new formation query.
//
// At most one class can ever be front-row-eligible at once: the front row holds
// `BALANCE.line.rowSize` (5) Strokes, and two classes each needing the 3-Stroke
// threshold would need 6 slots. The three per-class states below stay independent
// anyway (matching projectiles.ts's per-class FiringAccumulators pattern) rather than
// collapsing to "the one active class," since that's simpler to reason about and test.

import type { Pool } from '../core/pool.js';
import { BALANCE, DEG_TO_RAD } from './config.js';
import { isBlotStaggered, type Blot } from './blot.js';
import type { StrokeClass } from './stroke.js';

const ALL_STROKE_CLASSES: readonly StrokeClass[] = ['hane', 'tome', 'harai'];

export interface ClassPhraseState {
  /** Seconds accumulated toward this class's next fire. Reset to 0 the instant the
   *  class drops below the front-row threshold — no partial credit on requalifying. */
  readonly timeInCycleS: number;
  /** timeS of this class's most recent fire, or null if it never has — render's cue for
   *  "just fired" flashes (effects.ts), not consumed by /sim itself. */
  readonly lastFiredAtS: number | null;
}

/** Harai's Sweep is the one Phrase that's sustained rather than instant (GAME_DESIGN.md
 *  §4: "a full-lane-width beam sustained 0.5s, damage 6/tick at 10 ticks/s"), so it
 *  needs its own small tick-accumulator state, same shape as a firing accumulator.
 *  `damageMult` is captured once at the triggering fire (5-of-a-kind or not) and holds
 *  for the sweep's whole duration — the front row could in principle change mid-sweep,
 *  but what a cast beam does shouldn't retroactively change once it's already firing. */
export interface SweepState {
  readonly remainingS: number;
  readonly tickAccumulatorS: number;
  readonly damageMult: number;
}

export interface PhraseState {
  readonly hane: ClassPhraseState;
  readonly tome: ClassPhraseState;
  readonly harai: ClassPhraseState;
  readonly haraiSweep: SweepState;
}

function createClassPhraseState(): ClassPhraseState {
  return { timeInCycleS: 0, lastFiredAtS: null };
}

export function createPhraseState(): PhraseState {
  return {
    hane: createClassPhraseState(),
    tome: createClassPhraseState(),
    harai: createClassPhraseState(),
    haraiSweep: { remainingS: 0, tickAccumulatorS: 0, damageMult: 1 },
  };
}

export function isSweepActive(sweep: SweepState): boolean {
  return sweep.remainingS > 0;
}

export interface PhraseFireEvent {
  readonly cls: StrokeClass;
  readonly isFiveOfKind: boolean;
}

export interface PhraseEligibility {
  /** Front-row count for this class clears `minSameClassInFrontRow` (3). */
  readonly qualified: boolean;
  /** Front row is entirely this class (`rowSize`, 5) — the escalation tier. Always
   *  false when `qualified` is false: 5-of-a-kind implies qualified. */
  readonly isFiveOfKind: boolean;
}

/** GAME_DESIGN.md §4's front-row-of-5 detection rule, in isolation from cycle timing —
 *  a pure function of one class's front-row count, so it's directly testable against
 *  many hand-written formations without needing to step time forward at all. */
export function detectPhraseEligibility(count: number): PhraseEligibility {
  const p = BALANCE.phrase;
  return {
    qualified: count >= p.minSameClassInFrontRow,
    isFiveOfKind: count >= p.rowSize,
  };
}

/** Advances one class's cycle timer by `dt`, given this step's front-row count for it.
 *  Fires (possibly more than once, for pathological huge dt) whenever the accumulated
 *  time clears the cycle length — 5-of-a-kind uses the faster cycle throughout, exactly
 *  as GAME_DESIGN.md §4 describes it ("the Phrase cycle drops to 2.0s"), not just on the
 *  triggering fire. */
function stepClassPhrase(
  state: ClassPhraseState,
  dt: number,
  timeS: number,
  count: number,
  onFire: (event: PhraseFireEvent) => void,
  cls: StrokeClass,
): ClassPhraseState {
  const eligibility = detectPhraseEligibility(count);
  if (!eligibility.qualified) {
    return createClassPhraseState();
  }

  const cycleS = eligibility.isFiveOfKind ? BALANCE.phrase.fiveOfKindCycleS : BALANCE.phrase.cycleS;
  let timeInCycle = state.timeInCycleS + dt;
  let lastFiredAtS = state.lastFiredAtS;
  while (timeInCycle >= cycleS) {
    timeInCycle -= cycleS;
    lastFiredAtS = timeS;
    onFire({ cls, isFiveOfKind: eligibility.isFiveOfKind });
  }
  return { timeInCycleS: timeInCycle, lastFiredAtS };
}

/** Hane Phrase — Scatter (GAME_DESIGN.md §4): up to `scatterCount` (9) of the nearest
 *  active Blot within a `scatterSpreadDeg` (45°) forward-facing cone each take
 *  `scatterDamage` (2). No armour multiplier — like Flourish, this is a flat Phrase
 *  amount with no StrokeClass to look one up against, not a Stroke's own shot. */
function applyHaneScatter(blotPool: Pool<Blot>, brushX: number, brushZ: number, damageMult: number): void {
  const p = BALANCE.phrase.hane;
  const halfAngleRad = (BALANCE.phrase.hane.scatterSpreadDeg * DEG_TO_RAD) / 2;
  const candidates: { b: Blot; distSq: number }[] = [];
  blotPool.forEachActive((b) => {
    const dx = b.x - brushX;
    const dz = b.z - brushZ;
    if (dz < 0) return;
    if (Math.abs(Math.atan2(dx, dz)) > halfAngleRad) return;
    candidates.push({ b, distSq: dx * dx + dz * dz });
  });
  candidates.sort((a, c) => a.distSq - c.distSq);
  const hitCount = Math.min(p.scatterCount, candidates.length);
  for (let i = 0; i < hitCount; i++) {
    (candidates[i] as { b: Blot }).b.hp -= p.scatterDamage * damageMult;
  }
}

/** Tome Phrase — Press (GAME_DESIGN.md §4): a `pressWidthU` (3u) wide, `pressTravelU`
 *  (18u) forward corridor takes `pressDamage` (20) and staggers for `staggerS` (0.4s).
 *  Modelled as an instant hit-test over the corridor's full length rather than a
 *  genuinely travelling entity — the spec gives no travel speed, and the alternative
 *  (a new pooled shockwave type with its own motion/collision) is scope no other Phrase
 *  needs. Logged in DECISIONS.md. */
function applyTomePress(
  blotPool: Pool<Blot>,
  brushX: number,
  brushZ: number,
  timeS: number,
  damageMult: number,
): void {
  const p = BALANCE.phrase.tome;
  const halfWidth = p.pressWidthU / 2;
  blotPool.forEachActive((b) => {
    const dz = b.z - brushZ;
    if (dz < 0 || dz > p.pressTravelU) return;
    if (Math.abs(b.x - brushX) > halfWidth) return;
    b.hp -= p.pressDamage * damageMult;
    b.staggeredUntilS = timeS + p.staggerS;
  });
}

/** One tick of Harai Phrase — Sweep: every active Blot ahead of the Brush, anywhere in
 *  the lane ("full-lane-width... pierces everything" — no armour multiplier, same
 *  reasoning as Scatter/Press), takes `sweepDamagePerTick` (6). */
function applyHaraiSweepTick(blotPool: Pool<Blot>, brushZ: number, damageMult: number): void {
  const damage = BALANCE.phrase.harai.sweepDamagePerTick * damageMult;
  blotPool.forEachActive((b) => {
    if (b.z - brushZ < 0) return;
    b.hp -= damage;
  });
}

function stepHaraiSweep(sweep: SweepState, dt: number): { sweep: SweepState; ticks: number } {
  if (sweep.remainingS <= 0) return { sweep, ticks: 0 };
  const tickIntervalS = 1 / BALANCE.phrase.harai.sweepTicksPerS;
  const remainingS = Math.max(0, sweep.remainingS - dt);
  let acc = sweep.tickAccumulatorS + dt;
  let ticks = 0;
  while (acc >= tickIntervalS) {
    acc -= tickIntervalS;
    ticks++;
  }
  return {
    sweep: { remainingS, tickAccumulatorS: remainingS > 0 ? acc : 0, damageMult: sweep.damageMult },
    ticks,
  };
}

export interface PhraseStepResult {
  readonly state: PhraseState;
  readonly fired: readonly PhraseFireEvent[];
}

/**
 * Advances every class's Phrase cycle and Harai's sweep tick by `dt`, applying whatever
 * damage/stagger effects trigger this step directly to `blotPool`. Called once per fixed
 * step from world.ts, before that same step's resolveBlotDeaths — so a Phrase kill is
 * counted exactly like a Stroke kill, not deferred to next step.
 */
export function stepPhrases(
  state: PhraseState,
  dt: number,
  timeS: number,
  frontRowCounts: Record<StrokeClass, number>,
  blotPool: Pool<Blot>,
  brushX: number,
  brushZ: number,
): PhraseStepResult {
  const fired: PhraseFireEvent[] = [];
  const onFire = (event: PhraseFireEvent): void => {
    fired.push(event);
    const damageMult = event.isFiveOfKind ? BALANCE.phrase.fiveOfKindDamageMult : 1;
    if (event.cls === 'hane') applyHaneScatter(blotPool, brushX, brushZ, damageMult);
    else if (event.cls === 'tome') applyTomePress(blotPool, brushX, brushZ, timeS, damageMult);
    // Harai doesn't damage on the trigger step itself — it starts the sweep below,
    // which ticks (and damages) on its own schedule.
  };

  const next: Record<StrokeClass, ClassPhraseState> = {
    hane: stepClassPhrase(state.hane, dt, timeS, frontRowCounts.hane, onFire, 'hane'),
    tome: stepClassPhrase(state.tome, dt, timeS, frontRowCounts.tome, onFire, 'tome'),
    harai: stepClassPhrase(state.harai, dt, timeS, frontRowCounts.harai, onFire, 'harai'),
  };

  const haraiFired = fired.find((e) => e.cls === 'harai');
  let sweep = state.haraiSweep;
  if (haraiFired !== undefined) {
    // Re-triggering restarts the sweep at the current fire's strength — in practice this
    // can't happen (sweepDurationS is far shorter than either cycle length), but a fresh
    // cast simply superseding an old one is the least surprising behaviour if it ever did.
    const damageMult = haraiFired.isFiveOfKind ? BALANCE.phrase.fiveOfKindDamageMult : 1;
    sweep = { remainingS: BALANCE.phrase.harai.sweepDurationS, tickAccumulatorS: 0, damageMult };
  }
  const sweepResult = stepHaraiSweep(sweep, dt);
  for (let i = 0; i < sweepResult.ticks; i++) {
    applyHaraiSweepTick(blotPool, brushZ, sweepResult.sweep.damageMult);
  }

  return {
    state: { hane: next.hane, tome: next.tome, harai: next.harai, haraiSweep: sweepResult.sweep },
    fired,
  };
}

export { ALL_STROKE_CLASSES, isBlotStaggered };
