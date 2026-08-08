import { describe, expect, it, vi } from 'vitest';
import { createShakeState, currentShakeOffset, triggerShake } from '../../src/render/shake.js';

describe('camera shake (Task 7.10, GAME_DESIGN.md §12)', () => {
  it('a fresh state produces no offset', () => {
    const offset = currentShakeOffset(createShakeState(), 5, false);
    expect(offset).toEqual({ dx: 0, dy: 0 });
  });

  it('immediately after a trigger, the offset magnitude is at (or very near) the ≤4px cap', () => {
    const state = triggerShake(10);
    vi.spyOn(Math, 'random').mockReturnValue(0); // fixes the random direction for a deterministic magnitude check
    const offset = currentShakeOffset(state, 10, false);
    const magnitude = Math.hypot(offset.dx, offset.dy);
    expect(magnitude).toBeCloseTo(4, 5);
    vi.restoreAllMocks();
  });

  it('decays to zero by the ≤180ms duration and stays zero after', () => {
    const state = triggerShake(10);
    // Just past 0.18s, not exactly at it — floating-point addition (10 + 0.18) can land
    // a hair under the boundary, which would still be "still shaking" by one ULP.
    expect(currentShakeOffset(state, 10 + 0.181, false)).toEqual({ dx: 0, dy: 0 });
    expect(currentShakeOffset(state, 10 + 1, false)).toEqual({ dx: 0, dy: 0 });
  });

  it('halves the amplitude under reducedMotion rather than suppressing it', () => {
    const state = triggerShake(10);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const full = Math.hypot(...Object.values(currentShakeOffset(state, 10, false)) as [number, number]);
    const reduced = Math.hypot(...Object.values(currentShakeOffset(state, 10, true)) as [number, number]);
    vi.restoreAllMocks();
    expect(reduced).toBeCloseTo(full / 2, 5);
    expect(reduced).toBeGreaterThan(0); // never fully removed, per §12
  });

  it('a later trigger overrides an in-progress shake rather than stacking', () => {
    const first = triggerShake(10);
    const second = triggerShake(10.05);
    expect(second.triggeredAtS).toBe(10.05);
    expect(second.triggeredAtS).not.toBe(first.triggeredAtS);
  });
});
