// The Blank (GAME_DESIGN.md §8.2, Task 3.4) — "erases. Fires a beam that removes Slips
// and Gates from the road for 3s, plus a cone that converts hit Strokes into Blot that
// then attack you. The only Seal where losing feels like it compounds. Phase 4 erases
// the road markings entirely, leaving only the ink trail to navigate by."
//
// Two attacks, alternating on one cadence, never simultaneous:
//   - The **beam** targets the road/economy, not the Brush — it has no position to
//     dodge, so it doesn't run through the "danger zone vs. gap" shape the other two
//     bosses use. Resolving it returns `growthEraseS` (see framework.ts), a pure
//     instruction; world.ts is the one that actually clears the Slip pool and the
//     current Gate pair, since it already owns both.
//   - The **cone** targets the Brush directly and *is* a position: a single dangerous
//     band (`coneHalfWidthU` wide, instant-resolve — same precedent as the Press's
//     ring and Tome Phrase Press), safe everywhere else. A Stroke caught inside it
//     isn't just lost — it's converted: spawned back as an attacking Blot a short
//     distance ahead of the Brush (via `ctx.blotPool`, the same idiom the Press
//     already established for its Smudge summons), which is the literal mechanic
//     behind "losing feels like it compounds."
//
// Phase 4's road-markings erasure is render-only (render/seal.ts / road.ts check
// `phaseIndex`/`definitionId` directly) — nothing here needs to know about it.

import { spawnBlot } from '../blot.js';
import { BALANCE } from '../config.js';
import {
  startAttack,
  stepAttack,
  type AttackState,
  type SealBossStepResult,
  type SealDefinition,
  type SealStepContext,
} from './framework.js';

const CONE_HALF_WIDTH_U = BALANCE.seals.blank.coneHalfWidthU;
const CONE_CENTER_RANGE_U = BALANCE.lane.halfWidth - CONE_HALF_WIDTH_U;

export type BlankAttackKind = 'beam' | 'cone';

export interface BlankBossState {
  readonly cooldownS: number;
  readonly stage: 'telegraph' | null;
  readonly attack: AttackState | null;
  readonly attackKind: BlankAttackKind;
  /** Only meaningful once a cone telegraph has actually started. */
  readonly coneCenterX: number;
}

function createBlankBossState(nextKind: BlankAttackKind): BlankBossState {
  return { cooldownS: 0, stage: null, attack: null, attackKind: nextKind, coneCenterX: 0 };
}

function stepCooldown(state: BlankBossState, ctx: SealStepContext): SealBossStepResult<BlankBossState> {
  const cooldownS = state.cooldownS + ctx.dt;
  if (cooldownS < BALANCE.seals.blank.attackIntervalS) {
    return { bossState: { ...state, cooldownS }, strokesLost: 0 };
  }

  const isBeam = state.attackKind === 'beam';
  const telegraphS = isBeam ? BALANCE.seals.blank.beamTelegraphS : BALANCE.seals.blank.coneTelegraphS;
  const coneCenterX = isBeam ? 0 : ctx.rng.range('seals', -CONE_CENTER_RANGE_U, CONE_CENTER_RANGE_U);
  return {
    bossState: { ...state, cooldownS: 0, stage: 'telegraph', attack: startAttack(telegraphS), coneCenterX },
    strokesLost: 0,
  };
}

function stepTelegraph(state: BlankBossState, ctx: SealStepContext): SealBossStepResult<BlankBossState> {
  const stepped = stepAttack(state.attack as AttackState, ctx.dt);
  if (!stepped.justResolved) {
    return { bossState: { ...state, attack: stepped.state }, strokesLost: 0 };
  }

  if (state.attackKind === 'beam') {
    return {
      bossState: createBlankBossState('cone'),
      strokesLost: 0,
      growthEraseS: BALANCE.seals.blank.eraseDurationS,
    };
  }

  const inCone = Math.abs(ctx.brushX - state.coneCenterX) <= CONE_HALF_WIDTH_U;
  const strokesLost = inCone ? BALANCE.seals.blank.attackStrokeLoss : 0;
  for (let i = 0; i < strokesLost; i++) {
    spawnBlot(ctx.blotPool, 'smudge', ctx.brushX, ctx.brushZ + BALANCE.seals.blank.convertedBlotAheadZU);
  }
  return { bossState: createBlankBossState('beam'), strokesLost };
}

function stepBlankBoss(
  state: BlankBossState,
  _phaseIndex: number,
  ctx: SealStepContext,
): SealBossStepResult<BlankBossState> {
  if (state.stage === 'telegraph') return stepTelegraph(state, ctx);
  return stepCooldown(state, ctx);
}

export interface BlankVisual {
  readonly attackKind: BlankAttackKind;
  readonly coneCenterX: number;
  readonly coneHalfWidthU: number;
  readonly progressFraction: number;
}

/** Render-side query into the opaque bossState, same pattern as the other two bosses.
 *  Returns null between attacks, when there's nothing to warn about. */
export function blankActiveVisual(bossState: unknown): BlankVisual | null {
  const s = bossState as BlankBossState;
  if (s === null || s === undefined || s.stage !== 'telegraph') return null;
  const attack = s.attack as AttackState;
  return {
    attackKind: s.attackKind,
    coneCenterX: s.coneCenterX,
    coneHalfWidthU: CONE_HALF_WIDTH_U,
    progressFraction: attack.elapsedS / attack.telegraphDurationS,
  };
}

export const BLANK_SEAL_DEFINITION: SealDefinition<BlankBossState> = {
  id: 'blank',
  phaseCount: BALANCE.seals.blank.phases,
  createBossState: () => createBlankBossState('beam'),
  stepBoss: stepBlankBoss,
};
