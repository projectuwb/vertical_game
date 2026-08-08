// The Smear (GAME_DESIGN.md §8.2, Task 3.2) — the first real boss. "Sweeps an arm
// laterally across two thirds of the lane, telegraphed by a 0.9s ink-gathering pull;
// kills Strokes it crosses. Phase 3 adds a trailing residue that must be dodged for 2s."
//
// The arm itself is narrow (`armWidthU`); what "sweeps... across two thirds of the
// lane" is its *total reach* — the span from the leftmost point it ever covers to the
// rightmost, centred on the lane (`sweepReachFraction`, see DECISIONS.md for why this
// isn't the arm's own width). That keeps a stationary position near either lane edge
// safe for an attack's entire duration, which is what "a correct answer that is a
// position, not a reflex" (GAME_DESIGN.md §8.2) actually requires. The residue isn't
// given its own telegraph in GAME_DESIGN.md — it's a continuation of the
// already-telegraphed sweep ("trailing"), not a fresh attack, so it doesn't run through
// startAttack/stepAttack itself.

import { BALANCE } from '../config.js';
import {
  startAttack,
  stepAttack,
  type AttackState,
  type SealBossStepResult,
  type SealDefinition,
  type SealStepContext,
} from './framework.js';

const ARM_WIDTH_U = BALANCE.seals.smear.armWidthU;
const ARM_HALF_WIDTH_U = ARM_WIDTH_U / 2;
const SWEEP_REACH_U = BALANCE.lane.width * BALANCE.seals.smear.sweepReachFraction;
/** How far the arm's centre travels from 0 to either extreme — half the sweep's total
 *  reach, minus the arm's own half-width, so the arm's outer edge (not its centre)
 *  is what reaches the edge of the reach envelope. */
const SWEEP_CENTER_RANGE_U = SWEEP_REACH_U / 2 - ARM_HALF_WIDTH_U;

export type SmearStage = 'telegraph' | 'sweeping' | 'residue';

export interface SmearBossState {
  readonly cooldownS: number;
  readonly stage: SmearStage | null;
  readonly attack: AttackState | null;
  readonly sweepElapsedS: number;
  readonly sweepStartCenterX: number;
  readonly sweepEndCenterX: number;
  readonly hasHitThisSweep: boolean;
  readonly residueElapsedS: number;
  readonly residueCenterX: number;
  readonly hasHitThisResidue: boolean;
}

function createSmearBossState(): SmearBossState {
  return {
    cooldownS: 0,
    stage: null,
    attack: null,
    sweepElapsedS: 0,
    sweepStartCenterX: 0,
    sweepEndCenterX: 0,
    hasHitThisSweep: false,
    residueElapsedS: 0,
    residueCenterX: 0,
    hasHitThisResidue: false,
  };
}

function currentSweepCenterX(state: SmearBossState): number {
  const t = Math.min(1, state.sweepElapsedS / BALANCE.seals.smear.sweepDurationS);
  return state.sweepStartCenterX + (state.sweepEndCenterX - state.sweepStartCenterX) * t;
}

function stepCooldown(state: SmearBossState, ctx: SealStepContext): SealBossStepResult<SmearBossState> {
  const cooldownS = state.cooldownS + ctx.dt;
  if (cooldownS < BALANCE.seals.smear.attackIntervalS) {
    return { bossState: { ...state, cooldownS }, strokesLost: 0 };
  }

  const fromLeft = ctx.rng.chance('seals', BALANCE.gates.fiftyFifty);
  return {
    bossState: {
      ...createSmearBossState(),
      stage: 'telegraph',
      attack: startAttack(BALANCE.seals.smear.gatherPullS),
      sweepStartCenterX: fromLeft ? -SWEEP_CENTER_RANGE_U : SWEEP_CENTER_RANGE_U,
      sweepEndCenterX: fromLeft ? SWEEP_CENTER_RANGE_U : -SWEEP_CENTER_RANGE_U,
    },
    strokesLost: 0,
  };
}

function stepTelegraph(state: SmearBossState, ctx: SealStepContext): SealBossStepResult<SmearBossState> {
  const stepped = stepAttack(state.attack as AttackState, ctx.dt);
  if (!stepped.justResolved) {
    return { bossState: { ...state, attack: stepped.state }, strokesLost: 0 };
  }
  return { bossState: { ...state, stage: 'sweeping', attack: null }, strokesLost: 0 };
}

function stepSweeping(
  state: SmearBossState,
  phaseIndex: number,
  ctx: SealStepContext,
): SealBossStepResult<SmearBossState> {
  const sweepElapsedS = state.sweepElapsedS + ctx.dt;
  const centerX = currentSweepCenterX({ ...state, sweepElapsedS });
  const inZone = Math.abs(ctx.brushX - centerX) <= ARM_HALF_WIDTH_U;
  const justHit = inZone && !state.hasHitThisSweep;
  const strokesLost = justHit ? BALANCE.line.normalContactStrokeLoss : 0;

  if (sweepElapsedS < BALANCE.seals.smear.sweepDurationS) {
    return { bossState: { ...state, sweepElapsedS, hasHitThisSweep: state.hasHitThisSweep || justHit }, strokesLost };
  }

  const isFinalPhase = phaseIndex >= BALANCE.seals.smear.phases - 1;
  if (!isFinalPhase) {
    return { bossState: createSmearBossState(), strokesLost };
  }
  return {
    bossState: { ...createSmearBossState(), stage: 'residue', residueCenterX: state.sweepEndCenterX },
    strokesLost,
  };
}

function stepResidue(state: SmearBossState, ctx: SealStepContext): SealBossStepResult<SmearBossState> {
  const residueElapsedS = state.residueElapsedS + ctx.dt;
  const inZone = Math.abs(ctx.brushX - state.residueCenterX) <= ARM_HALF_WIDTH_U;
  const justHit = inZone && !state.hasHitThisResidue;
  const strokesLost = justHit ? BALANCE.line.normalContactStrokeLoss : 0;

  if (residueElapsedS < BALANCE.seals.smear.residuePhase3S) {
    return {
      bossState: { ...state, residueElapsedS, hasHitThisResidue: state.hasHitThisResidue || justHit },
      strokesLost,
    };
  }
  return { bossState: createSmearBossState(), strokesLost };
}

function stepSmearBoss(
  state: SmearBossState,
  phaseIndex: number,
  ctx: SealStepContext,
): SealBossStepResult<SmearBossState> {
  switch (state.stage) {
    case 'residue':
      return stepResidue(state, ctx);
    case 'sweeping':
      return stepSweeping(state, phaseIndex, ctx);
    case 'telegraph':
      return stepTelegraph(state, ctx);
    case null:
      return stepCooldown(state, ctx);
  }
}

export interface SmearVisual {
  readonly stage: SmearStage;
  readonly armHalfWidthU: number;
  /** Current arm/residue centre, or (during telegraph) the sweep's about-to-start
   *  position — always the value render should actually draw the danger zone around. */
  readonly centerX: number;
  readonly progressFraction: number;
}

/** Render-side query into the opaque bossState, same pattern as stub.ts's
 *  `stubActiveTelegraph`. Returns null only during the cooldown between attacks, when
 *  there's nothing to warn about. */
export function smearActiveVisual(bossState: unknown): SmearVisual | null {
  const s = bossState as SmearBossState;
  if (s === null || s === undefined || s.stage === null) return null;

  if (s.stage === 'telegraph') {
    const attack = s.attack as AttackState;
    return {
      stage: 'telegraph',
      armHalfWidthU: ARM_HALF_WIDTH_U,
      centerX: s.sweepStartCenterX,
      progressFraction: attack.elapsedS / attack.telegraphDurationS,
    };
  }
  if (s.stage === 'sweeping') {
    return {
      stage: 'sweeping',
      armHalfWidthU: ARM_HALF_WIDTH_U,
      centerX: currentSweepCenterX(s),
      progressFraction: s.sweepElapsedS / BALANCE.seals.smear.sweepDurationS,
    };
  }
  return {
    stage: 'residue',
    armHalfWidthU: ARM_HALF_WIDTH_U,
    centerX: s.residueCenterX,
    progressFraction: s.residueElapsedS / BALANCE.seals.smear.residuePhase3S,
  };
}

export const SMEAR_SEAL_DEFINITION: SealDefinition<SmearBossState> = {
  id: 'smear',
  phaseCount: BALANCE.seals.smear.phases,
  createBossState: () => createSmearBossState(),
  stepBoss: stepSmearBoss,
};
