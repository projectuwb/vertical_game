import { describe, expect, it } from 'vitest';
import { BALANCE, INKSTONE_TRACK_IDS } from '../../src/sim/config.js';
import { createDefaultProfile } from '../../src/meta/profile.js';
import { INKSTONE_TRACKS, canAffordUpgrade, computeUpgradeCost, purchaseUpgrade } from '../../src/meta/upgrades.js';

describe('INKSTONE_TRACKS', () => {
  it('has exactly one definition per track, matching INKSTONE_TRACK_IDS', () => {
    expect(INKSTONE_TRACKS.map((t) => t.id).sort()).toEqual([...INKSTONE_TRACK_IDS].sort());
  });

  it('every baseCost matches BALANCE.inkstone', () => {
    for (const track of INKSTONE_TRACKS) {
      expect(track.baseCost).toBe(BALANCE.inkstone[track.id].baseCost);
    }
  });
});

describe('computeUpgradeCost', () => {
  it('at level 0, costs exactly the track\'s base cost', () => {
    for (const id of INKSTONE_TRACK_IDS) {
      expect(computeUpgradeCost(id, 0)).toBe(BALANCE.inkstone[id].baseCost);
    }
  });

  it('matches GAME_DESIGN.md §10: round(base × 1.38^L)', () => {
    const cost = computeUpgradeCost('grind', 4);
    expect(cost).toBe(Math.round(BALANCE.inkstone.grind.baseCost * Math.pow(BALANCE.inkstone.costGrowthPerLevel, 4)));
  });

  it('strictly increases with level', () => {
    let previous = computeUpgradeCost('leaf', 0);
    for (let level = 1; level <= BALANCE.inkstone.levelsPerTrack; level++) {
      const cost = computeUpgradeCost('leaf', level);
      expect(cost).toBeGreaterThan(previous);
      previous = cost;
    }
  });
});

describe('canAffordUpgrade / purchaseUpgrade', () => {
  it('cannot afford or purchase when Gold Leaf is short', () => {
    const profile = { ...createDefaultProfile(), goldLeaf: 1 };
    expect(canAffordUpgrade(profile, 'grind')).toBe(false);
    expect(purchaseUpgrade(profile, 'grind')).toBeNull();
  });

  it('purchasing deducts exactly the cost and increments the level by one', () => {
    const cost = computeUpgradeCost('grind', 0);
    const profile = { ...createDefaultProfile(), goldLeaf: cost + 50 };
    const after = purchaseUpgrade(profile, 'grind');
    expect(after).not.toBeNull();
    expect(after?.goldLeaf).toBe(profile.goldLeaf - cost);
    expect(after?.upgradeLevels.grind).toBe(1);
    // every other track untouched
    for (const id of INKSTONE_TRACK_IDS) {
      if (id !== 'grind') expect(after?.upgradeLevels[id]).toBe(0);
    }
  });

  it('does not mutate the original profile (pure)', () => {
    const cost = computeUpgradeCost('nib', 0);
    const profile = { ...createDefaultProfile(), goldLeaf: cost + 10 };
    purchaseUpgrade(profile, 'nib');
    expect(profile.goldLeaf).toBe(cost + 10);
    expect(profile.upgradeLevels.nib).toBe(0);
  });

  it('cannot afford or purchase once a track is at its max level', () => {
    const maxed = {
      ...createDefaultProfile(),
      goldLeaf: 1_000_000,
      upgradeLevels: { ...createDefaultProfile().upgradeLevels, well: BALANCE.inkstone.levelsPerTrack },
    };
    expect(canAffordUpgrade(maxed, 'well')).toBe(false);
    expect(purchaseUpgrade(maxed, 'well')).toBeNull();
  });

  it('successive purchases climb the cost curve correctly', () => {
    let profile = { ...createDefaultProfile(), goldLeaf: 1_000_000 };
    for (let level = 0; level < 5; level++) {
      const expectedCost = computeUpgradeCost('reach', level);
      const goldBefore = profile.goldLeaf;
      const after = purchaseUpgrade(profile, 'reach');
      expect(after).not.toBeNull();
      expect(after?.goldLeaf).toBe(goldBefore - expectedCost);
      expect(after?.upgradeLevels.reach).toBe(level + 1);
      profile = after as typeof profile;
    }
  });
});
