import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import {
  applyArmorMultiplier,
  computeFiringPlan,
  createFiringAccumulators,
  createProjectilePool,
  registerHit,
  updateFiring,
  updateProjectileMotion,
  type FrontRowSource,
} from '../../src/sim/projectiles.js';
import type { StrokeClass } from '../../src/sim/stroke.js';

describe('computeFiringPlan', () => {
  it('front-row-only DPS matches count * class fire rate, under the cap', () => {
    const plan = computeFiringPlan('hane', 3, 0);
    expect(plan.spawnRatePerS).toBeCloseTo(3 * BALANCE.strokes.hane.fireRatePerS, 9);
    expect(plan.damagePerProjectile).toBeCloseTo(BALANCE.strokes.hane.damage, 9);
  });

  it('back-row Strokes contribute at extraRowDpsContribution (55%) of a full Stroke', () => {
    const frontOnly = computeFiringPlan('tome', 5, 0);
    const withBack = computeFiringPlan('tome', 5, 5);
    const expectedRateIncrease =
      5 * BALANCE.strokes.tome.fireRatePerS * BALANCE.line.extraRowDpsContribution;
    expect(withBack.spawnRatePerS - frontOnly.spawnRatePerS).toBeCloseTo(expectedRateIncrease, 6);
  });

  it('caps spawn rate at maxVisibleProjectilesPerClassPerS and preserves total DPS via damage multiplier', () => {
    // A very large Line (N=400) — deliberately exercises Task 2.3's "cap holds at N=400" criterion.
    const frontRowCount = 5;
    const backRowCount = 395;
    const plan = computeFiringPlan('harai', frontRowCount, backRowCount);

    expect(plan.spawnRatePerS).toBeCloseTo(BALANCE.line.maxVisibleProjectilesPerClassPerS, 9);

    const stats = BALANCE.strokes.harai;
    const desiredRate =
      stats.fireRatePerS * (frontRowCount + backRowCount * BALANCE.line.extraRowDpsContribution);
    const totalDpsViaCappedPlan = plan.spawnRatePerS * plan.damagePerProjectile;
    const totalDpsUncapped = desiredRate * stats.damage;
    expect(totalDpsViaCappedPlan).toBeCloseTo(totalDpsUncapped, 6);
  });

  it('a class with zero Strokes produces zero rate and zero damage', () => {
    const plan = computeFiringPlan('tome', 0, 0);
    expect(plan.spawnRatePerS).toBe(0);
    expect(plan.damagePerProjectile).toBe(0);
  });
});

describe('updateFiring + projectile pool', () => {
  function oneSource(x = 0, z = 0): Record<StrokeClass, readonly FrontRowSource[]> {
    return { hane: [{ x, z }], tome: [{ x, z }], harai: [{ x, z }] };
  }

  it('spawns projectiles at the expected long-run rate', () => {
    const pool = createProjectilePool();
    const acc = createFiringAccumulators();
    const front = { hane: 1, tome: 0, harai: 0 } as const;
    const back = { hane: 0, tome: 0, harai: 0 } as const;
    const sources = oneSource();

    const dt = 1 / 60;
    const seconds = 5;
    for (let i = 0; i < seconds * 60; i++) {
      updateFiring(acc, pool, dt, { ...front }, { ...back }, sources);
    }

    const expectedShots = BALANCE.strokes.hane.fireRatePerS * seconds;
    expect(pool.activeCount).toBeGreaterThanOrEqual(Math.floor(expectedShots) - 1);
    expect(pool.activeCount).toBeLessThanOrEqual(Math.ceil(expectedShots) + 1);
  });

  it('never spawns more than maxVisibleProjectilesPerClassPerS worth of pool growth in one second, even at N=400', () => {
    const pool = createProjectilePool();
    const acc = createFiringAccumulators();
    const front = { hane: 0, tome: 0, harai: 5 } as const;
    const back = { hane: 0, tome: 0, harai: 395 } as const;
    const sources = oneSource();

    const dt = 1 / 60;
    let spawnedInFirstSecond = 0;
    let previousActive = 0;
    for (let i = 0; i < 60; i++) {
      updateFiring(acc, pool, dt, { ...front }, { ...back }, sources);
      spawnedInFirstSecond += Math.max(0, pool.activeCount - previousActive);
      previousActive = pool.activeCount;
    }

    expect(spawnedInFirstSecond).toBeLessThanOrEqual(
      Math.ceil(BALANCE.line.maxVisibleProjectilesPerClassPerS) + 1,
    );
  });

  it('resets the accumulator (not left drifting) when a class loses its front-row muzzle', () => {
    const pool = createProjectilePool();
    const acc = createFiringAccumulators();
    const front = { hane: 3, tome: 0, harai: 0 } as const;
    const back = { hane: 0, tome: 0, harai: 0 } as const;

    updateFiring(acc, pool, 0.13, { ...front }, { ...back }, oneSource());
    expect(acc.hane.timeAccumulator).toBeGreaterThan(0);

    updateFiring(acc, pool, 0.5, { ...front }, { ...back }, { hane: [], tome: [], harai: [] });
    expect(acc.hane.timeAccumulator).toBe(0);
  });

  it('cycles through multiple front-row muzzles rather than stacking all shots at one point', () => {
    const pool = createProjectilePool();
    const acc = createFiringAccumulators();
    const front = { hane: 5, tome: 0, harai: 0 } as const;
    const back = { hane: 0, tome: 0, harai: 0 } as const;
    const sources = {
      hane: [
        { x: -1, z: 0 },
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      tome: [],
      harai: [],
    };

    for (let i = 0; i < 120; i++) {
      updateFiring(acc, pool, 1 / 60, { ...front }, { ...back }, sources);
    }

    const xs = new Set<number>();
    pool.forEachActive((p) => xs.add(p.x));
    expect(xs.size).toBeGreaterThan(1);
  });
});

describe('updateProjectileMotion', () => {
  it('moves projectiles forward at the class projectile speed', () => {
    const pool = createProjectilePool();
    const p = pool.acquire();
    if (p === undefined) throw new Error('pool should not be exhausted');
    p.class = 'hane';
    p.z = 0;
    p.maxRangeU = 1000;
    p.distanceTraveledU = 0;

    updateProjectileMotion(pool, 1);
    expect(p.z).toBeCloseTo(BALANCE.strokes.hane.projectileSpeedUPerS, 6);
  });

  it('releases a projectile once it exceeds its class range', () => {
    const pool = createProjectilePool();
    const p = pool.acquire();
    if (p === undefined) throw new Error('pool should not be exhausted');
    p.class = 'tome';
    p.z = 0;
    p.maxRangeU = BALANCE.strokes.tome.rangeU;
    p.distanceTraveledU = 0;

    expect(pool.activeCount).toBe(1);
    const secondsToExpire = p.maxRangeU / BALANCE.strokes.tome.projectileSpeedUPerS + 0.1;
    updateProjectileMotion(pool, secondsToExpire);
    expect(pool.activeCount).toBe(0);
  });

  it('handles many simultaneous expirations without skipping (backward-iteration correctness)', () => {
    const pool = createProjectilePool();
    for (let i = 0; i < 50; i++) {
      const p = pool.acquire();
      if (p === undefined) throw new Error('pool should not be exhausted');
      p.class = 'hane';
      p.z = 0;
      p.maxRangeU = 1; // tiny range — all should expire on the first big step
      p.distanceTraveledU = 0;
    }
    expect(pool.activeCount).toBe(50);
    updateProjectileMotion(pool, 10);
    expect(pool.activeCount).toBe(0);
  });
});

describe('applyArmorMultiplier', () => {
  it('matches GAME_DESIGN.md §4 exactly', () => {
    expect(applyArmorMultiplier('hane', 10, 'crust')).toBeCloseTo(10 * BALANCE.strokes.hane.vsCrust, 9);
    expect(applyArmorMultiplier('tome', 10, 'crust')).toBeCloseTo(10 * BALANCE.strokes.tome.vsCrust, 9);
    expect(applyArmorMultiplier('harai', 10, 'crust')).toBeCloseTo(10 * BALANCE.strokes.harai.vsCrust, 9);
    expect(applyArmorMultiplier('harai', 10, 'slip')).toBeCloseTo(10 * BALANCE.strokes.harai.vsSlips, 9);
  });

  it('applies no multiplier against normal targets', () => {
    expect(applyArmorMultiplier('hane', 7, 'normal')).toBe(7);
  });
});

describe('registerHit (pierce)', () => {
  it('Hane and Tome are destroyed on their first hit', () => {
    const pool = createProjectilePool();
    for (const cls of ['hane', 'tome'] as const) {
      const p = pool.acquire();
      if (p === undefined) throw new Error('pool should not be exhausted');
      p.class = cls;
      p.pierceRemaining = 1;
      expect(registerHit(p)).toBe(true);
    }
  });

  it('Harai survives until it has hit pierceCount targets', () => {
    const pool = createProjectilePool();
    const p = pool.acquire();
    if (p === undefined) throw new Error('pool should not be exhausted');
    p.class = 'harai';
    p.pierceRemaining = BALANCE.strokes.harai.pierceCount;

    let destroyed = false;
    let hits = 0;
    while (!destroyed) {
      destroyed = registerHit(p);
      hits++;
    }
    expect(hits).toBe(BALANCE.strokes.harai.pierceCount);
  });
});
