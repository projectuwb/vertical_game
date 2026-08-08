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
  setLineCount,
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
  resolveProjectileSealCollisions,
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
import { createPhraseState, stepPhrases, type PhraseState } from './phrases.js';
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
import {
  createSealEncounter,
  stepSealEncounter,
  type SealDefinition,
  type SealEncounterState,
} from './seals/framework.js';
import { SMEAR_SEAL_DEFINITION } from './seals/smear.js';
import { PRESS_SEAL_DEFINITION } from './seals/press.js';
import { BLANK_SEAL_DEFINITION } from './seals/blank.js';
import { computeUpgradeEffects, NO_UPGRADES, type UpgradeEffects } from './upgradeEffects.js';
import type { InkstoneTrackId } from './config.js';
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

export type DeathCause = 'blot' | 'gate' | 'sealstack' | 'seal';

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
  nextSealAtTimeS: number;

  mercy: MercyState;
  currentGatePair: GatePair | null;
  gatePairZ: number;

  /** Null when no Seal encounter (approach or fight) is in progress. `sealDefinition`
   *  carries the active boss's attack logic alongside it — a `SealEncounterState` is
   *  plain data (so it can be reassigned immutably like every other World field), but
   *  stepping it needs the definition's functions too, so they travel together. Task
   *  3.1 only starts one via `startSealEncounter` (a debug hook); real Director-driven
   *  cadence is Task 3.5. */
  seal: SealEncounterState | null;
  sealDefinition: SealDefinition | null;
  sealsBroken: number;
  /** The Blank's erasure beam (GAME_DESIGN.md §8.2): while `timeS < growthErasedUntilS`,
   *  new Slip runs are suppressed — set alongside clearing the Slip pool and the current
   *  Gate pair the instant a beam resolves. 0 outside of that window, same "quiescent
   *  zero" shape every other `next*AtDistanceU`/`*RemainingS` field in World already
   *  uses. */
  growthErasedUntilS: number;

  wetness: WetnessState;
  flourish: FlourishState;
  phrase: PhraseState;
  /** input.holding from the previous step — flourish.ts's charge/release state machine
   *  is edge-triggered (a hold *starting*, a hold *ending*), so it needs this to detect
   *  the transition rather than just the current value. */
  previousHolding: boolean;

  blotKilled: number;
  /** Highest `line.strokes.length` has ever reached this Passage — GAME_DESIGN.md §10's
   *  run-summary "peak Line" stat. Tracked on World itself (rather than externally, as
   *  the harness used to) so both the harness and the real run-summary display (Task
   *  2.11) read the same single source of truth. */
  peakLineCount: number;

  isDead: boolean;
  deathCause: DeathCause | null;

  /** Computed once at `createWorld` from the Inkstone levels a Passage started with
   *  (Task 4.2) — `BALANCE` itself stays frozen, so every /sim call site that needs an
   *  upgrade-adjusted value reads it from here rather than re-deriving from raw levels
   *  every step. */
  readonly upgradeEffects: UpgradeEffects;
  /** Second Draft (GAME_DESIGN.md §10: "Levels 1/4/8 grant a revive at 35% of peak
   *  Line"). Seeded from `upgradeEffects.reviveThresholdsMet` and decremented each time
   *  `killLineIfEmpty` actually uses one — unlike `upgradeEffects`, this genuinely
   *  changes over the course of a Passage. */
  revivesRemaining: number;
}

/** `upgradeLevels` defaults to zero everywhere (`NO_UPGRADES`) — every existing caller
 *  (the harness, main.ts before Task 4.3's screens wire a real Profile in, every test)
 *  keeps behaving exactly as before without passing anything. */
export function createWorld(
  seed: number,
  upgradeLevels: Readonly<Record<InkstoneTrackId, number>> = NO_UPGRADES,
): World {
  const rng = new RngRegistry(seed);
  const upgradeEffects = computeUpgradeEffects(upgradeLevels);
  const startCount = BALANCE.line.startCount + upgradeEffects.startingStrokeBonus;
  const wetnessCap = BALANCE.wetness.max + upgradeEffects.wetnessCapBonus;
  return {
    rng,
    line: createLine(startCount, 'hane'),
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
    nextSealAtTimeS: BALANCE.seals.arcadeCadenceS,

    mercy: createMercyState(),
    currentGatePair: null,
    gatePairZ: 0,

    seal: null,
    sealDefinition: null,
    sealsBroken: 0,
    growthErasedUntilS: 0,

    wetness: createWetnessState(wetnessCap),
    flourish: createFlourishState(),
    phrase: createPhraseState(),
    previousHolding: false,

    blotKilled: 0,
    peakLineCount: startCount,

    isDead: false,
    deathCause: null,

    upgradeEffects,
    revivesRemaining: upgradeEffects.reviveThresholdsMet,
  };
}

function jitteredInterval(rng: RngRegistry, base: number): number {
  const delta = base * BALANCE.director.intervalJitterFraction;
  return base + rng.range('director', -delta, delta);
}

/** Starts a Seal encounter — its own approach, phases, and HP, per `definition`.
 *  Overwrites any encounter already in progress; callers are responsible for not doing
 *  that mid-fight. Exported directly for main.ts's debug keys and tests; the real
 *  Director-driven arcade cadence (`maybeStartSealEncounter` below) also calls through
 *  it rather than duplicating the assignment. */
export function startSealEncounter(world: World, sealIndex: number, definition: SealDefinition): void {
  world.seal = createSealEncounter(sealIndex, definition);
  world.sealDefinition = definition;
}

/** `BALANCE.seals.order`'s string names, resolved to their actual `SealDefinition`s and
 *  laid out as a fixed-length tuple in the same sequence — the one place the cycling
 *  order and the concrete boss modules meet. A tuple (not a plain array) so indexing it
 *  with a literal, like the `[0]` fallback below, is fully typed with no non-null
 *  assertion (TECH_SPEC.md §13 restricts those to pool internals). */
const SEAL_DEFINITIONS_BY_NAME: Record<(typeof BALANCE.seals.order)[number], SealDefinition> = {
  smear: SMEAR_SEAL_DEFINITION,
  press: PRESS_SEAL_DEFINITION,
  blank: BLANK_SEAL_DEFINITION,
};
const SEAL_CYCLE: readonly [SealDefinition, SealDefinition, SealDefinition] = [
  SEAL_DEFINITIONS_BY_NAME[BALANCE.seals.order[0]],
  SEAL_DEFINITIONS_BY_NAME[BALANCE.seals.order[1]],
  SEAL_DEFINITIONS_BY_NAME[BALANCE.seals.order[2]],
];

/**
 * GAME_DESIGN.md §8.2: a Seal appears "in the arcade loop every 75s of Passage time,"
 * cycling through `BALANCE.seals.order` with an increasing index (§8.2's HP formula is
 * itself `sealIndex`-driven). `world.sealsBroken` already counts exactly that — how
 * many Seals this Passage has broken — so it doubles as both "which name is next in the
 * cycle" and "how strong the next one is," with no separate counter needed. Checked
 * only while `world.seal === null` (an encounter can't overlap another) and only once
 * per threshold crossing, same "just re-checks next time" shape every other Director
 * cadence in this file already uses — a fight that runs long doesn't make the next one
 * fire in a burst, it simply starts the moment this check next sees the time has passed.
 */
function maybeStartSealEncounter(world: World): void {
  if (world.seal !== null) return;
  if (world.timeS < world.nextSealAtTimeS) return;

  const definition = SEAL_CYCLE[world.sealsBroken % SEAL_CYCLE.length] ?? SEAL_CYCLE[0];
  startSealEncounter(world, world.sealsBroken, definition);
  world.nextSealAtTimeS = world.timeS + BALANCE.seals.arcadeCadenceS;
}

/** World-space z the Seal currently sits at: closing smoothly from the normal
 *  wave-spawn distance down to `engagementZU` across the whole approach ("a vertical
 *  seal-mark rises in the distance," GAME_DESIGN.md §8.2), then holding there for the
 *  fight — a Seal doesn't march in like a Blot once it's actually fighting. Exported so
 *  render (which needs the identical position) never computes this separately. */
export function computeSealZ(seal: SealEncounterState): number {
  if (seal.status !== 'approaching') return BALANCE.seals.engagementZU;
  const t = seal.approachRemainingS / BALANCE.seals.approachTelegraphS;
  return BALANCE.seals.engagementZU + (BALANCE.director.spawnDistanceU - BALANCE.seals.engagementZU) * t;
}

/** Lane-centred — the Seal is a stationary central presence during the fight, not
 *  something that follows the Brush. Exported so render (which needs the identical
 *  position) never computes this separately. */
export const SEAL_X = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The Line hitting 0 normally ends the Passage — unless Second Draft has a revive left
 * (GAME_DESIGN.md §10: "Levels 1/4/8 grant a revive at 35% of peak Line," Task 4.2),
 * in which case it's spent here instead: the Line refills to `revivePeakFraction` of
 * its own peak size (never its *current* target, which is 0) and the Passage carries
 * on under whichever `cause` would otherwise have ended it. Refilled with Hane, the
 * same class every Passage starts with — GAME_DESIGN.md doesn't specify a revived
 * Line's class, logged in DECISIONS.md.
 */
function killLineIfEmpty(world: World, cause: DeathCause): void {
  if (world.isDead || world.line.strokes.length > 0) return;

  if (world.revivesRemaining > 0) {
    world.revivesRemaining--;
    const reviveCount = Math.ceil(world.peakLineCount * BALANCE.inkstone.secondDraft.revivePeakFraction);
    world.line = setLineCount(world.line, reviveCount, 'hane');
    return;
  }

  world.isDead = true;
  world.deathCause = cause;
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
    world.upgradeEffects.flourishCooldownS,
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
  const wetnessCap = BALANCE.wetness.max + world.upgradeEffects.wetnessCapBonus;
  if (!input.holding) {
    const dryMultiplier = isWetnessDry(world.wetness) ? BALANCE.wetness.dryFireRateMult : 1;
    const rateMultiplier = dryMultiplier * world.upgradeEffects.fireRateMultiplier;
    updateFiring(
      world.firingAccumulators,
      world.projectilePool,
      dtFixed,
      front,
      back,
      sources,
      rateMultiplier,
      world.upgradeEffects.damageMultiplier,
      world.upgradeEffects.rangeMultiplier,
    );
  }
  updateProjectileMotion(world.projectilePool, dtFixed);

  const isFiring = !input.holding && world.line.strokes.length > 0;
  world.wetness = stepWetness(world.wetness, dtFixed, isFiring, wetnessCap);

  // Phrases (GAME_DESIGN.md §4) run off the same front-row counts firing just used, and
  // — like Flourish's sweep — before this step's own resolveBlotDeaths, so a Phrase
  // kill is counted exactly like any other, not deferred to next step.
  const phraseResult = stepPhrases(world.phrase, dtFixed, world.timeS, front, world.blotPool, brushX, BRUSH_Z);
  world.phrase = phraseResult.state;

  const lobsLanded = updateBlotMotion(world.blotPool, dtFixed, BRUSH_Z, world.timeS);
  resolveProjectileBlotCollisions(world.projectilePool, world.blotPool);
  world.blotKilled += resolveBlotDeaths(world.blotPool);
  const strokesLostToContact = resolveLineContact(world.blotPool, BRUSH_Z);
  const blotStrokesLost = lobsLanded + strokesLostToContact;
  if (blotStrokesLost > 0) {
    world.line = removeStrokesFromFront(world.line, blotStrokesLost);
    killLineIfEmpty(world, 'blot');
  }

  updateSlipMotion(world.slipPool, dtFixed);
  resolveProjectileSlipCollisions(world.projectilePool, world.slipPool, world.upgradeEffects.slipDamageMultiplier);
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

  if (world.seal !== null && world.sealDefinition !== null) {
    const sealZ = computeSealZ(world.seal);
    world.seal = resolveProjectileSealCollisions(world.projectilePool, world.seal, SEAL_X, sealZ);

    const sealCtx = {
      dt: dtFixed,
      timeS: world.timeS,
      brushX,
      brushZ: BRUSH_Z,
      rng: world.rng,
      blotPool: world.blotPool,
    };
    const sealStep = stepSealEncounter(world.seal, world.sealDefinition, sealCtx);
    world.seal = sealStep.seal;
    if (sealStep.strokesLost > 0) {
      world.line = removeStrokesFromFront(world.line, sealStep.strokesLost);
      killLineIfEmpty(world, 'seal');
    }
    if (sealStep.growthEraseS !== undefined && sealStep.growthEraseS > 0) {
      for (let i = world.slipPool.activeCount - 1; i >= 0; i--) {
        world.slipPool.release(world.slipPool.get(i));
      }
      world.currentGatePair = null;
      world.growthErasedUntilS = world.timeS + sealStep.growthEraseS;
    }

    if (world.seal.status === 'broken') {
      world.sealsBroken++;
      world.seal = null;
      world.sealDefinition = null;
    }
  }

  updateInkPoolMotion(world.inkPoolPool, dtFixed);
  world.wetness = resolveInkPoolContact(world.inkPoolPool, world.wetness, brushX, BRUSH_Z, wetnessCap);

  if (world.line.strokes.length > world.peakLineCount) {
    world.peakLineCount = world.line.strokes.length;
  }

  if (world.isDead) return; // no point directing more content at a Passage that's over

  world.mercy = updateMercyState(world.mercy, world.timeS, world.line.strokes.length);
  const mercyActive = isMercyActive(world.mercy, world.timeS);
  const pressure = computePressure(world.timeS, world.line.strokes.length);

  maybeStartSealEncounter(world);

  // GAME_DESIGN.md §8.2: "Seals do not block Slips — Slip runs continue during the
  // fight." Everything else the Director throws (Blot waves, Gates, Sealstacks) pauses
  // while an encounter (approach or fight) is in progress — the fight is what the
  // player's attention belongs to. `nextWaveAtTimeS` etc. simply stop being checked
  // rather than being advanced, so nothing "catches up" in a burst once the Seal ends —
  // the next wave/Gate/Sealstack just spawns as soon as its (already-passed) threshold
  // is checked again, exactly once.
  if (world.seal === null) {
    if (world.timeS >= world.nextWaveAtTimeS) {
      spawnWave(world, pressure, mercyActive);
      world.nextWaveAtTimeS = world.timeS + computeWaveIntervalS(world.timeS);
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
  }

  if (world.distanceU >= world.nextSlipBudgetAtDistanceU && world.timeS >= world.growthErasedUntilS) {
    spawnSlipRun(world, pressure, mercyActive);
    world.nextSlipBudgetAtDistanceU = world.distanceU + BALANCE.director.slipBudget.perU;
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

