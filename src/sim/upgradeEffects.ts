// Translates Inkstone track *levels* into the actual multipliers/values stepWorld
// consumes (Task 4.2, GAME_DESIGN.md §10). Deliberately split from /meta/upgrades.ts:
// that file owns display metadata and the Gold-Leaf cost curve (a spending-UI concern),
// this one owns "what does level N of this track actually do to the simulation" — pure
// math over BALANCE.inkstone, computed once per Passage (BALANCE itself stays frozen;
// nothing here ever mutates it) rather than re-read from raw levels at every call site.
//
// A discovered, pre-existing, out-of-scope gap while wiring this: Gates' Temper track
// (gates.ts's TemperState — rateStacks/rangeStacks/splashStacks/wetnessCapStacks) is
// accumulated but never actually applied anywhere in /sim. Fixing that is not this
// task's job (Task 4.2 is Inkstone, not Gates) — logged in DECISIONS.md and added as a
// new task at the end of Phase 7. The multiplier parameters added in this task
// (damageMultiplier, rateMultiplier, rangeMultiplier, slipDamageMultiplier) are plain
// numbers a caller composes before passing in, so Temper's eventual fix can multiply
// into the same values without needing new plumbing.

import { BALANCE, INKSTONE_TRACK_IDS, type InkstoneTrackId } from './config.js';

export interface UpgradeEffects {
  /** Opening Stroke: extra Strokes the Line starts a Passage with. */
  readonly startingStrokeBonus: number;
  /** Grind: multiplies every Stroke's per-shot damage. */
  readonly damageMultiplier: number;
  /** Nib: multiplies firing rate (composes with wetness.ts's dry-state ×0.5, same as
   *  any other rate source — see projectiles.ts's `rateMultiplier` param). */
  readonly fireRateMultiplier: number;
  /** Well: added directly to `BALANCE.wetness.max` (an additive u-cap bonus, not a
   *  percentage — GAME_DESIGN.md §10 gives "+8 Wetness cap per level" as a flat number). */
  readonly wetnessCapBonus: number;
  /** Reach (range component): multiplies projectile `rangeU`. */
  readonly rangeMultiplier: number;
  /** Reach (Slip-damage component): multiplies damage dealt specifically to Slips,
   *  composing with the existing per-class `vsSlips` armour multiplier. */
  readonly slipDamageMultiplier: number;
  /** Flourish Study: the *effective* cooldown in seconds, already reduced per level and
   *  floored at `BALANCE.inkstone.flourishStudy.cooldownFloorS` — callers use this
   *  directly in place of `BALANCE.flourish.cooldownS`, no further math needed. */
  readonly flourishCooldownS: number;
  /** Second Draft: how many revives (GAME_DESIGN.md §10: "Levels 1/4/8 grant a revive")
   *  the current level has unlocked, 0-3 — the count of {1,4,8} thresholds met, not the
   *  raw track level. world.ts seeds `World.revivesRemaining` from this once per
   *  Passage and decrements it as revives are actually used. */
  readonly reviveThresholdsMet: number;
}

export const NO_UPGRADES: Readonly<Record<InkstoneTrackId, number>> = Object.freeze(
  Object.fromEntries(INKSTONE_TRACK_IDS.map((id) => [id, 0])) as Record<InkstoneTrackId, number>,
);

export function computeUpgradeEffects(levels: Readonly<Record<InkstoneTrackId, number>>): UpgradeEffects {
  const ink = BALANCE.inkstone;
  return {
    startingStrokeBonus: levels.openingStroke * ink.openingStroke.strokesPerLevel,
    damageMultiplier: 1 + levels.grind * ink.grind.damagePerLevel,
    fireRateMultiplier: 1 + levels.nib * ink.nib.fireRatePerLevel,
    wetnessCapBonus: levels.well * ink.well.wetnessCapPerLevel,
    rangeMultiplier: 1 + levels.reach * ink.reach.rangePerLevel,
    slipDamageMultiplier: 1 + levels.reach * ink.reach.slipDamagePerLevel,
    flourishCooldownS: Math.max(
      ink.flourishStudy.cooldownFloorS,
      BALANCE.flourish.cooldownS - levels.flourishStudy * ink.flourishStudy.cooldownReductionPerLevelS,
    ),
    reviveThresholdsMet: ink.secondDraft.reviveLevels.filter((threshold) => levels.secondDraft >= threshold).length,
  };
}
