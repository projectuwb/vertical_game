// The road surface and its scrolling markings (GAME_DESIGN.md §3/§12, Task 2.1). Drawn
// into the "road+trail" offscreen layer (src/render/layers.ts), which — as of Task
// 2.10 — is a genuine accumulation layer: `resetRoadTrailBase` paints the lane once
// (on load and after every resize, mirroring sky/water's regen-on-resize pattern), and
// every ordinary frame only fades what's there by TRAIL_FADE_ALPHA (TECH_SPEC.md §5's
// "6% alpha fade") before redrawing the edge lines and this frame's dashes on top —
// never a hard clear, or the ink trail (trail.ts) painted into the same layer couldn't
// persist across frames at all.

import type { ProjectionParams } from './camera.js';
import { project, type ProjectedPoint } from './projection.js';
import { PALETTE } from './palette.js';
import { BALANCE } from '../sim/config.js';
import { gateEffectLabel, type Gate, type GatePair } from '../sim/gates.js';
import type { Pool } from '../core/pool.js';
import type { Sealstack } from '../sim/sealstacks.js';
import { CLASS_COLOR } from './strokes.js';

const LANE_HALF_WIDTH = BALANCE.lane.halfWidth;

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts.
const EDGE_LINE_HALF_WIDTH_U = 0.08;
const CENTER_DASH_LENGTH_U = 3;
const CENTER_DASH_GAP_U = 3;
const CENTER_DASH_PERIOD_U = CENTER_DASH_LENGTH_U + CENTER_DASH_GAP_U;
const CENTER_DASH_HALF_WIDTH_U = 0.08;
const MARKING_HEIGHT_U = 0.01; // just above the road surface, avoids z-fighting artefacts
// How far ahead of the camera the road is drawn. NEAR_DRAW_Z sits just short of the
// near-clip plane (camera.ts NEAR_CLIP corresponds to z ≈ -5.9) deliberately — at that
// depth the ground plane's projected scale is large enough that its near edge always
// lands past the bottom of the canvas, at any supported aspect ratio, so the road reads
// as continuing under the Brush rather than visibly stopping partway up the screen.
const NEAR_DRAW_Z = -5.8;
const FAR_DRAW_Z = 200;
/** TECH_SPEC.md §5: "the trail accumulates here with a per-frame 6% alpha fade." Applies
 *  to the whole road+trail layer, not just trail.ts's own paint — everything on this
 *  layer (old dash ghosts included) decays at the same rate, back toward the lane's own
 *  base colour (see resetRoadTrailBase/drawRoad below). */
const TRAIL_FADE_ALPHA = 0.06;

type Quad = readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint];

export function drawSkyWater(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  params: ProjectionParams,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const horizonY = params.cy + params.horizonOffsetPx;
  const horizonStop = Math.max(0, Math.min(1, horizonY / cssHeight));

  const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
  gradient.addColorStop(0, PALETTE.deep);
  gradient.addColorStop(horizonStop, '#1E2833'); // a faint atmospheric lift at the vanishing point
  gradient.addColorStop(1, PALETTE.deep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
}

function laneQuad(params: ProjectionParams): Quad {
  return [
    project(-LANE_HALF_WIDTH, 0, NEAR_DRAW_Z, params),
    project(LANE_HALF_WIDTH, 0, NEAR_DRAW_Z, params),
    project(LANE_HALF_WIDTH, 0, FAR_DRAW_Z, params),
    project(-LANE_HALF_WIDTH, 0, FAR_DRAW_Z, params),
  ];
}

/**
 * Paints the lane's opaque base once — on load and after every resize
 * (layers.ts's `needsRoadTrailReset`), mirroring sky/water's regen-on-resize pattern.
 * `drawRoad`'s per-frame 6%-alpha fade then maintains this base colour indefinitely
 * (fading it toward itself is a no-op) without ever needing a hard repaint, which is
 * exactly what lets trail.ts's ink persist and fade on the same layer instead of being
 * wiped every frame.
 */
export function resetRoadTrailBase(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  params: ProjectionParams,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  fillQuad(ctx, laneQuad(params), PALETTE.slate);
}

/**
 * The per-frame road pass: fade everything already on the layer (old ink, old dash
 * ghosts) by `TRAIL_FADE_ALPHA` toward the lane's base colour, then redraw the edge
 * lines (always the same screen position, so fade-then-redraw-opaque keeps them
 * permanently crisp) and this frame's dashes on top. Never clears — see
 * `resetRoadTrailBase` for the one-time base paint this depends on.
 *
 * `eraseMarkings` is the Blank's phase 4 (GAME_DESIGN.md §8.2: "erases the road
 * markings entirely, leaving only the ink trail to navigate by") — skips the edge
 * lines and dashes for this frame only (never touches the ink trail, painted
 * separately into the same layer) so old marking ghosts already on the layer still
 * fade away at the normal rate above rather than vanishing abruptly.
 */
export function drawRoad(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  scrollDistance: number,
  eraseMarkings = false,
): void {
  ctx.save();
  ctx.globalAlpha = TRAIL_FADE_ALPHA;
  fillQuad(ctx, laneQuad(params), PALETTE.slate);
  ctx.restore();

  if (eraseMarkings) return;

  drawEdgeLine(ctx, -LANE_HALF_WIDTH, params);
  drawEdgeLine(ctx, LANE_HALF_WIDTH, params);
  drawCenterDashes(ctx, params, scrollDistance);
}

function drawEdgeLine(ctx: CanvasRenderingContext2D, centerX: number, params: ProjectionParams): void {
  fillQuad(
    ctx,
    [
      project(centerX - EDGE_LINE_HALF_WIDTH_U, MARKING_HEIGHT_U, NEAR_DRAW_Z, params),
      project(centerX + EDGE_LINE_HALF_WIDTH_U, MARKING_HEIGHT_U, NEAR_DRAW_Z, params),
      project(centerX + EDGE_LINE_HALF_WIDTH_U, MARKING_HEIGHT_U, FAR_DRAW_Z, params),
      project(centerX - EDGE_LINE_HALF_WIDTH_U, MARKING_HEIGHT_U, FAR_DRAW_Z, params),
    ],
    PALETTE.bone,
  );
}

/**
 * The near/far world-z span of every currently-visible centreline dash, given how far
 * the Passage has scrolled. Pure and DOM-free specifically so the "no shimmer or seam"
 * requirement (Task 2.1) is unit-testable: dash positions are `k * period - phase`,
 * where `phase = scrollDistance mod period` — a continuous function of scrollDistance,
 * so nothing pops or jumps as it wraps from `period` back to `0`.
 */
export function computeDashSpans(
  scrollDistance: number,
  nearZ: number,
  farZ: number,
  period: number,
  length: number,
): (readonly [number, number])[] {
  const phase = ((scrollDistance % period) + period) % period;
  const firstK = Math.floor((nearZ + phase) / period) - 1;
  const lastK = Math.ceil((farZ + phase) / period) + 1;

  const spans: (readonly [number, number])[] = [];
  for (let k = firstK; k <= lastK; k++) {
    const farEdge = k * period - phase + length;
    const nearEdge = farEdge - length;
    const clippedNear = Math.max(nearEdge, nearZ);
    const clippedFar = Math.min(farEdge, farZ);
    if (clippedFar > clippedNear) {
      spans.push([clippedNear, clippedFar]);
    }
  }
  return spans;
}

function drawCenterDashes(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  scrollDistance: number,
): void {
  const spans = computeDashSpans(
    scrollDistance,
    NEAR_DRAW_Z,
    FAR_DRAW_Z,
    CENTER_DASH_PERIOD_U,
    CENTER_DASH_LENGTH_U,
  );
  for (const [near, far] of spans) {
    fillQuad(
      ctx,
      [
        project(-CENTER_DASH_HALF_WIDTH_U, MARKING_HEIGHT_U, near, params),
        project(CENTER_DASH_HALF_WIDTH_U, MARKING_HEIGHT_U, near, params),
        project(CENTER_DASH_HALF_WIDTH_U, MARKING_HEIGHT_U, far, params),
        project(-CENTER_DASH_HALF_WIDTH_U, MARKING_HEIGHT_U, far, params),
      ],
      PALETTE.bone,
    );
  }
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

// Render-only cosmetic constants for Gates/Sealstacks — not gameplay balance.
const GATE_HEIGHT_U = 1.6;
const GATE_THICKNESS_U = 0.15;
const SEALSTACK_HEIGHT_U = 1.2;
// Task 7.11, GAME_DESIGN.md §12: "Gate numbers are the loudest type in the game — set
// them enormous, at Shippori's heaviest weight, with a bone stroke on the vermilion
// fill." Applied to every non-Sealed family's label (§7.2 gives a literal display
// string for all three — arithmetic, conversion, temper — not just numeric ones), since
// this is the one typographic rule §12 states for Gates as a UI element, not a rule
// specific to the arithmetic family alone.
const GATE_LABEL_HEIGHT_U = 0.95; // roughly mid-door — GATE_HEIGHT_U is 1.6
const GATE_LABEL_FONT_SIZE_U = 1.05; // "enormous" relative to the 1.6-tall door it sits on
const GATE_LABEL_STROKE_FRACTION = 0.09; // stroke width as a fraction of font size
const SEAL_MARK_RADIUS_U = 0.45;

function drawSealMark(ctx: CanvasRenderingContext2D, params: ProjectionParams, centerX: number, z: number): void {
  const point = project(centerX, GATE_LABEL_HEIGHT_U, z - GATE_THICKNESS_U / 2, params);
  const r = Math.max(3, SEAL_MARK_RADIUS_U * point.scale * params.unit);
  ctx.save();
  ctx.strokeStyle = PALETTE.bone;
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(point.screenX, point.screenY, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PALETTE.bone;
  ctx.beginPath();
  ctx.arc(point.screenX, point.screenY, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** How much of the door's own projected width the label may fill before "enormous"
 *  starts spilling into the *other* half's label — the door itself only spans 80% of a
 *  lane-half (`drawGateHalf`'s own 10%-each-side inset), so this stays comfortably clear
 *  of the lane's centre line even at 1.0. */
const GATE_LABEL_MAX_WIDTH_FRACTION = 0.92;

function drawGateLabel(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  gate: Gate,
  left: number,
  right: number,
  z: number,
): void {
  const centerX = (left + right) / 2;
  const point = project(centerX, GATE_LABEL_HEIGHT_U, z - GATE_THICKNESS_U / 2, params);
  const availableWidthPx = Math.abs(project(right, GATE_LABEL_HEIGHT_U, z, params).screenX - project(left, GATE_LABEL_HEIGHT_U, z, params).screenX);
  const label = gateEffectLabel(gate.effect);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // "Enormous" (GAME_DESIGN.md §12) up to whatever the door's own width can hold without
  // the label bleeding into its neighbour's — measured, not guessed, since label length
  // varies a lot across families ("×2" vs "Wetness cap +25").
  let fontPx = Math.max(9, GATE_LABEL_FONT_SIZE_U * point.scale * params.unit);
  ctx.font = `800 ${fontPx}px "Shippori Mincho B1", serif`;
  const measuredWidthPx = ctx.measureText(label).width;
  const maxWidthPx = availableWidthPx * GATE_LABEL_MAX_WIDTH_FRACTION;
  if (measuredWidthPx > maxWidthPx) {
    fontPx *= maxWidthPx / measuredWidthPx;
    ctx.font = `800 ${fontPx}px "Shippori Mincho B1", serif`;
  }

  ctx.lineWidth = Math.max(1, fontPx * GATE_LABEL_STROKE_FRACTION);
  ctx.strokeStyle = PALETTE.bone;
  ctx.fillStyle = PALETTE.vermilion;
  // Stroke first, fill on top — the stroke straddles the glyph outline (half in, half
  // out), so filling afterward covers the inner half and leaves a clean bone border.
  ctx.strokeText(label, point.screenX, point.screenY);
  ctx.fillText(label, point.screenX, point.screenY);
  ctx.restore();
}

function gateColor(gate: Gate): string {
  if (gate.family === 'sealed') return PALETTE.blot;
  if (gate.family === 'temper') return PALETTE.jade;
  if (gate.family === 'conversion' && gate.effect.conversionTarget !== undefined) {
    return CLASS_COLOR[gate.effect.conversionTarget];
  }
  return PALETTE.bone; // arithmetic
}

function drawGateHalf(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  gate: Gate,
  xMin: number,
  xMax: number,
  z: number,
): void {
  const inset = (xMax - xMin) * 0.1;
  const left = xMin + inset;
  const right = xMax - inset;
  fillQuad(
    ctx,
    [
      project(left, 0, z - GATE_THICKNESS_U, params),
      project(right, 0, z - GATE_THICKNESS_U, params),
      project(right, GATE_HEIGHT_U, z, params),
      project(left, GATE_HEIGHT_U, z, params),
    ],
    gateColor(gate),
  );

  if (gate.family === 'sealed') {
    drawSealMark(ctx, params, (left + right) / 2, z);
  } else {
    drawGateLabel(ctx, params, gate, left, right, z);
  }
}

/** A Gate pair (GAME_DESIGN.md §7.2): two half-lane doors. Family colour-coded — Sealed
 *  is deliberately the darkest/most mysterious, matching "shows only a seal mark." */
export function drawGatePair(ctx: CanvasRenderingContext2D, params: ProjectionParams, pair: GatePair, z: number): void {
  drawGateHalf(ctx, params, pair.left, -BALANCE.lane.halfWidth, 0, z);
  drawGateHalf(ctx, params, pair.right, 0, BALANCE.lane.halfWidth, z);
}

/** Sealstacks (GAME_DESIGN.md §7.3): a wide dark block on whichever half of the lane it occupies. */
export function drawSealstacks(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  pool: Pool<Sealstack>,
): void {
  pool.forEachActive((s) => {
    const xMin = s.side === 'left' ? -BALANCE.lane.halfWidth : 0;
    const xMax = s.side === 'left' ? 0 : BALANCE.lane.halfWidth;
    const inset = (xMax - xMin) * 0.08;
    fillQuad(
      ctx,
      [
        project(xMin + inset, 0, s.z - BALANCE.sealstacks.thicknessU, params),
        project(xMax - inset, 0, s.z - BALANCE.sealstacks.thicknessU, params),
        project(xMax - inset, SEALSTACK_HEIGHT_U, s.z, params),
        project(xMin + inset, SEALSTACK_HEIGHT_U, s.z, params),
      ],
      PALETTE.blot,
    );
  });
}
