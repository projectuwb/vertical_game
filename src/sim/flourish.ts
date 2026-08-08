// Flourish charge/release (GAME_DESIGN.md §6, Task 2.8): hold to charge, release to
// sweep. World (world.ts) owns WetnessState and the Blot pool; this module is the pure
// charge/release state machine plus the sweep's effect on a Blot pool, so it stays
// testable without a full World.

import type { Pool } from '../core/pool.js';
import { BALANCE } from './config.js';
import type { Blot } from './blot.js';

export interface FlourishState {
  /** timeS the current hold's charge began, or null if not (validly) charging. */
  readonly chargeStartS: number | null;
  /** timeS before which a new charge can't start. 0 = ready from the very first step. */
  readonly cooldownUntilS: number;
  /** Holding, but this hold can never trigger a sweep (insufficient Wetness or still on
   *  cooldown when the hold began) — GAME_DESIGN.md §6: "shows the meter pulsing." */
  readonly isPulsing: boolean;
}

export function createFlourishState(): FlourishState {
  return { chargeStartS: null, cooldownUntilS: 0, isPulsing: false };
}

export function isFlourishReady(state: FlourishState, timeS: number): boolean {
  return timeS >= state.cooldownUntilS;
}

/** In-progress charge fraction for render (screen-edge bleed intensity, meter fill) —
 *  0 while not validly charging, 1 once the hold has cleared chargeTimeS. */
export function flourishChargeFraction(state: FlourishState, timeS: number): number {
  if (state.chargeStartS === null) return 0;
  return Math.min(1, (timeS - state.chargeStartS) / BALANCE.flourish.chargeTimeS);
}

export interface FlourishStepResult {
  readonly state: FlourishState;
  /** True only on the exact step a hold releases after a valid, full-length charge —
   *  world.ts applies the sweep's Wetness cost and Blot damage/knockback on that step. */
  readonly triggered: boolean;
}

/**
 * Advances the charge/release state machine by one `holding` edge. Not a per-frame
 * "charge grows continuously" model with its own accumulator — `chargeStartS` plus the
 * current `timeS` is enough to derive elapsed charge time at any point, so there's
 * nothing to drift between steps.
 */
/** `cooldownS` defaults to `BALANCE.flourish.cooldownS` but accepts an upgrade-adjusted
 *  value (the Flourish Study Inkstone track, Task 4.2: "-0.4s Flourish cooldown per
 *  level, floor 2.0s") — already reduced and floored by the caller (see
 *  `upgradeEffects.ts`'s `flourishCooldownS`), used as-is here. */
export function stepFlourishInput(
  state: FlourishState,
  timeS: number,
  holding: boolean,
  wasHolding: boolean,
  wetnessCurrent: number,
  cooldownS: number = BALANCE.flourish.cooldownS,
): FlourishStepResult {
  const f = BALANCE.flourish;

  if (holding && !wasHolding) {
    const canCharge = wetnessCurrent >= f.minWetnessToCharge && isFlourishReady(state, timeS);
    return {
      state: {
        chargeStartS: canCharge ? timeS : null,
        cooldownUntilS: state.cooldownUntilS,
        isPulsing: !canCharge,
      },
      triggered: false,
    };
  }

  if (!holding && wasHolding) {
    const chargedLongEnough = state.chargeStartS !== null && timeS - state.chargeStartS >= f.chargeTimeS;
    if (chargedLongEnough) {
      return {
        state: { chargeStartS: null, cooldownUntilS: timeS + cooldownS, isPulsing: false },
        triggered: true,
      };
    }
    return {
      state: { chargeStartS: null, cooldownUntilS: state.cooldownUntilS, isPulsing: false },
      triggered: false,
    };
  }

  return { state, triggered: false }; // mid-hold or mid-release, nothing changes
}

/**
 * The sweep itself (GAME_DESIGN.md §6): `28 × (1 + 0.15 × rowCount)` damage in a 5u
 * radius, forward of the Brush only (`dz >= 0` — never hits something already behind
 * it), knocking survivors back 4u. No armour multiplier — the formula is a flat amount
 * with no StrokeClass attached, unlike Stroke damage (see collision.ts). "Non-boss" per
 * spec — moot until Seals (Task 3.x) exist, at which point they should be excluded from
 * the knockback here. Doesn't delete "Blot projectiles": nothing in the sim currently
 * models one (Blotter's ink lob is a direct, non-projectile hit — blot.ts's
 * updateBlotMotion) — logged in DECISIONS.md so it isn't silently forgotten if that
 * changes.
 */
export function applyFlourishSweep(blotPool: Pool<Blot>, brushX: number, brushZ: number, rowCount: number): void {
  const f = BALANCE.flourish;
  const damage = f.damageBase * (1 + f.damagePerRow * rowCount);
  const radiusSq = f.radiusU * f.radiusU;
  blotPool.forEachActive((b) => {
    const dz = b.z - brushZ;
    if (dz < 0) return;
    const dx = b.x - brushX;
    if (dx * dx + dz * dz > radiusSq) return;
    b.hp -= damage;
    b.z += f.knockbackU;
  });
}
