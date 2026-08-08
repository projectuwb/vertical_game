// Four offscreen canvases, composited back-to-front every frame (TECH_SPEC.md §5):
// sky/water (regenerated only on resize), road+trail, actors, HUD (dirty-flagged).
// Owning the canvases here — rather than each drawing module creating its own — is what
// lets main.ts composite them in one fixed, documented order.

import { PALETTE } from './palette.js';

function makeLayer(width: number, height: number, dpr: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas context unavailable for offscreen layer');
  }
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx };
}

export class OffscreenLayers {
  skyWater: HTMLCanvasElement;
  skyWaterCtx: CanvasRenderingContext2D;
  roadTrail: HTMLCanvasElement;
  roadTrailCtx: CanvasRenderingContext2D;
  actors: HTMLCanvasElement;
  actorsCtx: CanvasRenderingContext2D;
  hud: HTMLCanvasElement;
  hudCtx: CanvasRenderingContext2D;

  private cssWidth: number;
  private cssHeight: number;
  private skyWaterStale = true;
  private roadTrailStale = true;
  private hudDirty = true;

  constructor(cssWidth: number, cssHeight: number, dpr: number) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;

    const skyWater = makeLayer(cssWidth, cssHeight, dpr);
    this.skyWater = skyWater.canvas;
    this.skyWaterCtx = skyWater.ctx;

    const roadTrail = makeLayer(cssWidth, cssHeight, dpr);
    this.roadTrail = roadTrail.canvas;
    this.roadTrailCtx = roadTrail.ctx;

    const actors = makeLayer(cssWidth, cssHeight, dpr);
    this.actors = actors.canvas;
    this.actorsCtx = actors.ctx;

    const hud = makeLayer(cssWidth, cssHeight, dpr);
    this.hud = hud.canvas;
    this.hudCtx = hud.ctx;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    for (const canvas of [this.skyWater, this.roadTrail, this.actors, this.hud]) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    for (const ctx of [this.skyWaterCtx, this.roadTrailCtx, this.actorsCtx, this.hudCtx]) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.skyWaterStale = true;
    this.roadTrailStale = true;
    this.hudDirty = true;
  }

  get needsSkyWaterRegen(): boolean {
    return this.skyWaterStale;
  }

  markSkyWaterClean(): void {
    this.skyWaterStale = false;
  }

  /** True immediately after construction and after every resize — the road+trail layer
   *  (Task 2.10) accumulates ink across frames rather than clearing, so a resize (which
   *  invalidates every existing pixel's screen position anyway) needs an explicit signal
   *  to repaint its base once before accumulation resumes, the same way sky/water does. */
  get needsRoadTrailReset(): boolean {
    return this.roadTrailStale;
  }

  markRoadTrailClean(): void {
    this.roadTrailStale = false;
  }

  /** Forces the next frame to repaint the road+trail base from scratch instead of
   *  accumulating on top of what's there — GAME_DESIGN.md §7.4's "visually reset the ink
   *  trail," used on restart (Task 2.11) so a new Passage doesn't inherit the previous
   *  one's ink/death-bleed. */
  requestRoadTrailReset(): void {
    this.roadTrailStale = true;
  }

  get isHudDirty(): boolean {
    return this.hudDirty;
  }

  markHudDirty(): void {
    this.hudDirty = true;
  }

  markHudClean(): void {
    this.hudDirty = false;
  }

  /** Clears the actors layer for a fresh redraw — the only layer cleared every frame. */
  clearActors(): void {
    this.actorsCtx.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  /** Composites all four layers, back to front, onto the real on-screen canvas. */
  compositeInto(targetCtx: CanvasRenderingContext2D): void {
    targetCtx.fillStyle = PALETTE.deep;
    targetCtx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    targetCtx.drawImage(this.skyWater, 0, 0, this.cssWidth, this.cssHeight);
    targetCtx.drawImage(this.roadTrail, 0, 0, this.cssWidth, this.cssHeight);
    targetCtx.drawImage(this.actors, 0, 0, this.cssWidth, this.cssHeight);
    targetCtx.drawImage(this.hud, 0, 0, this.cssWidth, this.cssHeight);
    this.drawVignette(targetCtx);
  }

  private drawVignette(targetCtx: CanvasRenderingContext2D): void {
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    const innerRadius = Math.min(this.cssWidth, this.cssHeight) * 0.35;
    const outerRadius = Math.max(this.cssWidth, this.cssHeight) * 0.75;
    const gradient = targetCtx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    targetCtx.fillStyle = gradient;
    targetCtx.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  dispose(): void {
    this.skyWater.remove();
    this.roadTrail.remove();
    this.actors.remove();
    this.hud.remove();
  }
}
