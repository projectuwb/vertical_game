import { describe, expect, it } from 'vitest';
import { FIXED_DT, FixedStepLoop, MAX_CATCHUP_STEPS, type LoopCallbacks } from '../../src/core/loop.js';

function makeRecordingCallbacks(): LoopCallbacks & { updateCount: number; alphas: number[] } {
  const state = {
    updateCount: 0,
    alphas: [] as number[],
    update(_dtFixed: number): void {
      state.updateCount++;
    },
    render(alpha: number): void {
      state.alphas.push(alpha);
    },
  };
  return state;
}

describe('FixedStepLoop', () => {
  it('drives ~N steps for N frames of fixed-dt length, with no compounding drift', () => {
    const cb = makeRecordingCallbacks();
    const loop = new FixedStepLoop(cb);

    const frameMs = FIXED_DT * 1000;
    const totalFrames = 10_000;

    // Compute each timestamp fresh (i * frameMs) rather than accumulating via +=,
    // so the test isn't itself measuring float error in its own loop.
    let t = 0;
    loop.advance(t); // primes lastNowMs, takes no steps
    for (let i = 1; i <= totalFrames; i++) {
      t = i * frameMs;
      loop.advance(t);
    }

    const stepsAfterFirstHalf = loop.totalStepCount;
    // A single frame's worth of rounding at the IEEE-754 boundary is expected and fine —
    // what "no drift" means is that error doesn't grow as the run continues.
    expect(stepsAfterFirstHalf).toBeGreaterThanOrEqual(totalFrames - 1);
    expect(stepsAfterFirstHalf).toBeLessThanOrEqual(totalFrames);
    expect(cb.updateCount).toBe(stepsAfterFirstHalf);

    for (let i = totalFrames + 1; i <= totalFrames * 2; i++) {
      t = i * frameMs;
      loop.advance(t);
    }

    const stepsAfterSecondHalf = loop.totalStepCount;
    const secondHalfSteps = stepsAfterSecondHalf - stepsAfterFirstHalf;
    // If rounding error compounded over time, the second identical-length segment
    // would diverge noticeably from the first. It doesn't — that's the "no drift" claim.
    expect(Math.abs(secondHalfSteps - stepsAfterFirstHalf)).toBeLessThanOrEqual(1);
    expect(stepsAfterSecondHalf).toBeGreaterThanOrEqual(totalFrames * 2 - 1);
    expect(stepsAfterSecondHalf).toBeLessThanOrEqual(totalFrames * 2);
  });

  it('accumulates irregular frame times without losing or duplicating simulation time', () => {
    const cb = makeRecordingCallbacks();
    const loop = new FixedStepLoop(cb);

    // Jittered frame lengths averaging ~1/60s, summing to exactly 500 * FIXED_DT.
    const pattern = [0.4, 1.6, 0.9, 1.1] as const; // multiples of FIXED_DT, sums to 4
    const cycles = 125; // 125 * 4 = 500 fixed-dt units total
    let t = 0;
    loop.advance(t);
    for (let c = 0; c < cycles; c++) {
      for (const mult of pattern) {
        t += mult * FIXED_DT * 1000;
        loop.advance(t);
      }
    }

    const expectedSteps = Math.floor((cycles * pattern.reduce((a, b) => a + b, 0) * FIXED_DT) / FIXED_DT);
    expect(loop.totalStepCount).toBe(expectedSteps);
  });

  it('clamps catch-up so a huge frame gap only ever runs maxCatchUpSteps', () => {
    const cb = makeRecordingCallbacks();
    const loop = new FixedStepLoop(cb);

    loop.advance(0);
    loop.advance(10_000); // 10s gap — would be 600 steps uncapped

    expect(loop.totalStepCount).toBe(MAX_CATCHUP_STEPS);
  });

  it('does not step while paused, and resuming does not burst catch-up steps', () => {
    const cb = makeRecordingCallbacks();
    const loop = new FixedStepLoop(cb);

    loop.advance(0);
    loop.pause();
    loop.advance(5000);
    loop.advance(9000);
    expect(loop.totalStepCount).toBe(0);
    expect(loop.isPaused).toBe(true);

    loop.resume();
    loop.advance(9016); // ~1 fixed-dt after resume's internal re-prime
    expect(loop.totalStepCount).toBeLessThanOrEqual(1);
  });

  it('reset clears step count and accumulator', () => {
    const cb = makeRecordingCallbacks();
    const loop = new FixedStepLoop(cb);
    loop.advance(0);
    loop.advance(1000);
    expect(loop.totalStepCount).toBeGreaterThan(0);

    loop.reset();
    expect(loop.totalStepCount).toBe(0);
    expect(loop.getStats().totalSteps).toBe(0);
  });
});
