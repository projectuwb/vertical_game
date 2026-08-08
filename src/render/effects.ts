// Phrase attack visuals (GAME_DESIGN.md §4, Task 2.9). Hit feedback/splats/screen shake
// generally live here too, but nothing else needs them yet — this file is Phrase-only
// for now. Each Phrase reads as a different shape/motion at a glance, matching §12's
// silhouette-first rule the rest of the game already follows: Hane a radiating burst,
// Tome a single directional pulse, Harai a sustained full-width wash — never all three
// reducible to "a coloured flash."

import type { ProjectionParams } from './camera.js';
import { project } from './projection.js';
import { fillQuad, type Quad } from './strokes.js';
import { PALETTE } from './palette.js';
import { BALANCE, DEG_TO_RAD } from '../sim/config.js';
import { isSweepActive, type PhraseState } from '../sim/phrases.js';

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts (the
// actual hit-test geometry these echo — cone angle, corridor size — does come from
// BALANCE, so the visual always matches what actually got hit).
const HANE_FLASH_DURATION_S = 0.15;
const HANE_RAY_LENGTH_U = 6;
const HANE_RAY_WIDTH_PX = 2.5;
const TOME_FLASH_DURATION_S = 0.2;
const HARAI_BEAM_DEPTH_U = 40;
const HARAI_BEAM_HEIGHT_U = 0.4;

function flashAlpha(firedAtS: number | null, timeS: number, durationS: number): number {
  if (firedAtS === null) return 0;
  const age = timeS - firedAtS;
  if (age < 0 || age >= durationS) return 0;
  return 1 - age / durationS;
}

/** Hane — Scatter: a fan of short rays from the Brush, fading out fast (it's a burst of
 *  9 quick pokes, not a lingering effect). Drawn at the fixed cosmetic HANE_RAY_LENGTH_U
 *  regardless of how far the actual nearest hit Blot was — this is the cone's shape, not
 *  a hit-confirm marker. */
function drawHaneScatter(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  alpha: number,
): void {
  const halfAngleRad = (BALANCE.phrase.hane.scatterSpreadDeg * DEG_TO_RAD) / 2;
  const rayCount: number = BALANCE.phrase.hane.scatterCount;
  const origin = project(brushX, 0.1, brushZ, params);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = PALETTE.jade;
  ctx.lineWidth = HANE_RAY_WIDTH_PX;
  for (let i = 0; i < rayCount; i++) {
    const t = rayCount === 1 ? 0 : i / (rayCount - 1) - 0.5; // -0.5..0.5 across the fan
    const angle = t * halfAngleRad * 2;
    const endX = brushX + Math.sin(angle) * HANE_RAY_LENGTH_U;
    const endZ = brushZ + Math.cos(angle) * HANE_RAY_LENGTH_U;
    const end = project(endX, 0.1, endZ, params);
    ctx.beginPath();
    ctx.moveTo(origin.screenX, origin.screenY);
    ctx.lineTo(end.screenX, end.screenY);
    ctx.stroke();
  }
  ctx.restore();
}

/** Tome — Press: one solid pulse filling the exact corridor the hit-test used (3u wide,
 *  18u forward) — a single heavy shape, matching Tome's "squat heavy block" silhouette
 *  language (strokes.ts's drawTomeGlyph) rather than Hane's scatter of thin lines. */
function drawTomePress(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  alpha: number,
): void {
  const p = BALANCE.phrase.tome;
  const halfWidth = p.pressWidthU / 2;
  const corners: Quad = [
    project(brushX - halfWidth, 0, brushZ, params),
    project(brushX + halfWidth, 0, brushZ, params),
    project(brushX + halfWidth, 0, brushZ + p.pressTravelU, params),
    project(brushX - halfWidth, 0, brushZ + p.pressTravelU, params),
  ];
  ctx.save();
  ctx.globalAlpha = alpha * 0.6;
  fillQuad(ctx, corners, PALETTE.vermilion);
  ctx.restore();
}

/** Harai — Sweep: a sustained, full-lane-width wash for the entire 0.5s the sweep is
 *  actually ticking damage — the one Phrase effect that persists rather than flashing,
 *  matching the sim-side sweep's own "sustained" behaviour exactly (isSweepActive). */
function drawHaraiSweep(ctx: CanvasRenderingContext2D, params: ProjectionParams, brushX: number, brushZ: number): void {
  const halfWidth = BALANCE.lane.halfWidth;
  const corners: Quad = [
    project(brushX - halfWidth, 0, brushZ, params),
    project(brushX + halfWidth, 0, brushZ, params),
    project(brushX + halfWidth, HARAI_BEAM_HEIGHT_U, brushZ + HARAI_BEAM_DEPTH_U, params),
    project(brushX - halfWidth, HARAI_BEAM_HEIGHT_U, brushZ + HARAI_BEAM_DEPTH_U, params),
  ];
  ctx.save();
  ctx.globalAlpha = 0.22;
  fillQuad(ctx, corners, PALETTE.bone);
  ctx.restore();
}

export function drawPhraseEffects(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  phrase: PhraseState,
  brushX: number,
  brushZ: number,
  timeS: number,
): void {
  const haneAlpha = flashAlpha(phrase.hane.lastFiredAtS, timeS, HANE_FLASH_DURATION_S);
  if (haneAlpha > 0) drawHaneScatter(ctx, params, brushX, brushZ, haneAlpha);

  const tomeAlpha = flashAlpha(phrase.tome.lastFiredAtS, timeS, TOME_FLASH_DURATION_S);
  if (tomeAlpha > 0) drawTomePress(ctx, params, brushX, brushZ, tomeAlpha);

  if (isSweepActive(phrase.haraiSweep)) drawHaraiSweep(ctx, params, brushX, brushZ);
}
