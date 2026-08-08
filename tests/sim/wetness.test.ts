import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import {
  createInkPoolPool,
  createWetnessState,
  isWetnessDry,
  resolveInkPoolContact,
  spawnInkPool,
  spendWetness,
  stepWetness,
  updateInkPoolMotion,
} from '../../src/sim/wetness.js';

describe('createWetnessState', () => {
  it('starts full', () => {
    const w = createWetnessState();
    expect(w.current).toBe(BALANCE.wetness.max);
    expect(isWetnessDry(w)).toBe(false);
  });
});

describe('stepWetness', () => {
  it('drains at drainPerSWhileFiring while firing, regardless of any Line size (flat)', () => {
    let w = createWetnessState();
    w = stepWetness(w, 1, true);
    expect(w.current).toBeCloseTo(BALANCE.wetness.max - BALANCE.wetness.drainPerSWhileFiring, 9);
  });

  it('clamps at 0 rather than going negative', () => {
    let w = createWetnessState();
    w = stepWetness(w, 1000, true);
    expect(w.current).toBe(0);
    expect(isWetnessDry(w)).toBe(true);
  });

  it('does not refill until refillDelayS has passed since firing stopped', () => {
    let w = createWetnessState();
    w = stepWetness(w, 1, true); // drain a bit, and firing
    const afterDrain = w.current;
    w = stepWetness(w, BALANCE.wetness.refillDelayS - 0.01, false);
    expect(w.current).toBeCloseTo(afterDrain, 9); // unchanged — still inside the delay window
  });

  it('refills at refillPerSAfterDelay once the delay has passed', () => {
    let w = createWetnessState();
    w = stepWetness(w, 1, true);
    const afterDrain = w.current;
    w = stepWetness(w, BALANCE.wetness.refillDelayS, false); // clears the delay exactly
    w = stepWetness(w, 0.1, false); // small enough not to clamp at max
    expect(w.current).toBeCloseTo(afterDrain + BALANCE.wetness.refillPerSAfterDelay * 0.1, 9);
  });

  it('resets the not-firing timer the instant firing resumes', () => {
    let w = createWetnessState();
    w = stepWetness(w, 1, true);
    w = stepWetness(w, BALANCE.wetness.refillDelayS + 0.5, false); // now refilling
    const refilled = w.current;
    w = stepWetness(w, 0.01, true); // fires again — refill timer must reset
    w = stepWetness(w, BALANCE.wetness.refillDelayS - 0.01, false);
    expect(w.current).toBeLessThan(refilled); // still net-drained, not refilled again yet
  });

  it('clamps at max rather than overfilling', () => {
    let w = createWetnessState();
    w = stepWetness(w, 1, true);
    w = stepWetness(w, BALANCE.wetness.refillDelayS + 1000, false);
    expect(w.current).toBe(BALANCE.wetness.max);
  });
});

describe('spendWetness', () => {
  it('subtracts the amount, clamped at 0', () => {
    const w = createWetnessState();
    expect(spendWetness(w, BALANCE.flourish.cost).current).toBe(BALANCE.wetness.max - BALANCE.flourish.cost);
    expect(spendWetness(w, 10000).current).toBe(0);
  });
});

describe('ink pools', () => {
  it('spawnInkPool sets position; updateInkPoolMotion scrolls toward the Brush at the world forward speed', () => {
    const pool = createInkPoolPool();
    const p = spawnInkPool(pool, 2, 30);
    if (p === undefined) throw new Error('spawn failed');
    updateInkPoolMotion(pool, 1);
    expect(p.z).toBeCloseTo(30 - BALANCE.forwardSpeed.baseUPerS, 9);
    expect(p.x).toBe(2);
  });

  it('restores poolRestoreAmount and releases the pool on contact within poolHitRadiusU', () => {
    const pool = createInkPoolPool();
    spawnInkPool(pool, 0, -1); // already at/past the Brush
    let w = createWetnessState();
    w = spendWetness(w, 50);
    const before = w.current;

    w = resolveInkPoolContact(pool, w, 0, 0);

    expect(pool.activeCount).toBe(0);
    expect(w.current).toBeCloseTo(Math.min(BALANCE.wetness.max, before + BALANCE.wetness.poolRestoreAmount), 9);
  });

  it('does not restore Wetness beyond max', () => {
    const pool = createInkPoolPool();
    spawnInkPool(pool, 0, -1);
    const w = resolveInkPoolContact(pool, createWetnessState(), 0, 0);
    expect(w.current).toBe(BALANCE.wetness.max);
  });

  it('releases the pool without restoring Wetness if the Brush is outside poolHitRadiusU', () => {
    const pool = createInkPoolPool();
    spawnInkPool(pool, BALANCE.wetness.poolHitRadiusU + 1, -1);
    let w = createWetnessState();
    w = spendWetness(w, 50);
    const before = w.current;

    w = resolveInkPoolContact(pool, w, 0, 0);

    expect(pool.activeCount).toBe(0); // still consumed — a puddle driven past without touching is gone
    expect(w.current).toBe(before);
  });

  it('leaves a pool that has not yet reached the Brush untouched', () => {
    const pool = createInkPoolPool();
    spawnInkPool(pool, 0, 5);
    resolveInkPoolContact(pool, createWetnessState(), 0, 0);
    expect(pool.activeCount).toBe(1);
  });
});
