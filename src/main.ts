// Application bootstrap. Wires platform → sim → render. Fleshed out across Phase 1-2.

import {
  attachVisibilityAutoPause,
  FixedStepLoop,
  mountDebugOverlay,
  runInBrowser,
  type LoopCallbacks,
} from './core/loop.js';
import { InputSampler } from './platform/input.js';
import { Viewport } from './platform/viewport.js';
import { stepCriticallyDamped, type DampedFollower1D } from './sim/line.js';
import { BALANCE } from './sim/config.js';
import { computeProjectionParams } from './render/camera.js';
import { project } from './render/projection.js';
import { drawRoad, drawSkyWater } from './render/road.js';
import { OffscreenLayers } from './render/layers.js';
import { PALETTE } from './render/palette.js';

const BRUSH_CLAMP = BALANCE.lane.brushClampX;
const LATERAL_DAMPING_TAU_S = BALANCE.control.dampingTimeConstantS;
/** The Brush's fixed world-space depth: the road scrolls past it, not the other way round. */
const BRUSH_Z = 0;
const BRUSH_MARKER_RADIUS_U = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bootstrap(): void {
  const app = document.getElementById('app');
  if (app === null) {
    throw new Error('missing #app root element');
  }

  const viewport = new Viewport(app);
  const input = new InputSampler(viewport.canvas);

  const initialMetrics = viewport.getMetrics();
  const layers = new OffscreenLayers(
    initialMetrics.cssWidth,
    initialMetrics.cssHeight,
    initialMetrics.devicePixelRatio,
  );
  let lastCssWidth = initialMetrics.cssWidth;
  let lastCssHeight = initialMetrics.cssHeight;
  let lastDpr = initialMetrics.devicePixelRatio;

  // Stand-in for the real Brush/Line entity (Task 2.2) — proves lateral control end to
  // end (Task 1.5) through the now-real projection (Task 2.1) rather than a flat mapping.
  let targetX = 0;
  let follower: DampedFollower1D = { position: 0, velocity: 0 };
  let holding = false;
  let scrollDistance = 0;

  const callbacks: LoopCallbacks = {
    update: (dtFixed: number): void => {
      const frame = input.sample(dtFixed);
      targetX = clamp(targetX + frame.lateralDelta, -BRUSH_CLAMP, BRUSH_CLAMP);
      follower = stepCriticallyDamped(follower, targetX, dtFixed, LATERAL_DAMPING_TAU_S);
      holding = frame.holding;
      scrollDistance += BALANCE.forwardSpeed.baseUPerS * dtFixed;
    },
    render: (_alpha: number): void => {
      const metrics = viewport.getMetrics();
      if (
        metrics.cssWidth !== lastCssWidth ||
        metrics.cssHeight !== lastCssHeight ||
        metrics.devicePixelRatio !== lastDpr
      ) {
        layers.resize(metrics.cssWidth, metrics.cssHeight, metrics.devicePixelRatio);
        lastCssWidth = metrics.cssWidth;
        lastCssHeight = metrics.cssHeight;
        lastDpr = metrics.devicePixelRatio;
      }

      const params = computeProjectionParams(metrics.cssWidth, metrics.cssHeight);

      if (layers.needsSkyWaterRegen) {
        drawSkyWater(layers.skyWaterCtx, metrics.cssWidth, metrics.cssHeight, params);
        layers.markSkyWaterClean();
      }

      drawRoad(layers.roadTrailCtx, metrics.cssWidth, metrics.cssHeight, params, scrollDistance);

      layers.clearActors();
      const marker = project(
        clamp(follower.position, -BRUSH_CLAMP, BRUSH_CLAMP),
        BRUSH_MARKER_RADIUS_U,
        BRUSH_Z,
        params,
      );
      layers.actorsCtx.beginPath();
      layers.actorsCtx.arc(
        marker.screenX,
        marker.screenY,
        Math.max(2, BRUSH_MARKER_RADIUS_U * marker.scale * params.unit),
        0,
        Math.PI * 2,
      );
      layers.actorsCtx.fillStyle = holding ? PALETTE.vermilion : PALETTE.jade;
      layers.actorsCtx.fill();

      layers.compositeInto(viewport.ctx);
    },
  };

  const loop = new FixedStepLoop(callbacks);
  attachVisibilityAutoPause(loop);
  runInBrowser(loop);

  const debugRequested = new URLSearchParams(window.location.search).get('debug') === '1';
  if (debugRequested) {
    mountDebugOverlay(loop, app);
  }
}

bootstrap();
