import { describe, expect, it } from 'vitest';
import { shapesOnlyMarkCount } from '../../src/render/strokes.js';

describe('shapesOnlyMarkCount', () => {
  it('assigns every class a distinct mark count (GAME_DESIGN.md §12: Shapes-Only stamps a glyph mark)', () => {
    const counts = [shapesOnlyMarkCount('hane'), shapesOnlyMarkCount('tome'), shapesOnlyMarkCount('harai')];
    expect(new Set(counts).size).toBe(3);
  });

  it('every count is a small positive integer, not zero (a mark that never draws is no mark)', () => {
    for (const cls of ['hane', 'tome', 'harai'] as const) {
      const count = shapesOnlyMarkCount(cls);
      expect(count).toBeGreaterThan(0);
      expect(Number.isInteger(count)).toBe(true);
    }
  });
});
