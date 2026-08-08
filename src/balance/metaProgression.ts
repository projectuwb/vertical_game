// Multi-Passage meta-progression simulation (Task 4.6, TECH_SPEC.md §6's "runs to
// afford first upgrade"/"runs to Inkstone level 40" §11 targets). The rest of this
// harness (harness.ts) simulates one Passage at a time with no memory between runs —
// these two targets are explicitly about the *sequence* of Passages a real player
// experiences, Gold Leaf carried and spent across runs, so they need their own loop
// with a real (if simplified) Profile threaded through it.

import { FIXED_DT } from '../core/loop.js';
import { deriveSeed } from '../core/rng.js';
import { createWorld, stepWorld } from '../sim/world.js';
import { computeGoldLeaf } from '../meta/economy.js';
import { createDefaultProfile, INKSTONE_TRACK_IDS, type Profile } from '../meta/profile.js';
import { canAffordUpgrade, computeUpgradeCost, purchaseUpgrade } from '../meta/upgrades.js';
import { createBotState, decideInput } from './bot.js';

function totalInkstoneLevel(profile: Profile): number {
  return INKSTONE_TRACK_IDS.reduce((sum, id) => sum + profile.upgradeLevels[id], 0);
}

/** Spends every Gold Leaf it can, cheapest-affordable-track first, until nothing more
 *  fits — not a real player's spend pattern (which would likely concentrate on a
 *  favourite track), but a defensible, simple stand-in for "how fast progression
 *  *could* move if every Leaf earned gets spent," which is what both target names
 *  ("runs to afford"/"runs to reach") are actually asking about. */
function spendGreedily(profile: Profile): Profile {
  let current = profile;
  for (;;) {
    let cheapestId: (typeof INKSTONE_TRACK_IDS)[number] | null = null;
    let cheapestCost = Infinity;
    for (const id of INKSTONE_TRACK_IDS) {
      if (!canAffordUpgrade(current, id)) continue;
      const cost = computeUpgradeCost(id, current.upgradeLevels[id]);
      if (cost < cheapestCost) {
        cheapestCost = cost;
        cheapestId = id;
      }
    }
    if (cheapestId === null) return current;
    current = purchaseUpgrade(current, cheapestId) ?? current;
  }
}

export interface MetaProgressionResult {
  /** Passage number (1-indexed) on which the profile first bought anything, or `null`
   *  if it never happened within `maxPassages`. */
  readonly runsToFirstUpgrade: number | null;
  /** Passage number (1-indexed) on which cumulative levels across all eight tracks
   *  first reached `levelTarget`, or `null` if it never happened within `maxPassages`. */
  readonly runsToLevelTarget: number | null;
  readonly levelTarget: number;
  readonly maxPassages: number;
}

/**
 * Plays up to `maxPassages` Passages back to back with the `mixed` bot (the harness's
 * "closest thing to a competent bot," same as every other mixed-bot §11 target),
 * carrying a real `Profile` between them exactly like the real game: each Passage's
 * Gold Leaf is earned at the Leaf level the Profile had *when the Passage started*,
 * then spent greedily before the next Passage begins.
 */
export function simulateMetaProgression(baseSeed: number, levelTarget: number, maxPassages: number): MetaProgressionResult {
  let profile = createDefaultProfile();
  let runsToFirstUpgrade: number | null = null;
  let runsToLevelTarget: number | null = null;
  const maxSteps = Math.ceil(400 / FIXED_DT); // same 400s safety cap the main harness uses

  for (let passage = 1; passage <= maxPassages; passage++) {
    const seed = deriveSeed(baseSeed, `meta:${passage}`);
    const world = createWorld(seed, profile.upgradeLevels);
    const botState = createBotState(seed);

    let steps = 0;
    while (!world.isDead && steps < maxSteps) {
      stepWorld(world, FIXED_DT, decideInput('mixed', world, FIXED_DT, botState));
      steps++;
    }

    const goldLeafEarned = computeGoldLeaf(
      world.blotKilled,
      world.distanceU,
      world.sealsBroken,
      profile.upgradeLevels.leaf,
    );
    profile = { ...profile, goldLeaf: profile.goldLeaf + goldLeafEarned };

    const levelBefore = totalInkstoneLevel(profile);
    profile = spendGreedily(profile);
    const levelAfter = totalInkstoneLevel(profile);

    if (runsToFirstUpgrade === null && levelAfter > levelBefore) {
      runsToFirstUpgrade = passage;
    }
    if (runsToLevelTarget === null && levelAfter >= levelTarget) {
      runsToLevelTarget = passage;
    }
    if (runsToFirstUpgrade !== null && runsToLevelTarget !== null) break;
  }

  return { runsToFirstUpgrade, runsToLevelTarget, levelTarget, maxPassages };
}
