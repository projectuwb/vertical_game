// Root simulation state (Task 2.7). Composes every subsystem built in Phase 2 into one
// steppable World, so the balance harness (src/balance/harness.ts) — which imports only
// /sim and /meta, per TECH_SPEC.md §6 — has a single entry point that's exactly the same
// simulation the real game runs. Like the pools it contains, World is mutated in place
// by stepWorld(); recreating it every step would defeat the entire point of pooling.

import { RngRegistry } from '../core/rng.js';
import { BALANCE } from './config.js';
import {
  addStroke,
  computeFormationSlot,
  computeFrontRowSourcePositions,
  computeRowClassCounts,
  createLine,
  removeStrokesFromFront,
  stepCriticallyDamped,
  type ClassCounts,
  type DampedFollower1D,
  type LineState,
} from './line.js';
import {
  createFiringAccumulators,
  createProjectilePool,
  updateFiring,
  updateProjectileMotion,
  type FiringAccumulators,
  type Projectile,
} from './projectiles.js';
import {
  createBlotPool,
  resolveBlotDeaths,
  resolveLineContact,
  spawnBlot,
  updateBlotMotion,
  type Blot,
} from './blot.js';
import {
  createJoiningRecruitPool,
  createSlipPool,
  pickSlipClass,
  resolveMissedSlips,
  resolveSlipDeaths,
  spawnSlip,
  updateJoiningRecruits,
  updateSlipMotion,
  type JoiningRecruit,
  type Slip,
} from './slips.js';
import {
  createSealstackPool,
  resolveSealstackContact,
  resolveSealstackDeaths,
  spawnSealstack,
  updateSealstackMotion,
  type Sealstack,
} from './sealstacks.js';
import {
  applyGateEffect,
  createTemperState,
  generateGatePair,
  resolveGatePairContact,
  type GatePair,
  type TemperState,
} from './gates.js';
import {
  resolveProjectileBlotCollisions,
  resolveProjectileSealstackCollisions,
  resolveProjectileSlipCollisions,
} from './collision.js';
import {
  createInkPoolPool,
  createWetnessState,
  isWetnessDry,
  resolveInkPoolContact,
  spawnInkPool,
  spendWetness,
  stepWetness,
  updateInkPoolMotion,
  type InkPool,
  type WetnessState,
} from './wetness.js';
import {
  applyFlourishSweep,
  createFlourishState,
  stepFlourishInput,
  type FlourishState,
} from './flourish.js';
import {
  computeComposition,
  computeSlipBudgetPer100U,
  computePressure,
  computeWaveIntervalS,
  computeWaveSize,
  createMercyState,
  isMercyActive,
  pickBlotClass,
  planSlipSpawn,
  updateMercyState,
  type MercyState,
} from './director.js';
import type { Pool } from '../core/pool.js';

/** The Brush's fixed world-space depth — the world scrolls past it, not the other way
 *  round (see any of Tasks 2.2-2.6's "static road furniture" motion functions). */
const BRUSH_Z = 0;

/** Structurally identical to platform/input.ts's InputFrame minus dtFixed (World takes
 *  that as stepWorld's own parameter) — /sim can't import /platform, so this is its own
 *  copy of the shape, not a re-export. */
export interface WorldInput {
  readonly lateralDelta: number;
  readonly holding: boolean;
}

export type DeathCause = 'blot' | 'gate' | 'sealstack';

export interface World {
  readonly rng: RngRegistry;
  line: LineState;
  temper: TemperState;

  readonly projectilePool: Pool<Projectile>;
  readonly firingAccumulators: FiringAccumulators;
  readonly blotPool: Pool<Blot>;
  readonly slipPool: Pool<Slip>;
  readonly joiningRecruitPool: Pool<JoiningRecruit>;
  readonly sealstackPool: Pool<Sealstack>;
  readonly inkPoolPool: Pool<InkPool>;

  brushTargetX: number;
  brushFollower: DampedFollower1D;

  timeS: number;
  distanceU: number;

  nextWaveAtTimeS: number;
  nextSlipBudgetAtDistanceU: number;
  nextGateAtDistanceU: number;
  nextSealstackAtDistanceU: number;
  nextInkPoolAtDistanceU: number;

  mercy: MercyState;
  currentGatePair: GatePair | null;
  gatePairZ: number;

  wetness: WetnessState;
  flourish: FlourishState;
  /** input.holding from the previous step — flourish.ts's charge/release state machine
   *  is edge-triggered (a hold *starting*, a hold *ending*), so it needs this to detect
   *  the transition rather than just the current value. */
  previousHolding: boolean;

  blotKilled: number;

  isDead: boolean;
  deathCause: DeathCause | null;
}

export function createWorld(seed: number): World {
  const rng = new RngRegistry(seed);
  return {
    rng,
    line: createLine(BALANCE.line.startCount, 'hane'),
    temper: createTemperState(),

    projectilePool: createProjectilePool(),
    firingAccumulators: createFiringAccumulators(),
    blotPool: createBlotPool(),
    slipPool: createSlipPool(),
    joiningRecruitPool: createJoiningRecruitPool(),
    sealstackPool: createSealstackPool(),
    inkPoolPool: createInkPoolPool(),

    brushTargetX: 0,
    brushFollower: { position: 0, velocity: 0 },

    timeS: 0,
    distanceU: 0,

    nextWaveAtTimeS: computeWaveIntervalS(0),
    nextSlipBudgetAtDistanceU: BALANCE.director.slipBudget.perU,
    nextGateAtDistanceU: jitteredInterval(rng, BALANCE.gates.pairIntervalU),
    nextSealstackAtDistanceU: jitteredInterval(rng, BALANCE.director.sealstackIntervalU),
    nextInkPoolAtDistanceU: jitteredInterval(rng, BALANCE.wetness.poolSpacingU),

    mercy: createMercyState(),
    currentGatePair: null,
    gatePairZ: 0,

    wetness: createWetnessState(),
    flourish: createFlourishState(),
    previousHolding: false,

    blotKilled: 0,

    isDead: false,
    deathCause: null,
  };
}

function jitteredInterval(rng: RngRegistry, base: number): number {
  const delta = base * BALANCE.director.intervalJitterFraction;
  return base + rng.range('director', -delta, delta);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function killLineIfEmpty(world: World, cause: DeathCause): void {
  if (!world.isDead && world.line.strokes.length === 0) {
    world.isDead = true;
    world.deathCause = cause;
  }
}

export function stepWorld(world: World, dtFixed: number, input: WorldInput): void {
  if (world.isDead) return;

  world.timeS += dtFixed;
  const distanceStep = BALANCE.forwardSpeed.baseUPerS * dtFixed;
  world.distanceU += distanceStep;

  world.brushTargetX = clamp(
    world.brushTargetX + input.lateralDelta,
    -BALANCE.lane.brushClampX,
    BALANCE.lane.brushClampX,
  );
  world.brushFollower = stepCriticallyDamped(
    world.brushFollower,
    world.brushTargetX,
    dtFixed,
    BALANCE.control.dampingTimeConstantS,
  );
  const brushX = clamp(world.brushFollower.position, -BALANCE.lane.brushClampX, BALANCE.lane.brushClampX);

  // Flourish (GAME_DESIGN.md §6) runs before firing/combat this step: holding suspends
  // the normal auto-fire entirely ("Wetness converts the always-firing default into an
  // occasional decision to stop"), and a triggered sweep's damage needs to land before
  // this step's own resolveBlotDeaths so a Flourish kill is counted exactly like any
  // other — not deferred to next step.
  const flourishResult = stepFlourishInput(
    world.flourish,
    world.timeS,
    input.holding,
    world.previousHolding,
    world.wetness.current,
  );
  world.flourish = flourishResult.state;
  if (flourishResult.triggered) {
    world.wetness = spendWetness(world.wetness, BALANCE.flourish.cost);
    const rowCount = Math.ceil(world.line.strokes.length / BALANCE.line.rowSize);
    applyFlourishSweep(world.blotPool, brushX, BRUSH_Z, rowCount);
  }
  world.previousHolding = input.holding;

  const { front, back } = computeRowClassCounts(world.line);
  const sources = computeFrontRowSourcePositions(world.line, brushX, BRUSH_Z);
  if (!input.holding) {
    const rateMultiplier = isWetnessDry(world.wetness) ? BALANCE.wetness.dryFireRateMult : 1;
    updateFiring(world.firingAccumulators, world.projectilePool, dtFixed, front, back, sources, rateMultiplier);
  }
  updateProjectileMotion(world.projectilePool, dtFixed);

  const isFiring = !input.holding && world.line.strokes.length > 0;
  world.wetness = stepWetness(world.wetness, dtFixed, isFiring);

  const lobsLanded = updateBlotMotion(world.blotPool, dtFixed, BRUSH_Z);
  resolveProjectileBlotCollisions(world.projectilePool, world.blotPool);
  world.blotKilled += resolveBlotDeaths(world.blotPool);
  const strokesLostToContact = resolveLineContact(world.blotPool, BRUSH_Z);
  const blotStrokesLost = lobsLanded + strokesLostToContact;
  if (blotStrokesLost > 0) {
    world.line = removeStrokesFromFront(world.line, blotStrokesLost);
    killLineIfEmpty(world, 'blot');
  }

  updateSlipMotion(world.slipPool, dtFixed);
  resolveProjectileSlipCollisions(world.projectilePool, world.slipPool);
  const backSlot = computeFormationSlot(world.line.strokes.length);
  resolveSlipDeaths(world.slipPool, world.joiningRecruitPool, {
    x: brushX + backSlot.lateralOffset,
    z: BRUSH_Z + backSlot.depthOffset,
  });
  resolveMissedSlips(world.slipPool, BRUSH_Z);
  for (const cls of updateJoiningRecruits(world.joiningRecruitPool, dtFixed)) {
    world.line = addStroke(world.line, cls);
  }

  if (world.currentGatePair !== null) {
    world.gatePairZ -= distanceStep;
    if (world.gatePairZ <= BRUSH_Z) {
      const chosenGate = resolveGatePairContact(world.currentGatePair, brushX);
      const resolution = applyGateEffect(world.line, world.temper, chosenGate.effect);
      world.line = resolution.line;
      world.temper = resolution.temper;
      world.currentGatePair = null;
      killLineIfEmpty(world, 'gate');
    }
  }

  updateSealstackMotion(world.sealstackPool, dtFixed);
  resolveProjectileSealstackCollisions(world.projectilePool, world.sealstackPool);
  resolveSealstackDeaths(world.sealstackPool);
  const strokesLostToSealstack = resolveSealstackContact(world.sealstackPool, BRUSH_Z, brushX);
  if (strokesLostToSealstack > 0) {
    world.line = removeStrokesFromFront(world.line, strokesLostToSealstack);
    killLineIfEmpty(world, 'sealstack');
  }

  updateInkPoolMotion(world.inkPoolPool, dtFixed);
  world.wetness = resolveInkPoolContact(world.inkPoolPool, world.wetness, brushX, BRUSH_Z);

  if (world.isDead) return; // no point directing more content at a Passage that's over

  world.mercy = updateMercyState(world.mercy, world.timeS, world.line.strokes.length);
  const mercyActive = isMercyActive(world.mercy, world.timeS);
  const pressure = computePressure(world.timeS, world.line.strokes.length);

  if (world.timeS >= world.nextWaveAtTimeS) {
    spawnWave(world, pressure, mercyActive);
    world.nextWaveAtTimeS = world.timeS + computeWaveIntervalS(world.timeS);
  }

  if (world.distanceU >= world.nextSlipBudgetAtDistanceU) {
    spawnSlipRun(world, pressure, mercyActive);
    world.nextSlipBudgetAtDistanceU = world.distanceU + BALANCE.director.slipBudget.perU;
  }

  if (world.currentGatePair === null && world.distanceU >= world.nextGateAtDistanceU) {
    world.currentGatePair = generateGatePair(world.rng);
    world.gatePairZ = BRUSH_Z + BALANCE.director.spawnDistanceU;
    world.nextGateAtDistanceU = world.distanceU + jitteredInterval(world.rng, BALANCE.gates.pairIntervalU);
  }

  if (world.distanceU >= world.nextSealstackAtDistanceU) {
    const side = world.rng.chance('director', BALANCE.gates.fiftyFifty) ? 'left' : 'right';
    spawnSealstack(world.sealstackPool, side, BRUSH_Z + BALANCE.director.spawnDistanceU);
    world.nextSealstackAtDistanceU =
      world.distanceU + jitteredInterval(world.rng, BALANCE.director.sealstackIntervalU);
  }

  if (world.distanceU >= world.nextInkPoolAtDistanceU) {
    const half = BALANCE.lane.halfWidth * BALANCE.wetness.poolLateralRangeFraction;
    const x = world.rng.range('director', -half, half);
    spawnInkPool(world.inkPoolPool, x, BRUSH_Z + BALANCE.director.spawnDistanceU);
    world.nextInkPoolAtDistanceU = world.distanceU + jitteredInterval(world.rng, BALANCE.wetness.poolSpacingU);
  }
}

function spawnWave(world: World, pressure: number, mercyActive: boolean): void {
  const lineCount = world.line.strokes.length;
  const size = computeWaveSize(pressure, lineCount);
  const weights = computeComposition(pressure, lineCount, mercyActive);
  const baseZ = BRUSH_Z + BALANCE.director.spawnDistanceU;
  for (let i = 0; i < size; i++) {
    const cls = pickBlotClass(weights, world.rng);
    const x = world.rng.range('director', -BALANCE.lane.halfWidth, BALANCE.lane.halfWidth);
    const z = baseZ + world.rng.range('director', 0, BALANCE.director.waveScatterDepthU);
    spawnBlot(world.blotPool, cls, x, z);
  }
}

function spawnSlipRun(world: World, pressure: number, mercyActive: boolean): void {
  const budget = computeSlipBudgetPer100U(pressure, mercyActive);
  const plan = planSlipSpawn(budget, world.rng);
  const { front, back } = computeRowClassCounts(world.line);
  const counts: ClassCounts = {
    hane: front.hane + back.hane,
    tome: front.tome + back.tome,
    harai: front.harai + back.harai,
  };
  const cls = pickSlipClass(counts, world.rng);
  const verge = world.rng.chance('director', BALANCE.gates.fiftyFifty) ? -1 : 1;
  const x = verge * BALANCE.lane.halfWidth * BALANCE.slips.vergeOffsetFraction;
  const baseZ = BRUSH_Z + BALANCE.director.spawnDistanceU;
  const spacing = BALANCE.slips.runZSpacingU;

  if (plan.kind === 'plusTwentyFive') {
    // "+25 Banner... always at the end of a Slip run" (GAME_DESIGN.md §7.1): lead with
    // a short +1 run, cap it with the Banner.
    const leadCount = BALANCE.slips.plusOne.runMin;
    for (let i = 0; i < leadCount; i++) {
      spawnSlip(world.slipPool, 'plusOne', cls, x, baseZ + i * spacing);
    }
    spawnSlip(world.slipPool, 'plusTwentyFive', cls, x, baseZ + leadCount * spacing);
    return;
  }

  for (let i = 0; i < plan.count; i++) {
    spawnSlip(world.slipPool, plan.kind, cls, x, baseZ + i * spacing);
  }
}

/**
 * GAME_DESIGN.md §10: `blotKilled × 1 + floor(distance / 8) + sealsBroken × 120`, before
 * the Leaf upgrade multiplier (Task 4.2 — Seals don't exist until Phase 3 either, so
 * that term is always 0 for now). Lives here rather than /meta/economy.ts until Task
 * 4.2 actually builds the upgrade system this formula's last step depends on.
 */
export function computeGoldLeaf(blotKilled: number, distanceU: number, sealsBroken: number): number {
  const e = BALANCE.economy;
  return (
    blotKilled * e.goldLeafPerBlotKilled +
    Math.floor(distanceU / e.goldLeafPerDistanceU) +
    sealsBroken * e.goldLeafPerSealBroken
  );
}
