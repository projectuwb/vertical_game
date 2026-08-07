// Stroke rendering + density blocks (GAME_DESIGN.md §5, Task 2.2). Silhouette first,
// colour second (GAME_DESIGN.md §4/§12) — the three classes are distinguishable shapes
// before they're distinguishable colours, which is what the colourblind Shapes-Only
// toggle (Task 5.3) builds on rather than bolting on afterward.

import type { ProjectionParams } from './camera.js';
import { project, type ProjectedPoint } from './projection.js';
import { PALETTE } from './palette.js';
import { BALANCE } from '../sim/config.js';
import { classifyForRender, computeFormationSlot, type LineState } from '../sim/line.js';
import type { Pool } from '../core/pool.js';
import type { Projectile } from '../sim/projectiles.js';
import type { StrokeClass } from '../sim/stroke.js';

const CLASS_COLOR: Record<StrokeClass, string> = {
  hane: PALETTE.jade,
  tome: PALETTE.vermilion,
  harai: PALETTE.bone,
};

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts.
const SILHOUETTE_BASE_SIZE_U = 0.4;
/** Density block never extends further back than this, regardless of overflow count —
 *  otherwise a very large Line's block would reach past the camera's near-clip plane
 *  and blow up in size instead of reading as "a mass of ink." */
const MAX_BLOCK_DEPTH_U = 3.5;
const BLOCK_LATERAL_PAD_U = 0.3;
const STIPPLE_DOT_COUNT = 48;
const STIPPLE_DOT_RADIUS_PX = 2.5;

type Quad = readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint];

export function drawLine(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  line: LineState,
): void {
  const classification = classifyForRender(line.strokes.length);
  const individualCount = Math.min(classification.individualCount, line.strokes.length);

  // Index order (0 = front = farthest from camera among the Line's own rows) already
  // matches painter's-algorithm draw order: draw far-to-near just by counting up.
  for (let i = 0; i < individualCount; i++) {
    const stroke = line.strokes[i] as { class: StrokeClass };
    const slot = computeFormationSlot(i);
    drawStroke(ctx, params, brushX + slot.lateralOffset, brushZ + slot.depthOffset, stroke.class);
  }

  if (classification.hasDensityBlock) {
    drawDensityBlock(ctx, params, brushX, brushZ, line, individualCount);
  }
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  x: number,
  z: number,
  cls: StrokeClass,
): void {
  const ground = project(x, 0, z, params);
  const pxSize = SILHOUETTE_BASE_SIZE_U * ground.scale * params.unit;
  ctx.fillStyle = CLASS_COLOR[cls];
  if (cls === 'hane') {
    drawHaneGlyph(ctx, ground.screenX, ground.screenY, pxSize);
  } else if (cls === 'tome') {
    drawTomeGlyph(ctx, ground.screenX, ground.screenY, pxSize);
  } else {
    drawHaraiGlyph(ctx, ground.screenX, ground.screenY, pxSize);
  }
}

/** Hane — a narrow upward tick. */
function drawHaneGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const halfWidth = size * 0.18;
  const height = size * 1.3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - height);
  ctx.lineTo(cx + halfWidth, cy);
  ctx.lineTo(cx - halfWidth, cy);
  ctx.closePath();
  ctx.fill();
}

/** Tome — a squat heavy block. */
function drawTomeGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const halfWidth = size * 0.55;
  const halfHeight = size * 0.65;
  ctx.fillRect(cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2);
}

/** Harai — a long tapering diagonal sliver. */
function drawHaraiGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const length = size * 1.6;
  const width = size * 0.32;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 5);
  ctx.beginPath();
  ctx.moveTo(-length / 2, 0);
  ctx.lineTo(length / 2, -width / 2);
  ctx.lineTo(length / 2, width / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDensityBlock(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  line: LineState,
  individualCount: number,
): void {
  const rowSize = BALANCE.line.rowSize;
  const blockStartIndex = BALANCE.line.individualRowsDrawn * rowSize;
  const farSlot = computeFormationSlot(blockStartIndex);
  const farZ = brushZ + farSlot.depthOffset;

  const overflowCount = line.strokes.length - individualCount;
  const overflowRows = Math.ceil(overflowCount / rowSize);
  const realDepth = overflowRows * BALANCE.line.longitudinalSpacingU;
  const cappedDepth = Math.min(realDepth, MAX_BLOCK_DEPTH_U);
  const nearZ = farZ - cappedDepth;

  const halfWidth = ((rowSize - 1) / 2) * BALANCE.line.lateralSpacingU + BLOCK_LATERAL_PAD_U;

  const corners: Quad = [
    project(brushX - halfWidth, 0, farZ, params),
    project(brushX + halfWidth, 0, farZ, params),
    project(brushX + halfWidth, 0, nearZ, params),
    project(brushX - halfWidth, 0, nearZ, params),
  ];

  const counts: Record<StrokeClass, number> = { hane: 0, tome: 0, harai: 0 };
  for (let i = individualCount; i < line.strokes.length; i++) {
    const stroke = line.strokes[i] as { class: StrokeClass };
    counts[stroke.class]++;
  }

  const dominant = dominantClass(counts);
  ctx.fillStyle = CLASS_COLOR[dominant];
  ctx.beginPath();
  ctx.moveTo(corners[0].screenX, corners[0].screenY);
  ctx.lineTo(corners[1].screenX, corners[1].screenY);
  ctx.lineTo(corners[2].screenX, corners[2].screenY);
  ctx.lineTo(corners[3].screenX, corners[3].screenY);
  ctx.closePath();
  ctx.fill();

  drawStipple(ctx, corners, counts, dominant);
}

/** Ties broken hane > tome > harai — arbitrary but stable, so the block doesn't flicker
 *  between two equally-represented classes as Strokes are added one at a time. */
function dominantClass(counts: Record<StrokeClass, number>): StrokeClass {
  const classes: StrokeClass[] = ['hane', 'tome', 'harai'];
  let best = classes[0] as StrokeClass;
  for (const cls of classes) {
    if (counts[cls] > counts[best]) best = cls;
  }
  return best;
}

/**
 * The block's base fill is the dominant class's pure colour — GAME_DESIGN.md §12
 * explicitly rules out a blended/averaged palette ("not a warm-cream-and-terracotta
 * scheme"), and averaging jade+vermilion+bone by weight produces exactly that muddy
 * tan. Minority classes are represented by stipple dots instead (only for classes other
 * than the dominant one — a same-colour dot on a same-colour fill would be invisible and
 * is redundant anyway). Math.random() is fine here: /render cosmetics are exempt from
 * the seeded-PRNG rule (eslint.config.js), and dot placement affects nothing
 * gameplay-deterministic.
 */
function drawStipple(
  ctx: CanvasRenderingContext2D,
  corners: Quad,
  counts: Record<StrokeClass, number>,
  dominant: StrokeClass,
): void {
  const minorityTotal = counts.hane + counts.tome + counts.harai - counts[dominant];
  if (minorityTotal === 0) return;

  let minX = corners[0].screenX;
  let maxX = corners[0].screenX;
  let minY = corners[0].screenY;
  let maxY = corners[0].screenY;
  for (const corner of corners) {
    minX = Math.min(minX, corner.screenX);
    maxX = Math.max(maxX, corner.screenX);
    minY = Math.min(minY, corner.screenY);
    maxY = Math.max(maxY, corner.screenY);
  }

  const minorityClasses = (['hane', 'tome', 'harai'] as StrokeClass[]).filter(
    (cls) => cls !== dominant && counts[cls] > 0,
  );

  for (let i = 0; i < STIPPLE_DOT_COUNT; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);

    let roll = Math.random() * minorityTotal;
    let chosen = minorityClasses[0] as StrokeClass;
    for (const cls of minorityClasses) {
      roll -= counts[cls];
      if (roll <= 0) {
        chosen = cls;
        break;
      }
    }

    ctx.fillStyle = CLASS_COLOR[chosen];
    ctx.beginPath();
    ctx.arc(x, y, STIPPLE_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Render-only cosmetic constants for projectiles — not gameplay balance.
const PROJECTILE_BASE_SIZE_U = 0.16;
const PROJECTILE_HEIGHT_U = 0.15;

/**
 * Per-class projectile silhouettes (GAME_DESIGN.md §4): Hane a small fast dot, Tome a
 * heavy slow blob, Harai a thin piercing line. Draws every active pooled projectile —
 * cheap even at the pool's full 2048 capacity since Canvas 2D fills are trivial at this
 * size, and in practice concurrent count is bounded by class range/speed/cap anyway.
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  pool: Pool<Projectile>,
): void {
  pool.forEachActive((p) => {
    const ground = project(p.x, PROJECTILE_HEIGHT_U, p.z, params);
    const pxSize = Math.max(1.5, PROJECTILE_BASE_SIZE_U * ground.scale * params.unit);
    ctx.fillStyle = CLASS_COLOR[p.class];

    if (p.class === 'tome') {
      ctx.beginPath();
      ctx.arc(ground.screenX, ground.screenY, pxSize * 1.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.class === 'harai') {
      const halfWidth = pxSize * 0.28;
      const halfLength = pxSize * 2.2;
      ctx.fillRect(
        ground.screenX - halfWidth,
        ground.screenY - halfLength,
        halfWidth * 2,
        halfLength * 2,
      );
    } else {
      ctx.beginPath();
      ctx.arc(ground.screenX, ground.screenY, pxSize * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
