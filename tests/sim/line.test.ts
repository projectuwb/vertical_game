import { describe, expect, it } from 'vitest';
import { stepCriticallyDamped, type DampedFollower1D } from '../../src/sim/line.js';

const TAU = 0.07;
const DT = 1 / 60;

describe('stepCriticallyDamped', () => {
  it('does not overshoot a step input', () => {
    let state: DampedFollower1D = { position: 0, velocity: 0 };
    const target = 4;
    let maxPosition = 0;
    for (let i = 0; i < 600; i++) {
      state = stepCriticallyDamped(state, target, DT, TAU);
      maxPosition = Math.max(maxPosition, state.position);
    }
    expect(maxPosition).toBeLessThanOrEqual(target + 1e-9);
  });

  it('converges to the target and settles (zero velocity) when the target stops moving', () => {
    let state: DampedFollower1D = { position: -3, velocity: 2 };
    const target = 2.5;
    for (let i = 0; i < 600; i++) {
      state = stepCriticallyDamped(state, target, DT, TAU);
    }
    expect(state.position).toBeCloseTo(target, 6);
    expect(state.velocity).toBeCloseTo(0, 6);
  });

  it('is a no-op for dt = 0', () => {
    const state: DampedFollower1D = { position: 1.5, velocity: -0.4 };
    const next = stepCriticallyDamped(state, 3, 0, TAU);
    expect(next.position).toBeCloseTo(state.position, 9);
    expect(next.velocity).toBeCloseTo(state.velocity, 9);
  });

  it('holds steady when already at rest on target', () => {
    const state: DampedFollower1D = { position: 5, velocity: 0 };
    const next = stepCriticallyDamped(state, 5, DT, TAU);
    expect(next.position).toBeCloseTo(5, 9);
    expect(next.velocity).toBeCloseTo(0, 9);
  });

  it('responds faster with a smaller time constant', () => {
    let fast: DampedFollower1D = { position: 0, velocity: 0 };
    let slow: DampedFollower1D = { position: 0, velocity: 0 };
    for (let i = 0; i < 10; i++) {
      fast = stepCriticallyDamped(fast, 1, DT, 0.03);
      slow = stepCriticallyDamped(slow, 1, DT, 0.2);
    }
    expect(fast.position).toBeGreaterThan(slow.position);
  });
});
