// Inkstone track definitions, cost curve, and the purchase transaction (Task 4.2,
// GAME_DESIGN.md §10). Display metadata and Gold-Leaf spending live here; what each
// track's level actually *does* to the simulation is /sim/upgradeEffects.ts's job —
// that file has to stay inside /sim (it's consumed by createWorld/stepWorld directly),
// this one sits above it, the same layering /meta/profile.ts already established.

import { BALANCE, type InkstoneTrackId } from '../sim/config.js';
import type { Profile } from './profile.js';

export interface InkstoneTrackDefinition {
  readonly id: InkstoneTrackId;
  readonly name: string;
  readonly effectPerLevel: string;
  readonly baseCost: number;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Every description is derived directly from `BALANCE.inkstone`, not hand-typed prose
 *  — so this text can never drift from the actual mechanical numbers `upgradeEffects.ts`
 *  applies. */
export const INKSTONE_TRACKS: readonly InkstoneTrackDefinition[] = [
  {
    id: 'openingStroke',
    name: 'Opening Stroke',
    effectPerLevel: `Start with +${BALANCE.inkstone.openingStroke.strokesPerLevel} Stroke`,
    baseCost: BALANCE.inkstone.openingStroke.baseCost,
  },
  {
    id: 'grind',
    name: 'Grind',
    effectPerLevel: `+${pct(BALANCE.inkstone.grind.damagePerLevel)} damage`,
    baseCost: BALANCE.inkstone.grind.baseCost,
  },
  {
    id: 'nib',
    name: 'Nib',
    effectPerLevel: `+${pct(BALANCE.inkstone.nib.fireRatePerLevel)} fire rate`,
    baseCost: BALANCE.inkstone.nib.baseCost,
  },
  {
    id: 'well',
    name: 'Well',
    effectPerLevel: `+${BALANCE.inkstone.well.wetnessCapPerLevel} Wetness cap`,
    baseCost: BALANCE.inkstone.well.baseCost,
  },
  {
    id: 'leaf',
    name: 'Leaf',
    effectPerLevel: `+${pct(BALANCE.inkstone.leaf.goldLeafPerLevel)} Gold Leaf`,
    baseCost: BALANCE.inkstone.leaf.baseCost,
  },
  {
    id: 'reach',
    name: 'Reach',
    effectPerLevel: `+${pct(BALANCE.inkstone.reach.rangePerLevel)} range, +${pct(BALANCE.inkstone.reach.slipDamagePerLevel)} Slip damage`,
    baseCost: BALANCE.inkstone.reach.baseCost,
  },
  {
    id: 'flourishStudy',
    name: 'Flourish Study',
    effectPerLevel: `-${BALANCE.inkstone.flourishStudy.cooldownReductionPerLevelS}s Flourish cooldown (floor ${BALANCE.inkstone.flourishStudy.cooldownFloorS}s)`,
    baseCost: BALANCE.inkstone.flourishStudy.baseCost,
  },
  {
    id: 'secondDraft',
    name: 'Second Draft',
    effectPerLevel: `Levels ${BALANCE.inkstone.secondDraft.reviveLevels.join('/')} grant a revive at ${pct(BALANCE.inkstone.secondDraft.revivePeakFraction)} of peak Line`,
    baseCost: BALANCE.inkstone.secondDraft.baseCost,
  },
];

/** GAME_DESIGN.md §10: "Cost at level L (0-indexed) = round(base × 1.38^L)." */
export function computeUpgradeCost(track: InkstoneTrackId, currentLevel: number): number {
  const baseCost = BALANCE.inkstone[track].baseCost;
  return Math.round(baseCost * Math.pow(BALANCE.inkstone.costGrowthPerLevel, currentLevel));
}

export function canAffordUpgrade(profile: Profile, track: InkstoneTrackId): boolean {
  const currentLevel = profile.upgradeLevels[track];
  if (currentLevel >= BALANCE.inkstone.levelsPerTrack) return false;
  return profile.goldLeaf >= computeUpgradeCost(track, currentLevel);
}

/**
 * Spends Gold Leaf and increments one track's level by one. Returns the updated
 * Profile, or `null` if the track is already maxed or unaffordable. Pure — no
 * confirmation-dialog logic here (GAME_DESIGN.md §10: "No confirmation dialogs —
 * tapping buys" is Task 4.3's screen's job; this is just the transaction itself).
 */
export function purchaseUpgrade(profile: Profile, track: InkstoneTrackId): Profile | null {
  if (!canAffordUpgrade(profile, track)) return null;
  const cost = computeUpgradeCost(track, profile.upgradeLevels[track]);
  return {
    ...profile,
    goldLeaf: profile.goldLeaf - cost,
    upgradeLevels: { ...profile.upgradeLevels, [track]: profile.upgradeLevels[track] + 1 },
  };
}
