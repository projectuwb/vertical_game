import { describe, expect, it } from 'vitest';
import {
  addStroke,
  classifyForRender,
  computeFormationSlot,
  createLine,
  removeStrokesFromFront,
  setLineCount,
  stepCriticallyDamped,
  type DampedFollower1D,
} from '../../src/sim/line.js';
import { BALANCE } from '../../src/sim/config.js';

const TAU = 0.07;
const DT = 1 / 60;

describe('stepCriticallyDamped', () => {
  it('does not overshoot a step input', () => {
    let state: DampedFollower1D = { position: 0, velocity: 0 };
    const target = 4;
    let maxPosition = 0;
    for (let i = 0; i < 600; i++) {
      state = stepCriticallyDamped(state, target, DT, TAU);
      maxPosition = Math.max(maxPosition, state.position);
    }
    expect(maxPosition).toBeLessThanOrEqual(target + 1e-9);
  });

  it('converges to the target and settles (zero velocity) when the target stops moving', () => {
    let state: DampedFollower1D = { position: -3, velocity: 2 };
    const target = 2.5;
    for (let i = 0; i < 600; i++) {
      state = stepCriticallyDamped(state, target, DT, TAU);
    }
    expect(state.position).toBeCloseTo(target, 6);
    expect(state.velocity).toBeCloseTo(0, 6);
  });

  it('is a no-op for dt = 0', () => {
    const state: DampedFollower1D = { position: 1.5, velocity: -0.4 };
    const next = stepCriticallyDamped(state, 3, 0, TAU);
    expect(next.position).toBeCloseTo(state.position, 9);
    expect(next.velocity).toBeCloseTo(state.velocity, 9);
  });

  it('holds steady when already at rest on target', () => {
    const state: DampedFollower1D = { position: 5, velocity: 0 };
    const next = stepCriticallyDamped(state, 5, DT, TAU);
    expect(next.position).toBeCloseTo(5, 9);
    expect(next.velocity).toBeCloseTo(0, 9);
  });

  it('responds faster with a smaller time constant', () => {
    let fast: DampedFollower1D = { position: 0, velocity: 0 };
    let slow: DampedFollower1D = { position: 0, velocity: 0 };
    for (let i = 0; i < 10; i++) {
      fast = stepCriticallyDamped(fast, 1, DT, 0.03);
      slow = stepCriticallyDamped(slow, 1, DT, 0.2);
    }
    expect(fast.position).toBeGreaterThan(slow.position);
  });
});

describe('Line growth and loss', () => {
  it('createLine starts with the given count, all front-to-back positions filled', () => {
    const line = createLine(3, 'hane');
    expect(line.strokes).toHaveLength(3);
    expect(line.strokes.every((s) => s.class === 'hane')).toBe(true);
  });

  it('addStroke appends to the back, never mutating the input', () => {
    const before = createLine(2, 'hane');
    const after = addStroke(before, 'tome');
    expect(before.strokes).toHaveLength(2); // unchanged
    expect(after.strokes).toHaveLength(3);
    expect(after.strokes[2]?.class).toBe('tome');
    expect(after.strokes[0]?.class).toBe('hane');
  });

  it('addStroke is a no-op once the Line is at max capacity', () => {
    const full = createLine(BALANCE.line.maxCount, 'hane');
    const after = addStroke(full, 'tome');
    expect(after.strokes).toHaveLength(BALANCE.line.maxCount);
  });

  it('removeStrokesFromFront removes the front-most Strokes first', () => {
    const line = { strokes: [{ class: 'hane' }, { class: 'tome' }, { class: 'harai' }] } as const;
    const after = removeStrokesFromFront(line, 1);
    expect(after.strokes.map((s) => s.class)).toEqual(['tome', 'harai']);
  });

  it('removeStrokesFromFront never removes more than are present', () => {
    const line = createLine(2, 'hane');
    const after = removeStrokesFromFront(line, 10);
    expect(after.strokes).toHaveLength(0);
  });

  it('N reaching 0 is a valid, representable state (Line death, GAME_DESIGN.md §5)', () => {
    const line = createLine(1, 'hane');
    const after = removeStrokesFromFront(line, 1);
    expect(after.strokes).toHaveLength(0);
  });

  it('setLineCount grows from the back and shrinks from the front to reach an exact target', () => {
    const line = createLine(5, 'hane');
    const grown = setLineCount(line, 8, 'tome');
    expect(grown.strokes).toHaveLength(8);
    expect(grown.strokes.slice(0, 5).every((s) => s.class === 'hane')).toBe(true);
    expect(grown.strokes.slice(5).every((s) => s.class === 'tome')).toBe(true);

    const shrunk = setLineCount(grown, 2, 'hane');
    expect(shrunk.strokes).toHaveLength(2);
    // The front 6 were removed, leaving the back-most 2 (both 'tome', added last above).
    expect(shrunk.strokes.every((s) => s.class === 'tome')).toBe(true);
  });

  it('setLineCount clamps to [0, maxCount]', () => {
    const line = createLine(5, 'hane');
    expect(setLineCount(line, -10, 'hane').strokes).toHaveLength(0);
    expect(setLineCount(line, 100000, 'hane').strokes).toHaveLength(BALANCE.line.maxCount);
  });
});

describe('computeFormationSlot', () => {
  it('lays out rows of 5, front-most index at row 0', () => {
    for (let i = 0; i < 12; i++) {
      const slot = computeFormationSlot(i);
      expect(slot.row).toBe(Math.floor(i / 5));
      expect(slot.col).toBe(i % 5);
    }
  });

  it('the centre column of each row has zero lateral offset', () => {
    // Index 2 is column 2 (the centre of a 5-wide row) of row 0.
    expect(computeFormationSlot(2).lateralOffset).toBeCloseTo(0, 9);
  });

  it('columns are symmetric around the centre', () => {
    const left = computeFormationSlot(0); // col 0
    const right = computeFormationSlot(4); // col 4
    expect(left.lateralOffset).toBeCloseTo(-right.lateralOffset, 9);
  });

  it('each row sits further back (more negative depth) than the one before it', () => {
    const row0Center = computeFormationSlot(2).depthOffset;
    const row1Center = computeFormationSlot(7).depthOffset; // index 7 = row 1, col 2
    expect(row1Center).toBeLessThan(row0Center);
  });

  it('the arc bulge peaks at the centre column and vanishes at the row edges', () => {
    const center = computeFormationSlot(2); // row 0, col 2
    const edge = computeFormationSlot(0); // row 0, col 0
    expect(center.depthOffset).toBeGreaterThan(edge.depthOffset);
    expect(edge.depthOffset).toBeCloseTo(0, 9); // row 0 base depth, bulge ~0 at the edge
  });

  it('never produces NaN/Infinity across a large index range', () => {
    for (let i = 0; i < 999; i++) {
      const slot = computeFormationSlot(i);
      expect(Number.isFinite(slot.lateralOffset)).toBe(true);
      expect(Number.isFinite(slot.depthOffset)).toBe(true);
    }
  });
});

describe('classifyForRender', () => {
  it('draws every Stroke individually at or below the density-block threshold (60)', () => {
    for (const n of [1, 5, 37, 60]) {
      const result = classifyForRender(n);
      expect(result.hasDensityBlock).toBe(false);
      expect(result.individualCount).toBe(n);
    }
  });

  it('caps individual rendering to the front 3 rows above the threshold', () => {
    for (const n of [61, 120, 400, BALANCE.line.maxCount]) {
      const result = classifyForRender(n);
      expect(result.hasDensityBlock).toBe(true);
      expect(result.individualCount).toBe(BALANCE.line.individualRowsDrawn * BALANCE.line.rowSize);
    }
  });
});
