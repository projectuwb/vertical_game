// Fixed-timestep accumulator loop (TECH_SPEC.md §4). `advance()` is a pure function of
// the timestamp it's given — no reads of `performance`/`Date` inside it — so the
// determinism test can drive it with fabricated frame times and assert exact step counts.

import { nowMs } from './time.js';

export const FIXED_DT = 1 / 60;
export const MAX_CATCHUP_STEPS = 5;

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dtFixed` seconds. Called 0..N times per frame. */
  update(dtFixed: number): void;
  /** Draw with `alpha` in [0, 1): how far between the last two sim steps to interpolate. */
  render(alpha: number): void;
}

export interface LoopStats {
  /** Rolling count of fixed steps executed in the last ~1s window. */
  stepsPerSecond: number;
  /** Rolling count of frames rendered in the last ~1s window. */
  fps: number;
  totalSteps: number;
  paused: boolean;
}

export class FixedStepLoop {
  private accumulator = 0;
  private totalSteps = 0;
  private paused = false;
  private lastNowMs: number | null = null;

  private statsWindowStartMs = 0;
  private stepsInWindow = 0;
  private framesInWindow = 0;
  private lastStepsPerSecond = 0;
  private lastFps = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly fixedDt: number = FIXED_DT,
    private readonly maxCatchUpSteps: number = MAX_CATCHUP_STEPS,
  ) {}

  get isPaused(): boolean {
    return this.paused;
  }

  get totalStepCount(): number {
    return this.totalSteps;
  }

  getStats(): LoopStats {
    return {
      stepsPerSecond: this.lastStepsPerSecond,
      fps: this.lastFps,
      totalSteps: this.totalSteps,
      paused: this.paused,
    };
  }

  pause(): void {
    this.paused = true;
  }

  /** Resumes and discards any elapsed wall-clock time so the next frame doesn't catch up all at once. */
  resume(): void {
    this.paused = false;
    this.lastNowMs = null;
  }

  reset(): void {
    this.accumulator = 0;
    this.totalSteps = 0;
    this.lastNowMs = null;
    this.stepsInWindow = 0;
    this.framesInWindow = 0;
    this.statsWindowStartMs = 0;
    this.lastStepsPerSecond = 0;
    this.lastFps = 0;
  }

  /** Feed the loop the current high-resolution timestamp, in milliseconds. */
  advance(currentNowMs: number): void {
    if (this.lastNowMs === null) {
      this.lastNowMs = currentNowMs;
      this.statsWindowStartMs = currentNowMs;
      this.callbacks.render(1);
      return;
    }

    const frameDtMs = currentNowMs - this.lastNowMs;
    this.lastNowMs = currentNowMs;
    this.framesInWindow++;
    this.rollStatsWindow(currentNowMs);

    if (this.paused) {
      this.callbacks.render(1);
      return;
    }

    // Clamp a huge frame gap (tab backgrounded, debugger pause) so the accumulator
    // never demands more than maxCatchUpSteps of simulation in one go.
    const maxFrameDt = this.fixedDt * this.maxCatchUpSteps;
    const frameDt = Math.min(frameDtMs / 1000, maxFrameDt);

    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxCatchUpSteps) {
      this.callbacks.update(this.fixedDt);
      this.accumulator -= this.fixedDt;
      this.totalSteps++;
      this.stepsInWindow++;
      steps++;
    }

    // If we exhausted the catch-up budget, drop the remainder rather than let it
    // balloon — a sustained slow frame degrades sim rate gracefully instead of spiralling.
    if (steps === this.maxCatchUpSteps && this.accumulator > this.fixedDt) {
      this.accumulator = this.accumulator % this.fixedDt;
    }

    const alpha = this.accumulator / this.fixedDt;
    this.callbacks.render(alpha);
  }

  private rollStatsWindow(currentNowMs: number): void {
    const elapsed = currentNowMs - this.statsWindowStartMs;
    if (elapsed >= 1000) {
      const seconds = elapsed / 1000;
      this.lastStepsPerSecond = this.stepsInWindow / seconds;
      this.lastFps = this.framesInWindow / seconds;
      this.stepsInWindow = 0;
      this.framesInWindow = 0;
      this.statsWindowStartMs = currentNowMs;
    }
  }
}

/** Drives a loop from `requestAnimationFrame`. Returns a handle to stop it. */
export function runInBrowser(loop: FixedStepLoop): { stop: () => void } {
  let handle = 0;
  let running = true;

  const frame = (): void => {
    if (!running) return;
    loop.advance(nowMs());
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);

  return {
    stop: (): void => {
      running = false;
      cancelAnimationFrame(handle);
    },
  };
}

/**
 * FPS/step debug overlay, gated behind a flag by the caller (main.ts reads it from
 * `?debug=1`). Polls stats on a plain interval rather than every render — it's
 * diagnostic text, not part of the frame budget.
 */
export function mountDebugOverlay(
  loop: FixedStepLoop,
  parent: HTMLElement,
  doc: Document = document,
): { unmount: () => void } {
  const el = doc.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.zIndex = '9999';
  el.style.padding = '2px 6px';
  el.style.fontFamily = 'monospace';
  el.style.fontSize = '12px';
  el.style.color = '#E8E2D4';
  el.style.background = 'rgba(23, 30, 38, 0.75)';
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'pre';
  parent.appendChild(el);

  const intervalId = setInterval(() => {
    const stats = loop.getStats();
    el.textContent = `fps ${stats.fps.toFixed(0)}  steps/s ${stats.stepsPerSecond.toFixed(0)}  total ${stats.totalSteps}${stats.paused ? '  [paused]' : ''}`;
  }, 250);

  return {
    unmount: (): void => {
      clearInterval(intervalId);
      el.remove();
    },
  };
}

/** Pauses the loop while the tab/app is hidden and resumes when it's visible again. */
export function attachVisibilityAutoPause(
  loop: FixedStepLoop,
  doc: Document = document,
): { detach: () => void } {
  const onChange = (): void => {
    if (doc.hidden) {
      loop.pause();
    } else {
      loop.resume();
    }
  };
  doc.addEventListener('visibilitychange', onChange);
  return {
    detach: (): void => doc.removeEventListener('visibilitychange', onChange),
  };
}
