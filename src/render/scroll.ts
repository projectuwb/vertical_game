// Photo mode (Task 7.4): "a photo mode that renders the ink trail of your best Passage
// as a downloadable PNG scroll." GAME_DESIGN.md doesn't name this feature (logged as
// this task's own design in DECISIONS.md) — the approach: replay the seed + input tape
// silently (no rendering to the real canvas, no audio, much faster than real time),
// and at every step paint the same width/colour wash `render/trail.ts` paints each
// frame, but onto one tall, non-fading canvas indexed by *distance travelled* instead
// of real time — the whole Passage's trail unrolled top (start) to bottom (death) as a
// single continuous scroll, which no live moment of actual play ever shows at once
// (the real trail persists only ~4s and scrolls away with the road).
//
// Uses the browser's own native `canvas.toBlob('image/png')` — no custom encoder
// needed here (unlike `build/generateIcons.ts`, which specifically has no
// `CanvasRenderingContext2D` available in Node and has to rasterize by hand; a browser
// always has one, and its built-in PNG encoder is exactly what this needs).

import { createWorld, stepWorld } from '../sim/world.js';
import { BALANCE } from '../sim/config.js';
import type { InkstoneTrackId } from '../meta/profile.js';
import type { Replay } from '../meta/replay.js';
import { blendClassColor, trailWidthU } from './trail.js';
import { PALETTE } from './palette.js';

const DT = 1 / 60;
// 3px/u produced a technically-correct but nearly-illegible 33px-wide strip (checked by
// actually downloading and opening one in headless Chromium, not just trusting the
// math) — 10px/u keeps a long Passage's file size entirely reasonable (a generous 1000u
// run is still only 10000px tall) while making the trail's own width variation, the
// whole point of a keepsake image, something a viewer can actually see.
const PX_PER_DISTANCE_U = 10;
const LANE_PADDING_U = 1.5; // beyond BALANCE.lane.brushClampX ± the trail's own max half-width, so a wide trail never clips the scroll's edge
const SCROLL_WIDTH_U = (BALANCE.lane.brushClampX + LANE_PADDING_U) * 2;
const PAINT_ALPHA = 0.55; // higher than the live trail's 0.4 — a still image has no repeated-frame overlap building up opacity for it

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Silently replays `replay` end to end (no real-time pacing, no audio/haptics/render to
 * the live canvas) and paints the resulting trail onto a fresh offscreen canvas. Pure
 * with respect to the rest of the app's state — creates its own `World`, touches
 * nothing else.
 */
export function renderTrailScroll(replay: Replay, upgradeLevels: Readonly<Record<InkstoneTrackId, number>>): HTMLCanvasElement {
  const world = createWorld(replay.seed, upgradeLevels, replay.firstRunTeaching);

  // A first pass to find the final distance (so the canvas is sized correctly) is
  // wasteful — `stepWorld` is cheap and the tape is already fully known, so instead
  // just size the canvas from `distanceU` at the *end* of the tape, computed by
  // stepping a lightweight scratch World once, then paint for real on a second pass.
  // Two passes are simpler to get right than growing a canvas mid-paint.
  let finalDistanceU = 0;
  for (const input of replay.inputs) {
    stepWorld(world, DT, input);
    finalDistanceU = world.distanceU;
  }

  const canvasHeightPx = Math.max(1, Math.round(finalDistanceU * PX_PER_DISTANCE_U));
  const canvasWidthPx = Math.round(SCROLL_WIDTH_U * PX_PER_DISTANCE_U);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context unavailable for photo mode');

  ctx.fillStyle = PALETTE.slate;
  ctx.fillRect(0, 0, canvasWidthPx, canvasHeightPx);

  const paintWorld = createWorld(replay.seed, upgradeLevels, replay.firstRunTeaching);
  const centerXPx = canvasWidthPx / 2;
  const uToPx = PX_PER_DISTANCE_U;
  ctx.globalAlpha = PAINT_ALPHA;
  // Each step's own distance travelled (forward speed ramps over a Passage, so this
  // isn't constant) sets how tall that step's painted slice needs to be — a fixed pixel
  // height would leave visible gaps once PX_PER_DISTANCE_U or the forward speed makes a
  // step's own Y advance bigger than that fixed height (a real bug caught by actually
  // downloading and opening an image, not assumed away by the math looking fine at a
  // smaller scale).
  let previousYPx = canvasHeightPx;
  for (const input of replay.inputs) {
    stepWorld(paintWorld, DT, input);
    const strokeCount = paintWorld.line.strokes.length;
    const yPx = canvasHeightPx - paintWorld.distanceU * uToPx; // start at the bottom, death at the top — climbing the scroll upward as distance grows
    if (strokeCount === 0) {
      previousYPx = yPx;
      continue;
    }

    const brushX = clamp(paintWorld.brushFollower.position, -BALANCE.lane.brushClampX, BALANCE.lane.brushClampX);
    const halfWidthPx = (trailWidthU(strokeCount) / 2) * uToPx;
    const xPx = centerXPx + brushX * uToPx;
    const sliceHeightPx = Math.max(1, previousYPx - yPx);

    ctx.fillStyle = blendClassColor(paintWorld.line);
    ctx.fillRect(xPx - halfWidthPx, yPx, halfWidthPx * 2, sliceHeightPx);
    previousYPx = yPx;
  }
  ctx.globalAlpha = 1;

  return canvas;
}

function triggerPngDownload(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob === null) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/** Renders and immediately triggers a browser download — the one entry point main.ts
 *  actually calls. Filename includes the seed so two different scrolls never collide if
 *  a player saves more than one. */
export function downloadTrailScroll(replay: Replay, upgradeLevels: Readonly<Record<InkstoneTrackId, number>>): void {
  const canvas = renderTrailScroll(replay, upgradeLevels);
  triggerPngDownload(canvas, `inkfall-scroll-${replay.seed}.png`);
}
