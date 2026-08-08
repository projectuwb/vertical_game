import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { BALANCE } from '../../src/sim/config.js';
import {
  computeClassWeights,
  createJoiningRecruitPool,
  createSlipPool,
  pickSlipClass,
  recruitCountFor,
  resolveSlipDeaths,
  slipHitRadiusU,
  spawnSlip,
  updateJoiningRecruits,
  updateSlipMotion,
} from '../../src/sim/slips.js';
import { createProjectilePool } from '../../src/sim/projectiles.js';
import { resolveProjectileSlipCollisions } from '../../src/sim/collision.js';
import type { StrokeClass } from '../../src/sim/stroke.js';

function zeroCounts(): Record<StrokeClass, number> {
  return { hane: 0, tome: 0, harai: 0 };
}

describe('spawnSlip / recruitCountFor', () => {
  it('sets hp per kind from BALANCE', () => {
    const pool = createSlipPool();
    expect(spawnSlip(pool, 'plusOne', 'hane', 0, 10)?.hp).toBe(BALANCE.slips.plusOne.hp);
    expect(spawnSlip(pool, 'plusFive', 'hane', 0, 10)?.hp).toBe(BALANCE.slips.plusFive.hp);
    expect(spawnSlip(pool, 'plusTwentyFive', 'hane', 0, 10)?.hp).toBe(BALANCE.slips.plusTwentyFive.hp);
  });

  it('grants the recruit count matching the kind name', () => {
    expect(recruitCountFor('plusOne')).toBe(1);
    expect(recruitCountFor('plusFive')).toBe(5);
    expect(recruitCountFor('plusTwentyFive')).toBe(25);
  });
});

describe('updateSlipMotion', () => {
  it('shifts every active Slip toward the Brush at the world forward speed (Slips have no speed stat of their own)', () => {
    const pool = createSlipPool();
    const s = spawnSlip(pool, 'plusOne', 'hane', 2, 30);
    if (s === undefined) throw new Error('spawn failed');

    updateSlipMotion(pool, 1);

    expect(s.z).toBeCloseTo(30 - BALANCE.forwardSpeed.baseUPerS, 9);
    expect(s.x).toBe(2); // lateral position is untouched
  });

  it('brings a distant Slip within Hane range after enough time (regression: Slips used to never move)', () => {
    const pool = createSlipPool();
    const s = spawnSlip(pool, 'plusOne', 'hane', 0, 30);
    if (s === undefined) throw new Error('spawn failed');

    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) updateSlipMotion(pool, dt); // 10s of world scroll

    expect(s.z).toBeLessThan(BALANCE.strokes.hane.rangeU);
  });
});

describe('slipHitRadiusU', () => {
  it('the +25 Banner spans a third of the lane width', () => {
    const expected = (BALANCE.lane.width * BALANCE.slips.plusTwentyFive.laneSpanFraction) / 2;
    expect(slipHitRadiusU('plusTwentyFive')).toBeCloseTo(expected, 9);
  });

  it('+1/+5 Slips use the standard collision hit radius', () => {
    expect(slipHitRadiusU('plusOne')).toBe(BALANCE.collision.hitRadiusU);
    expect(slipHitRadiusU('plusFive')).toBe(BALANCE.collision.hitRadiusU);
  });
});

describe('computeClassWeights', () => {
  it('weights the least-held class at leastHeldWeightMultiplier, others at 1', () => {
    const weights = computeClassWeights({ hane: 10, tome: 2, harai: 10 });
    expect(weights.tome).toBe(BALANCE.slips.leastHeldWeightMultiplier);
    expect(weights.hane).toBe(1);
    expect(weights.harai).toBe(1);
  });

  it('an all-zero Line weights the first class in iteration order (a stable tie-break)', () => {
    const weights = computeClassWeights(zeroCounts());
    expect(weights.hane).toBe(BALANCE.slips.leastHeldWeightMultiplier);
  });
});

describe('pickSlipClass', () => {
  it('over many draws, favours the least-held class by roughly the configured multiplier', () => {
    const rng = new RngRegistry(20260808);
    const counts = { hane: 0, tome: 50, harai: 50 }; // hane is starved
    const picks: Record<StrokeClass, number> = zeroCounts();
    const n = 20000;
    for (let i = 0; i < n; i++) {
      picks[pickSlipClass(counts, rng)]++;
    }
    // hane's weight is 1.5, tome/harai are 1 each: expected share = 1.5 / 3.5 ≈ 0.4286.
    const expectedShare = BALANCE.slips.leastHeldWeightMultiplier / (BALANCE.slips.leastHeldWeightMultiplier + 2);
    expect(picks.hane / n).toBeGreaterThan(expectedShare - 0.02);
    expect(picks.hane / n).toBeLessThan(expectedShare + 0.02);
  });

  it('is deterministic for a given RngRegistry seed (same seed → same sequence)', () => {
    const counts = { hane: 3, tome: 1, harai: 5 };
    const a = new RngRegistry(777);
    const b = new RngRegistry(777);
    const picksA = Array.from({ length: 50 }, () => pickSlipClass(counts, a));
    const picksB = Array.from({ length: 50 }, () => pickSlipClass(counts, b));
    expect(picksA).toEqual(picksB);
  });

  it("never picks a class outside the three that exist", () => {
    const rng = new RngRegistry(1);
    const counts = { hane: 1, tome: 1, harai: 1 };
    for (let i = 0; i < 500; i++) {
      expect(['hane', 'tome', 'harai']).toContain(pickSlipClass(counts, rng));
    }
  });
});

describe('recruit pipeline: Slip death → JoiningRecruit → arrival', () => {
  it('a destroyed Slip spawns exactly recruitCountFor(kind) recruits at its death position', () => {
    const slipPool = createSlipPool();
    const joiningPool = createJoiningRecruitPool();
    const s = spawnSlip(slipPool, 'plusFive', 'tome', 3, 15);
    if (s === undefined) throw new Error('spawn failed');
    s.hp = 0;

    resolveSlipDeaths(slipPool, joiningPool, { x: 0, z: 0 });

    expect(slipPool.activeCount).toBe(0);
    expect(joiningPool.activeCount).toBe(5);
    joiningPool.forEachActive((r) => {
      expect(r.class).toBe('tome');
      expect(r.x).toBe(3);
      expect(r.z).toBe(15);
    });
  });

  it('a recruit reaches its target and is released within the configured travel duration', () => {
    const joiningPool = createJoiningRecruitPool();
    const slipPool = createSlipPool();
    const s = spawnSlip(slipPool, 'plusOne', 'harai', 0, 10);
    if (s === undefined) throw new Error('spawn failed');
    s.hp = 0;
    resolveSlipDeaths(slipPool, joiningPool, { x: 5, z: 0 });

    const dt = 1 / 60;
    let arrivedClasses: StrokeClass[] = [];
    let elapsed = 0;
    // Task 2.5's acceptance bar: a Stroke lands within 1.2s of the kill.
    while (elapsed < 1.2 && arrivedClasses.length === 0) {
      arrivedClasses = updateJoiningRecruits(joiningPool, dt);
      elapsed += dt;
    }

    expect(arrivedClasses).toEqual(['harai']);
    expect(joiningPool.activeCount).toBe(0);
    expect(elapsed).toBeLessThanOrEqual(1.2);
  });

  it('a recruit interpolates smoothly from its start toward its target, never overshooting', () => {
    const joiningPool = createJoiningRecruitPool();
    const slipPool = createSlipPool();
    const s = spawnSlip(slipPool, 'plusOne', 'hane', -2, 8);
    if (s === undefined) throw new Error('spawn failed');
    s.hp = 0;
    resolveSlipDeaths(slipPool, joiningPool, { x: 4, z: 0 });

    const dt = 1 / 60;
    let lastDistance = Infinity;
    for (let i = 0; i < 60; i++) {
      updateJoiningRecruits(joiningPool, dt);
      if (joiningPool.activeCount === 0) break;
      const recruit = joiningPool.get(0);
      const dx = recruit.x - 4;
      const dz = recruit.z - 0;
      const distance = Math.sqrt(dx * dx + dz * dz);
      expect(distance).toBeLessThanOrEqual(lastDistance + 1e-9);
      lastDistance = distance;
    }
  });
});

describe('resolveProjectileSlipCollisions', () => {
  it('damages a Slip within the hit radius, applying the §4 armour multiplier', () => {
    const projectiles = createProjectilePool();
    const slips = createSlipPool();
    const proj = projectiles.acquire();
    if (proj === undefined) throw new Error('acquire failed');
    proj.class = 'harai';
    proj.x = 0;
    proj.z = 0;
    proj.damage = 4;
    proj.pierceRemaining = 1;
    proj.splashRadiusU = 0;

    const slip = spawnSlip(slips, 'plusOne', 'hane', 0, 0);
    if (slip === undefined) throw new Error('spawn failed');

    resolveProjectileSlipCollisions(projectiles, slips);

    expect(slip.hp).toBeCloseTo(BALANCE.slips.plusOne.hp - 4 * BALANCE.strokes.harai.vsSlips, 9);
  });

  it('a projectile outside the hit radius does not damage the Slip', () => {
    const projectiles = createProjectilePool();
    const slips = createSlipPool();
    const proj = projectiles.acquire();
    if (proj === undefined) throw new Error('acquire failed');
    proj.class = 'hane';
    proj.x = 0;
    proj.z = 0;
    proj.damage = 1;
    proj.pierceRemaining = 1;

    const slip = spawnSlip(slips, 'plusOne', 'hane', 100, 100);
    if (slip === undefined) throw new Error('spawn failed');

    resolveProjectileSlipCollisions(projectiles, slips);

    expect(slip.hp).toBe(BALANCE.slips.plusOne.hp);
  });
});

describe('end-to-end: shooting a Slip adds a Stroke of its class within 1.2s', () => {
  it('destroy → recruit → arrival, all classes', () => {
    for (const cls of ['hane', 'tome', 'harai'] as const) {
      const slipPool = createSlipPool();
      const joiningPool = createJoiningRecruitPool();
      const slip = spawnSlip(slipPool, 'plusOne', cls, 0, 20);
      if (slip === undefined) throw new Error('spawn failed');
      slip.hp = 0;

      resolveSlipDeaths(slipPool, joiningPool, { x: 0, z: 0 });

      let arrived: StrokeClass[] = [];
      let elapsed = 0;
      const dt = 1 / 60;
      while (elapsed <= 1.2 && arrived.length === 0) {
        arrived = updateJoiningRecruits(joiningPool, dt);
        elapsed += dt;
      }
      expect(arrived).toEqual([cls]);
    }
  });
});
