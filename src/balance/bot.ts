// Bot strategies for the harness (Task 2.7, TECH_SPEC.md §6). Each strategy is a pure
// function of World + a per-run BotState → the same WorldInput shape a real player's
// InputSampler would produce, so `stepWorld` never has to know it's driving a bot instead
// of a human. These are the harness's "measuring instrument" — deliberately simple,
// legible heuristics, not an AI trying to play well; tuning them is not itself a Task
// 2.7 goal, and the numbers here (cluster window, threat radius, etc.) are bot-behaviour
// choices rather than GAME_DESIGN.md balance numbers, so they don't live in
// `/sim/config.ts` and aren't subject to its no-magic-number rule.

import { deriveSeed, mulberry32 } from '../core/rng.js';
import { BALANCE } from '../sim/config.js';
import type { ArithmeticOp, Gate, GatePair } from '../sim/gates.js';
import type { World, WorldInput } from '../sim/world.js';

export type BotStrategy = 'greedy-slips' | 'greedy-kill' | 'mixed' | 'gates' | 'random';

export const ALL_BOT_STRATEGIES: readonly BotStrategy[] = [
  'greedy-slips',
  'greedy-kill',
  'mixed',
  'gates',
  'random',
];

/** Per-Passage bot state. Only `random` needs anything — a fixed phase so its wander is
 *  deterministic for a given seed without threading a live RNG stream through every step. */
export interface BotState {
  readonly randomPhase: number;
}

export function createBotState(seed: number): BotState {
  const rng = mulberry32(deriveSeed(seed, 'bot'));
  return { randomPhase: rng() * Math.PI * 2 };
}

const KEYBOARD_LATERAL_SPEED = BALANCE.control.keyboardUPerS;

/** Moves at most `maxDeltaU` from `current` toward `target` — the same "hold a direction
 *  key" model real keyboard input uses (platform/input.ts), so a bot's control authority
 *  matches a human's exactly rather than teleporting the aim point. */
function stepToward(current: number, target: number, maxDeltaU: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDeltaU) return diff;
  return Math.sign(diff) * maxDeltaU;
}

// --- Target-x selection, one per strategy's "what am I aiming at" question ---

/** A Blot counts as an immediate threat once it's this close to the Brush — matches
 *  TECH_SPEC.md §6's `greedy-slips` spec text verbatim ("within 6u"). */
const SLIP_STRATEGY_THREAT_RADIUS_U = 6;

function findNearestBlotWithin(world: World, radiusU: number): number | null {
  let nearestZ = Infinity;
  let nearestX: number | null = null;
  world.blotPool.forEachActive((b) => {
    if (b.z <= radiusU && b.z < nearestZ) {
      nearestZ = b.z;
      nearestX = b.x;
    }
  });
  return nearestX;
}

function findNearestSlipX(world: World): number | null {
  let nearestZ = Infinity;
  let nearestX: number | null = null;
  world.slipPool.forEachActive((s) => {
    if (s.hp > 0 && s.z < nearestZ) {
      nearestZ = s.z;
      nearestX = s.x;
    }
  });
  return nearestX;
}

/** The x of the densest cluster of active Blot, found with a sliding window over the
 *  sorted x positions (a plain O(n log n) scan — trivial at harness scale). Returns
 *  null when there's nothing to shoot at. */
const CLUSTER_WINDOW_U = 3;

function findDensestBlotClusterX(world: World): number | null {
  const xs: number[] = [];
  world.blotPool.forEachActive((b) => xs.push(b.x));
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);

  let bestStart = 0;
  let bestCount = 0;
  let windowStart = 0;
  for (let i = 0; i < xs.length; i++) {
    const xi = xs[i] as number;
    while (xi - (xs[windowStart] as number) > CLUSTER_WINDOW_U) windowStart++;
    const count = i - windowStart + 1;
    if (count > bestCount) {
      bestCount = count;
      bestStart = windowStart;
    }
  }

  let sum = 0;
  for (let i = bestStart; i < bestStart + bestCount; i++) sum += xs[i] as number;
  return sum / bestCount;
}

function decideGreedySlipsTargetX(world: World): number {
  const threat = findNearestBlotWithin(world, SLIP_STRATEGY_THREAT_RADIUS_U);
  if (threat !== null) return threat;
  return findNearestSlipX(world) ?? 0;
}

function decideGreedyKillTargetX(world: World): number {
  return findDensestBlotClusterX(world) ?? findNearestSlipX(world) ?? 0;
}

/** TECH_SPEC.md §6: "targets Slips unless projected Blot arrivals in the next
 *  `PROJECTION_WINDOW_S` exceed current N × `ARRIVAL_N_FRACTION`." */
const PROJECTION_WINDOW_S = 2;
const ARRIVAL_N_FRACTION = 0.4;

function countProjectedArrivals(world: World): number {
  let count = 0;
  world.blotPool.forEachActive((b) => {
    // Blotter stops short and lobs rather than reaching contact — it never "arrives".
    if (b.class === 'blotter') return;
    const etaS = b.z / BALANCE.blot[b.class].speedUPerS;
    if (etaS <= PROJECTION_WINDOW_S) count++;
  });
  return count;
}

function decideMixedTargetX(world: World): number {
  const arrivals = countProjectedArrivals(world);
  if (arrivals > world.line.strokes.length * ARRIVAL_N_FRACTION) {
    return decideGreedyKillTargetX(world);
  }
  return decideGreedySlipsTargetX(world);
}

// --- `gates`: mixed's targeting, plus steering to the better half of an inbound pair ---

const GOOD_ARITHMETIC_OPS: readonly ArithmeticOp[] = ['mul2', 'mul3', 'addTwelve', 'addTwentyFive'];
const BAD_ARITHMETIC_OPS: readonly ArithmeticOp[] = ['subTen', 'divTwo'];

/** Fractional change to the Line's count this op would produce right now — comparable
 *  across the additive and multiplicative ops alike because it's normalised by the
 *  Line's *current* size, exactly the quantity a player actually cares about. */
function arithmeticFractionalDelta(op: ArithmeticOp, lineCount: number): number {
  const a = BALANCE.gates.arithmetic;
  const current = Math.max(lineCount, 1);
  let target: number;
  switch (op) {
    case 'mul2':
      target = current * a.mul2;
      break;
    case 'mul3':
      target = current * a.mul3;
      break;
    case 'addTwelve':
      target = current + a.addTwelve;
      break;
    case 'addTwentyFive':
      target = current + a.addTwentyFive;
      break;
    case 'subTen':
      target = current + a.subTen;
      break;
    case 'divTwo':
      target = current * a.divTwo;
      break;
  }
  return (target - current) / current;
}

/** Temper stacks don't grow the Line, so they're not directly comparable to a fractional
 *  count change — this is a rough "worth about as much as" conversion using the average
 *  of its three genuinely fractional bonuses (rate/range/splash; wetnessCap is a flat
 *  amount in a different unit, so it's left out of the average). */
function temperEquivalentEV(): number {
  const t = BALANCE.gates.temper;
  return (t.rateBonus + t.rangeBonus + t.splashBonus) / 3;
}

/** A visible (non-Sealed) gate's EV is exactly what it does — Sealed's is the expected
 *  value over its reveal table (GAME_DESIGN.md §7.2's known 60/40 odds), never the
 *  concrete rolled effect: a real player can't see through the seal, only reason about
 *  the odds, and evaluating "by expected value" (TECH_SPEC.md §6) means exactly that. */
function estimateGateEV(gate: Gate, lineCount: number): number {
  if (gate.family === 'sealed') return estimateSealedEV(lineCount);
  const effect = gate.effect;
  if (effect.arithmeticOp !== undefined) return arithmeticFractionalDelta(effect.arithmeticOp, lineCount);
  if (effect.temperStat !== undefined) return temperEquivalentEV();
  return 0; // conversion — neither clearly good nor bad on its own
}

function average(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function estimateSealedEV(lineCount: number): number {
  const s = BALANCE.gates.sealed;
  const goodArithmeticAvg = average(GOOD_ARITHMETIC_OPS.map((op) => arithmeticFractionalDelta(op, lineCount)));
  const badArithmeticAvg = average(BAD_ARITHMETIC_OPS.map((op) => arithmeticFractionalDelta(op, lineCount)));
  // makeSealedGate (gates.ts): on the 60%-good branch, a 50/50 split between a good
  // arithmetic op and a Temper stack; the 40%-bad branch is always a bad arithmetic op.
  const goodBranchEV = 0.5 * goodArithmeticAvg + 0.5 * temperEquivalentEV();
  return s.goodChance * goodBranchEV + s.badChance * badArithmeticAvg;
}

/** Left half (x<0) vs right half, matching gates.ts's resolveGatePairContact exactly. */
function decideGatesSideTargetX(pair: GatePair, lineCount: number): number {
  const leftEV = estimateGateEV(pair.left, lineCount);
  const rightEV = estimateGateEV(pair.right, lineCount);
  const side = leftEV >= rightEV ? -1 : 1;
  return side * BALANCE.lane.halfWidth * 0.5;
}

function decideGatesTargetX(world: World): number {
  if (world.currentGatePair !== null) {
    return decideGatesSideTargetX(world.currentGatePair, world.line.strokes.length);
  }
  return decideMixedTargetX(world);
}

// --- `random`: the noise floor. A smooth, seeded wander with no regard for the field at
// all — a stand-in for a player not really looking, not truly per-frame white noise
// (which the critically damped follower would mostly cancel out anyway). ---

const RANDOM_WANDER_HZ = 0.15;
const RANDOM_WANDER_AMPLITUDE_FRACTION = 0.8;

function decideRandomTargetX(world: World, botState: BotState): number {
  const amplitude = BALANCE.lane.halfWidth * RANDOM_WANDER_AMPLITUDE_FRACTION;
  return amplitude * Math.sin(world.timeS * RANDOM_WANDER_HZ * Math.PI * 2 + botState.randomPhase);
}

export function decideInput(
  strategy: BotStrategy,
  world: World,
  dtFixed: number,
  botState: BotState,
): WorldInput {
  let targetX: number;
  switch (strategy) {
    case 'greedy-slips':
      targetX = decideGreedySlipsTargetX(world);
      break;
    case 'greedy-kill':
      targetX = decideGreedyKillTargetX(world);
      break;
    case 'mixed':
      targetX = decideMixedTargetX(world);
      break;
    case 'gates':
      targetX = decideGatesTargetX(world);
      break;
    case 'random':
      targetX = decideRandomTargetX(world, botState);
      break;
  }
  const lateralDelta = stepToward(world.brushTargetX, targetX, KEYBOARD_LATERAL_SPEED * dtFixed);
  // Flourish/Wetness (Task 2.8) isn't wired into stepWorld yet, so `holding` is currently
  // inert either way — left false rather than pretending any strategy has an opinion.
  return { lateralDelta, holding: false };
}
