import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import {
  BLOT_CLASSES,
  classifyBlotForRender,
  createBlotPool,
  resolveBlotDeaths,
  resolveLineContact,
  spawnBlot,
  updateBlotMotion,
} from '../../src/sim/blot.js';

describe('spawnBlot', () => {
  it('sets hp to the class base HP from BALANCE', () => {
    const pool = createBlotPool();
    for (const cls of BLOT_CLASSES) {
      const b = spawnBlot(pool, cls, 0, 10);
      expect(b?.hp).toBe(BALANCE.blot[cls].hp);
    }
  });

  it('returns undefined once the pool is exhausted, without throwing', () => {
    const pool = createBlotPool();
    for (let i = 0; i < BALANCE.pools.blotCapacity; i++) {
      spawnBlot(pool, 'smudge', 0, 10);
    }
    expect(spawnBlot(pool, 'smudge', 0, 10)).toBeUndefined();
  });
});

describe('updateBlotMotion', () => {
  it('marches straight-line classes forward at their class speed', () => {
    const pool = createBlotPool();
    for (const cls of ['smudge', 'runner', 'crust', 'splitter'] as const) {
      const b = spawnBlot(pool, cls, 0, 100);
      if (b === undefined) throw new Error('spawn failed');
      updateBlotMotion(pool, 1, 0);
      expect(b.z).toBeCloseTo(100 - BALANCE.blot[cls].speedUPerS, 6);
    }
  });

  it('Drifter strafes laterally and bounces off both lane edges', () => {
    const pool = createBlotPool();
    const dt = 1 / 60;
    const b = spawnBlot(pool, 'drifter', BALANCE.lane.halfWidth - 0.001, 100);
    if (b === undefined) throw new Error('spawn failed');

    // At this speed a single step is already enough to cross the near edge.
    updateBlotMotion(pool, dt, -1000);
    expect(b.x).toBeCloseTo(BALANCE.lane.halfWidth, 6);
    expect(b.strafeDirection).toBe(-1);

    // Drive it all the way across to the opposite edge, stopping the instant it flips
    // back (further steps would carry it back off the edge in the new direction).
    const maxSteps =
      Math.ceil((2 * BALANCE.lane.halfWidth) / (BALANCE.blot.drifter.strafeUPerS * dt)) + 2;
    for (let i = 0; i < maxSteps && b.strafeDirection === -1; i++) {
      updateBlotMotion(pool, dt, -1000);
    }
    expect(b.x).toBeCloseTo(-BALANCE.lane.halfWidth, 6);
    expect(b.strafeDirection).toBe(1);
  });

  it('never lets Drifter escape the lane bounds', () => {
    const pool = createBlotPool();
    const b = spawnBlot(pool, 'drifter', 0, 100);
    if (b === undefined) throw new Error('spawn failed');
    for (let i = 0; i < 6000; i++) {
      updateBlotMotion(pool, 1 / 60, -1000);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(BALANCE.lane.halfWidth + 1e-9);
    }
  });

  it('Blotter stops at its stop distance instead of continuing to the Brush', () => {
    const pool = createBlotPool();
    const brushZ = 0;
    const b = spawnBlot(pool, 'blotter', 0, 100);
    if (b === undefined) throw new Error('spawn failed');

    const dt = 1 / 60;
    for (let i = 0; i < 6000; i++) updateBlotMotion(pool, dt, brushZ);

    expect(b.stopped).toBe(true);
    // Discrete stepping can land up to one step's distance short of the exact
    // threshold, never past it.
    const oneStep = BALANCE.blot.blotter.speedUPerS * dt;
    expect(b.z).toBeLessThanOrEqual(brushZ + BALANCE.blot.blotter.stopDistanceU + 1e-9);
    expect(b.z).toBeGreaterThan(brushZ + BALANCE.blot.blotter.stopDistanceU - oneStep - 1e-9);
  });

  it('Blotter lobs ink at the expected rate once stopped', () => {
    const pool = createBlotPool();
    const brushZ = 0;
    const b = spawnBlot(pool, 'blotter', 0, BALANCE.blot.blotter.stopDistanceU);
    if (b === undefined) throw new Error('spawn failed');

    let totalLobs = 0;
    const dt = 1 / 60;
    const seconds = 10;
    for (let i = 0; i < seconds * 60; i++) {
      totalLobs += updateBlotMotion(pool, dt, brushZ);
    }

    const expected = seconds / BALANCE.blot.blotter.lobIntervalS;
    expect(totalLobs).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
    expect(totalLobs).toBeLessThanOrEqual(Math.ceil(expected) + 1);
  });
});

describe('resolveLineContact', () => {
  it('a normal Blot reaching the Brush kills exactly 1 Stroke and dies', () => {
    const pool = createBlotPool();
    spawnBlot(pool, 'smudge', 0, -1); // already past the Brush
    const result = resolveLineContact(pool, 0);
    expect(result.strokesLost).toBe(1);
    expect(result.crustInvolved).toBe(false);
    expect(pool.activeCount).toBe(0);
  });

  it('a Crust reaching the Brush kills exactly 3 Strokes, dies, and reports crustInvolved', () => {
    const pool = createBlotPool();
    spawnBlot(pool, 'crust', 0, -1);
    const result = resolveLineContact(pool, 0);
    expect(result.strokesLost).toBe(3);
    expect(result.crustInvolved).toBe(true);
    expect(pool.activeCount).toBe(0);
  });

  it('Blot ahead of the Brush do not trigger contact', () => {
    const pool = createBlotPool();
    spawnBlot(pool, 'smudge', 0, 5);
    const result = resolveLineContact(pool, 0);
    expect(result.strokesLost).toBe(0);
    expect(pool.activeCount).toBe(1);
  });

  it('sums correctly across a mixed group in one step', () => {
    const pool = createBlotPool();
    spawnBlot(pool, 'smudge', -1, -1);
    spawnBlot(pool, 'crust', 0, -1);
    spawnBlot(pool, 'runner', 1, -2);
    spawnBlot(pool, 'drifter', 2, 5); // not in contact
    const result = resolveLineContact(pool, 0);
    expect(result.strokesLost).toBe(1 + 3 + 1);
    expect(result.crustInvolved).toBe(true);
    expect(pool.activeCount).toBe(1); // only the drifter remains
  });
});

describe('resolveBlotDeaths', () => {
  it('releases Blot at hp <= 0 and leaves living ones untouched', () => {
    const pool = createBlotPool();
    const alive = spawnBlot(pool, 'smudge', 0, 10);
    const dead = spawnBlot(pool, 'smudge', 1, 10);
    if (alive === undefined || dead === undefined) throw new Error('spawn failed');
    dead.hp = 0;

    const killedCount = resolveBlotDeaths(pool);

    expect(pool.activeCount).toBe(1);
    expect(killedCount).toBe(1);
    let survivorX = -999;
    pool.forEachActive((b) => (survivorX = b.x));
    expect(survivorX).toBe(0);
  });

  it('Splitter spawns exactly 3 Smudges spread across ±spawnOffsetU at its death position', () => {
    const pool = createBlotPool();
    const splitter = spawnBlot(pool, 'splitter', 5, 20);
    if (splitter === undefined) throw new Error('spawn failed');
    splitter.hp = 0;

    resolveBlotDeaths(pool);

    expect(pool.activeCount).toBe(3);
    const xs: number[] = [];
    pool.forEachActive((b) => {
      expect(b.class).toBe('smudge');
      expect(b.z).toBeCloseTo(20, 9);
      xs.push(b.x);
    });
    xs.sort((a, b) => a - b);
    const offset = BALANCE.blot.splitter.spawnOffsetU;
    expect(xs).toEqual([5 - offset, 5, 5 + offset]);
  });

  it('handles many simultaneous Splitter deaths without skipping or crashing (backward-iteration correctness)', () => {
    const pool = createBlotPool();
    const count = 100;
    for (let i = 0; i < count; i++) {
      const b = spawnBlot(pool, 'splitter', i, 10);
      if (b === undefined) throw new Error('spawn failed');
      b.hp = 0;
    }
    expect(pool.activeCount).toBe(count);

    resolveBlotDeaths(pool);

    expect(pool.activeCount).toBe(count * 3);
    let smudgeCount = 0;
    pool.forEachActive((b) => {
      if (b.class === 'smudge') smudgeCount++;
    });
    expect(smudgeCount).toBe(count * 3);
  });

  it('a mix of surviving and dying Blot resolves exactly (no extras, no losses)', () => {
    const pool = createBlotPool();
    for (let i = 0; i < 40; i++) {
      const b = spawnBlot(pool, i % 2 === 0 ? 'smudge' : 'crust', i, 10);
      if (b === undefined) throw new Error('spawn failed');
      if (i % 3 === 0) b.hp = 0; // kill every third one
    }
    const survivorsExpected = 40 - Math.ceil(40 / 3);

    resolveBlotDeaths(pool);

    expect(pool.activeCount).toBe(survivorsExpected);
    pool.forEachActive((b) => expect(b.hp).toBeGreaterThan(0));
  });
});

describe('classifyBlotForRender', () => {
  it('is always individual at or below the mass threshold, regardless of distance', () => {
    expect(classifyBlotForRender(BALANCE.blotRender.massThresholdCount, 1000)).toBe('individual');
    expect(classifyBlotForRender(1, 1000)).toBe('individual');
  });

  it('above the threshold, only Blot within massRenderDistanceU stay individual', () => {
    const above = BALANCE.blotRender.massThresholdCount + 1;
    expect(classifyBlotForRender(above, 0)).toBe('individual');
    expect(classifyBlotForRender(above, BALANCE.blotRender.massRenderDistanceU)).toBe('individual');
    expect(classifyBlotForRender(above, BALANCE.blotRender.massRenderDistanceU + 0.01)).toBe('mass');
  });
});
