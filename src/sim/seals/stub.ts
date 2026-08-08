// The stub Seal (Task 3.1): the minimal boss that exercises the framework end to end —
// 3 phases (borrowing the Smear's phase count, since a stub isn't a named entry in
// BALANCE.seals.order and shouldn't invent its own unlisted balance number), one attack
// ("Pulse": telegraph a lane half, then cost a Stroke if the Brush is still there when
// it resolves — GAME_DESIGN.md §8.2's "a correct answer that is a position, not a
// reflex"). Tasks 3.2-3.4 replace this with the three real bosses; nothing else in the
// framework or world.ts is boss-specific, so that swap-in shouldn't touch either.

import type { RngRegistry } from '../../core/rng.js';
import { BALANCE } from '../config.js';
import {
  startAttack,
  stepAttack,
  type AttackState,
  type SealBossStepResult,
  type SealDefinition,
  type SealStepContext,
} from './framework.js';

export type LaneSide = 'left' | 'right';

export interface StubBossState {
  readonly cooldownS: number;
  readonly attack: AttackState | null;
  readonly telegraphedSide: LaneSide | null;
}

// Derived from real BALANCE fields (×2, an exempt literal) rather than a new unlisted
// config number — see the module docblock on why a test-only stub doesn't get one.
const ATTACK_INTERVAL_S = BALANCE.seals.minAttackTelegraphS * 2;

function laneSideOf(x: number): LaneSide {
  return x < 0 ? 'left' : 'right'; // matches gates.ts's resolveGatePairContact exactly
}

function createStubBossState(): StubBossState {
  return { cooldownS: 0, attack: null, telegraphedSide: null };
}

function stepStubBoss(
  state: StubBossState,
  _phaseIndex: number,
  ctx: SealStepContext,
): SealBossStepResult<StubBossState> {
  if (state.attack === null) {
    const cooldownS = state.cooldownS + ctx.dt;
    if (cooldownS < ATTACK_INTERVAL_S) {
      return { bossState: { ...state, cooldownS }, strokesLost: 0 };
    }
    const side: LaneSide = ctx.rng.chance('seals', BALANCE.gates.fiftyFifty) ? 'left' : 'right';
    return {
      bossState: { cooldownS: 0, attack: startAttack(BALANCE.seals.minAttackTelegraphS), telegraphedSide: side },
      strokesLost: 0,
    };
  }

  const stepped = stepAttack(state.attack, ctx.dt);
  if (!stepped.justResolved) {
    return { bossState: { ...state, attack: stepped.state }, strokesLost: 0 };
  }

  const hit = state.telegraphedSide !== null && laneSideOf(ctx.brushX) === state.telegraphedSide;
  return { bossState: createStubBossState(), strokesLost: hit ? 1 : 0 };
}

/** Render-side query into the stub's opaque bossState — kept here (not in framework.ts,
 *  which never inspects boss-specific state) so render only needs to know the stub's
 *  own shape, the same pattern phrases.ts's `lastFiredAtS` uses for its own flashes. */
export function stubActiveTelegraph(bossState: unknown): { side: LaneSide; progressFraction: number } | null {
  const s = bossState as StubBossState;
  if (s?.attack === null || s?.attack === undefined || s.telegraphedSide === null) return null;
  return { side: s.telegraphedSide, progressFraction: s.attack.elapsedS / s.attack.telegraphDurationS };
}

export const STUB_SEAL_DEFINITION: SealDefinition<StubBossState> = {
  id: 'stub',
  phaseCount: BALANCE.seals.smear.phases,
  createBossState: (_phaseIndex: number, _rng: RngRegistry) => createStubBossState(),
  stepBoss: stepStubBoss,
};
