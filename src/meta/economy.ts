// Gold Leaf formula (Task 4.2, GAME_DESIGN.md §10). Moved here from /sim/world.ts once
// there was an actual Leaf-multiplier value to apply — the base formula is pure
// arithmetic over run stats, with no simulation state of its own, so it belongs beside
// the rest of the economy rather than inside World's own module.

import { BALANCE } from '../sim/config.js';

/**
 * GAME_DESIGN.md §10: `blotKilled × 1 + floor(distance / 8) + sealsBroken × 120`, then
 * × the Leaf upgrade multiplier ("+5% Gold Leaf per level"). `leafLevel` defaults to 0
 * (every existing caller — the harness, the current run-summary display — has no
 * Profile wired in yet, matching Task 4.1's own "standalone, not yet wired into the
 * game loop" note). Rounded at the end: the base formula is always an integer, but a
 * non-zero Leaf level can make the multiplied result fractional, and Gold Leaf is a
 * whole-number currency.
 */
export function computeGoldLeaf(blotKilled: number, distanceU: number, sealsBroken: number, leafLevel = 0): number {
  const e = BALANCE.economy;
  const base =
    blotKilled * e.goldLeafPerBlotKilled +
    Math.floor(distanceU / e.goldLeafPerDistanceU) +
    sealsBroken * e.goldLeafPerSealBroken;
  const multiplier = 1 + leafLevel * BALANCE.inkstone.leaf.goldLeafPerLevel;
  return Math.round(base * multiplier);
}
