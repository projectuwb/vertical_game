// HUD layer (Task 2.11): the run-summary/death overlay. This is *not* the polished,
// keyboard-navigable /ui/screens system Task 4.3 builds (title/summary/Inkstone/
// settings, persistence-backed best-ever comparison) — it's the minimal, fully-finished
// (not placeholder) stats readout this task's own acceptance bar needs: freeze, show
// what actually happened, get back into a new Passage in two taps and under 3s.
//
// Text here uses a system font stack, not the real vendored OFL faces (TECH_SPEC.md
// §7) — logged in DECISIONS.md, tracked as Task 7.7. Serif for the one animated
// display number, sans for everything else, per CLAUDE.md's documented fallback shape.

import { PALETTE } from './palette.js';
import type { DeathCause } from '../sim/world.js';

const DISPLAY_FONT_STACK = 'Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif';
const UI_FONT_STACK = '"Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans", sans-serif';

// Real elapsed seconds (wall-clock, not world.timeS — the World is frozen the instant
// it dies) since death, driving the reveal sequence below. Tapping to restart is never
// blocked by any of this; a player who taps immediately skips straight past it.
const BLEED_DURATION_S = 1.2;
const PANEL_START_S = 0.8;
const PANEL_FADE_S = 0.4;
// GAME_DESIGN.md §10: "One animated number, the rest static — no drum roll." Gold Leaf
// earned is the one that counts up — the reward figure, and the most natural one to
// animate without it reading as suspense-building (which "no drum roll" rules out).
const GOLD_COUNT_S = 0.6;

export function inkBleedFraction(elapsedS: number): number {
  return Math.min(1, Math.max(0, elapsedS / BLEED_DURATION_S));
}

function panelAlpha(elapsedS: number): number {
  if (elapsedS < PANEL_START_S) return 0;
  return Math.min(1, (elapsedS - PANEL_START_S) / PANEL_FADE_S);
}

function goldCountFraction(elapsedS: number): number {
  const start = PANEL_START_S + PANEL_FADE_S;
  if (elapsedS < start) return 0;
  return Math.min(1, (elapsedS - start) / GOLD_COUNT_S);
}

export interface RunSummaryStats {
  readonly distanceU: number;
  readonly peakLine: number;
  readonly blotKilled: number;
  readonly sealsBroken: number;
  readonly goldLeaf: number;
  readonly deathCause: DeathCause;
}

const DEATH_CAUSE_LABEL: Record<DeathCause, string> = {
  blot: 'Overrun',
  gate: 'A Gate cost too much',
  sealstack: 'Blocked and broken',
};

function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * The death/run-summary overlay, drawn on the HUD layer while `world.isDead`.
 * `elapsedS` is real wall-clock time since death (main.ts tracks this separately from
 * `world.timeS`, which stops advancing the instant the World dies) and drives the whole
 * reveal — a dark scrim and stat lines fading in after `PANEL_START_S`, Gold Leaf
 * counting up once the panel has mostly appeared. Every value shown is real and
 * currently available; "best-ever comparison" is deliberately omitted rather than shown
 * empty — there's no persistence yet to compare against (Task 4.1).
 */
export function drawDeathSummary(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  stats: RunSummaryStats,
  elapsedS: number,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const alpha = panelAlpha(elapsedS);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha * 0.72;
  ctx.fillStyle = PALETTE.deep;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.restore();

  const cx = cssWidth / 2;
  let y = cssHeight * 0.32;

  drawCenteredText(ctx, DEATH_CAUSE_LABEL[stats.deathCause], cx, y, `600 20px ${UI_FONT_STACK}`, PALETTE.bone, alpha);
  y += 64;

  const shownGold = Math.round(stats.goldLeaf * goldCountFraction(elapsedS));
  drawCenteredText(ctx, `${shownGold} Gold Leaf`, cx, y, `700 52px ${DISPLAY_FONT_STACK}`, PALETTE.goldLeaf, alpha);
  y += 72;

  const lines = [
    `Distance ${Math.round(stats.distanceU)}u`,
    `Peak Line ${stats.peakLine}`,
    `Blot unbound ${stats.blotKilled}`,
    `Seals broken ${stats.sealsBroken}`,
  ];
  for (const line of lines) {
    drawCenteredText(ctx, line, cx, y, `400 18px ${UI_FONT_STACK}`, PALETTE.bone, alpha);
    y += 30;
  }

  y += 40;
  drawCenteredText(ctx, 'Tap to sail again', cx, y, `400 16px ${UI_FONT_STACK}`, PALETTE.jade, alpha);
}
