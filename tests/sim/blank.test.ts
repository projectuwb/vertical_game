import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { createBlotPool } from '../../src/sim/blot.js';
import { BALANCE } from '../../src/sim/config.js';
import type { SealStepContext } from '../../src/sim/seals/framework.js';
import { BLANK_SEAL_DEFINITION, blankActiveVisual } from '../../src/sim/seals/blank.js';
import { spawnSlip } from '../../src/sim/slips.js';
import { generateGatePair } from '../../src/sim/gates.js';
import { createWorld, startSealEncounter, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };
const FINAL_PHASE_INDEX = BALANCE.seals.blank.phases - 1;

function makeCtx(overrides: Partial<SealStepContext> = {}): SealStepContext {
  return { dt: DT, timeS: 0, brushX: 0, brushZ: 0, rng: new RngRegistry(1), blotPool: createBlotPool(), ...overrides };
}

/** Fast-forwards a World's Seal encounter past the 6s approach, into 'fighting'. */
function skipApproach(world: ReturnType<typeof createWorld>): void {
  const steps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
  for (let i = 0; i < steps; i++) stepWorld(world, DT, NO_INPUT);
}

describe('The Blank: attack cycle alternates beam then cone', () => {
  it('goes cooldown -> beam telegraph -> resolves (no Stroke loss, growthEraseS set) -> cooldown -> cone telegraph', () => {
    let bossState = BLANK_SEAL_DEFINITION.createBossState(0, new RngRegistry(1));

    const cooldownSteps = Math.round(BALANCE.seals.blank.attackIntervalS / DT) + 2;
    for (let i = 0; i < cooldownSteps; i++) {
      bossState = BLANK_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx()).bossState;
    }
    expect(blankActiveVisual(bossState)?.attackKind).toBe('beam');

    const beamTelegraphSteps = Math.round(BALANCE.seals.blank.beamTelegraphS / DT) + 2;
    let sawGrowthErase = false;
    for (let i = 0; i < beamTelegraphSteps; i++) {
      const result = BLANK_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx());
      bossState = result.bossState;
      if (result.growthEraseS !== undefined) {
        sawGrowthErase = true;
        expect(result.growthEraseS).toBe(BALANCE.seals.blank.eraseDurationS);
        expect(result.strokesLost).toBe(0);
      }
    }
    expect(sawGrowthErase).toBe(true);
    expect(blankActiveVisual(bossState)).toBeNull(); // back to cooldown, queued for the cone next

    const cooldownSteps2 = Math.round(BALANCE.seals.blank.attackIntervalS / DT) + 2;
    for (let i = 0; i < cooldownSteps2; i++) {
      bossState = BLANK_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx()).bossState;
    }
    expect(blankActiveVisual(bossState)?.attackKind).toBe('cone');
  });

  it('neither telegraph ever resolves in under minAttackTelegraphS', () => {
    expect(BALANCE.seals.blank.beamTelegraphS).toBeGreaterThanOrEqual(BALANCE.seals.minAttackTelegraphS);
    expect(BALANCE.seals.blank.coneTelegraphS).toBeGreaterThanOrEqual(BALANCE.seals.minAttackTelegraphS);
  });
});

describe('The Blank: the cone converts a hit Stroke into an attacking Blot', () => {
  function driveToConeResolve(brushX: number): { strokesLost: number; blotCount: number } {
    let bossState = BLANK_SEAL_DEFINITION.createBossState(0, new RngRegistry(2));
    const pool = createBlotPool();
    let totalStrokesLost = 0;

    // Beam first (no Stroke loss, no Blot), then the cone.
    const toBeamResolve = Math.round((BALANCE.seals.blank.attackIntervalS + BALANCE.seals.blank.beamTelegraphS) / DT + 4);
    for (let i = 0; i < toBeamResolve; i++) {
      const result = BLANK_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ blotPool: pool }));
      bossState = result.bossState;
      totalStrokesLost += result.strokesLost;
    }
    expect(pool.activeCount).toBe(0);

    const toConeResolve = Math.round((BALANCE.seals.blank.attackIntervalS + BALANCE.seals.blank.coneTelegraphS) / DT + 4);
    for (let i = 0; i < toConeResolve; i++) {
      const result = BLANK_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ brushX, blotPool: pool }));
      bossState = result.bossState;
      totalStrokesLost += result.strokesLost;
    }
    return { strokesLost: totalStrokesLost, blotCount: pool.activeCount };
  }

  it('camping far outside the lane guarantees the cone never hits — no Stroke loss, no conversion', () => {
    const farOutsideLaneX = BALANCE.lane.halfWidth * 10;
    const { strokesLost, blotCount } = driveToConeResolve(farOutsideLaneX);
    expect(strokesLost).toBe(0);
    expect(blotCount).toBe(0);
  });

  it('a hit cone converts exactly one Stroke into exactly one Blot', () => {
    // Drive once to discover the cone's centre, then redrive standing there.
    let bossState = BLANK_SEAL_DEFINITION.createBossState(0, new RngRegistry(2));
    const toTelegraphStart = Math.round(
      (BALANCE.seals.blank.attackIntervalS + BALANCE.seals.blank.beamTelegraphS + BALANCE.seals.blank.attackIntervalS) /
        DT +
        4,
    );
    for (let i = 0; i < toTelegraphStart; i++) {
      bossState = BLANK_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx()).bossState;
    }
    const coneCenterX = blankActiveVisual(bossState)?.coneCenterX ?? 0;

    const { strokesLost, blotCount } = driveToConeResolve(coneCenterX);
    expect(strokesLost).toBe(BALANCE.line.normalContactStrokeLoss);
    expect(blotCount).toBe(BALANCE.line.normalContactStrokeLoss);
  });
});

describe('The Blank: full integration through World', () => {
  it("the erasure beam clears the Slip pool and current Gate pair, and suppresses new Slip runs for eraseDurationS", () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, BLANK_SEAL_DEFINITION);
    // Task 3.5's arcade cadence would otherwise be free to auto-start a second,
    // different-boss encounter later in this test (real Passage behaviour, but not
    // what this Blank-specific test means to measure).
    world.nextSealAtTimeS = Infinity;
    skipApproach(world);

    spawnSlip(world.slipPool, 'plusOne', 'hane', 3, 10);
    world.currentGatePair = generateGatePair(world.rng);
    expect(world.slipPool.activeCount).toBeGreaterThan(0);
    expect(world.currentGatePair).not.toBeNull();

    // Drive until the beam resolves (attackIntervalS + beamTelegraphS, plus buffer).
    const toBeamResolve = Math.round(
      (BALANCE.seals.blank.attackIntervalS + BALANCE.seals.blank.beamTelegraphS) / DT + 4,
    );
    for (let i = 0; i < toBeamResolve && world.seal !== null; i++) {
      stepWorld(world, DT, NO_INPUT);
    }

    expect(world.slipPool.activeCount).toBe(0);
    expect(world.currentGatePair).toBeNull();
    expect(world.growthErasedUntilS).toBeGreaterThan(world.timeS - 1e-6);

    // A Slip run becoming due during the erasure window must not spawn until it clears.
    world.nextSlipBudgetAtDistanceU = world.distanceU; // force it "due" right now
    const erasedAtStart = world.slipPool.activeCount;
    const untilErased = Math.round((world.growthErasedUntilS - world.timeS) / DT) + 2;
    for (let i = 0; i < untilErased && world.seal !== null; i++) {
      stepWorld(world, DT, NO_INPUT);
      if (world.timeS < world.growthErasedUntilS) {
        expect(world.slipPool.activeCount).toBe(erasedAtStart);
      }
    }
  });
});

describe('The Blank: phase 4 is the final phase index', () => {
  it('the boss definition has exactly 4 phases, and the final index is 3', () => {
    expect(BLANK_SEAL_DEFINITION.phaseCount).toBe(4);
    expect(FINAL_PHASE_INDEX).toBe(3);
  });
});
