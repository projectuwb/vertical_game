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

const LANE_HALF_WIDTH = BALANCE.lane.halfWidth;
const BRUSH_CLAMP = BALANCE.lane.brushClampX;
const LATERAL_DAMPING_TAU_S = BALANCE.control.dampingTimeConstantS;

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

  // Stand-in for the real Brush/Line entity (Task 2.2) and projection (Task 2.1) —
  // this exists purely to prove the input → damped-position path end to end (Task 1.5's
  // acceptance criterion), via a flat linear mapping rather than the true perspective one.
  let targetX = 0;
  let follower: DampedFollower1D = { position: 0, velocity: 0 };
  let holding = false;

  const callbacks: LoopCallbacks = {
    update: (dtFixed: number): void => {
      const frame = input.sample(dtFixed);
      targetX = clamp(targetX + frame.lateralDelta, -BRUSH_CLAMP, BRUSH_CLAMP);
      follower = stepCriticallyDamped(follower, targetX, dtFixed, LATERAL_DAMPING_TAU_S);
      holding = frame.holding;
    },
    render: (_alpha: number): void => {
      const { ctx } = viewport;
      const { cssWidth, cssHeight } = viewport.getMetrics();
      ctx.fillStyle = '#2A3440';
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      const pxPerWorldUnit = (cssWidth * 0.8) / (LANE_HALF_WIDTH * 2);
      const centerX = cssWidth / 2;
      const markerY = cssHeight * 0.8;
      const markerX = centerX + clamp(follower.position, -BRUSH_CLAMP, BRUSH_CLAMP) * pxPerWorldUnit;

      ctx.beginPath();
      ctx.arc(markerX, markerY, 14, 0, Math.PI * 2);
      ctx.fillStyle = holding ? '#D33A2C' : '#4FB79A';
      ctx.fill();
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
