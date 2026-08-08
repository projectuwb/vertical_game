// Task 7.3: pure aggregation over `Profile.runHistory` (TECH_SPEC.md §3's "40-run
// rolling history") for the Statistics screen. Kept separate from `profile.ts` itself —
// that file owns the schema/persistence, this one owns "what does this data mean when
// you look at a page of it," the same split `economy.ts`/`upgrades.ts` already draw.

import type { RunHistoryEntry } from './profile.js';

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export interface RunHistoryStats {
  /** How many runs the stats below are actually computed over — up to the 40-run cap,
   *  never `Profile.totalPassages` itself (a lifetime count that can run ahead of the
   *  rolling window). */
  readonly runsShown: number;
  readonly medianDistanceU: number;
  readonly averageDistanceU: number;
  /** Best *within the shown window* — not `Profile.bestDistanceU`, which is a lifetime
   *  best that can predate everything currently in the rolling history. */
  readonly windowBestDistanceU: number;
  readonly medianPeakLine: number;
  /** Chronological order (oldest first, matching `runHistory`'s own append order) — the
   *  shape a sparkline/bar chart wants directly, no re-sorting needed at the call site. */
  readonly distancesChronological: readonly number[];
}

/** `null` for a profile with no recorded runs yet — the Statistics screen shows an
 *  empty-state message in that case rather than a table of zeroes. */
export function computeRunHistoryStats(runHistory: readonly RunHistoryEntry[]): RunHistoryStats | null {
  if (runHistory.length === 0) return null;
  const distances = runHistory.map((r) => r.distanceU);
  const peaks = runHistory.map((r) => r.peakLine);
  return {
    runsShown: runHistory.length,
    medianDistanceU: median(distances),
    averageDistanceU: average(distances),
    windowBestDistanceU: Math.max(...distances),
    medianPeakLine: median(peaks),
    distancesChronological: distances,
  };
}
