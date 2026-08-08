import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import {
  applyFlourishSweep,
  createFlourishState,
  flourishChargeFraction,
  isFlourishReady,
  stepFlourishInput,
} from '../../src/sim/flourish.js';
import { createBlotPool, spawnBlot } from '../../src/sim/blot.js';

const FULL_WETNESS = BALANCE.wetness.max;

describe('createFlourishState', () => {
  it('starts idle and ready', () => {
    const f = createFlourishState();
    expect(f.chargeStartS).toBeNull();
    expect(f.isPulsing).toBe(false);
    expect(isFlourishReady(f, 0)).toBe(true);
  });
});

describe('stepFlourishInput', () => {
  it('starting a hold with enough Wetness and off cooldown begins a valid charge', () => {
    const f = createFlourishState();
    const result = stepFlourishInput(f, 10, true, false, FULL_WETNESS);
    expect(result.state.chargeStartS).toBe(10);
    expect(result.state.isPulsing).toBe(false);
    expect(result.triggered).toBe(false);
  });

  it('starting a hold below minWetnessToCharge pulses instead of charging', () => {
    const f = createFlourishState();
    const result = stepFlourishInput(f, 10, true, false, BALANCE.flourish.minWetnessToCharge - 1);
    expect(result.state.chargeStartS).toBeNull();
    expect(result.state.isPulsing).toBe(true);
  });

  it('starting a hold while still on cooldown pulses even with full Wetness', () => {
    const onCooldown = { chargeStartS: null, cooldownUntilS: 20, isPulsing: false };
    const result = stepFlourishInput(onCooldown, 10, true, false, FULL_WETNESS);
    expect(result.state.chargeStartS).toBeNull();
    expect(result.state.isPulsing).toBe(true);
  });

  it('releasing before chargeTimeS has elapsed does nothing — no trigger, no cooldown', () => {
    let f = createFlourishState();
    f = stepFlourishInput(f, 10, true, false, FULL_WETNESS).state;
    const early = 10 + BALANCE.flourish.chargeTimeS - 0.01;
    const result = stepFlourishInput(f, early, false, true, FULL_WETNESS);
    expect(result.triggered).toBe(false);
    expect(result.state.chargeStartS).toBeNull();
    expect(isFlourishReady(result.state, early)).toBe(true); // no cooldown was spent
  });

  it('releasing at or after chargeTimeS triggers and starts the cooldown', () => {
    let f = createFlourishState();
    f = stepFlourishInput(f, 10, true, false, FULL_WETNESS).state;
    // A hair past the exact float sum of 10 + chargeTimeS, which can round to fractionally
    // under chargeTimeS elapsed and make the >= check a coin flip on floating point noise.
    const releaseAt = 10 + BALANCE.flourish.chargeTimeS + 1e-6;
    const result = stepFlourishInput(f, releaseAt, false, true, FULL_WETNESS);
    expect(result.triggered).toBe(true);
    expect(result.state.cooldownUntilS).toBeCloseTo(releaseAt + BALANCE.flourish.cooldownS, 9);
    expect(isFlourishReady(result.state, releaseAt)).toBe(false);
  });

  it('releasing a pulsing (invalid) hold never triggers, however long it was held', () => {
    let f = createFlourishState();
    f = stepFlourishInput(f, 10, true, false, 0).state; // invalid — insufficient Wetness
    expect(f.isPulsing).toBe(true);
    const result = stepFlourishInput(f, 10 + BALANCE.flourish.chargeTimeS + 5, false, true, FULL_WETNESS);
    expect(result.triggered).toBe(false);
  });

  it('mid-hold and mid-release (no edge) leaves state untouched', () => {
    const f = createFlourishState();
    expect(stepFlourishInput(f, 5, true, true, FULL_WETNESS).state).toBe(f);
    expect(stepFlourishInput(f, 5, false, false, FULL_WETNESS).state).toBe(f);
  });
});

describe('flourishChargeFraction', () => {
  it('is 0 when not charging', () => {
    expect(flourishChargeFraction(createFlourishState(), 5)).toBe(0);
  });

  it('rises linearly from 0 to 1 over chargeTimeS, then clamps at 1', () => {
    const f = { chargeStartS: 10, cooldownUntilS: 0, isPulsing: false };
    expect(flourishChargeFraction(f, 10)).toBeCloseTo(0, 9);
    expect(flourishChargeFraction(f, 10 + BALANCE.flourish.chargeTimeS / 2)).toBeCloseTo(0.5, 9);
    expect(flourishChargeFraction(f, 10 + BALANCE.flourish.chargeTimeS)).toBeCloseTo(1, 9);
    expect(flourishChargeFraction(f, 10 + BALANCE.flourish.chargeTimeS + 5)).toBe(1);
  });
});

describe('applyFlourishSweep', () => {
  it('matches the §6 formula: 28 * (1 + 0.15 * rowCount)', () => {
    const pool = createBlotPool();
    const b = spawnBlot(pool, 'smudge', 0, 2);
    if (b === undefined) throw new Error('spawn failed');
    const hpBefore = b.hp;
    const rowCount = 3;

    applyFlourishSweep(pool, 0, 0, rowCount);

    const expectedDamage = BALANCE.flourish.damageBase * (1 + BALANCE.flourish.damagePerRow * rowCount);
    expect(hpBefore - b.hp).toBeCloseTo(expectedDamage, 9);
  });

  it('knocks a hit Blot back by knockbackU', () => {
    const pool = createBlotPool();
    const b = spawnBlot(pool, 'smudge', 0, 2);
    if (b === undefined) throw new Error('spawn failed');
    applyFlourishSweep(pool, 0, 0, 1);
    expect(b.z).toBeCloseTo(2 + BALANCE.flourish.knockbackU, 9);
  });

  it('never hits a Blot behind the Brush (dz < 0)', () => {
    const pool = createBlotPool();
    const b = spawnBlot(pool, 'smudge', 0, -1);
    if (b === undefined) throw new Error('spawn failed');
    const hpBefore = b.hp;
    applyFlourishSweep(pool, 0, 0, 1);
    expect(b.hp).toBe(hpBefore);
  });

  it('never hits a Blot outside radiusU', () => {
    const pool = createBlotPool();
    const b = spawnBlot(pool, 'smudge', BALANCE.flourish.radiusU + 1, 0);
    if (b === undefined) throw new Error('spawn failed');
    const hpBefore = b.hp;
    applyFlourishSweep(pool, 0, 0, 1);
    expect(b.hp).toBe(hpBefore);
  });
});
