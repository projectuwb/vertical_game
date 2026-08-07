// The Line: formation, growth, loss — Task 2.2 builds the full Line/Brush entity.
//
// The critically damped 1D follower below is laid down now (Task 1.5) because the
// lateral control response is part of /sim by construction: TECH_SPEC.md §4 requires
// the sim to consume raw InputFrame deltas and never touch the DOM, and a smoothing
// recurrence with persistent velocity state has to run once per fixed step to stay
// deterministic/replayable — so it belongs here, not in /platform. Task 2.2 wires this
// into the real Brush entity.

import { BALANCE } from './config.js';
import type { StrokeClass } from './stroke.js';

/** Persistent state for one critically damped 1D follower (e.g. the Brush's lateral position). */
export interface DampedFollower1D {
  readonly position: number;
  readonly velocity: number;
}

/**
 * Exact closed-form step of a critically damped spring-damper (no overshoot on a step
 * input) chasing `target`, with response speed set by time constant `tau` seconds
 * (GAME_DESIGN.md §3: "critically damped with a 70ms time constant"). Using the exact
 * exponential solution rather than a semi-implicit Euler step keeps it stable for any
 * dt/tau ratio, which matters since `tau` (70ms) is close to a single fixed step (16.7ms).
 */
export function stepCriticallyDamped(
  state: DampedFollower1D,
  target: number,
  dt: number,
  tau: number,
): DampedFollower1D {
  const omega = 1 / tau;
  const change = state.position - target;
  const c2 = state.velocity + omega * change;
  const factor = Math.exp(-omega * dt);
  const newPosition = target + (change + c2 * dt) * factor;
  const newVelocity = factor * (c2 * (1 - omega * dt) - omega * change);
  return { position: newPosition, velocity: newVelocity };
}

// --- The Line: formation, growth, loss (Task 2.2, GAME_DESIGN.md §5) ---

export interface LineStroke {
  readonly class: StrokeClass;
}

/**
 * `strokes[0]` is the front-most Stroke, `strokes[length - 1]` the back-most — arrival
 * order doubles as formation order, exactly as GAME_DESIGN.md §5 requires: "newest
 * Strokes fill from the back, and losses remove from the front." Rebuilt (not mutated)
 * on every change, matching the rest of /sim's style so a World snapshot is just a
 * plain object the determinism hash can walk.
 */
export interface LineState {
  readonly strokes: readonly LineStroke[];
}

export function createLine(startCount: number, fillClass: StrokeClass): LineState {
  const strokes: LineStroke[] = [];
  for (let i = 0; i < startCount; i++) {
    strokes.push({ class: fillClass });
  }
  return { strokes };
}

/** Appends to the back — a Slip's recruit joining the Line (GAME_DESIGN.md §7.1). */
export function addStroke(line: LineState, cls: StrokeClass): LineState {
  if (line.strokes.length >= BALANCE.line.maxCount) return line;
  return { strokes: [...line.strokes, { class: cls }] };
}

/** Removes up to `count` Strokes from the front — Blot contact loss (GAME_DESIGN.md §5). */
export function removeStrokesFromFront(line: LineState, count: number): LineState {
  if (count <= 0) return line;
  return { strokes: line.strokes.slice(Math.min(count, line.strokes.length)) };
}

/**
 * Directly sets the Line to `targetCount`, growing from the back or shrinking from the
 * front to match §5's rules either way. Exists for the Task 2.2 debug control
 * (GAME_DESIGN.md §5's acceptance criterion sets N to 1/5/37/120/400 directly) — real
 * gameplay always goes through addStroke/removeStrokesFromFront one at a time.
 */
export function setLineCount(line: LineState, targetCount: number, fillClass: StrokeClass): LineState {
  const clamped = Math.max(0, Math.min(BALANCE.line.maxCount, Math.round(targetCount)));
  if (clamped === line.strokes.length) return line;
  if (clamped > line.strokes.length) {
    const strokes = line.strokes.slice();
    for (let i = line.strokes.length; i < clamped; i++) {
      strokes.push({ class: fillClass });
    }
    return { strokes };
  }
  return removeStrokesFromFront(line, line.strokes.length - clamped);
}

export interface FormationSlot {
  readonly row: number;
  readonly col: number;
  /** World-space x offset from the Line's centre. */
  readonly lateralOffset: number;
  /** World-space z offset from the front reference depth; more negative = further back. */
  readonly depthOffset: number;
}

/**
 * Formation position for the Stroke at `index` (0 = front-most). Every row shares the
 * same shallow forward arc GAME_DESIGN.md §5 describes for the front row — a parabolic
 * bulge peaking at the row's centre column and vanishing at its edges — generalised to
 * every row rather than only the first, so a large Line reads as a stack of nested
 * arcs (concentric with the lane's own curve) instead of the front row alone looking
 * different from the mass behind it.
 */
export function computeFormationSlot(index: number): FormationSlot {
  const rowSize = BALANCE.line.rowSize;
  const row = Math.floor(index / rowSize);
  const col = index % rowSize;
  const centerCol = (rowSize - 1) / 2;
  const lateralOffset = (col - centerCol) * BALANCE.line.lateralSpacingU;

  const t = centerCol === 0 ? 0 : (col - centerCol) / centerCol; // -1..1 across the row
  const bulge = BALANCE.line.arcBulgeU * (1 - t * t);
  const rowBaseDepth = -row * BALANCE.line.longitudinalSpacingU;

  return { row, col, lateralOffset, depthOffset: rowBaseDepth + bulge };
}

export interface RenderClassification {
  /** How many front-most Strokes to draw individually. */
  readonly individualCount: number;
  /** Whether the remainder (if any) should be drawn as a single density-block mass. */
  readonly hasDensityBlock: boolean;
}

/**
 * GAME_DESIGN.md §5: above 60 Strokes (12 full rows), only the front 3 rows are drawn
 * as individual Strokes; the rest collapse into one density-block shape. Pure and
 * /render-agnostic — /render/strokes.ts decides how to actually draw each case.
 */
export function classifyForRender(totalCount: number): RenderClassification {
  const blockThresholdCount = BALANCE.line.rowSize * BALANCE.line.densityBlockRowThreshold;
  if (totalCount <= blockThresholdCount) {
    return { individualCount: totalCount, hasDensityBlock: false };
  }
  return {
    individualCount: BALANCE.line.individualRowsDrawn * BALANCE.line.rowSize,
    hasDensityBlock: true,
  };
}
