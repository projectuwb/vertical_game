import { describe, expect, it } from 'vitest';
import { BALANCE, INKSTONE_TRACK_IDS, type InkstoneTrackId } from '../../src/sim/config.js';
import { NO_UPGRADES, computeUpgradeEffects } from '../../src/sim/upgradeEffects.js';

function levelsWith(track: InkstoneTrackId, level: number): Readonly<Record<InkstoneTrackId, number>> {
  return { ...NO_UPGRADES, [track]: level };
}

describe('computeUpgradeEffects: NO_UPGRADES baseline', () => {
  it('every track at level 0 produces no-op effects', () => {
    const effects = computeUpgradeEffects(NO_UPGRADES);
    expect(effects.startingStrokeBonus).toBe(0);
    expect(effects.damageMultiplier).toBe(1);
    expect(effects.fireRateMultiplier).toBe(1);
    expect(effects.wetnessCapBonus).toBe(0);
    expect(effects.rangeMultiplier).toBe(1);
    expect(effects.slipDamageMultiplier).toBe(1);
    expect(effects.flourishCooldownS).toBe(BALANCE.flourish.cooldownS);
    expect(effects.reviveThresholdsMet).toBe(0);
  });

  it('NO_UPGRADES has every one of the 8 track ids at 0', () => {
    for (const id of INKSTONE_TRACK_IDS) {
      expect(NO_UPGRADES[id]).toBe(0);
    }
  });
});

describe('computeUpgradeEffects: Opening Stroke', () => {
  it('adds strokesPerLevel Strokes per level', () => {
    const effects = computeUpgradeEffects(levelsWith('openingStroke', 3));
    expect(effects.startingStrokeBonus).toBe(3 * BALANCE.inkstone.openingStroke.strokesPerLevel);
  });
});

describe('computeUpgradeEffects: Grind', () => {
  it('multiplies damage by 1 + damagePerLevel * level', () => {
    const effects = computeUpgradeEffects(levelsWith('grind', 5));
    expect(effects.damageMultiplier).toBeCloseTo(1 + 5 * BALANCE.inkstone.grind.damagePerLevel);
  });
});

describe('computeUpgradeEffects: Nib', () => {
  it('multiplies fire rate by 1 + fireRatePerLevel * level', () => {
    const effects = computeUpgradeEffects(levelsWith('nib', 4));
    expect(effects.fireRateMultiplier).toBeCloseTo(1 + 4 * BALANCE.inkstone.nib.fireRatePerLevel);
  });
});

describe('computeUpgradeEffects: Well', () => {
  it('adds a flat wetnessCapPerLevel bonus per level (additive, not a percentage)', () => {
    const effects = computeUpgradeEffects(levelsWith('well', 6));
    expect(effects.wetnessCapBonus).toBe(6 * BALANCE.inkstone.well.wetnessCapPerLevel);
  });
});

describe('computeUpgradeEffects: Leaf', () => {
  it('is not represented directly in UpgradeEffects — applied at the economy layer instead', () => {
    // Leaf ("+5% Gold Leaf per level") only ever affects the post-run Gold Leaf total,
    // never anything inside a live simulation step, so it deliberately has no field
    // here — see meta/economy.ts's computeGoldLeaf(..., leafLevel) instead.
    const effects = computeUpgradeEffects(levelsWith('leaf', 10));
    expect(Object.keys(effects)).not.toContain('leafMultiplier');
    expect(Object.keys(effects)).not.toContain('goldLeafMultiplier');
  });
});

describe('computeUpgradeEffects: Reach', () => {
  it('multiplies range and Slip damage independently, both from the same track level', () => {
    const effects = computeUpgradeEffects(levelsWith('reach', 7));
    expect(effects.rangeMultiplier).toBeCloseTo(1 + 7 * BALANCE.inkstone.reach.rangePerLevel);
    expect(effects.slipDamageMultiplier).toBeCloseTo(1 + 7 * BALANCE.inkstone.reach.slipDamagePerLevel);
  });
});

describe('computeUpgradeEffects: Flourish Study', () => {
  it('reduces the cooldown by cooldownReductionPerLevelS per level', () => {
    const effects = computeUpgradeEffects(levelsWith('flourishStudy', 1));
    expect(effects.flourishCooldownS).toBeCloseTo(
      BALANCE.flourish.cooldownS - BALANCE.inkstone.flourishStudy.cooldownReductionPerLevelS,
    );
  });

  it('never reduces the cooldown below cooldownFloorS, no matter how high the level', () => {
    const effects = computeUpgradeEffects(levelsWith('flourishStudy', BALANCE.inkstone.levelsPerTrack));
    expect(effects.flourishCooldownS).toBe(BALANCE.inkstone.flourishStudy.cooldownFloorS);
  });
});

describe('computeUpgradeEffects: Second Draft', () => {
  it('counts how many of the {1,4,8} thresholds the level has met, not the raw level', () => {
    expect(computeUpgradeEffects(levelsWith('secondDraft', 0)).reviveThresholdsMet).toBe(0);
    expect(computeUpgradeEffects(levelsWith('secondDraft', 1)).reviveThresholdsMet).toBe(1);
    expect(computeUpgradeEffects(levelsWith('secondDraft', 3)).reviveThresholdsMet).toBe(1);
    expect(computeUpgradeEffects(levelsWith('secondDraft', 4)).reviveThresholdsMet).toBe(2);
    expect(computeUpgradeEffects(levelsWith('secondDraft', 7)).reviveThresholdsMet).toBe(2);
    expect(computeUpgradeEffects(levelsWith('secondDraft', 8)).reviveThresholdsMet).toBe(3);
    expect(computeUpgradeEffects(levelsWith('secondDraft', 10)).reviveThresholdsMet).toBe(3);
  });

  it('matches BALANCE.inkstone.secondDraft.reviveLevels exactly, not a hardcoded {1,4,8}', () => {
    expect(BALANCE.inkstone.secondDraft.reviveLevels).toEqual([1, 4, 8]);
  });
});
