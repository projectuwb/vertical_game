// BALANCE_REPORT.md generator (Task 2.7, TECH_SPEC.md §6): turns a batch of harness runs
// into ASCII histograms and a pass/fail table against GAME_DESIGN.md §11. Pure — takes
// data in, returns a markdown string; harness.ts owns writing the file.

import { BALANCE } from '../sim/config.js';
import type { BotStrategy } from './bot.js';

export type ReportedDeathCause = 'blot' | 'gate' | 'sealstack' | 'seal' | 'timeout';

export interface RunResult {
  readonly strategy: BotStrategy;
  readonly seed: number;
  readonly passageLengthS: number;
  readonly peakLine: number;
  readonly deathCause: ReportedDeathCause;
  readonly goldLeaf: number;
  readonly distanceU: number;
  readonly blotKilled: number;
  /** Measured by the harness's own loop (world.ts doesn't track this) — did death land
   *  within 8s of the most recent Gate resolution? Null if no Gate was ever resolved. */
  readonly diedWithin8sOfGate: boolean | null;
  /** Did this run ever start a Seal encounter (approach or fight), whether or not it
   *  ultimately broke one? Task 3.5's arcade cadence (every `arcadeCadenceS`, GAME_DESIGN.md
   *  §8.2) is what makes this ever true in harness runs — no bot strategy triggers one
   *  any other way. */
  readonly sealReached: boolean;
  readonly sealBroken: boolean;
  /** Only meaningful when `deathCause === 'blot'` — did a Crust land its contact on the
   *  exact step that ended the run? Task 4.6's "Deaths from Crust" §11 target. */
  readonly deathCrustInvolved: boolean;
}

export interface MetaProgressionSummary {
  readonly runsToFirstUpgrade: number | null;
  readonly runsToLevelTarget: number | null;
  readonly levelTarget: number;
  readonly maxPassages: number;
}

export interface ReportMeta {
  readonly seed: number;
  readonly upgrades: number;
  readonly runsPerStrategy: number;
  readonly maxPassageSCap: number;
  readonly timedOutCount: number;
  readonly sweepNote: string | null;
  readonly metaProgression: MetaProgressionSummary;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1] as number;
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 0 ? (lo + hi) / 2 : (sorted[mid] as number);
}

function formatNum(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(decimals);
}

/** A fixed-width ASCII bar chart over `bucketCount` equal-width buckets spanning
 *  [min, max] of `values`. Degenerates gracefully (a single bucket) when every value is
 *  identical, rather than dividing by zero. */
function asciiHistogram(values: readonly number[], bucketCount: number, unit: string): string[] {
  if (values.length === 0) return ['  (no data)'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (span === 0) {
    return [`  ${formatNum(min, 0)}${unit} | ${'#'.repeat(40)} ${values.length} (every run identical)`];
  }
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const v of values) {
    const idx = Math.min(bucketCount - 1, Math.floor(((v - min) / span) * bucketCount));
    buckets[idx] = (buckets[idx] as number) + 1;
  }
  const maxCount = Math.max(...buckets);
  const barWidth = 40;
  const lines: string[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + (span * i) / bucketCount;
    const hi = min + (span * (i + 1)) / bucketCount;
    const count = buckets[i] as number;
    const barLen = maxCount === 0 ? 0 : Math.round((count / maxCount) * barWidth);
    const bar = '#'.repeat(barLen);
    const label = `${formatNum(lo, 0).padStart(4)}-${formatNum(hi, 0).padStart(4)}${unit}`;
    lines.push(`  ${label} | ${bar.padEnd(barWidth)} ${count}`);
  }
  return lines;
}

function deathCauseBreakdown(results: readonly RunResult[]): string[] {
  const counts: Record<ReportedDeathCause, number> = { blot: 0, gate: 0, sealstack: 0, seal: 0, timeout: 0 };
  for (const r of results) counts[r.deathCause]++;
  const total = results.length || 1;
  return (Object.keys(counts) as ReportedDeathCause[]).map(
    (cause) => `  - ${cause}: ${counts[cause]} (${formatNum((counts[cause] / total) * 100, 1)}%)`,
  );
}

interface TargetRow {
  readonly name: string;
  readonly status: 'PASS' | 'FAIL' | 'N/A';
  readonly detail: string;
}

/** Compares against GAME_DESIGN.md §11 (mirrored as BALANCE.balanceTargets). Several
 *  targets depend on systems that don't exist yet in this Phase-2 build — the
 *  Inkstone/upgrades (Task 4.2), and per-Blot-class death attribution (no target
 *  requires it before Task 4.6, which is where the harness gets extended to chase every
 *  §11 row) — those report N/A rather than a fabricated pass or fail. Seal-related
 *  targets (Task 3.5) are real as of the arcade cadence landing — no bot strategy
 *  fights intelligently, so "broken" in particular should be read as a floor, not a
 *  measure of real player skill. See DECISIONS.md for why this list of gaps is where
 *  the line is drawn for Task 2.7 (and what changed for Task 3.5).
 */
function evaluateTargets(
  results: readonly RunResult[],
  strategyResults: Map<BotStrategy, RunResult[]>,
  upgradeLevel: number,
  metaProgression: MetaProgressionSummary,
): TargetRow[] {
  const t = BALANCE.balanceTargets;
  const rows: TargetRow[] = [];
  const isZeroUpgrades = upgradeLevel === 0;
  const zeroUpgradesNote = `this batch used --upgrades ${upgradeLevel}, not 0 — rerun with --upgrades 0 (the default) to measure this`;

  const mixed = strategyResults.get('mixed') ?? [];
  if (mixed.length > 0 && isZeroUpgrades) {
    const medianLen = median(mixed.map((r) => r.passageLengthS));
    rows.push({
      name: 'Median Passage length, zero upgrades (mixed bot)',
      status: medianLen >= t.passageLengthSZeroUpgrades.min && medianLen <= t.passageLengthSZeroUpgrades.max ? 'PASS' : 'FAIL',
      detail: `${formatNum(medianLen)}s vs target ${t.passageLengthSZeroUpgrades.min}-${t.passageLengthSZeroUpgrades.max}s`,
    });

    const medianPeak = median(mixed.map((r) => r.peakLine));
    rows.push({
      name: 'Median peak Line, zero upgrades (mixed bot)',
      status: medianPeak >= t.peakLineZeroUpgrades.min && medianPeak <= t.peakLineZeroUpgrades.max ? 'PASS' : 'FAIL',
      detail: `${formatNum(medianPeak, 0)} vs target ${t.peakLineZeroUpgrades.min}-${t.peakLineZeroUpgrades.max}`,
    });

    const within8s = mixed.filter((r) => r.diedWithin8sOfGate === true).length;
    const fraction = within8s / mixed.length;
    rows.push({
      name: 'Deaths within 8s of a Gate (mixed bot)',
      status: fraction <= t.deathsWithin8sOfGateMaxFraction ? 'PASS' : 'FAIL',
      detail: `${formatNum(fraction * 100, 1)}% vs target ≤${formatNum(t.deathsWithin8sOfGateMaxFraction * 100, 0)}%`,
    });
  } else {
    const detail = mixed.length === 0 ? 'no mixed-strategy runs in this batch' : zeroUpgradesNote;
    rows.push(
      { name: 'Median Passage length, zero upgrades', status: 'N/A', detail },
      { name: 'Median peak Line, zero upgrades', status: 'N/A', detail },
      { name: 'Deaths within 8s of a Gate', status: 'N/A', detail },
    );
  }

  // GAME_DESIGN.md §11 names exactly these two strategies and exactly "median distance"
  // — not a Gold-Leaf comparison across every strategy in the batch. Gold Leaf was the
  // original stand-in (Task 2.7, before Task 4.2's Inkstone/economy existed to make
  // "distance" itself meaningful to compare), but it reads as either-or noise once short
  // runs routinely earn 0 Leaf (Task 4.6's stingier economy) — distanceU is what the
  // design doc actually asks for, and every RunResult has always carried it.
  const greedySlips = strategyResults.get('greedy-slips') ?? [];
  const greedyKill = strategyResults.get('greedy-kill') ?? [];
  if (greedySlips.length > 0 && greedyKill.length > 0) {
    const medianSlipsDistance = median(greedySlips.map((r) => r.distanceU));
    const medianKillDistance = median(greedyKill.map((r) => r.distanceU));
    const lo = Math.min(medianSlipsDistance, medianKillDistance);
    const hi = Math.max(medianSlipsDistance, medianKillDistance);
    const dominance = lo === 0 ? Infinity : (hi - lo) / lo;
    rows.push({
      name: 'Strategy dominance (spread in median distance, greedy-slips vs greedy-kill)',
      status: dominance <= t.strategyDominanceMaxFraction ? 'PASS' : 'FAIL',
      detail: `${formatNum(dominance * 100, 1)}% spread vs target ≤${formatNum(t.strategyDominanceMaxFraction * 100, 0)}% (greedy-slips=${formatNum(medianSlipsDistance, 0)}, greedy-kill=${formatNum(medianKillDistance, 0)})`,
    });
  } else {
    rows.push({ name: 'Strategy dominance', status: 'N/A', detail: 'needs both greedy-slips and greedy-kill runs in one batch (run without --strategy)' });
  }

  if (isZeroUpgrades) {
    const sealReachedFraction = results.length === 0 ? NaN : results.filter((r) => r.sealReached).length / results.length;
    rows.push({
      name: 'First Seal reached, zero upgrades',
      status: sealReachedFraction >= t.firstSealReachedZeroUpgradesMinFraction ? 'PASS' : 'FAIL',
      detail: `${formatNum(sealReachedFraction * 100, 1)}% vs target ≥${formatNum(t.firstSealReachedZeroUpgradesMinFraction * 100, 0)}%`,
    });

    const sealBrokenFraction = results.length === 0 ? NaN : results.filter((r) => r.sealBroken).length / results.length;
    rows.push({
      name: 'First Seal broken, zero upgrades',
      status:
        sealBrokenFraction >= t.firstSealBrokenZeroUpgradesFraction.min &&
        sealBrokenFraction <= t.firstSealBrokenZeroUpgradesFraction.max
          ? 'PASS'
          : 'FAIL',
      detail: `${formatNum(sealBrokenFraction * 100, 1)}% vs target ${formatNum(t.firstSealBrokenZeroUpgradesFraction.min * 100, 0)}-${formatNum(t.firstSealBrokenZeroUpgradesFraction.max * 100, 0)}% (no bot strategy fights a Seal intelligently yet, so this is a floor)`,
    });
  } else {
    rows.push(
      { name: 'First Seal reached, zero upgrades', status: 'N/A', detail: zeroUpgradesNote },
      { name: 'First Seal broken, zero upgrades', status: 'N/A', detail: zeroUpgradesNote },
    );
  }

  const isLevel5 = upgradeLevel === 5;
  if (mixed.length > 0 && isLevel5) {
    const medianLen = median(mixed.map((r) => r.passageLengthS));
    rows.push({
      name: 'Median Passage length, all upgrades level 5 (mixed bot)',
      status:
        medianLen >= t.passageLengthSMaxUpgrades.min && medianLen <= t.passageLengthSMaxUpgrades.max ? 'PASS' : 'FAIL',
      detail: `${formatNum(medianLen)}s vs target ${t.passageLengthSMaxUpgrades.min}-${t.passageLengthSMaxUpgrades.max}s`,
    });

    const medianPeak = median(mixed.map((r) => r.peakLine));
    rows.push({
      name: 'Median peak Line, upgrades level 5 (mixed bot)',
      status: medianPeak >= t.peakLineMaxUpgrades.min && medianPeak <= t.peakLineMaxUpgrades.max ? 'PASS' : 'FAIL',
      detail: `${formatNum(medianPeak, 0)} vs target ${t.peakLineMaxUpgrades.min}-${t.peakLineMaxUpgrades.max}`,
    });
  } else {
    const detail = mixed.length === 0 ? 'no mixed-strategy runs in this batch' : 'rerun with --upgrades 5 to measure this';
    rows.push(
      { name: 'Median Passage length, all upgrades level 5', status: 'N/A', detail },
      { name: 'Median peak Line, upgrades level 5', status: 'N/A', detail },
    );
  }

  if (metaProgression.runsToFirstUpgrade === null) {
    rows.push({
      name: 'Runs to afford first upgrade',
      status: 'FAIL',
      detail: `never happened within ${metaProgression.maxPassages} simulated Passages`,
    });
  } else {
    const runs = metaProgression.runsToFirstUpgrade;
    rows.push({
      name: 'Runs to afford first upgrade',
      status: runs >= t.runsToAffordFirstUpgrade.min && runs <= t.runsToAffordFirstUpgrade.max ? 'PASS' : 'FAIL',
      detail: `${runs} vs target ${t.runsToAffordFirstUpgrade.min}-${t.runsToAffordFirstUpgrade.max} (mixed bot, greedy cheapest-first spend, meta-progression sim)`,
    });
  }

  if (metaProgression.runsToLevelTarget === null) {
    rows.push({
      name: `Runs to Inkstone level ${metaProgression.levelTarget}`,
      status: 'FAIL',
      detail: `never happened within ${metaProgression.maxPassages} simulated Passages`,
    });
  } else {
    const runs = metaProgression.runsToLevelTarget;
    rows.push({
      name: `Runs to Inkstone level ${metaProgression.levelTarget}`,
      status: runs >= t.runsToUpgradeLevel40.min && runs <= t.runsToUpgradeLevel40.max ? 'PASS' : 'FAIL',
      detail: `${runs} vs target ${t.runsToUpgradeLevel40.min}-${t.runsToUpgradeLevel40.max} (mixed bot, greedy cheapest-first spend, meta-progression sim)`,
    });
  }

  const blotDeaths = results.filter((r) => r.deathCause === 'blot');
  if (blotDeaths.length > 0) {
    const crustFraction = blotDeaths.filter((r) => r.deathCrustInvolved).length / blotDeaths.length;
    rows.push({
      name: 'Deaths from Crust (share of blot-caused deaths)',
      status:
        crustFraction >= t.deathsFromCrustFraction.min && crustFraction <= t.deathsFromCrustFraction.max
          ? 'PASS'
          : 'FAIL',
      detail: `${formatNum(crustFraction * 100, 1)}% vs target ${formatNum(t.deathsFromCrustFraction.min * 100, 0)}-${formatNum(t.deathsFromCrustFraction.max * 100, 0)}% (${blotDeaths.length} blot-caused deaths in this batch)`,
    });
  } else {
    rows.push({ name: 'Deaths from Crust', status: 'N/A', detail: 'no blot-caused deaths in this batch' });
  }

  return rows;
}

export function generateReport(results: readonly RunResult[], meta: ReportMeta): string {
  const strategyResults = new Map<BotStrategy, RunResult[]>();
  for (const r of results) {
    const list = strategyResults.get(r.strategy) ?? [];
    list.push(r);
    strategyResults.set(r.strategy, list);
  }

  const lines: string[] = [];
  lines.push('# BALANCE_REPORT.md');
  lines.push('');
  lines.push(`Generated by \`npm run sim\` (TECH_SPEC.md §6). ${results.length} Passages, base seed ${meta.seed}, upgrades=${meta.upgrades}.`);
  if (meta.upgrades !== 0) {
    lines.push('');
    lines.push(`> \`--upgrades ${meta.upgrades}\` applies level ${meta.upgrades} uniformly across all eight Inkstone tracks (Task 4.2) — not a real player's spend pattern (which would concentrate levels rather than spread them evenly), just a uniform stand-in until Task 4.6's real balance pass.`);
  }
  if (meta.sweepNote !== null) {
    lines.push('');
    lines.push(`> ${meta.sweepNote}`);
  }
  if (meta.timedOutCount > 0) {
    lines.push('');
    lines.push(`> ${meta.timedOutCount} run(s) hit the ${meta.maxPassageSCap}s safety cap without dying and are recorded with deathCause \`timeout\` — treat their Passage-length/Gold-Leaf figures as lower bounds, not real outcomes.`);
  }
  lines.push('');

  lines.push('## Per-strategy summary');
  lines.push('');
  lines.push('| Strategy | Runs | Median length (s) | Median peak Line | Median Gold Leaf | Timeouts |');
  lines.push('|---|---|---|---|---|---|');
  for (const strategy of [...strategyResults.keys()].sort()) {
    const rs = strategyResults.get(strategy) as RunResult[];
    const timeouts = rs.filter((r) => r.deathCause === 'timeout').length;
    lines.push(
      `| ${strategy} | ${rs.length} | ${formatNum(median(rs.map((r) => r.passageLengthS)))} | ${formatNum(median(rs.map((r) => r.peakLine)), 0)} | ${formatNum(median(rs.map((r) => r.goldLeaf)), 0)} | ${timeouts} |`,
    );
  }
  lines.push('');

  lines.push('## Histograms (all strategies pooled)');
  lines.push('');
  lines.push('### Passage length');
  lines.push('```');
  lines.push(...asciiHistogram(results.map((r) => r.passageLengthS), 10, 's'));
  lines.push('```');
  lines.push('');
  lines.push('### Peak Line size');
  lines.push('```');
  lines.push(...asciiHistogram(results.map((r) => r.peakLine), 10, ''));
  lines.push('```');
  lines.push('');
  lines.push('### Gold Leaf per run');
  lines.push('```');
  lines.push(...asciiHistogram(results.map((r) => r.goldLeaf), 10, ''));
  lines.push('```');
  lines.push('');

  lines.push('## Death cause (all strategies pooled)');
  lines.push('');
  lines.push(...deathCauseBreakdown(results));
  lines.push('');

  lines.push('## §11 targets');
  lines.push('');
  lines.push('Mean/median passage-length and peak-Line targets are evaluated against the `mixed` strategy (the closest thing this harness has to "a competent bot"). Targets need not pass yet (Task 2.7\'s acceptance bar) — this table exists so Task 4.6\'s balance pass has a starting baseline.');
  lines.push('');
  lines.push('| Target | Status | Detail |');
  lines.push('|---|---|---|');
  for (const row of evaluateTargets(results, strategyResults, meta.upgrades, meta.metaProgression)) {
    lines.push(`| ${row.name} | ${row.status} | ${row.detail} |`);
  }
  lines.push('');

  return lines.join('\n');
}
