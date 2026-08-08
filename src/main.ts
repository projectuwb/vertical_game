// Application bootstrap. Wires platform → sim → render. Fleshed out across Phase 1-2.
//
// As of Task 2.7, the actual simulation wiring lives entirely in sim/world.ts
// (createWorld/stepWorld) — this file just samples input, calls stepWorld once per fixed
// step, and draws whatever World currently holds. Before 2.7 this file carried its own
// inline copy of the same wiring (predating World's existence); that duplication is gone
// now, which also means the real Spawn Director drives Blot waves/Slip runs/Gate
// pairs/Sealstacks during ordinary play for the first time, not just via the debug keys
// below.

import {
  attachVisibilityAutoPause,
  FixedStepLoop,
  mountDebugOverlay,
  runInBrowser,
  type LoopCallbacks,
} from './core/loop.js';
import { InputSampler } from './platform/input.js';
import { Viewport } from './platform/viewport.js';
import { computeRowClassCounts, type LineState } from './sim/line.js';
import type { StrokeClass } from './sim/stroke.js';
import { BALANCE } from './sim/config.js';
import { BLOT_CLASSES, spawnBlot, type Blot } from './sim/blot.js';
import { pickSlipClass, spawnSlip, type Slip, type SlipKind } from './sim/slips.js';
import { generateGatePair } from './sim/gates.js';
import { spawnSealstack } from './sim/sealstacks.js';
import { createWorld, stepWorld, type World } from './sim/world.js';
import { RngRegistry } from './core/rng.js';
import type { Pool } from './core/pool.js';
import { computeProjectionParams } from './render/camera.js';
import { drawGatePair, drawRoad, drawSealstacks, drawSkyWater, resetRoadTrailBase } from './render/road.js';
import { drawBrush, drawJoiningRecruits, drawLine, drawProjectiles, drawSlips } from './render/strokes.js';
import { drawBlot } from './render/blot.js';
import { drawPhraseEffects } from './render/effects.js';
import { drawInkTrail } from './render/trail.js';
import { OffscreenLayers } from './render/layers.js';

const BRUSH_CLAMP = BALANCE.lane.brushClampX;
/** The Brush's fixed world-space depth: the road scrolls past it, not the other way
 *  round. Matches world.ts's own (private) BRUSH_Z exactly. */
const BRUSH_Z = 0;

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

/** Task 2.9's debug control: a pure-class Line, front row and all — the fastest way to
 *  check Phrase detection/effects/5-of-a-kind escalation without waiting on real Slip
 *  recruitment to happen to line up 3+ of one class at the front. */
function buildDebugPureLine(cls: StrokeClass, count: number): LineState {
  return { strokes: Array.from({ length: count }, () => ({ class: cls })) };
}

/** Task 2.4's debug control: a mixed-class wave spread across the lane and stacked back
 *  into the distance, to check mass rendering and 60fps at up to 900 concurrent Blot. */
function spawnDebugBlotWave(pool: Pool<Blot>, count: number): void {
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
 *  real Spawn Director (Task 2.7, world.ts's spawnSlipRun) does — least-held-class-
 *  weighted via the seeded 'slips' RNG concern. Uses a decoupled debug RngRegistry
 *  rather than world.rng, so pressing a debug key never perturbs the real Director's
 *  own sequence. */
function spawnDebugSlipRun(
  pool: Pool<Slip>,
  kind: SlipKind,
  count: number,
  line: LineState,
  debugRng: RngRegistry,
): void {
  const { front, back } = computeRowClassCounts(line);
  const counts: Record<StrokeClass, number> = {
    hane: front.hane + back.hane,
    tome: front.tome + back.tome,
    harai: front.harai + back.harai,
  };
  const cls = pickSlipClass(counts, debugRng);
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

  // TECH_SPEC.md §4/§9: every Passage records its seed for reproduction; the actual
  // recording/display is Task 4.1/4.3 (persistence, screens) — for now each page load
  // just gets a fresh one, same as before this refactor.
  let world: World = createWorld(Date.now());
  // Decoupled from world.rng on purpose (see spawnDebugSlipRun) — debug keys are dev
  // tooling, not part of a replayable Passage.
  const debugRng = new RngRegistry(Date.now());

  const callbacks: LoopCallbacks = {
    update: (dtFixed: number): void => {
      const frame = input.sample(dtFixed);
      stepWorld(world, dtFixed, { lateralDelta: frame.lateralDelta, holding: frame.holding });
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
      const brushX = clamp(world.brushFollower.position, -BRUSH_CLAMP, BRUSH_CLAMP);

      if (layers.needsSkyWaterRegen) {
        drawSkyWater(layers.skyWaterCtx, metrics.cssWidth, metrics.cssHeight, params);
        layers.markSkyWaterClean();
      }
      if (layers.needsRoadTrailReset) {
        resetRoadTrailBase(layers.roadTrailCtx, metrics.cssWidth, metrics.cssHeight, params);
        layers.markRoadTrailClean();
      }

      drawRoad(layers.roadTrailCtx, params, world.distanceU);
      drawInkTrail(layers.roadTrailCtx, params, brushX, BRUSH_Z, world.line, world.timeS);

      layers.clearActors();
      drawBlot(layers.actorsCtx, params, world.blotPool, BRUSH_Z);
      drawSlips(layers.actorsCtx, params, world.slipPool);
      if (world.currentGatePair !== null) {
        drawGatePair(layers.actorsCtx, params, world.currentGatePair, world.gatePairZ);
      }
      drawSealstacks(layers.actorsCtx, params, world.sealstackPool);
      drawLine(layers.actorsCtx, params, brushX, BRUSH_Z, world.line);
      drawJoiningRecruits(layers.actorsCtx, params, world.joiningRecruitPool);
      drawProjectiles(layers.actorsCtx, params, world.projectilePool);
      drawPhraseEffects(layers.actorsCtx, params, world.phrase, brushX, BRUSH_Z, world.timeS);
      drawBrush(layers.actorsCtx, params, brushX, BRUSH_Z, world.wetness, world.flourish, world.timeS);

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
        world.line = buildDebugLine(lineSize);
      }
      const waveSize = debugBlotWaveSizes[e.code];
      if (waveSize !== undefined) {
        world.blotPool.releaseAll();
        spawnDebugBlotWave(world.blotPool, waveSize);
      }
      if (e.code === 'Digit9') {
        spawnDebugSlipRun(world.slipPool, 'plusOne', 8, world.line, debugRng);
      }
      if (e.code === 'Digit0') {
        spawnDebugSlipRun(world.slipPool, 'plusTwentyFive', 1, world.line, debugRng);
      }
      if (e.code === 'KeyG') {
        world.currentGatePair = generateGatePair(debugRng);
        world.gatePairZ = 40;
      }
      if (e.code === 'KeyH') {
        spawnSealstack(world.sealstackPool, debugRng.chance('cosmetic', 0.5) ? 'left' : 'right', 40);
      }
      if (e.code === 'KeyR') {
        world = createWorld(Date.now());
      }
      if (e.code === 'KeyJ') {
        world.line = buildDebugPureLine('hane', BALANCE.phrase.rowSize);
      }
      if (e.code === 'KeyK') {
        world.line = buildDebugPureLine('tome', BALANCE.phrase.rowSize);
      }
      if (e.code === 'KeyL') {
        world.line = buildDebugPureLine('harai', BALANCE.phrase.rowSize);
      }
    });
  }
}

bootstrap();
