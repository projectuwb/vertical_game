// Blot rendering + mass silhouettes (GAME_DESIGN.md §8.1, Task 2.4). "Ragged, wet-edged
// silhouettes with visible bleed — never detailed characters. A wave of 300 should read
// as a single advancing stain that resolves into individuals as it nears." Per-class
// silhouette *shape* differentiation isn't required here the way it is for Strokes
// (§4/§12's colourblind rule is specifically about Strokes/Slips) — Blot's job is to
// read as one dark mass, with only size hinting at threat.

import type { ProjectionParams } from './camera.js';
import { project } from './projection.js';
import { PALETTE } from './palette.js';
import { classifyBlotForRender, type Blot, type BlotClass } from '../sim/blot.js';
import type { Pool } from '../core/pool.js';

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts.
const CLASS_VISUAL_RADIUS_U: Record<BlotClass, number> = {
  smudge: 0.35,
  runner: 0.3,
  crust: 0.55,
  splitter: 0.4,
  blotter: 0.45,
  drifter: 0.32,
};
const MASS_TIER_RADIUS_U = 0.2;
const RAGGED_VERTEX_COUNT = 8;

/** Deterministic per-slot "randomness" so a Blot's ragged silhouette stays stable frame
 *  to frame (regenerating it from Math.random() every draw would read as flicker, not
 *  raggedness) without needing an extra stored field — poolIndex is already stable for
 *  as long as that Blot instance is alive. */
function pseudoRandom01(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function drawRaggedBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseRadius: number,
  seed: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < RAGGED_VERTEX_COUNT; i++) {
    const angle = (i / RAGGED_VERTEX_COUNT) * Math.PI * 2;
    const jitter = 0.75 + pseudoRandom01(seed, i) * 0.5; // 0.75..1.25 — a torn, uneven edge
    const r = baseRadius * jitter;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r * 0.85; // slightly flattened, ground-hugging
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws every active Blot. Individual (near/low-count) Blot get the full ragged blob;
 * beyond TECH_SPEC.md §5's mass threshold, distant ones drop to a plain small circle —
 * cheaper to draw, and at that size/distance visually indistinguishable from the
 * detailed version, so the wave still reads as one dark stain at full 900-unit counts.
 */
export function drawBlot(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  pool: Pool<Blot>,
  brushZ: number,
): void {
  const activeCount = pool.activeCount;
  ctx.fillStyle = PALETTE.blot;

  pool.forEachActive((b: Blot) => {
    const distanceU = b.z - brushZ;
    const tier = classifyBlotForRender(activeCount, distanceU);
    const ground = project(b.x, 0.2, b.z, params);

    if (tier === 'individual') {
      const pxRadius = Math.max(2, CLASS_VISUAL_RADIUS_U[b.class] * ground.scale * params.unit);
      drawRaggedBlob(ctx, ground.screenX, ground.screenY, pxRadius, b.poolIndex);
    } else {
      const pxRadius = Math.max(1, MASS_TIER_RADIUS_U * ground.scale * params.unit);
      ctx.beginPath();
      ctx.arc(ground.screenX, ground.screenY, pxRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
