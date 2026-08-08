import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import type { SealEncounterState } from '../../src/sim/seals/framework.js';
import { isRoadMarkingsErased } from '../../src/render/seal.js';

function makeSeal(overrides: Partial<SealEncounterState> = {}): SealEncounterState {
  return {
    sealIndex: 0,
    definitionId: 'blank',
    status: 'fighting',
    approachRemainingS: 0,
    phaseCount: BALANCE.seals.blank.phases,
    maxHp: 100,
    hp: 100,
    hpPerPhase: 25,
    phaseIndex: 0,
    staggerRemainingS: 0,
    bossState: null,
    ...overrides,
  };
}

describe('isRoadMarkingsErased', () => {
  it('is false with no encounter in progress', () => {
    expect(isRoadMarkingsErased(null)).toBe(false);
  });

  it('is false for every Blank phase before the final one', () => {
    for (let phaseIndex = 0; phaseIndex < BALANCE.seals.blank.phases - 1; phaseIndex++) {
      expect(isRoadMarkingsErased(makeSeal({ phaseIndex }))).toBe(false);
    }
  });

  it('is true only on the Blank\'s final phase while actually fighting', () => {
    const finalPhaseIndex = BALANCE.seals.blank.phases - 1;
    expect(isRoadMarkingsErased(makeSeal({ phaseIndex: finalPhaseIndex }))).toBe(true);
    expect(isRoadMarkingsErased(makeSeal({ phaseIndex: finalPhaseIndex, status: 'approaching' }))).toBe(false);
    expect(isRoadMarkingsErased(makeSeal({ phaseIndex: finalPhaseIndex, status: 'broken' }))).toBe(false);
  });

  it('is always false for the other two Seals, even at their own final phase', () => {
    expect(isRoadMarkingsErased(makeSeal({ definitionId: 'smear', phaseIndex: BALANCE.seals.smear.phases - 1 }))).toBe(
      false,
    );
    expect(isRoadMarkingsErased(makeSeal({ definitionId: 'press', phaseIndex: BALANCE.seals.press.phases - 1 }))).toBe(
      false,
    );
  });
});
