import { describe, expect, it } from 'vitest';
import { computeHitPop } from '../../src/render/blot.js';

// Task 7.10, GAME_DESIGN.md §12: "hit feedback is an ink splat and a 60ms scale pop,
// never a flash." Only the pure decay math is unit-tested here — this codebase's
// convention (road.test.ts's computeDashSpans, strokes.test.ts's shapesOnlyMarkCount) is
// to test the pure helpers a draw function feeds on, not to mock CanvasRenderingContext2D.
describe('computeHitPop', () => {
  it('is null well before a hit (negative age) and once the window has fully elapsed', () => {
    expect(computeHitPop(-0.01)).toBeNull();
    expect(computeHitPop(1)).toBeNull(); // long past any reasonable pop duration
  });

  it('right at the hit (age 0), the pop is at its largest and the splat at its most opaque', () => {
    const pop = computeHitPop(0);
    expect(pop).not.toBeNull();
    expect(pop!.popScale).toBeGreaterThan(1); // a real "pop," not a no-op
    expect(pop!.splatAlpha).toBeGreaterThan(0);
  });

  it('decays monotonically: popScale and splatAlpha shrink, splatScale grows, as age advances', () => {
    const early = computeHitPop(0.01)!;
    const late = computeHitPop(0.05)!;
    expect(late.popScale).toBeLessThan(early.popScale);
    expect(late.splatAlpha).toBeLessThan(early.splatAlpha);
    expect(late.splatScale).toBeGreaterThan(early.splatScale);
  });

  it('never a flash: the pop is a size/alpha change only — never returns a negative or zero scale', () => {
    for (const age of [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.059]) {
      const pop = computeHitPop(age)!;
      expect(pop.popScale).toBeGreaterThan(0);
      expect(pop.splatScale).toBeGreaterThan(0);
      expect(pop.splatAlpha).toBeGreaterThanOrEqual(0);
    }
  });
});
