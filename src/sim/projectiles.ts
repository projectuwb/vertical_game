// Projectile pools + motion (GAME_DESIGN.md §4/§5, TECH_SPEC.md §5, Task 2.3).
//
// Unlike the rest of /sim (which favours copy-on-write snapshots — see line.ts),
// projectiles are a genuine per-frame, up-to-2048-item hot path: the whole point of
// Pool<T> (core/pool.ts) is that acquiring, moving, and releasing them never allocates.
// So this module mutates pool items and the firing accumulators in place by design.

import { Pool, type PoolItem } from '../core/pool.js';
import { BALANCE } from './config.js';
import type { StrokeClass } from './stroke.js';
import type { GameEventBus } from './events.js';

export interface Projectile extends PoolItem {
  class: StrokeClass;
  x: number;
  z: number;
  damage: number;
  /** Targets left before the projectile is destroyed: 1 for Hane/Tome, pierceCount for Harai. */
  pierceRemaining: number;
  /** >0 only for Tome. */
  splashRadiusU: number;
  distanceTraveledU: number;
  maxRangeU: number;
}

export function createProjectilePool(): Pool<Projectile> {
  return new Pool<Projectile>(BALANCE.pools.projectileCapacity, (index) => ({
    poolIndex: index,
    class: 'hane',
    x: 0,
    z: 0,
    damage: 0,
    pierceRemaining: 0,
    splashRadiusU: 0,
    distanceTraveledU: 0,
    maxRangeU: 0,
  }));
}

export interface FiringPlan {
  readonly spawnRatePerS: number;
  readonly damagePerProjectile: number;
}

/**
 * GAME_DESIGN.md §5: the front row fires at full rate; every Stroke beyond the front
 * row contributes `extraRowDpsContribution` (55%) of its class's normal rate as *more*
 * projectiles fired from the front row, capped at `maxVisibleProjectilesPerClassPerS`
 * (24) — beyond the cap, the surplus rate folds into a damage multiplier on the (fewer)
 * projectiles that do spawn, so total DPS output is exactly preserved regardless of how
 * many projectiles represent it on screen. `rateMultiplier` (default 1) scales the
 * desired rate before the cap/compensation math runs, so wetness.ts's dry-state ×0.5
 * (GAME_DESIGN.md §6) actually halves the shot count rather than halving already-capped
 * damage. `damageMultiplier` (default 1, the Grind Inkstone track, Task 4.2: "+4%
 * damage per level") scales per-shot damage directly and composes independently of
 * `rateMultiplier` — Grind should not change how many projectiles spawn.
 */
export function computeFiringPlan(
  cls: StrokeClass,
  frontRowCount: number,
  backRowCount: number,
  rateMultiplier = 1,
  damageMultiplier = 1,
): FiringPlan {
  const stats = BALANCE.strokes[cls];
  const effectiveStrokeCount = frontRowCount + backRowCount * BALANCE.line.extraRowDpsContribution;
  const desiredRate = stats.fireRatePerS * effectiveStrokeCount * rateMultiplier;
  const cap = BALANCE.line.maxVisibleProjectilesPerClassPerS;
  const spawnRatePerS = Math.min(desiredRate, cap);
  const damagePerProjectile = spawnRatePerS > 0 ? stats.damage * damageMultiplier * (desiredRate / spawnRatePerS) : 0;
  return { spawnRatePerS, damagePerProjectile };
}

/** Per-class firing state. `muzzleCursor` must persist across frames (not reset per
 *  call) — at typical fire rates a single fixed step spawns at most one projectile, so
 *  resetting the cursor every call would fire every shot from the same muzzle forever. */
export interface ClassFiringState {
  timeAccumulator: number;
  muzzleCursor: number;
}

export interface FiringAccumulators {
  hane: ClassFiringState;
  tome: ClassFiringState;
  harai: ClassFiringState;
}

export function createFiringAccumulators(): FiringAccumulators {
  return {
    hane: { timeAccumulator: 0, muzzleCursor: 0 },
    tome: { timeAccumulator: 0, muzzleCursor: 0 },
    harai: { timeAccumulator: 0, muzzleCursor: 0 },
  };
}

export interface FrontRowSource {
  readonly x: number;
  readonly z: number;
}

const ALL_CLASSES: readonly StrokeClass[] = ['hane', 'tome', 'harai'];

/**
 * Advances each class's firing accumulator by `dt` and spawns any projectiles that
 * come due, cycling through that class's front-row source positions for muzzle
 * variety. Mutates `accumulators` and `pool` in place. `damageMultiplier`/
 * `rangeMultiplier` (both default 1) are the Grind/Reach Inkstone tracks (Task 4.2),
 * threaded straight through to `computeFiringPlan`/`spawnProjectile`. `splashMultiplier`
 * (default 1, appended last rather than inserted alongside the others to avoid
 * reshuffling existing positional callers) is Gates' Temper track's splash stack
 * (Task 7.8, GAME_DESIGN.md §7.2: "Splash +30%") — a no-op for every class but Tome.
 */
export function updateFiring(
  accumulators: FiringAccumulators,
  pool: Pool<Projectile>,
  dt: number,
  frontRowCounts: Record<StrokeClass, number>,
  backRowCounts: Record<StrokeClass, number>,
  frontRowSources: Record<StrokeClass, readonly FrontRowSource[]>,
  rateMultiplier = 1,
  damageMultiplier = 1,
  rangeMultiplier = 1,
  events?: GameEventBus,
  splashMultiplier = 1,
): void {
  for (const cls of ALL_CLASSES) {
    const plan = computeFiringPlan(cls, frontRowCounts[cls], backRowCounts[cls], rateMultiplier, damageMultiplier);
    const sources = frontRowSources[cls];
    const state = accumulators[cls];

    if (sources.length === 0) {
      state.timeAccumulator = 0; // no muzzle to fire from (e.g. this class lost from the front row)
      continue;
    }

    state.timeAccumulator += plan.spawnRatePerS * dt;
    while (state.timeAccumulator >= 1) {
      state.timeAccumulator -= 1;
      const source = sources[state.muzzleCursor % sources.length] as FrontRowSource;
      state.muzzleCursor++;
      spawnProjectile(pool, cls, source.x, source.z, plan.damagePerProjectile, rangeMultiplier, splashMultiplier);
      events?.emit('fire', { class: cls });
    }
  }
}

function spawnProjectile(
  pool: Pool<Projectile>,
  cls: StrokeClass,
  x: number,
  z: number,
  damage: number,
  rangeMultiplier = 1,
  splashMultiplier = 1,
): void {
  const projectile = pool.acquire();
  if (projectile === undefined) return; // pool exhausted — a perf ceiling, not a gameplay bug
  const stats = BALANCE.strokes[cls];
  projectile.class = cls;
  projectile.x = x;
  projectile.z = z;
  projectile.damage = damage;
  projectile.pierceRemaining = cls === 'harai' ? BALANCE.strokes.harai.pierceCount : 1;
  projectile.splashRadiusU = cls === 'tome' ? BALANCE.strokes.tome.splashRadiusU * splashMultiplier : 0;
  projectile.distanceTraveledU = 0;
  projectile.maxRangeU = stats.rangeU * rangeMultiplier;
}

/** Moves every active projectile forward (+z, toward the oncoming Blot) and releases
 *  those past their class's range. */
export function updateProjectileMotion(pool: Pool<Projectile>, dt: number): void {
  // Iterate backward so release()'s swap-remove (which moves the last active item into
  // the released slot) never skips an unvisited item — the replacement comes from the
  // tail, which backward iteration hasn't reached yet.
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const p = pool.get(i);
    const step = BALANCE.strokes[p.class].projectileSpeedUPerS * dt;
    p.z += step;
    p.distanceTraveledU += step;
    if (p.distanceTraveledU >= p.maxRangeU) {
      pool.release(p);
    }
  }
}

export type DamageTargetKind = 'normal' | 'crust' | 'slip';

/** GAME_DESIGN.md §4's armour-multiplier table. `slipDamageMultiplier` (default 1) is
 *  the Reach Inkstone track's Slip-damage component (Task 4.2: "+2% Slip damage per
 *  level"), composing with the class's own `vsSlips` — irrelevant for any other
 *  `target`, so it's a no-op there rather than needing a separate parameter per target
 *  kind. */
export function applyArmorMultiplier(
  cls: StrokeClass,
  baseDamage: number,
  target: DamageTargetKind,
  slipDamageMultiplier = 1,
): number {
  const stats = BALANCE.strokes[cls];
  if (target === 'crust') return baseDamage * stats.vsCrust;
  if (target === 'slip') return baseDamage * stats.vsSlips * slipDamageMultiplier;
  return baseDamage;
}

/**
 * Registers a hit on `projectile`. Returns true if it should now be destroyed (out of
 * pierce budget) — Hane/Tome are always destroyed on their first hit; Harai survives
 * until it's hit `pierceCount` targets.
 */
export function registerHit(projectile: Projectile): boolean {
  projectile.pierceRemaining -= 1;
  return projectile.pierceRemaining <= 0;
}
