// The Press (GAME_DESIGN.md §8.2, Task 3.3) — "slams down, sending a shockwave ring;
// you must be outside the ring or in the one gap in it. Summons 8 Smudges per slam.
// Phase 2 adds a second, offset ring. Phase 3 slams on a 2-beat rhythm."
//
// The game has no radial dimension — the Brush only ever moves laterally — so "outside
// the ring or in the gap" collapses to: the whole lane is dangerous except one narrow
// gap window (`gapHalfWidthU`, see config.ts). The slam itself is modelled as an
// instant resolve at the end of its telegraph (same precedent as Tome Phrase Press and
// the Smear's residue: nothing here has a specified travel speed to animate a literal
// expanding ring at), checked against the Brush's position the instant the telegraph
// completes.
//
// Phase 1 (index 0): one ring, one gap. Phase 2 (index 1): a second, offset ring
// resolves simultaneously — the Brush must be inside *both* gaps at once, so the two
// gap windows are rolled to guarantee overlap **by construction** (the second gap's
// centre is rolled within `gapHalfWidthU` of the first's, the same "guarantee, don't
// reject-sample" idiom Task 2.6 used for Gate pairing), never by rejecting bad rolls.
// Phase 3 (index 2) doesn't add a second ring — it adds a second *beat*: one slam,
// a short `beatGapS` pause, then a second independently-telegraphed slam, each with
// its own single gap. That's the "2-beat rhythm... deliberately musical" phase.

import type { Pool } from '../../core/pool.js';
import { spawnBlot, type Blot } from '../blot.js';
import { BALANCE } from '../config.js';
import {
  startAttack,
  stepAttack,
  type AttackState,
  type SealBossStepResult,
  type SealDefinition,
  type SealStepContext,
} from './framework.js';

const LANE_HALF_WIDTH_U = BALANCE.lane.halfWidth;
const GAP_HALF_WIDTH_U = BALANCE.seals.press.gapHalfWidthU;
/** How far a gap's centre can roll from lane centre while keeping the whole gap window
 *  inside the lane — the same "keep the moving/placed thing's own edge, not its centre,
 *  within playable bounds" reasoning as the Smear's `SWEEP_CENTER_RANGE_U`. */
const GAP_CENTER_RANGE_U = LANE_HALF_WIDTH_U - GAP_HALF_WIDTH_U;
const SUMMON_COUNT = BALANCE.seals.press.summonPerSlamCount;
const FINAL_PHASE_INDEX = BALANCE.seals.press.phases - 1;
const DUAL_RING_PHASE_INDEX = 1;

type PressStage = 'telegraph' | 'beatGap';

export interface PressBossState {
  readonly cooldownS: number;
  readonly stage: PressStage | null;
  readonly attack: AttackState | null;
  /** One centre for a single-ring slam, two for phase 2's offset pair. */
  readonly gapCenters: readonly number[];
  readonly beatIndex: 0 | 1;
}

function createPressBossState(): PressBossState {
  return { cooldownS: 0, stage: null, attack: null, gapCenters: [], beatIndex: 0 };
}

function clampToGapRange(x: number): number {
  return Math.min(GAP_CENTER_RANGE_U, Math.max(-GAP_CENTER_RANGE_U, x));
}

/** Rolls the gap centre(s) for one slam. Phase 2 (index 1) rolls a second centre within
 *  `gapHalfWidthU` of the first — guaranteeing by construction that the two gap
 *  intervals overlap by at least `gapHalfWidthU`, so a position safe from both rings
 *  always exists, never left to chance across the independent rolls. */
function rollGapCenters(phaseIndex: number, ctx: SealStepContext): readonly number[] {
  const c1 = ctx.rng.range('seals', -GAP_CENTER_RANGE_U, GAP_CENTER_RANGE_U);
  if (phaseIndex !== DUAL_RING_PHASE_INDEX) return [c1];

  const offset = ctx.rng.range('seals', -GAP_HALF_WIDTH_U, GAP_HALF_WIDTH_U);
  const c2 = clampToGapRange(c1 + offset);
  return [c1, c2];
}

function spawnSlamSmudges(pool: Pool<Blot>): void {
  const spacingU = BALANCE.lane.width / SUMMON_COUNT;
  const halfSpacingU = spacingU / 2;
  for (let i = 0; i < SUMMON_COUNT; i++) {
    const x = -LANE_HALF_WIDTH_U + halfSpacingU + spacingU * i;
    spawnBlot(pool, 'smudge', x, BALANCE.seals.engagementZU);
  }
}

function stepCooldown(state: PressBossState, phaseIndex: number, ctx: SealStepContext): SealBossStepResult<PressBossState> {
  const cooldownS = state.cooldownS + ctx.dt;
  if (cooldownS < BALANCE.seals.press.attackIntervalS) {
    return { bossState: { ...state, cooldownS }, strokesLost: 0 };
  }
  return {
    bossState: {
      ...createPressBossState(),
      stage: 'telegraph',
      attack: startAttack(BALANCE.seals.press.slamTelegraphS),
      gapCenters: rollGapCenters(phaseIndex, ctx),
      beatIndex: 0,
    },
    strokesLost: 0,
  };
}

function stepBeatGap(state: PressBossState, ctx: SealStepContext): SealBossStepResult<PressBossState> {
  const cooldownS = state.cooldownS + ctx.dt;
  if (cooldownS < BALANCE.seals.press.beatGapS) {
    return { bossState: { ...state, cooldownS }, strokesLost: 0 };
  }
  return {
    bossState: {
      ...state,
      cooldownS: 0,
      stage: 'telegraph',
      attack: startAttack(BALANCE.seals.press.slamTelegraphS),
      // The second beat is always a single ring — phase 3 layers the 2-beat rhythm on
      // top of the phase-1 single-ring shape, never combined with phase 2's dual ring.
      gapCenters: [ctx.rng.range('seals', -GAP_CENTER_RANGE_U, GAP_CENTER_RANGE_U)],
      beatIndex: 1,
    },
    strokesLost: 0,
  };
}

function stepTelegraph(
  state: PressBossState,
  phaseIndex: number,
  ctx: SealStepContext,
): SealBossStepResult<PressBossState> {
  const stepped = stepAttack(state.attack as AttackState, ctx.dt);
  if (!stepped.justResolved) {
    return { bossState: { ...state, attack: stepped.state }, strokesLost: 0 };
  }

  const inAnyGap = state.gapCenters.some((c) => Math.abs(ctx.brushX - c) <= GAP_HALF_WIDTH_U);
  const strokesLost = inAnyGap ? 0 : BALANCE.line.normalContactStrokeLoss;
  spawnSlamSmudges(ctx.blotPool);

  const isFirstBeatOfTwo = phaseIndex >= FINAL_PHASE_INDEX && state.beatIndex === 0;
  if (isFirstBeatOfTwo) {
    return { bossState: { ...state, stage: 'beatGap', attack: null, cooldownS: 0 }, strokesLost };
  }
  return { bossState: createPressBossState(), strokesLost };
}

function stepPressBoss(
  state: PressBossState,
  phaseIndex: number,
  ctx: SealStepContext,
): SealBossStepResult<PressBossState> {
  switch (state.stage) {
    case 'telegraph':
      return stepTelegraph(state, phaseIndex, ctx);
    case 'beatGap':
      return stepBeatGap(state, ctx);
    case null:
      return stepCooldown(state, phaseIndex, ctx);
  }
}

export interface PressVisual {
  readonly gapCenters: readonly number[];
  readonly gapHalfWidthU: number;
  readonly progressFraction: number;
}

/** Render-side query into the opaque bossState, same pattern as smearActiveVisual.
 *  Returns null outside a telegraph (cooldown and the inter-beat pause both have
 *  nothing to warn about yet). */
export function pressActiveVisual(bossState: unknown): PressVisual | null {
  const s = bossState as PressBossState;
  if (s === null || s === undefined || s.stage !== 'telegraph') return null;
  const attack = s.attack as AttackState;
  return {
    gapCenters: s.gapCenters,
    gapHalfWidthU: GAP_HALF_WIDTH_U,
    progressFraction: attack.elapsedS / attack.telegraphDurationS,
  };
}

export const PRESS_SEAL_DEFINITION: SealDefinition<PressBossState> = {
  id: 'press',
  phaseCount: BALANCE.seals.press.phases,
  createBossState: () => createPressBossState(),
  stepBoss: stepPressBoss,
};
