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
import type { JoiningRecruit, Slip } from '../sim/slips.js';
import type { StrokeClass } from '../sim/stroke.js';
import { isWetnessDry, type WetnessState } from '../sim/wetness.js';
import { flourishChargeFraction, type FlourishState } from '../sim/flourish.js';
import type { QualitySettings } from './quality.js';

export const CLASS_COLOR: Record<StrokeClass, string> = {
  hane: PALETTE.jade,
  tome: PALETTE.vermilion,
  harai: PALETTE.bone,
};

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts.
const SILHOUETTE_BASE_SIZE_U = 0.4;
/**
 * Density block never extends further back (toward the camera) than this, regardless
 * of overflow count. The block always starts right behind row 3, only ~2.25u ahead of
 * the camera itself (row depth is small — 0.75u/row — while the camera sits ~6.5u back)
 * — so even a modest additional depth here pushes its near edge toward the projection's
 * near-clip plane, where scale explodes and the block balloons to cover the whole
 * screen instead of reading as a mass sitting near the Brush. 1.8u keeps its projected
 * scale bounded to a reasonable size at any Line count.
 */
const MAX_BLOCK_DEPTH_U = 1.8;
const BLOCK_LATERAL_PAD_U = 0.3;
const STIPPLE_DOT_COUNT = 48;
const STIPPLE_DOT_RADIUS_PX = 2.5;

export type Quad = readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint];

export function drawLine(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  line: LineState,
  quality?: QualitySettings,
  shapesOnly = false,
): void {
  const classification =
    quality === undefined
      ? classifyForRender(line.strokes.length)
      : classifyForRender(line.strokes.length, quality.densityBlockRowThreshold, quality.individualRowsDrawn);
  const individualCount = Math.min(classification.individualCount, line.strokes.length);

  // Index order (0 = front = farthest from camera among the Line's own rows) already
  // matches painter's-algorithm draw order: draw far-to-near just by counting up.
  for (let i = 0; i < individualCount; i++) {
    const stroke = line.strokes[i] as { class: StrokeClass };
    const slot = computeFormationSlot(i);
    drawStroke(ctx, params, brushX + slot.lateralOffset, brushZ + slot.depthOffset, stroke.class, shapesOnly);
  }

  if (classification.hasDensityBlock) {
    drawDensityBlock(ctx, params, brushX, brushZ, line, individualCount, quality?.stippleDotCount ?? STIPPLE_DOT_COUNT);
  }
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  x: number,
  z: number,
  cls: StrokeClass,
  shapesOnly: boolean,
): void {
  const ground = project(x, 0, z, params);
  const pxSize = SILHOUETTE_BASE_SIZE_U * ground.scale * params.unit;
  ctx.fillStyle = CLASS_COLOR[cls];
  drawGlyph(ctx, ground.screenX, ground.screenY, pxSize, cls);
  if (shapesOnly) drawShapesOnlyMark(ctx, ground.screenX, ground.screenY, pxSize, cls);
}

/** GAME_DESIGN.md §12's colourblind requirement: "class must be legible from silhouette
 *  alone... Ship a Shapes-Only toggle that additionally stamps a small glyph mark on
 *  every Stroke and Slip." The three glyphs (tick/block/sliver) are already
 *  silhouette-distinct without this — it's a deliberately redundant, extra-legible cue
 *  for players who want it, not the primary mechanism. A dot count (1/2/3) rather than
 *  lettering: no font dependency, reads at the small on-screen size a single Stroke
 *  renders at, and — like the glyphs themselves — survives any colour transform,
 *  including full greyscale, since it's placement/count, not hue. `PALETTE.deep` (the
 *  darkest colour in the whole palette) against any of the three class colours (all
 *  lighter) keeps the mark visible on every one without a fourth palette colour. */
const SHAPES_ONLY_MARK_COUNT: Record<StrokeClass, number> = { hane: 1, tome: 2, harai: 3 };
const SHAPES_ONLY_DOT_RADIUS_FRACTION = 0.06;
const SHAPES_ONLY_DOT_SPACING_FRACTION = 0.22;

/** Exported purely so `tests/render/strokes.test.ts` can assert the three classes get
 *  distinct, stable mark counts without needing a mock CanvasRenderingContext2D — the
 *  actual drawing (like the rest of /render) is verified by eye via headless Chromium,
 *  same convention Tasks 4.3-4.5 already established. */
export function shapesOnlyMarkCount(cls: StrokeClass): number {
  return SHAPES_ONLY_MARK_COUNT[cls];
}

function drawShapesOnlyMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  cls: StrokeClass,
): void {
  const count = SHAPES_ONLY_MARK_COUNT[cls];
  const spacing = size * SHAPES_ONLY_DOT_SPACING_FRACTION;
  const radius = Math.max(0.75, size * SHAPES_ONLY_DOT_RADIUS_FRACTION);
  const startX = cx - (spacing * (count - 1)) / 2;
  ctx.fillStyle = PALETTE.deep;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * spacing, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type GlyphPoint = readonly [number, number];

/**
 * The three classes' silhouette-defining polygons (GAME_DESIGN.md §4's "silhouette
 * first, colour second"), local to a glyph centred at the origin at the given `size` —
 * the single source of truth `drawStroke`'s actual `ctx` calls below draw from. Task
 * 7.6's `src/build/checkColorblind.ts` dev tool duplicates these same numbers rather
 * than importing them (with an explicit cross-reference comment) — it compiles under
 * `tsconfig.cli.json`'s Node-only program, which doesn't include /render, the same
 * constraint `generateIcons.ts` already documents for its own copy of the Harai
 * triangle. Harai's rotation is baked into the returned points (matching what
 * `ctx.rotate` used to do implicitly) rather than left for the caller to apply, since
 * the rotation is part of the glyph's identity, not a caller-supplied transform.
 */
export function strokeGlyphPolygon(cls: StrokeClass, size: number): readonly GlyphPoint[] {
  if (cls === 'hane') {
    // A narrow upward tick.
    const halfWidth = size * 0.18;
    const height = size * 1.3;
    return [
      [0, -height],
      [halfWidth, 0],
      [-halfWidth, 0],
    ];
  }
  if (cls === 'tome') {
    // A squat heavy block.
    const halfWidth = size * 0.55;
    const halfHeight = size * 0.65;
    return [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ];
  }
  // Harai — a long tapering diagonal sliver, rotated -36° (-π/5).
  const length = size * 1.6;
  const width = size * 0.32;
  const angle = -Math.PI / 5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local: readonly GlyphPoint[] = [
    [-length / 2, 0],
    [length / 2, -width / 2],
    [length / 2, width / 2],
  ];
  return local.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
}

function fillGlyphPolygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, points: readonly GlyphPoint[]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(cx + x, cy + y);
    else ctx.lineTo(cx + x, cy + y);
  });
  ctx.closePath();
  ctx.fill();
}

function drawGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, cls: StrokeClass): void {
  fillGlyphPolygon(ctx, cx, cy, strokeGlyphPolygon(cls, size));
}

function drawDensityBlock(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  line: LineState,
  individualCount: number,
  stippleDotCount: number,
): void {
  const rowSize = BALANCE.line.rowSize;
  // The block always starts right where the individually-drawn glyphs stop — reading
  // this from the actual `individualCount` passed in (rather than recomputing from
  // `BALANCE.line.individualRowsDrawn`) is what makes the adaptive quality manager's
  // reduced-row-count override (render/quality.ts) draw a seamless block instead of a
  // gap or overlap where the row count it was actually called with differs from
  // `BALANCE`'s own default.
  const farSlot = computeFormationSlot(individualCount);
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
  fillQuad(ctx, corners, CLASS_COLOR[dominant]);

  drawStipple(ctx, corners, counts, dominant, stippleDotCount);
}

export function fillQuad(ctx: CanvasRenderingContext2D, corners: Quad, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(corners[0].screenX, corners[0].screenY);
  ctx.lineTo(corners[1].screenX, corners[1].screenY);
  ctx.lineTo(corners[2].screenX, corners[2].screenY);
  ctx.lineTo(corners[3].screenX, corners[3].screenY);
  ctx.closePath();
  ctx.fill();
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
  dotCount: number,
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

  for (let i = 0; i < dotCount; i++) {
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

// Render-only cosmetic constants for Slips — not gameplay balance.
const SLIP_HEIGHT_U = 0.55;
const SLIP_PLUS_ONE_WIDTH_U = 0.5;
const SLIP_PLUS_FIVE_WIDTH_U = 0.9;
const SLIP_THICKNESS_U = 0.08;

/**
 * Paper slips staked along the verge (GAME_DESIGN.md §7.1): class-tinted, growing wider
 * with value — +1 modest, +5 larger, the +25 Banner spanning a third of the lane.
 */
export function drawSlips(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  pool: Pool<Slip>,
  shapesOnly = false,
): void {
  pool.forEachActive((s) => {
    const widthU =
      s.kind === 'plusOne'
        ? SLIP_PLUS_ONE_WIDTH_U
        : s.kind === 'plusFive'
          ? SLIP_PLUS_FIVE_WIDTH_U
          : BALANCE.lane.width * BALANCE.slips.plusTwentyFive.laneSpanFraction;
    const halfWidth = widthU / 2;

    const corners: Quad = [
      project(s.x - halfWidth, 0, s.z - SLIP_THICKNESS_U, params),
      project(s.x + halfWidth, 0, s.z - SLIP_THICKNESS_U, params),
      project(s.x + halfWidth, SLIP_HEIGHT_U, s.z, params),
      project(s.x - halfWidth, SLIP_HEIGHT_U, s.z, params),
    ];
    fillQuad(ctx, corners, CLASS_COLOR[s.class]);

    if (shapesOnly) {
      const centerX = (corners[0].screenX + corners[1].screenX + corners[2].screenX + corners[3].screenX) / 4;
      const centerY = (corners[0].screenY + corners[1].screenY + corners[2].screenY + corners[3].screenY) / 4;
      const sizePx = Math.abs(corners[1].screenX - corners[0].screenX);
      drawShapesOnlyMark(ctx, centerX, centerY, sizePx, s.class);
    }
  });
}

const RECRUIT_RADIUS_U = 0.14;

/** The runner-joins-the-back animation (GAME_DESIGN.md §7.1): a small mark travelling
 *  from the Slip it came from to its new place in the Line. */
export function drawJoiningRecruits(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  pool: Pool<JoiningRecruit>,
): void {
  pool.forEachActive((r) => {
    const ground = project(r.x, 0.2, r.z, params);
    const pxRadius = Math.max(1.5, RECRUIT_RADIUS_U * ground.scale * params.unit);
    ctx.fillStyle = CLASS_COLOR[r.class];
    ctx.beginPath();
    ctx.arc(ground.screenX, ground.screenY, pxRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Render-only cosmetic constants for the Brush marker — not gameplay balance.
const BRUSH_RADIUS_U = 0.3;
const BRUSH_MARKER_Z_LEAD_U = 0.5; // slightly ahead of the Line's own front-row bulge
const BRUSH_CHARGE_GROW_FRACTION = 0.5; // how much bigger the Brush gets at full charge
const BRUSH_PULSE_HZ = 4; // insufficient-Wetness/on-cooldown "no" pulse
const BRUSH_EMPTY_RING_ALPHA = 0.35;

/** Blends `hex` toward its own greyscale luminance by `amount` (0-1) — used for the dry
 *  Wetness state's "colours desaturate 60%" (GAME_DESIGN.md §6), computed from the one
 *  declared palette colour rather than adding a second hardcoded swatch (palette.ts:
 *  "exactly these, no others without logging a decision"). */
function desaturate(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number): number => Math.round(c + (gray - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * The Brush itself (GAME_DESIGN.md §6): Wetness is "drawn as an ink level in the Brush's
 * own body, not as a UI bar" — rendered as a liquid-style fill rising from the bottom of
 * the marker to `current/max`, inside a faint always-visible ring so an empty Brush still
 * reads as present rather than missing. At Wetness 0 the fill (nearly empty) and the
 * desaturated colour double up to make "the Brush visibly runs pale" unmistakable without
 * needing a separate bar. While charging a valid Flourish the Brush grows and turns
 * vermilion with charge progress; while holding on an invalid charge (too little Wetness,
 * still on cooldown) it pulses instead, per §6's "shows the meter pulsing."
 */
export function drawBrush(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  brushX: number,
  brushZ: number,
  wetness: WetnessState,
  flourish: FlourishState,
  timeS: number,
): void {
  const chargeFraction = flourishChargeFraction(flourish, timeS);
  const ground = project(brushX, 0, brushZ + BRUSH_MARKER_Z_LEAD_U, params);
  const baseRadiusPx = Math.max(2, BRUSH_RADIUS_U * ground.scale * params.unit);
  const radiusPx = baseRadiusPx * (1 + chargeFraction * BRUSH_CHARGE_GROW_FRACTION);

  const isCharging = chargeFraction > 0;
  const color = isCharging
    ? PALETTE.vermilion
    : isWetnessDry(wetness)
      ? desaturate(PALETTE.bone, BALANCE.wetness.dryDesaturateFraction)
      : PALETTE.bone;

  let alpha = 1;
  if (flourish.isPulsing) {
    const pulse = 0.5 + 0.5 * Math.sin(timeS * BRUSH_PULSE_HZ * Math.PI * 2);
    alpha = 0.4 + pulse * 0.6;
  }

  ctx.save();
  ctx.globalAlpha = alpha * BRUSH_EMPTY_RING_ALPHA;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ground.screenX, ground.screenY, radiusPx, 0, Math.PI * 2);
  ctx.stroke();

  const fraction = Math.max(0, Math.min(1, wetness.current / BALANCE.wetness.max));
  ctx.beginPath();
  ctx.arc(ground.screenX, ground.screenY, radiusPx, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const fillTop = ground.screenY + radiusPx - fraction * radiusPx * 2;
  ctx.fillRect(ground.screenX - radiusPx, fillTop, radiusPx * 2, radiusPx * 2);
  ctx.restore();
}
