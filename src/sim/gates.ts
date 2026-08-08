// Gate families + maths (GAME_DESIGN.md §7.2, Task 2.6).

import type { RngRegistry } from '../core/rng.js';
import { BALANCE } from './config.js';
import { setLineCount, type LineState, type LineStroke } from './line.js';
import type { StrokeClass } from './stroke.js';

export type ArithmeticOp = 'mul2' | 'mul3' | 'addTwelve' | 'addTwentyFive' | 'subTen' | 'divTwo';
export type TemperStat = 'rate' | 'range' | 'splash' | 'wetnessCap';
export type GateFamily = 'arithmetic' | 'conversion' | 'temper' | 'sealed';

/**
 * At most one of each field is normally set (a gate is one family's effect) — except a
 * Sealed gate's hidden reveal, which can combine `arithmeticOp` with `conversionTarget`
 * (see DECISIONS.md: it's the only place "multiply before add, conversion after count
 * changes" has any observable meaning).
 */
export interface GateEffect {
  readonly arithmeticOp?: ArithmeticOp;
  readonly conversionTarget?: StrokeClass;
  readonly temperStat?: TemperStat;
}

export interface Gate {
  /** What the player sees before choosing — Sealed hides `effect` behind a seal mark. */
  readonly family: GateFamily;
  readonly effect: GateEffect;
}

export interface GatePair {
  readonly left: Gate;
  readonly right: Gate;
}

const GOOD_ARITHMETIC_OPS: readonly ArithmeticOp[] = ['mul2', 'mul3', 'addTwelve', 'addTwentyFive'];
const BAD_ARITHMETIC_OPS: readonly ArithmeticOp[] = ['subTen', 'divTwo'];
const CONVERSION_TARGETS: readonly StrokeClass[] = ['hane', 'tome', 'harai'];
const TEMPER_STATS: readonly TemperStat[] = ['rate', 'range', 'splash', 'wetnessCap'];
type DilemmaFlavor = 'arithmetic' | 'conversion' | 'temper';
const DILEMMA_FLAVORS: readonly DilemmaFlavor[] = ['arithmetic', 'conversion', 'temper'];

function makeArithmeticGate(op: ArithmeticOp): Gate {
  return { family: 'arithmetic', effect: { arithmeticOp: op } };
}

function makeConversionGate(target: StrokeClass): Gate {
  return { family: 'conversion', effect: { conversionTarget: target } };
}

function makeTemperGate(stat: TemperStat): Gate {
  return { family: 'temper', effect: { temperStat: stat } };
}

function makeSealedGate(rng: RngRegistry): Gate {
  const isGood = rng.chance('gates', BALANCE.gates.sealed.goodChance);
  if (!isGood) {
    return { family: 'sealed', effect: { arithmeticOp: rng.pick('gates', BAD_ARITHMETIC_OPS) } };
  }
  if (rng.chance('gates', BALANCE.gates.fiftyFifty)) {
    return { family: 'sealed', effect: { arithmeticOp: rng.pick('gates', GOOD_ARITHMETIC_OPS) } };
  }
  return { family: 'sealed', effect: { temperStat: rng.pick('gates', TEMPER_STATS) } };
}

function makeGateOfFlavor(flavor: DilemmaFlavor, rng: RngRegistry): Gate {
  if (flavor === 'arithmetic') return makeArithmeticGate(rng.pick('gates', GOOD_ARITHMETIC_OPS));
  if (flavor === 'conversion') return makeConversionGate(rng.pick('gates', CONVERSION_TARGETS));
  return makeTemperGate(rng.pick('gates', TEMPER_STATS));
}

function gatesAreIdentical(a: Gate, b: Gate): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A gate is "known bad" only if its effect is visible to the player and strictly
 *  harmful — a Sealed gate's true nature is hidden, so it's never "known" anything. */
function isKnownBad(gate: Gate): boolean {
  if (gate.family === 'sealed') return false;
  return gate.effect.arithmeticOp !== undefined && BAD_ARITHMETIC_OPS.includes(gate.effect.arithmeticOp);
}

export function isLegalPair(pair: GatePair): boolean {
  if (gatesAreIdentical(pair.left, pair.right)) return false;
  if (isKnownBad(pair.left) && isKnownBad(pair.right)) return false;
  return true;
}

/** A pair is a genuine dilemma if neither side is an obvious "don't pick this" and the
 *  two options aren't the same choice twice (GAME_DESIGN.md §7.2's example: `×2` vs
 *  `→ Tome`) — including a Sealed-vs-known-modest pair, since the gamble itself is the
 *  dilemma ("so taking it is a real gamble"). */
export function isGenuineDilemma(pair: GatePair): boolean {
  return !isKnownBad(pair.left) && !isKnownBad(pair.right) && !gatesAreIdentical(pair.left, pair.right);
}

function orderRandomly(rng: RngRegistry, a: Gate, b: Gate): GatePair {
  return rng.chance('gates', BALANCE.gates.fiftyFifty) ? { left: a, right: b } : { left: b, right: a };
}

function makeDilemmaPair(rng: RngRegistry): GatePair {
  const first = rng.pick('gates', DILEMMA_FLAVORS);
  const second = DILEMMA_FLAVORS[(DILEMMA_FLAVORS.indexOf(first) + 1 + rng.int('gates', 0, 2)) % DILEMMA_FLAVORS.length] as DilemmaFlavor;

  const left = makeGateOfFlavor(first, rng);
  let right = makeGateOfFlavor(second, rng);
  // Different flavours can still coincidentally produce identical gates only if the
  // flavours matched, which they can't here — this guards the edge case anyway.
  let guard = 0;
  while (gatesAreIdentical(left, right) && guard < BALANCE.gates.identicalRetryGuard) {
    right = makeGateOfFlavor(second, rng);
    guard++;
  }
  return orderRandomly(rng, left, right);
}

/**
 * Generates one Gate pair, guaranteeing GAME_DESIGN.md §7.2's rules by construction
 * (never 2 identical, never 2 strictly-bad) rather than by rejection-sampling: each
 * archetype below is individually incapable of violating them.
 *  - 20% Sealed vs a known-modest (good) gate — a real gamble, still a dilemma.
 *  - 30% safety-valve: an obviously-good arithmetic op vs an obviously-bad one.
 *  - 50% genuine dilemma: two attractive-but-different options.
 * Dilemma share is therefore ~70%, comfortably over the "≥1 in 4" floor.
 */
export function generateGatePair(rng: RngRegistry): GatePair {
  const roll = rng.next('gates');

  if (roll < BALANCE.gates.pairArchetype.sealedThreshold) {
    const sealed = makeSealedGate(rng);
    const modest = makeArithmeticGate(rng.pick('gates', GOOD_ARITHMETIC_OPS));
    return orderRandomly(rng, sealed, modest);
  }

  if (roll < BALANCE.gates.pairArchetype.safetyValveThreshold) {
    const good = makeArithmeticGate(rng.pick('gates', GOOD_ARITHMETIC_OPS));
    const bad = makeArithmeticGate(rng.pick('gates', BAD_ARITHMETIC_OPS));
    return orderRandomly(rng, good, bad);
  }

  return makeDilemmaPair(rng);
}

/** Left half of the lane (x < 0) vs right half — GAME_DESIGN.md §7.2: "each spanning half the lane." */
export function resolveGatePairContact(pair: GatePair, brushX: number): Gate {
  return brushX < 0 ? pair.left : pair.right;
}

export interface TemperState {
  readonly rateStacks: number;
  readonly rangeStacks: number;
  readonly splashStacks: number;
  readonly wetnessCapStacks: number;
}

export function createTemperState(): TemperState {
  return { rateStacks: 0, rangeStacks: 0, splashStacks: 0, wetnessCapStacks: 0 };
}

function applyTemperStat(temper: TemperState, stat: TemperStat): TemperState {
  const cap = BALANCE.gates.temper.stackCap;
  switch (stat) {
    case 'rate':
      return { ...temper, rateStacks: Math.min(cap, temper.rateStacks + 1) };
    case 'range':
      return { ...temper, rangeStacks: Math.min(cap, temper.rangeStacks + 1) };
    case 'splash':
      return { ...temper, splashStacks: Math.min(cap, temper.splashStacks + 1) };
    case 'wetnessCap':
      return { ...temper, wetnessCapStacks: Math.min(cap, temper.wetnessCapStacks + 1) };
  }
}

function applyArithmeticOp(line: LineState, op: ArithmeticOp): LineState {
  const current = line.strokes.length;
  const arithmetic = BALANCE.gates.arithmetic;
  let target: number;
  switch (op) {
    case 'mul2':
      target = current * arithmetic.mul2;
      break;
    case 'mul3':
      target = current * arithmetic.mul3;
      break;
    case 'addTwelve':
      target = current + arithmetic.addTwelve;
      break;
    case 'addTwentyFive':
      target = current + arithmetic.addTwentyFive;
      break;
    case 'subTen':
      target = current + arithmetic.subTen; // stored as a negative value
      break;
    case 'divTwo':
      target = current * arithmetic.divTwo; // stored as 0.5
      break;
  }
  const fillClass = (line.strokes[line.strokes.length - 1] as LineStroke | undefined)?.class ?? 'hane';
  return setLineCount(line, Math.round(target), fillClass);
}

function applyConversionTarget(line: LineState, target: StrokeClass): LineState {
  return { strokes: line.strokes.map(() => ({ class: target })) };
}

export interface GateResolution {
  readonly line: LineState;
  readonly temper: TemperState;
}

/**
 * GAME_DESIGN.md §7.2: "multiply before add within a single gate; conversion applies
 * after count changes." Arithmetic always resolves before conversion — if it didn't,
 * strokes added by an arithmetic op processed *after* a conversion would keep their
 * pre-conversion class, breaking "converts the entire Line to that class." Temper never
 * touches the Line, so its ordering relative to the other two doesn't matter.
 */
export function applyGateEffect(
  line: LineState,
  temper: TemperState,
  effect: GateEffect,
): GateResolution {
  let nextLine = line;
  if (effect.arithmeticOp !== undefined) {
    nextLine = applyArithmeticOp(nextLine, effect.arithmeticOp);
  }
  if (effect.conversionTarget !== undefined) {
    nextLine = applyConversionTarget(nextLine, effect.conversionTarget);
  }

  let nextTemper = temper;
  if (effect.temperStat !== undefined) {
    nextTemper = applyTemperStat(nextTemper, effect.temperStat);
  }

  return { line: nextLine, temper: nextTemper };
}
