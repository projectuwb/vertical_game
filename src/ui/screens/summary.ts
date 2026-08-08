// Run summary screen (Task 4.3, GAME_DESIGN.md §10): "Run summary shows: distance,
// peak Line, Blot unbound, Seals broken, Gold Leaf earned, best-ever comparison. One
// animated number, the rest static — no drum roll." Replaces Task 2.11's canvas HUD
// text overlay (render/hud.ts) now that there's a real Profile (Task 4.1) to compare
// against — the frozen, ink-bleeding game canvas (still driven by main.ts) stays
// visible behind this screen's translucent backdrop, so the "freeze frame, ink
// bleeding out" feel from Task 2.11 isn't lost, just no longer carrying the text too.

import type { DeathCause } from '../../sim/world.js';
import { formatDailyShareText } from '../../meta/dailySeed.js';
import { PALETTE } from '../../render/palette.js';
import { STRINGS } from '../strings.js';
import { createButton, createHeading, createLinkButton, createParagraph, createScreenOverlay, createStatRow } from '../widgets.js';

export interface SummaryStats {
  readonly distanceU: number;
  readonly peakLine: number;
  readonly blotKilled: number;
  readonly sealsBroken: number;
  readonly goldLeaf: number;
  readonly deathCause: DeathCause;
  /** Profile's `bestDistanceU` *before* this run's result was folded in — so "new
   *  best"/"previous best" reads correctly even though the Profile has already been
   *  updated by the time this screen shows (main.ts records the run immediately on
   *  death, not on a delay). */
  readonly previousBestDistanceU: number;
  /** Task 7.1: set only when this Passage used the daily seed — the "Copy result" row
   *  only ever shows for a run comparable across players, not an ordinary Passage
   *  (whose seed nobody else shares, so sharing its result wouldn't mean anything). */
  readonly dailyDayNumber: number | null;
}

export interface SummaryScreen {
  readonly root: HTMLDivElement;
  /** Starts the reveal: static stats appear immediately, Gold Leaf counts up over
   *  GOLD_COUNT_S — GAME_DESIGN.md §10's "one animated number, the rest static." Safe
   *  to call again (e.g. a fresh death after the screen was reused) — cancels any
   *  in-flight animation from a previous call first. */
  show(stats: SummaryStats): void;
}

const GOLD_COUNT_S = 0.6;

export function createSummaryScreen(callbacks: { onContinue: () => void; onWatchReplay: () => void }): SummaryScreen {
  const { root, content } = createScreenOverlay();
  root.style.background = `${PALETTE.deep}EB`; // translucent — the frozen, bleeding canvas stays visible behind
  content.style.justifyContent = 'center';
  content.style.flex = '1';

  const heading = createHeading(STRINGS.summary.heading);
  const causeLine = createParagraph('', { muted: true });
  const goldRow = createStatRow(STRINGS.summary.goldLeaf, '0', { highlight: true });
  const distanceRow = createStatRow(STRINGS.summary.distance, '');
  const peakLineRow = createStatRow(STRINGS.summary.peakLine, '');
  const blotRow = createStatRow(STRINGS.summary.blotUnbound, '');
  const sealsRow = createStatRow(STRINGS.summary.sealsBroken, '');
  const bestLine = createParagraph('', { muted: true });
  // Task 7.1: copy-to-clipboard, never a network submission — visible only for a run
  // that used the daily seed (see `SummaryStats.dailyDayNumber`'s own doc comment).
  const copyResultButton = createLinkButton(STRINGS.summary.copyResult, () => {
    if (currentShareText === null) return;
    navigator.clipboard
      .writeText(currentShareText)
      .then(() => {
        copyResultButton.textContent = STRINGS.summary.copied;
        window.setTimeout(() => {
          copyResultButton.textContent = STRINGS.summary.copyResult;
        }, 1500);
      })
      .catch(() => {
        // Clipboard access denied or unavailable — nothing else to do about it.
      });
  });
  copyResultButton.style.display = 'none';
  // Task 7.2: always available once a real Passage has ended — the seed + input tape
  // that just produced this summary is always what "Watch replay" plays back.
  const watchReplayButton = createLinkButton(STRINGS.summary.watchReplay, callbacks.onWatchReplay);
  const continueButton = createButton(STRINGS.summary.continue, callbacks.onContinue, { primary: true });

  content.append(
    heading,
    causeLine,
    goldRow.element,
    distanceRow.element,
    peakLineRow.element,
    blotRow.element,
    sealsRow.element,
    bestLine,
    copyResultButton,
    watchReplayButton,
    continueButton,
  );

  let animationHandle: number | null = null;
  let currentShareText: string | null = null;

  return {
    root,
    show(stats: SummaryStats): void {
      if (animationHandle !== null) cancelAnimationFrame(animationHandle);

      causeLine.textContent = STRINGS.deathCause[stats.deathCause];
      distanceRow.setValue(`${Math.floor(stats.distanceU)}u`);
      peakLineRow.setValue(`${stats.peakLine}`);
      blotRow.setValue(`${stats.blotKilled}`);
      sealsRow.setValue(`${stats.sealsBroken}`);

      const isNewBest = stats.distanceU > stats.previousBestDistanceU;
      bestLine.textContent = isNewBest
        ? STRINGS.summary.newBest
        : stats.previousBestDistanceU > 0
          ? STRINGS.summary.previousBest(stats.previousBestDistanceU)
          : '';

      if (stats.dailyDayNumber !== null) {
        currentShareText = formatDailyShareText({
          dayNumber: stats.dailyDayNumber,
          distanceU: stats.distanceU,
          peakLine: stats.peakLine,
          sealsBroken: stats.sealsBroken,
          deathCauseText: STRINGS.deathCause[stats.deathCause],
        });
        copyResultButton.textContent = STRINGS.summary.copyResult;
        copyResultButton.style.display = '';
      } else {
        currentShareText = null;
        copyResultButton.style.display = 'none';
      }

      const startMs = performance.now();
      const tick = (nowMs: number): void => {
        const fraction = Math.min(1, (nowMs - startMs) / 1000 / GOLD_COUNT_S);
        goldRow.setValue(`${Math.floor(stats.goldLeaf * fraction)}`);
        if (fraction < 1) {
          animationHandle = requestAnimationFrame(tick);
        } else {
          animationHandle = null;
        }
      };
      animationHandle = requestAnimationFrame(tick);
    },
  };
}
