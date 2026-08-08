import { describe, expect, it } from 'vitest';
import { createAdaptiveQualityManager, MAX_QUALITY_LEVEL } from '../../src/render/quality.js';

// A fake clock the manager reads via its injectable `nowMs` — lets these tests drive
// exact elapsed time without any real sleeping, and stay fully deterministic.
function fakeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Feeds `count` frames at `dtMs` each, advancing the fake clock by the same amount
 *  every frame — the shared "steady frame rate for N frames" shape most cases below need. */
function feedFrames(
  manager: ReturnType<typeof createAdaptiveQualityManager>,
  clock: ReturnType<typeof fakeClock>,
  dtMs: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    clock.advance(dtMs);
    manager.recordFrame(dtMs);
  }
}

describe('createAdaptiveQualityManager', () => {
  it('starts at full quality (level 0)', () => {
    const manager = createAdaptiveQualityManager();
    expect(manager.current().level).toBe(0);
  });

  it('stays at full quality under a comfortably high, steady frame rate', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    feedFrames(manager, clock, 1000 / 60, 300); // 60fps for 5s
    expect(manager.current().level).toBe(0);
  });

  it('degrades one level after 2s sustained below 52fps (TECH_SPEC.md §8)', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    const lowFpsDtMs = 1000 / 40; // 40fps, comfortably under the 52fps threshold
    feedFrames(manager, clock, lowFpsDtMs, 29); // fill the 30-frame rolling window, not yet 2s
    expect(manager.current().level).toBe(0);
    feedFrames(manager, clock, lowFpsDtMs, 60); // now comfortably past 2s sustained in total
    expect(manager.current().level).toBe(1);
  });

  it('never drops below fps momentarily — only a *sustained* 2s drop degrades', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    feedFrames(manager, clock, 1000 / 40, 20); // ~0.5s of low fps
    feedFrames(manager, clock, 1000 / 60, 40); // recovers before 2s elapses
    expect(manager.current().level).toBe(0);
  });

  it('can degrade through every level given a long enough sustained drop', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    feedFrames(manager, clock, 1000 / 30, 600); // 30fps sustained for 20s
    expect(manager.current().level).toBe(MAX_QUALITY_LEVEL);
  });

  it('recovers one level after a longer sustained comfortable frame rate', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    feedFrames(manager, clock, 1000 / 30, 600); // degrade to max
    expect(manager.current().level).toBe(MAX_QUALITY_LEVEL);
    feedFrames(manager, clock, 1000 / 60, 600); // 60fps sustained for 20s
    expect(manager.current().level).toBeLessThan(MAX_QUALITY_LEVEL);
  });

  it('each level down reduces stippleDotCount, then also trailPaintEveryNthFrame, then also the density-block thresholds — TECH_SPEC.md §8\'s exact order', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    const full = manager.current();

    feedFrames(manager, clock, 1000 / 30, 90); // -> level 1
    const level1 = manager.current();
    expect(level1.stippleDotCount).toBeLessThan(full.stippleDotCount);
    expect(level1.trailPaintEveryNthFrame).toBe(full.trailPaintEveryNthFrame);
    expect(level1.densityBlockRowThreshold).toBe(full.densityBlockRowThreshold);

    feedFrames(manager, clock, 1000 / 30, 90); // -> level 2
    const level2 = manager.current();
    expect(level2.trailPaintEveryNthFrame).toBeGreaterThan(level1.trailPaintEveryNthFrame);
    expect(level2.densityBlockRowThreshold).toBe(full.densityBlockRowThreshold);

    feedFrames(manager, clock, 1000 / 30, 90); // -> level 3
    const level3 = manager.current();
    expect(level3.densityBlockRowThreshold).toBeLessThan(level2.densityBlockRowThreshold);
    expect(level3.individualRowsDrawn).toBeLessThan(level2.individualRowsDrawn);
  });

  it('never advances past MAX_QUALITY_LEVEL however long the drop persists', () => {
    const clock = fakeClock();
    const manager = createAdaptiveQualityManager(clock.now);
    feedFrames(manager, clock, 1000 / 20, 3000); // 20fps sustained for 150s
    expect(manager.current().level).toBe(MAX_QUALITY_LEVEL);
  });
});
