// Statistics screen (Task 7.3): "a statistics screen driven by the rolling run
// history" — GAME_DESIGN.md doesn't name this feature (logged as this task's own
// design in DECISIONS.md), so its content is scoped to what `Profile` already tracks:
// the lifetime totals every summary/run already folds in, plus TECH_SPEC.md §3's
// existing 40-run rolling `runHistory`, via `meta/statistics.ts`'s pure aggregation.

import type { Profile } from '../../meta/profile.js';
import { computeRunHistoryStats } from '../../meta/statistics.js';
import { PALETTE } from '../../render/palette.js';
import { STRINGS } from '../strings.js';
import { createButton, createDivider, createHeading, createParagraph, createScreenOverlay, createStatRow } from '../widgets.js';

export interface StatisticsScreen {
  readonly root: HTMLDivElement;
  update(profile: Profile): void;
}

const CHART_HEIGHT_PX = 80;
const CHART_MIN_BAR_HEIGHT_PX = 3;

/** A plain DOM bar chart (styled `div`s, no canvas) of the rolling history's distances,
 *  oldest to newest left to right — every other /ui screen is DOM-only (Task 4.3's own
 *  "screens are DOM overlays, not another Canvas 2D layer," logged in DECISIONS.md), so
 *  this stays consistent rather than introducing the one canvas element on a DOM screen. */
function buildDistanceChart(distances: readonly number[]): HTMLDivElement {
  const chart = document.createElement('div');
  Object.assign(chart.style, {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '2px',
    height: `${CHART_HEIGHT_PX}px`,
    width: '100%',
  });
  const max = Math.max(...distances, 1);
  for (const d of distances) {
    const bar = document.createElement('div');
    const heightPx = Math.max(CHART_MIN_BAR_HEIGHT_PX, Math.round((d / max) * CHART_HEIGHT_PX));
    Object.assign(bar.style, {
      flex: '1 1 0',
      height: `${heightPx}px`,
      background: PALETTE.goldLeaf,
      opacity: '0.85',
      borderRadius: '1px',
    });
    chart.append(bar);
  }
  return chart;
}

export function createStatisticsScreen(callbacks: { onBack: () => void }): StatisticsScreen {
  const { root, content } = createScreenOverlay();

  const heading = createHeading(STRINGS.statistics.heading);
  const emptyState = createParagraph(STRINGS.statistics.empty, { muted: true });

  const totalPassagesRow = createStatRow(STRINGS.statistics.totalPassages, '');
  const bestDistanceRow = createStatRow(STRINGS.statistics.bestDistance, '');
  const bestPeakLineRow = createStatRow(STRINGS.statistics.bestPeakLine, '');
  const sealsBrokenRow = createStatRow(STRINGS.statistics.totalSealsBroken, '');
  const goldLeafRow = createStatRow(STRINGS.statistics.lifetimeGoldLeaf, '', { highlight: true });

  const recentHeading = createParagraph('');
  const chartHost = document.createElement('div');
  const medianDistanceRow = createStatRow(STRINGS.statistics.medianDistance, '');
  const averageDistanceRow = createStatRow(STRINGS.statistics.averageDistance, '');
  const windowBestRow = createStatRow(STRINGS.statistics.windowBest, '');
  const medianPeakLineRow = createStatRow(STRINGS.statistics.medianPeakLine, '');

  const back = createButton(STRINGS.statistics.back, callbacks.onBack);

  const recentBlock = document.createElement('div');
  recentBlock.append(
    createDivider(),
    recentHeading,
    chartHost,
    medianDistanceRow.element,
    averageDistanceRow.element,
    windowBestRow.element,
    medianPeakLineRow.element,
  );

  content.append(
    heading,
    emptyState,
    totalPassagesRow.element,
    bestDistanceRow.element,
    bestPeakLineRow.element,
    sealsBrokenRow.element,
    goldLeafRow.element,
    recentBlock,
    back,
  );

  return {
    root,
    update(profile: Profile): void {
      totalPassagesRow.setValue(`${profile.totalPassages}`);
      bestDistanceRow.setValue(`${Math.floor(profile.bestDistanceU)}u`);
      bestPeakLineRow.setValue(`${profile.bestPeakLine}`);
      sealsBrokenRow.setValue(`${profile.totalSealsBroken}`);
      goldLeafRow.setValue(`${profile.goldLeaf}`);

      const stats = computeRunHistoryStats(profile.runHistory);
      const hasHistory = stats !== null;
      emptyState.style.display = hasHistory ? 'none' : 'block';
      recentBlock.style.display = hasHistory ? 'block' : 'none';

      if (stats !== null) {
        recentHeading.textContent = STRINGS.statistics.recentHeading(stats.runsShown);
        chartHost.replaceChildren(buildDistanceChart(stats.distancesChronological));
        medianDistanceRow.setValue(`${Math.floor(stats.medianDistanceU)}u`);
        averageDistanceRow.setValue(`${Math.floor(stats.averageDistanceU)}u`);
        windowBestRow.setValue(`${Math.floor(stats.windowBestDistanceU)}u`);
        medianPeakLineRow.setValue(`${Math.floor(stats.medianPeakLine)}`);
      }
    },
  };
}
