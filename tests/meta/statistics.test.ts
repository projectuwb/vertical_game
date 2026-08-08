import { describe, expect, it } from 'vitest';
import { computeRunHistoryStats } from '../../src/meta/statistics.js';
import type { RunHistoryEntry } from '../../src/meta/profile.js';

function entry(distanceU: number, peakLine: number): RunHistoryEntry {
  return { seed: 1, distanceU, peakLine, sealsBroken: 0, goldLeafEarned: 0, timestampMs: 0 };
}

describe('computeRunHistoryStats', () => {
  it('is null for an empty history', () => {
    expect(computeRunHistoryStats([])).toBeNull();
  });

  it('computes runsShown, median, average, and window-best distance correctly', () => {
    const stats = computeRunHistoryStats([entry(100, 5), entry(300, 10), entry(200, 8)]);
    expect(stats).not.toBeNull();
    expect(stats!.runsShown).toBe(3);
    expect(stats!.medianDistanceU).toBe(200);
    expect(stats!.averageDistanceU).toBeCloseTo(200, 9);
    expect(stats!.windowBestDistanceU).toBe(300);
    expect(stats!.medianPeakLine).toBe(8);
  });

  it('averages an even-length list as the mean of the two middle values', () => {
    const stats = computeRunHistoryStats([entry(100, 1), entry(200, 2), entry(300, 3), entry(400, 4)]);
    expect(stats!.medianDistanceU).toBe(250);
  });

  it('preserves chronological (append) order in distancesChronological, not sorted', () => {
    const stats = computeRunHistoryStats([entry(300, 1), entry(100, 1), entry(200, 1)]);
    expect(stats!.distancesChronological).toEqual([300, 100, 200]);
  });

  it('a single run: median/average/best all equal that one run', () => {
    const stats = computeRunHistoryStats([entry(150, 6)]);
    expect(stats!.runsShown).toBe(1);
    expect(stats!.medianDistanceU).toBe(150);
    expect(stats!.averageDistanceU).toBe(150);
    expect(stats!.windowBestDistanceU).toBe(150);
  });
});
