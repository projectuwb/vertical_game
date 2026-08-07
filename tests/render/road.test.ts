import { describe, expect, it } from 'vitest';
import { computeDashSpans } from '../../src/render/road.js';

const NEAR_Z = -4;
const FAR_Z = 200;
const PERIOD = 6;
const LENGTH = 3;

describe('computeDashSpans', () => {
  it('produces non-overlapping, ordered spans covering the visible range', () => {
    const spans = computeDashSpans(0, NEAR_Z, FAR_Z, PERIOD, LENGTH);
    for (let i = 0; i < spans.length; i++) {
      const [near, far] = spans[i]!;
      expect(far).toBeGreaterThan(near);
      expect(near).toBeGreaterThanOrEqual(NEAR_Z);
      expect(far).toBeLessThanOrEqual(FAR_Z);
      if (i > 0) {
        const [, prevFar] = spans[i - 1]!;
        expect(near).toBeGreaterThanOrEqual(prevFar);
      }
    }
  });

  it('is continuous across a scroll-distance step: no dash position jumps by more than the step size', () => {
    // Every dash's near edge is `k*period - phase` for some integer k. Which k is
    // nearest a fixed reference point can itself change by exactly one period between
    // frames (a dash exits near the clip, its neighbour takes its place) — that's
    // expected, not a seam. What must stay continuous is the *phase* (near mod period):
    // comparing raw near-edge z values across frames would spuriously "detect" a jump
    // of a whole period at that handoff, so compare circular distance in phase-space.
    const REFERENCE_Z = 50;
    const step = 0.5;

    function phaseOfNearestSpan(scrollDistance: number): number {
      const spans = computeDashSpans(scrollDistance, NEAR_Z, FAR_Z, PERIOD, LENGTH);
      let best = spans[0]!;
      let bestDist = Math.abs(best[0] - REFERENCE_Z);
      for (const span of spans) {
        const dist = Math.abs(span[0] - REFERENCE_Z);
        if (dist < bestDist) {
          best = span;
          bestDist = dist;
        }
      }
      return ((best[0] % PERIOD) + PERIOD) % PERIOD;
    }

    function circularDistance(a: number, b: number, period: number): number {
      const raw = Math.abs(a - b) % period;
      return Math.min(raw, period - raw);
    }

    let previousPhase = phaseOfNearestSpan(0);
    for (let i = 1; i <= 400; i++) {
      const currentPhase = phaseOfNearestSpan(i * step);
      expect(circularDistance(currentPhase, previousPhase, PERIOD)).toBeLessThanOrEqual(step + 1e-9);
      previousPhase = currentPhase;
    }
  });

  it('is periodic: spans at scrollDistance and scrollDistance + period are identical', () => {
    const a = computeDashSpans(37, NEAR_Z, FAR_Z, PERIOD, LENGTH);
    const b = computeDashSpans(37 + PERIOD, NEAR_Z, FAR_Z, PERIOD, LENGTH);
    expect(b).toEqual(a);
  });

  it('handles the exact phase-wrap boundary without a visible jump', () => {
    const justBefore = computeDashSpans(PERIOD - 1e-6, NEAR_Z, FAR_Z, PERIOD, LENGTH);
    const atWrap = computeDashSpans(PERIOD, NEAR_Z, FAR_Z, PERIOD, LENGTH);
    const justBeforeMid = justBefore[Math.floor(justBefore.length / 2)]!;
    const atWrapMid = atWrap[Math.floor(atWrap.length / 2)]!;
    expect(Math.abs(atWrapMid[0] - justBeforeMid[0])).toBeLessThan(1e-3);
  });

  it('negative scrollDistance (defensive: shouldn\'t occur, but must not crash or misbehave)', () => {
    expect(() => computeDashSpans(-42, NEAR_Z, FAR_Z, PERIOD, LENGTH)).not.toThrow();
  });
});
