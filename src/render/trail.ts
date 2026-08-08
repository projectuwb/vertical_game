// The ink trail (GAME_DESIGN.md §12, Task 2.10) — the signature visual. Paints the
// Line's current footprint onto the road+trail layer every frame; the layer's own
// non-clearing 6%-alpha-fade accumulation (road.ts) is what turns that into a trail at
// all; this module never needs to remember past Brush positions itself. A slow-moving
// or lingering Brush repaints roughly the same spot every frame, so the accumulated
// (still-decaying) opacity there stays high far longer than the per-frame 6% alone would
// suggest — that's the whole mechanism behind "persists ~4s... a huge Line lays down a
// river of ink; a dying Line leaves a thin scratch" (a wide trail overlaps itself more
// as it drifts, a thin one doesn't) — no separate persistence timer needed anywhere.

import type { ProjectionParams } from './camera.js';
import { project, type ProjectedPoint } from './projection.js';
import { PALETTE } from './palette.js';
import { CLASS_COLOR } from './strokes.js';
import type { LineState } from '../sim/line.js';
import type { StrokeClass } from '../sim/stroke.js';

type Quad = readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint];

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts.
// Width grows with sqrt(N) rather than linearly: GAME_DESIGN.md §12 says only "width
// proportional to N," not a formula, and a Line of 999 painted at a literal linear
// width would blow past the lane itself — sqrt gives a clearly-different width between
// a Line of 5 and a Line of 300 (Task 2.10's acceptance bar) while still tapering off at
// very large N, capped defensively at MAX_WIDTH_U regardless.
const BASE_WIDTH_U = 0.3;
const WIDTH_PER_SQRT_STROKE_U = 0.32;
const MAX_WIDTH_U = 3.5;
const TRAIL_NEAR_OFFSET_U = -0.4; // slightly behind the Brush (toward camera)
const TRAIL_FAR_OFFSET_U = 0.6; // slightly ahead, roughly where the front row sits
const PAINT_ALPHA = 0.4;
// "Capillary wobble" (§12): a slow organic breathing (sine) plus per-frame roughness
// (Math.random() — /render cosmetics are exempt from the seeded-PRNG rule) on each edge
// independently, so accumulated frames bleed unevenly instead of forming a clean bar.
// Task 5.3 ("respect prefers-reduced-motion... disabling trail wobble") should zero
// these two out, not delete the mechanism.
const WOBBLE_HZ = 1.6;
const WOBBLE_AMPLITUDE_FRACTION = 0.18;
const WOBBLE_PHASE_OFFSET = Math.PI * 0.7; // left/right edges wobble out of sync
const JITTER_AMPLITUDE_FRACTION = 0.12;

function hexToRgb(hex: string): readonly [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const CLASS_RGB: Record<StrokeClass, readonly [number, number, number]> = {
  hane: hexToRgb(CLASS_COLOR.hane),
  tome: hexToRgb(CLASS_COLOR.tome),
  harai: hexToRgb(CLASS_COLOR.harai),
};

/** Exported for Task 7.4's `render/scroll.ts` (the photo-mode trail reconstruction),
 *  which needs the exact same width-from-Line-size formula this module already uses —
 *  a second copy would drift the moment §12's "width proportional to N" tuning changed
 *  here and not there. */
export function trailWidthU(strokeCount: number): number {
  return Math.min(MAX_WIDTH_U, BASE_WIDTH_U + WIDTH_PER_SQRT_STROKE_U * Math.sqrt(strokeCount));
}

/** "Colour blended from the Line's class mix" (§12) — unlike the density block's
 *  dominant-class-only fill (strokes.ts, chosen specifically to avoid a muddy blended
 *  look on an *opaque* silhouette), a translucent, constantly-repainted-and-fading wet
 *  ink wash reads as genuinely mixed ink rather than a flat muddy fill, which is exactly
 *  what the trail is supposed to look like. */
/** Exported for the same reason as `trailWidthU` above. */
export function blendClassColor(line: LineState): string {
  const n = line.strokes.length;
  if (n === 0) return PALETTE.bone;
  let hane = 0;
  let tome = 0;
  let harai = 0;
  for (const s of line.strokes) {
    if (s.class === 'hane') hane++;
    else if (s.class === 'tome') tome++;
    else harai++;
  }
  const r = (CLASS_RGB.hane[0] * hane + CLASS_RGB.tome[0] * tome + CLASS_RGB.harai[0] * harai) / n;
  const g = (CLASS_RGB.hane[1] * hane + CLASS_RGB.tome[1] * tome + CLASS_RGB.harai[1] * harai) / n;
  const b = (CLASS_RGB.hane[2] * hane + CLASS_RGB.tome[2] * tome + CLASS_RGB.harai[2] * harai) / n;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function fillQuad(ctx: CanvasRenderingContext2D, corners: Quad, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(corners[0].screenX, corners[0].screenY);
  ctx.lineTo(corners[1].screenX, corners[1].screenY);
  ctx.lineTo(corners[2].screenX, corners[2].screenY);
  ctx.lineTo(corners[3].screenX, corners[3].screenY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints this frame's ink onto the road+trail layer — call after road.ts's `drawRoad`
 * (see main.ts) so fresh ink sits on top of, and can visibly darken, this frame's edge
 * lines/dashes ("it... darkens the road," §12), rather than being drawn under them.
 */
export function drawInkTrail(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  line: LineState,
  timeS: number,
  reducedMotion = false,
): void {
  const strokeCount = line.strokes.length;
  if (strokeCount === 0) return;

  const halfWidth = trailWidthU(strokeCount) / 2;
  const color = blendClassColor(line);

  // GAME_DESIGN.md §12: "respect prefers-reduced-motion by... disabling trail wobble
  // (never by removing gameplay feedback)" — zeroing the two motion terms out (Task
  // 2.10's own note above already flagged this exact spot) rather than deleting the
  // mechanism: the trail itself, its width/colour/darkening behaviour, is still full
  // gameplay feedback and stays completely intact, only the organic wobble/jitter motion
  // is suppressed.
  const wobbleL = reducedMotion
    ? 0
    : Math.sin(timeS * WOBBLE_HZ * Math.PI * 2) * halfWidth * WOBBLE_AMPLITUDE_FRACTION +
      (Math.random() - 0.5) * halfWidth * JITTER_AMPLITUDE_FRACTION;
  const wobbleR = reducedMotion
    ? 0
    : Math.sin(timeS * WOBBLE_HZ * Math.PI * 2 + WOBBLE_PHASE_OFFSET) * halfWidth * WOBBLE_AMPLITUDE_FRACTION +
      (Math.random() - 0.5) * halfWidth * JITTER_AMPLITUDE_FRACTION;

  const nearZ = brushZ + TRAIL_NEAR_OFFSET_U;
  const farZ = brushZ + TRAIL_FAR_OFFSET_U;
  const corners: Quad = [
    project(brushX - halfWidth + wobbleL, 0, nearZ, params),
    project(brushX + halfWidth + wobbleR, 0, nearZ, params),
    project(brushX + halfWidth + wobbleR, 0, farZ, params),
    project(brushX - halfWidth + wobbleL, 0, farZ, params),
  ];

  ctx.save();
  ctx.globalAlpha = PAINT_ALPHA;
  fillQuad(ctx, corners, color);
  ctx.restore();
}

// Death sequence (Task 2.11, TASKS.md: "ink bleeding out across the road") — a distinct
// visual from ordinary play, not just a bigger version of the normal trail: it grows
// from nothing to BLEED_MAX_WIDTH_U as `bleedFraction` (main.ts's real-elapsed-time-since-
// death, via hud.ts's inkBleedFraction) goes 0..1, in the Blot colour rather than the
// Line's class mix — the Line has just been consumed to 0, so there's no class mix left
// to blend, and "the ink going dark" reads correctly as the Passage ending.
const BLEED_MAX_WIDTH_U = 5;
const BLEED_MAX_DEPTH_U = 2;
const BLEED_ALPHA = 0.6;

export function drawInkBleed(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  bleedFraction: number,
): void {
  if (bleedFraction <= 0) return;
  const halfWidth = (BLEED_MAX_WIDTH_U * bleedFraction) / 2;
  const nearZ = brushZ - BLEED_MAX_DEPTH_U * bleedFraction * 0.3;
  const farZ = brushZ + BLEED_MAX_DEPTH_U * bleedFraction;
  const corners: Quad = [
    project(brushX - halfWidth, 0, nearZ, params),
    project(brushX + halfWidth, 0, nearZ, params),
    project(brushX + halfWidth, 0, farZ, params),
    project(brushX - halfWidth, 0, farZ, params),
  ];

  ctx.save();
  ctx.globalAlpha = BLEED_ALPHA * bleedFraction;
  fillQuad(ctx, corners, PALETTE.blot);
  ctx.restore();
}
