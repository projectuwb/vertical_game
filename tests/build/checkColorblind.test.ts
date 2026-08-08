import { describe, expect, it } from 'vitest';
import { MIN_SILHOUETTE_DISTANCE, silhouetteDistance, silhouetteMask } from '../../src/build/checkColorblind.js';

describe('silhouetteDistance', () => {
  it('is 0 for identical masks (a genuine legibility failure, if this ever happened for two real classes)', () => {
    const mask = silhouetteMask('hane');
    expect(silhouetteDistance(mask, mask)).toBe(0);
  });

  it('is 1 for two masks with no overlap at all', () => {
    const a = [
      [true, false],
      [false, false],
    ];
    const b = [
      [false, false],
      [false, true],
    ];
    expect(silhouetteDistance(a, b)).toBe(1);
  });
});

// Task 7.6: the actual regression floor — if a future glyph tweak ever makes two of the
// three classes' silhouettes too close to each other, this test (not just eyeballing a
// screenshot) is what catches it.
describe('the three real Stroke glyphs stay silhouette-distinguishable', () => {
  const masks = {
    hane: silhouetteMask('hane'),
    tome: silhouetteMask('tome'),
    harai: silhouetteMask('harai'),
  };

  it.each([
    ['hane', 'tome'],
    ['hane', 'harai'],
    ['tome', 'harai'],
  ] as const)('%s vs %s clears the minimum silhouette distance', (a, b) => {
    expect(silhouetteDistance(masks[a], masks[b])).toBeGreaterThanOrEqual(MIN_SILHOUETTE_DISTANCE);
  });
});
