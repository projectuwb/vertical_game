// The road surface and its scrolling markings (GAME_DESIGN.md §3/§12, Task 2.1). Drawn
// into the "road+trail" offscreen layer (src/render/layers.ts). For now this layer is
// fully cleared and redrawn every frame; Task 2.10 changes that to the 6%-alpha-fade
// accumulation TECH_SPEC.md §5 describes, once there's an ink trail that needs to persist
// on top of it.

import type { ProjectionParams } from './camera.js';
import { project, type ProjectedPoint } from './projection.js';
import { PALETTE } from './palette.js';
import { BALANCE } from '../sim/config.js';

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

export function drawRoad(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  params: ProjectionParams,
  scrollDistance: number,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  fillQuad(
    ctx,
    [
      project(-LANE_HALF_WIDTH, 0, NEAR_DRAW_Z, params),
      project(LANE_HALF_WIDTH, 0, NEAR_DRAW_Z, params),
      project(LANE_HALF_WIDTH, 0, FAR_DRAW_Z, params),
      project(-LANE_HALF_WIDTH, 0, FAR_DRAW_Z, params),
    ],
    PALETTE.slate,
  );

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
