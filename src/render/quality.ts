// Adaptive quality manager (Task 5.2, TECH_SPEC.md §8): "an adaptive quality manager
// drops particle count, then trail resolution, then density-block thresholds, if the
// rolling 30-frame average drops below 52fps for 2s. Never drop simulation rate." Pure
// state — no Canvas/DOM access here, so it's fully unit-testable by feeding it a
// synthetic sequence of frame deltas; main.ts is the only caller that actually reads its
// output and threads it into the real draw calls each frame.

// Render-only cosmetic constants — not gameplay balance, so not in /sim/config.ts (same
// carve-out every other /render module's own cosmetic constants already use).
const ROLLING_WINDOW_SIZE = 30;
const LOW_FPS_THRESHOLD = 52;
const SUSTAINED_LOW_MS = 2000;
/** Recovery isn't named in TECH_SPEC.md §8 (only the degrade trigger is) — a
 *  degrade-only manager would mean one brief 2s hiccup (a GC pause, a backgrounded tab
 *  regaining focus) permanently degrades quality for the rest of the session, which
 *  reads as a bug the first time a player notices it. Recovering requires a longer,
 *  higher bar (5s comfortably above 52fps, not just crossing back over it) specifically
 *  so it can't flap against the same threshold it just degraded from. Logged in
 *  DECISIONS.md as a reasoned addition beyond the literal spec text. */
const RECOVER_FPS_THRESHOLD = 58;
const SUSTAINED_RECOVER_MS = 5000;

export const MAX_QUALITY_LEVEL = 3;

export interface QualitySettings {
  readonly level: number;
  /** Density-block minority-class stipple dot count (strokes.ts) — the closest thing to
   *  a "particle" system this build has; TECH_SPEC.md §8's first degrade step. */
  readonly stippleDotCount: number;
  /** Skips every other frame's ink-trail repaint once degraded — a real reduction in
   *  how often the trail's per-frame wobble/blend is recomputed ("trail resolution"),
   *  not just a cosmetic simplification. */
  readonly trailPaintEveryNthFrame: number;
  /** Lower values collapse the Line into the cheap density-block mass at a smaller
   *  Stroke count, drawing fewer individual glyphs at high N — TECH_SPEC.md §8's third
   *  degrade step, threaded into `sim/line.ts`'s `classifyForRender` as an override
   *  (never mutates the frozen `BALANCE` singleton itself). */
  readonly densityBlockRowThreshold: number;
  readonly individualRowsDrawn: number;
}

const FULL_STIPPLE_DOT_COUNT = 48;
const REDUCED_STIPPLE_DOT_COUNT = 16;
const FULL_DENSITY_BLOCK_ROW_THRESHOLD = 12;
const REDUCED_DENSITY_BLOCK_ROW_THRESHOLD = 6;
const FULL_INDIVIDUAL_ROWS_DRAWN = 3;
const REDUCED_INDIVIDUAL_ROWS_DRAWN = 2;

const LEVEL_SETTINGS: readonly QualitySettings[] = [
  {
    level: 0,
    stippleDotCount: FULL_STIPPLE_DOT_COUNT,
    trailPaintEveryNthFrame: 1,
    densityBlockRowThreshold: FULL_DENSITY_BLOCK_ROW_THRESHOLD,
    individualRowsDrawn: FULL_INDIVIDUAL_ROWS_DRAWN,
  },
  {
    level: 1,
    stippleDotCount: REDUCED_STIPPLE_DOT_COUNT,
    trailPaintEveryNthFrame: 1,
    densityBlockRowThreshold: FULL_DENSITY_BLOCK_ROW_THRESHOLD,
    individualRowsDrawn: FULL_INDIVIDUAL_ROWS_DRAWN,
  },
  {
    level: 2,
    stippleDotCount: REDUCED_STIPPLE_DOT_COUNT,
    trailPaintEveryNthFrame: 2,
    densityBlockRowThreshold: FULL_DENSITY_BLOCK_ROW_THRESHOLD,
    individualRowsDrawn: FULL_INDIVIDUAL_ROWS_DRAWN,
  },
  {
    level: 3,
    stippleDotCount: REDUCED_STIPPLE_DOT_COUNT,
    trailPaintEveryNthFrame: 2,
    densityBlockRowThreshold: REDUCED_DENSITY_BLOCK_ROW_THRESHOLD,
    individualRowsDrawn: REDUCED_INDIVIDUAL_ROWS_DRAWN,
  },
];

export interface AdaptiveQualityManager {
  /** Feeds one frame's real wall-clock delta (ms) — call exactly once per rendered
   *  frame, never per fixed simulation step (TECH_SPEC.md §8: "never drop simulation
   *  rate" — this only ever reads render-frame timing, and its output only ever gates
   *  render-side draw calls, so simulation cadence is structurally unaffected). */
  recordFrame(dtMs: number): void;
  current(): QualitySettings;
}

export function createAdaptiveQualityManager(nowMs: () => number = Date.now): AdaptiveQualityManager {
  const window: number[] = [];
  let level = 0;
  let belowThresholdSinceMs: number | null = null;
  let aboveRecoverThresholdSinceMs: number | null = null;

  function rollingAverageFps(): number | null {
    if (window.length === 0) return null;
    const avgMs = window.reduce((sum, v) => sum + v, 0) / window.length;
    return avgMs <= 0 ? Infinity : 1000 / avgMs;
  }

  return {
    recordFrame(dtMs: number): void {
      window.push(dtMs);
      if (window.length > ROLLING_WINDOW_SIZE) window.shift();

      const fps = rollingAverageFps();
      if (fps === null) return;
      const now = nowMs();

      if (fps < LOW_FPS_THRESHOLD) {
        aboveRecoverThresholdSinceMs = null;
        if (belowThresholdSinceMs === null) belowThresholdSinceMs = now;
        if (now - belowThresholdSinceMs >= SUSTAINED_LOW_MS && level < MAX_QUALITY_LEVEL) {
          level++;
          belowThresholdSinceMs = now; // re-arm — a further sustained drop can degrade again
        }
      } else {
        belowThresholdSinceMs = null;
        if (fps >= RECOVER_FPS_THRESHOLD) {
          if (aboveRecoverThresholdSinceMs === null) aboveRecoverThresholdSinceMs = now;
          if (now - aboveRecoverThresholdSinceMs >= SUSTAINED_RECOVER_MS && level > 0) {
            level--;
            aboveRecoverThresholdSinceMs = now; // re-arm for the next step back up
          }
        } else {
          aboveRecoverThresholdSinceMs = null;
        }
      }
    },
    current(): QualitySettings {
      return LEVEL_SETTINGS[level] as QualitySettings;
    },
  };
}
