// Run summary screen (Task 4.3, GAME_DESIGN.md §10): "Run summary shows: distance,
// peak Line, Blot unbound, Seals broken, Gold Leaf earned, best-ever comparison. One
// animated number, the rest static — no drum roll." Replaces Task 2.11's canvas HUD
// text overlay (render/hud.ts) now that there's a real Profile (Task 4.1) to compare
// against — the frozen, ink-bleeding game canvas (still driven by main.ts) stays
// visible behind this screen's translucent backdrop, so the "freeze frame, ink
// bleeding out" feel from Task 2.11 isn't lost, just no longer carrying the text too.

import type { DeathCause } from '../../sim/world.js';
import { PALETTE } from '../../render/palette.js';
import { STRINGS } from '../strings.js';
import { createButton, createHeading, createParagraph, createScreenOverlay, createStatRow } from '../widgets.js';

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

export function createSummaryScreen(callbacks: { onContinue: () => void }): SummaryScreen {
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
    continueButton,
  );

  let animationHandle: number | null = null;

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
