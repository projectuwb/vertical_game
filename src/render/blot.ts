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
// Task 7.10, GAME_DESIGN.md §12: "hit feedback is an ink splat and a 60ms scale pop,
// never a flash." No new colour/brightness anywhere — the splat is the same fillStyle
// (PALETTE.blot) as the Blot itself, just a softer, briefly-larger, fading echo of it.
const HIT_POP_DURATION_S = 0.06;
const HIT_POP_SCALE = 0.4;
const HIT_SPLAT_START_SCALE = 1.5;
const HIT_SPLAT_END_SCALE = 2.3;
const HIT_SPLAT_START_ALPHA = 0.5;

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

export interface HitPop {
  /** Multiplies the Blot's own drawn radius — the "scale pop" half. */
  readonly popScale: number;
  /** Multiplies the Blot's own drawn radius for the splat's (larger, separate) radius. */
  readonly splatScale: number;
  readonly splatAlpha: number;
}

/**
 * Pure decay math for Task 7.10's hit feedback (GAME_DESIGN.md §12: "an ink splat and a
 * 60ms scale pop, never a flash") — kept separate from `drawBlot`'s actual `ctx` calls
 * so it's unit-testable the same way `road.ts`'s `computeDashSpans` and `strokes.ts`'s
 * `shapesOnlyMarkCount` are (this codebase's convention is to unit-test the pure math a
 * draw function feeds on, not to mock `CanvasRenderingContext2D` itself). Returns null
 * once `ageS` (time since the hit) is outside the window, or negative (not hit yet this
 * frame — shouldn't happen, but a Blot spawned exactly at `lastHitAtS`'s sentinel is
 * defensively excluded rather than assumed impossible).
 */
export function computeHitPop(ageS: number): HitPop | null {
  if (ageS < 0 || ageS >= HIT_POP_DURATION_S) return null;
  const t = ageS / HIT_POP_DURATION_S;
  return {
    popScale: 1 + HIT_POP_SCALE * (1 - t),
    splatScale: HIT_SPLAT_START_SCALE + (HIT_SPLAT_END_SCALE - HIT_SPLAT_START_SCALE) * t,
    splatAlpha: HIT_SPLAT_START_ALPHA * (1 - t),
  };
}

/** Fading, briefly-expanding echo of the same shape at the same spot — the "splat" half
 *  of Task 7.10's hit feedback. Drawn *before* the main shape (same fillStyle, just a
 *  lower, decaying alpha) so the crisp Blot silhouette always reads on top of its own
 *  splat rather than being smudged by it. */
function drawHitSplat(ctx: CanvasRenderingContext2D, cx: number, cy: number, baseRadius: number, pop: HitPop): void {
  ctx.save();
  ctx.globalAlpha = pop.splatAlpha;
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius * pop.splatScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws every active Blot. Individual (near/low-count) Blot get the full ragged blob;
 * beyond TECH_SPEC.md §5's mass threshold, distant ones drop to a plain small circle —
 * cheaper to draw, and at that size/distance visually indistinguishable from the
 * detailed version, so the wave still reads as one dark stain at full 900-unit counts.
 * `timeS` (Task 7.10) drives the recently-hit pop/splat — a plain per-Blot field read,
 * not a new pass, so it costs nothing extra at the 900-Blot ceiling beyond what every
 * other frame already does.
 */
export function drawBlot(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  pool: Pool<Blot>,
  brushZ: number,
  timeS: number,
): void {
  const activeCount = pool.activeCount;
  ctx.fillStyle = PALETTE.blot;

  pool.forEachActive((b: Blot) => {
    const distanceU = b.z - brushZ;
    const tier = classifyBlotForRender(activeCount, distanceU);
    const ground = project(b.x, 0.2, b.z, params);

    const pop = computeHitPop(timeS - b.lastHitAtS);
    const popScale = pop?.popScale ?? 1;

    if (tier === 'individual') {
      const pxRadius = Math.max(2, CLASS_VISUAL_RADIUS_U[b.class] * ground.scale * params.unit);
      if (pop !== null) drawHitSplat(ctx, ground.screenX, ground.screenY, pxRadius, pop);
      drawRaggedBlob(ctx, ground.screenX, ground.screenY, pxRadius * popScale, b.poolIndex);
    } else {
      const pxRadius = Math.max(1, MASS_TIER_RADIUS_U * ground.scale * params.unit);
      if (pop !== null) drawHitSplat(ctx, ground.screenX, ground.screenY, pxRadius, pop);
      ctx.beginPath();
      ctx.arc(ground.screenX, ground.screenY, pxRadius * popScale, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
