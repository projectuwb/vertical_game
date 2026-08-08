import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { computeGoldLeaf } from '../../src/meta/economy.js';

describe('computeGoldLeaf', () => {
  // GAME_DESIGN.md §10's exact formula is `blotKilled x 1 + floor(distance/8) +
  // sealsBroken x 120` — the three coefficients are Task-4.6-tunable (same "starting
  // value... may be tuned" carve-out as the director numbers), so this checks the
  // formula shape (including the function's own documented final rounding) against
  // BALANCE's live values rather than the original literals.
  it('matches the §10 formula shape: blotKilled x goldLeafPerBlotKilled + floor(distance/goldLeafPerDistanceU) + sealsBroken x goldLeafPerSealBroken, rounded', () => {
    const e = BALANCE.economy;
    expect(computeGoldLeaf(10, 800, 1)).toBe(
      Math.round(10 * e.goldLeafPerBlotKilled + Math.floor(800 / e.goldLeafPerDistanceU) + 1 * e.goldLeafPerSealBroken),
    );
  });

  it('floors the distance term rather than rounding', () => {
    expect(computeGoldLeaf(0, 15, 0)).toBe(Math.floor(15 / BALANCE.economy.goldLeafPerDistanceU));
  });

  it('defaults to no Leaf multiplier (leafLevel=0)', () => {
    expect(computeGoldLeaf(5, 100, 0)).toBe(computeGoldLeaf(5, 100, 0, 0));
  });

  it('applies +goldLeafPerLevel per Leaf level, rounded', () => {
    const base = computeGoldLeaf(10, 800, 1);
    const withLeaf = computeGoldLeaf(10, 800, 1, 5);
    const expected = Math.round(base * (1 + 5 * BALANCE.inkstone.leaf.goldLeafPerLevel));
    expect(withLeaf).toBe(expected);
    expect(withLeaf).toBeGreaterThan(base);
  });

  it('a higher Leaf level always yields at least as much Gold Leaf as a lower one', () => {
    const low = computeGoldLeaf(20, 1600, 2, 1);
    const high = computeGoldLeaf(20, 1600, 2, 8);
    expect(high).toBeGreaterThan(low);
  });
});
