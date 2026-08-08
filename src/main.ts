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
import {
  addStroke,
  computeFormationSlot,
  computeFrontRowSourcePositions,
  computeRowClassCounts,
  createLine,
  removeStrokesFromFront,
  stepCriticallyDamped,
  type DampedFollower1D,
  type LineState,
} from './sim/line.js';
import type { StrokeClass } from './sim/stroke.js';
import { BALANCE } from './sim/config.js';
import {
  createFiringAccumulators,
  createProjectilePool,
  updateFiring,
  updateProjectileMotion,
} from './sim/projectiles.js';
import {
  BLOT_CLASSES,
  createBlotPool,
  resolveBlotDeaths,
  resolveLineContact,
  spawnBlot,
  updateBlotMotion,
} from './sim/blot.js';
import {
  createJoiningRecruitPool,
  createSlipPool,
  pickSlipClass,
  resolveSlipDeaths,
  spawnSlip,
  updateJoiningRecruits,
  updateSlipMotion,
  type SlipKind,
} from './sim/slips.js';
import {
  resolveProjectileBlotCollisions,
  resolveProjectileSlipCollisions,
} from './sim/collision.js';
import { RngRegistry } from './core/rng.js';
import { computeProjectionParams } from './render/camera.js';
import { project } from './render/projection.js';
import { drawRoad, drawSkyWater } from './render/road.js';
import { drawJoiningRecruits, drawLine, drawProjectiles, drawSlips } from './render/strokes.js';
import { drawBlot } from './render/blot.js';
import { OffscreenLayers } from './render/layers.js';
import { PALETTE } from './render/palette.js';

const BRUSH_CLAMP = BALANCE.lane.brushClampX;
const LATERAL_DAMPING_TAU_S = BALANCE.control.dampingTimeConstantS;
/** The Brush's fixed world-space depth: the road scrolls past it, not the other way round. */
const BRUSH_Z = 0;
/** Slightly ahead of the Line's own front-row bulge, so the Brush reads as the leader. */
const BRUSH_MARKER_Z = BRUSH_Z + 0.5;
const BRUSH_MARKER_RADIUS_U = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Task 2.2's debug control: mixed-class Lines at fixed sizes, to check formation
 *  layout and density-block behaviour independent of real recruitment (Task 2.5). */
function buildDebugLine(count: number): LineState {
  const classes: StrokeClass[] = ['hane', 'tome', 'harai'];
  const strokes = Array.from({ length: count }, (_, i) => ({
    class: classes[i % classes.length] as StrokeClass,
  }));
  return { strokes };
}

/** Task 2.4's debug control: a mixed-class wave spread across the lane and stacked back
 *  into the distance, to check mass rendering and 60fps at up to 900 concurrent Blot. */
function spawnDebugBlotWave(pool: ReturnType<typeof createBlotPool>, count: number): void {
  const columns = 9;
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const rowDepth = Math.floor(i / columns);
    const x = (col - (columns - 1) / 2) * 0.9;
    const z = 40 + rowDepth * 3;
    const cls = BLOT_CLASSES[i % BLOT_CLASSES.length] as (typeof BLOT_CLASSES)[number];
    spawnBlot(pool, cls, x, z);
  }
}

/** Task 2.5's debug control: a run of Slips staked ahead, class chosen the same way the
 *  real Spawn Director (Task 2.7) will — least-held-class-weighted via the seeded
 *  'slips' RNG concern. */
function spawnDebugSlipRun(
  pool: ReturnType<typeof createSlipPool>,
  kind: SlipKind,
  count: number,
  line: LineState,
  rng: RngRegistry,
): void {
  const { front, back } = computeRowClassCounts(line);
  const counts: Record<StrokeClass, number> = {
    hane: front.hane + back.hane,
    tome: front.tome + back.tome,
    harai: front.harai + back.harai,
  };
  const cls = pickSlipClass(counts, rng);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.7;
    spawnSlip(pool, kind, cls, x, 30);
  }
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

  let targetX = 0;
  let follower: DampedFollower1D = { position: 0, velocity: 0 };
  let holding = false;
  let scrollDistance = 0;
  let line: LineState = createLine(BALANCE.line.startCount, 'hane');
  const projectilePool = createProjectilePool();
  const firingAccumulators = createFiringAccumulators();
  const blotPool = createBlotPool();
  const slipPool = createSlipPool();
  const joiningRecruitPool = createJoiningRecruitPool();
  const rng = new RngRegistry(Date.now());

  const callbacks: LoopCallbacks = {
    update: (dtFixed: number): void => {
      const frame = input.sample(dtFixed);
      targetX = clamp(targetX + frame.lateralDelta, -BRUSH_CLAMP, BRUSH_CLAMP);
      follower = stepCriticallyDamped(follower, targetX, dtFixed, LATERAL_DAMPING_TAU_S);
      holding = frame.holding;
      scrollDistance += BALANCE.forwardSpeed.baseUPerS * dtFixed;

      const brushX = clamp(follower.position, -BRUSH_CLAMP, BRUSH_CLAMP);
      const { front, back } = computeRowClassCounts(line);
      const sources = computeFrontRowSourcePositions(line, brushX, BRUSH_Z);
      updateFiring(firingAccumulators, projectilePool, dtFixed, front, back, sources);
      updateProjectileMotion(projectilePool, dtFixed);

      const lobsLanded = updateBlotMotion(blotPool, dtFixed, BRUSH_Z);
      resolveProjectileBlotCollisions(projectilePool, blotPool);
      resolveBlotDeaths(blotPool);
      const strokesLostToContact = resolveLineContact(blotPool, BRUSH_Z);
      const strokesLost = lobsLanded + strokesLostToContact;
      if (strokesLost > 0) {
        line = removeStrokesFromFront(line, strokesLost);
      }

      updateSlipMotion(slipPool, dtFixed);
      resolveProjectileSlipCollisions(projectilePool, slipPool);
      const backSlot = computeFormationSlot(line.strokes.length);
      resolveSlipDeaths(slipPool, joiningRecruitPool, {
        x: brushX + backSlot.lateralOffset,
        z: BRUSH_Z + backSlot.depthOffset,
      });
      for (const cls of updateJoiningRecruits(joiningRecruitPool, dtFixed)) {
        line = addStroke(line, cls);
      }
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
      const brushX = clamp(follower.position, -BRUSH_CLAMP, BRUSH_CLAMP);
      drawBlot(layers.actorsCtx, params, blotPool, BRUSH_Z);
      drawSlips(layers.actorsCtx, params, slipPool);
      drawLine(layers.actorsCtx, params, brushX, BRUSH_Z, line);
      drawJoiningRecruits(layers.actorsCtx, params, joiningRecruitPool);
      drawProjectiles(layers.actorsCtx, params, projectilePool);

      const marker = project(brushX, BRUSH_MARKER_RADIUS_U, BRUSH_MARKER_Z, params);
      layers.actorsCtx.beginPath();
      layers.actorsCtx.arc(
        marker.screenX,
        marker.screenY,
        Math.max(2, BRUSH_MARKER_RADIUS_U * marker.scale * params.unit),
        0,
        Math.PI * 2,
      );
      layers.actorsCtx.fillStyle = holding ? PALETTE.vermilion : PALETTE.bone;
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

    const debugLineSizes: Record<string, number> = {
      Digit1: 1,
      Digit2: 5,
      Digit3: 37,
      Digit4: 120,
      Digit5: 400,
    };
    const debugBlotWaveSizes: Record<string, number> = {
      Digit6: 150,
      Digit7: 400,
      Digit8: 900,
    };
    document.addEventListener('keydown', (e) => {
      const lineSize = debugLineSizes[e.code];
      if (lineSize !== undefined) {
        line = buildDebugLine(lineSize);
      }
      const waveSize = debugBlotWaveSizes[e.code];
      if (waveSize !== undefined) {
        blotPool.releaseAll();
        spawnDebugBlotWave(blotPool, waveSize);
      }
      if (e.code === 'Digit9') {
        spawnDebugSlipRun(slipPool, 'plusOne', 8, line, rng);
      }
      if (e.code === 'Digit0') {
        spawnDebugSlipRun(slipPool, 'plusTwentyFive', 1, line, rng);
      }
    });
  }
}

bootstrap();
