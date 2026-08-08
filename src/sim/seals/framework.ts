// The Seal framework (GAME_DESIGN.md §8.2, Task 3.1): everything shared by every boss —
// phased HP, the segmented-bar/stagger/damage-window mechanic, the 6s approach, and the
// generic "telegraph before resolve" attack shape every Seal attack uses. The three real
// bosses (Tasks 3.2-3.4) each plug into this as a `SealDefinition`; this file never
// knows their specific attack patterns, only that they exist.
//
// HP model: one continuous pool (`hp`, 0..maxHp), not `phaseCount` separate pools —
// "segmented HP bar (segments = phase count)" is the *display*, not `phaseCount`
// independent fights. `phaseIndex` (which attack pattern is active) only advances once
// the stagger window from crossing a segment boundary has fully elapsed; the pool itself
// drains continuously (at the stagger's damage multiplier while staggered), so a big
// enough hit during the ×2 window can cut straight through toward the next segment
// instead of the extra damage being wasted — the standard "punish a stagger" shape this
// mechanic is drawing from.

import type { RngRegistry } from '../../core/rng.js';
import type { Pool } from '../../core/pool.js';
import { BALANCE } from '../config.js';
import type { Blot } from '../blot.js';

export type SealStatus = 'approaching' | 'fighting' | 'broken';

export interface SealEncounterState {
  readonly sealIndex: number;
  readonly definitionId: string;
  readonly status: SealStatus;
  readonly approachRemainingS: number;
  readonly phaseCount: number;
  readonly maxHp: number;
  readonly hp: number;
  readonly hpPerPhase: number;
  /** Which phase's attack pattern is currently active — only changes once a stagger
   *  window finishes (see `stepSealEncounter`), never mid-stagger. */
  readonly phaseIndex: number;
  /** >0 while staggered (a segment boundary was just crossed); counts down to 0. */
  readonly staggerRemainingS: number;
  /** Opaque to the framework — whatever the active `SealDefinition` needs to track its
   *  own attack pattern. Reset (via `createBossState`) every time `phaseIndex` changes. */
  readonly bossState: unknown;
}

export function computeSealMaxHp(sealIndex: number): number {
  return BALANCE.seals.hpBase * Math.pow(BALANCE.seals.hpGrowthPerIndex, sealIndex);
}

export interface SealStepContext {
  readonly dt: number;
  readonly timeS: number;
  readonly brushX: number;
  readonly brushZ: number;
  readonly rng: RngRegistry;
  /** For attacks that summon Blot (The Press's "8 Smudges per slam," GAME_DESIGN.md
   *  §8.2) — bosses mutate this directly via `spawnBlot`, the same pool-mutation idiom
   *  every other spawn site in /sim already uses, rather than the framework routing
   *  spawn requests through yet another indirection layer. */
  readonly blotPool: Pool<Blot>;
}

export interface SealBossStepResult<TBossState> {
  readonly bossState: TBossState;
  /** Strokes the Line loses this step from a resolved attack — 0 most steps. */
  readonly strokesLost: number;
  /** The Blank's erasure beam only (GAME_DESIGN.md §8.2's "removes Slips and Gates from
   *  the road for 3s") — seconds from now to suppress Slip/Gate growth, or undefined
   *  every other step and for every other boss. world.ts owns the Slip pool and current
   *  Gate pair, so it's the one that actually clears them; a boss only ever requests it
   *  through this return value, the same "instruction, not a direct mutation" shape
   *  `strokesLost` already uses for the Line. */
  readonly growthEraseS?: number;
}

/** What a boss (Tasks 3.2-3.4, or seals/stub.ts for this task) plugs into the framework.
 *  Generic over its own opaque attack-state shape so each boss's `stepBoss` gets that
 *  type back typed, not `unknown`, without the framework itself needing to know it. */
export interface SealDefinition<TBossState = unknown> {
  readonly id: string;
  readonly phaseCount: number;
  createBossState(phaseIndex: number, rng: RngRegistry): TBossState;
  stepBoss(bossState: TBossState, phaseIndex: number, ctx: SealStepContext): SealBossStepResult<TBossState>;
}

export function createSealEncounter<TBossState>(
  sealIndex: number,
  definition: SealDefinition<TBossState>,
): SealEncounterState {
  const maxHp = computeSealMaxHp(sealIndex);
  return {
    sealIndex,
    definitionId: definition.id,
    status: 'approaching',
    approachRemainingS: BALANCE.seals.approachTelegraphS,
    phaseCount: definition.phaseCount,
    maxHp,
    hp: maxHp,
    hpPerPhase: maxHp / definition.phaseCount,
    phaseIndex: 0,
    staggerRemainingS: 0,
    bossState: null,
  };
}

/**
 * Advances the encounter by one fixed step: counts down the approach, ticks a stagger
 * window and — once it clears — formally advances `phaseIndex` and resets the boss's
 * attack state, or otherwise lets the active `SealDefinition` act. Returns any Strokes
 * lost this step; world.ts applies that to the Line exactly like any other loss.
 */
export function stepSealEncounter<TBossState>(
  seal: SealEncounterState,
  definition: SealDefinition<TBossState>,
  ctx: SealStepContext,
): { seal: SealEncounterState; strokesLost: number; growthEraseS?: number } {
  if (seal.status === 'broken') return { seal, strokesLost: 0 };

  if (seal.status === 'approaching') {
    const approachRemainingS = Math.max(0, seal.approachRemainingS - ctx.dt);
    if (approachRemainingS <= 0) {
      const bossState = definition.createBossState(0, ctx.rng);
      return { seal: { ...seal, status: 'fighting', approachRemainingS: 0, bossState }, strokesLost: 0 };
    }
    return { seal: { ...seal, approachRemainingS }, strokesLost: 0 };
  }

  if (seal.staggerRemainingS > 0) {
    const staggerRemainingS = Math.max(0, seal.staggerRemainingS - ctx.dt);
    if (staggerRemainingS <= 0) {
      const phaseIndex = Math.min(seal.phaseCount - 1, Math.floor((seal.maxHp - seal.hp) / seal.hpPerPhase));
      const bossState = definition.createBossState(phaseIndex, ctx.rng);
      return { seal: { ...seal, staggerRemainingS: 0, phaseIndex, bossState }, strokesLost: 0 };
    }
    return { seal: { ...seal, staggerRemainingS }, strokesLost: 0 };
  }

  const result = definition.stepBoss(seal.bossState as TBossState, seal.phaseIndex, ctx);
  return {
    seal: { ...seal, bossState: result.bossState },
    strokesLost: result.strokesLost,
    ...(result.growthEraseS !== undefined ? { growthEraseS: result.growthEraseS } : {}),
  };
}

/**
 * Applies raw (unarmoured — a Seal isn't a Blot class, there's no multiplier table to
 * look one up in) damage to a fighting Seal, doubled while staggered
 * (`phaseStaggerDamageMult`). Crossing a fresh segment boundary (re)starts the stagger
 * window; hp reaching 0 breaks the Seal immediately regardless of stagger state, rather
 * than making the kill wait out a window that has nothing left to protect.
 */
export function applySealDamage(seal: SealEncounterState, rawDamage: number): SealEncounterState {
  if (seal.status !== 'fighting') return seal;

  const multiplier = seal.staggerRemainingS > 0 ? BALANCE.seals.phaseStaggerDamageMult : 1;
  const hp = Math.max(0, seal.hp - rawDamage * multiplier);

  if (hp <= 0) {
    return { ...seal, hp: 0, status: 'broken', staggerRemainingS: 0 };
  }

  const previousBoundary = Math.floor((seal.maxHp - seal.hp) / seal.hpPerPhase);
  const newBoundary = Math.floor((seal.maxHp - hp) / seal.hpPerPhase);
  if (newBoundary > previousBoundary) {
    return { ...seal, hp, staggerRemainingS: BALANCE.seals.phaseStaggerWindowS };
  }
  return { ...seal, hp };
}

// --- The generic "telegraph, then resolve" attack shape every Seal attack uses
// (GAME_DESIGN.md §8.2: "every attack has a telegraph of at least 0.7s") ---

export interface AttackState {
  readonly phase: 'telegraphing' | 'resolved';
  readonly elapsedS: number;
  readonly telegraphDurationS: number;
}

/** Starts a telegraph. Clamps up to `minAttackTelegraphS` regardless of what's asked
 *  for — structurally, no boss (this one or a future one) can construct an
 *  under-telegraphed attack through this framework. */
export function startAttack(requestedTelegraphS: number): AttackState {
  return {
    phase: 'telegraphing',
    elapsedS: 0,
    telegraphDurationS: Math.max(BALANCE.seals.minAttackTelegraphS, requestedTelegraphS),
  };
}

export function stepAttack(state: AttackState, dt: number): { state: AttackState; justResolved: boolean } {
  if (state.phase === 'resolved') return { state, justResolved: false };
  const elapsedS = state.elapsedS + dt;
  if (elapsedS >= state.telegraphDurationS) {
    return { state: { ...state, phase: 'resolved', elapsedS }, justResolved: true };
  }
  return { state: { ...state, elapsedS }, justResolved: false };
}
