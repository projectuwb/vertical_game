// Wetness economy (GAME_DESIGN.md §6, Task 2.8): the 0-100 meter that turns "always
// firing" into an occasional decision to stop. Like blot.ts/slips.ts, mutates the pooled
// InkPool entity in place; WetnessState itself is a small copy-on-write value (matching
// TemperState in gates.ts) since nothing pools it.

import { Pool, type PoolItem } from '../core/pool.js';
import { BALANCE } from './config.js';

export interface WetnessState {
  readonly current: number;
  /** Seconds since firing last stopped — refill only starts once this clears
   *  `refillDelayS` (GAME_DESIGN.md §6: "refills... after 0.8s of not firing"). */
  readonly timeSinceStoppedFiringS: number;
}

/** `cap` defaults to `BALANCE.wetness.max` but accepts an upgrade-adjusted value (the
 *  Well Inkstone track, Task 4.2: "+8 Wetness cap per level") — a Passage started with
 *  Well levels already owned should start full at *that* cap, not the base one. */
export function createWetnessState(cap: number = BALANCE.wetness.max): WetnessState {
  return { current: cap, timeSinceStoppedFiringS: 0 };
}

export function isWetnessDry(state: WetnessState): boolean {
  return state.current <= 0;
}

/** GAME_DESIGN.md §6: drains 6.0/s flat while firing (regardless of N — "a big Line must
 *  not be punished"); refills 25/s once 0.8s have passed since firing last stopped.
 *  `cap` is the same upgrade-adjusted Well cap `createWetnessState`/
 *  `resolveInkPoolContact` take — defaults to the base `BALANCE.wetness.max`. */
export function stepWetness(state: WetnessState, dt: number, isFiring: boolean, cap: number = BALANCE.wetness.max): WetnessState {
  const w = BALANCE.wetness;
  if (isFiring) {
    return { current: Math.max(0, state.current - w.drainPerSWhileFiring * dt), timeSinceStoppedFiringS: 0 };
  }
  const timeSinceStopped = state.timeSinceStoppedFiringS + dt;
  if (timeSinceStopped <= w.refillDelayS) {
    return { current: state.current, timeSinceStoppedFiringS: timeSinceStopped };
  }
  return {
    current: Math.min(cap, state.current + w.refillPerSAfterDelay * dt),
    timeSinceStoppedFiringS: timeSinceStopped,
  };
}

export function spendWetness(state: WetnessState, amount: number): WetnessState {
  return { ...state, current: Math.max(0, state.current - amount) };
}

// --- Ink pools: staked road furniture like Slips/Sealstacks (no speed stat of their
// own — approach at the world scroll rate), a one-time pickup rather than a target. ---

export interface InkPool extends PoolItem {
  x: number;
  z: number;
}

export function createInkPoolPool(): Pool<InkPool> {
  return new Pool<InkPool>(BALANCE.pools.inkPoolCapacity, (index) => ({ poolIndex: index, x: 0, z: 0 }));
}

export function spawnInkPool(pool: Pool<InkPool>, x: number, z: number): InkPool | undefined {
  const p = pool.acquire();
  if (p === undefined) return undefined; // pool exhausted — a perf ceiling, not a gameplay bug
  p.x = x;
  p.z = z;
  return p;
}

export function updateInkPoolMotion(pool: Pool<InkPool>, dt: number): void {
  const step = BALANCE.forwardSpeed.baseUPerS * dt;
  pool.forEachActive((p) => {
    p.z -= step;
  });
}

/**
 * Restores Wetness by `poolRestoreAmount` the instant the Brush crosses a pool within
 * `poolHitRadiusU` laterally — GAME_DESIGN.md §6's "restore 40 instantly on contact."
 * Every pool that reaches the Brush is released whether or not it was actually driven
 * through (same crossing-releases-it pattern as sealstacks.ts's
 * resolveSealstackContact/blot.ts's resolveLineContact): a puddle you drove past without
 * touching is simply gone, not lingering.
 */
export function resolveInkPoolContact(
  pool: Pool<InkPool>,
  wetness: WetnessState,
  brushX: number,
  brushZ: number,
  cap: number = BALANCE.wetness.max,
): WetnessState {
  let next = wetness;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const p = pool.get(i);
    if (p.z > brushZ) continue;
    if (Math.abs(p.x - brushX) <= BALANCE.wetness.poolHitRadiusU) {
      next = {
        ...next,
        current: Math.min(cap, next.current + BALANCE.wetness.poolRestoreAmount),
      };
    }
    pool.release(p);
  }
  return next;
}
