import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { BALANCE } from '../../src/sim/config.js';
import {
  applySealDamage,
  computeSealMaxHp,
  createSealEncounter,
  startAttack,
  stepAttack,
  stepSealEncounter,
  type SealStepContext,
} from '../../src/sim/seals/framework.js';
import { STUB_SEAL_DEFINITION, stubActiveTelegraph } from '../../src/sim/seals/stub.js';
import { computeSealZ, createWorld, startSealEncounter, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };

function makeCtx(overrides: Partial<SealStepContext> = {}): SealStepContext {
  return { dt: DT, timeS: 0, brushX: 0, brushZ: 0, rng: new RngRegistry(1), ...overrides };
}

describe('computeSealMaxHp', () => {
  it('matches GAME_DESIGN.md §8.2: 420 * 1.62^sealIndex', () => {
    expect(computeSealMaxHp(0)).toBeCloseTo(BALANCE.seals.hpBase, 9);
    expect(computeSealMaxHp(1)).toBeCloseTo(BALANCE.seals.hpBase * BALANCE.seals.hpGrowthPerIndex, 9);
    expect(computeSealMaxHp(2)).toBeCloseTo(BALANCE.seals.hpBase * BALANCE.seals.hpGrowthPerIndex ** 2, 9);
  });
});

describe('createSealEncounter', () => {
  it('starts approaching, full HP, phase 0', () => {
    const seal = createSealEncounter(0, STUB_SEAL_DEFINITION);
    expect(seal.status).toBe('approaching');
    expect(seal.approachRemainingS).toBe(BALANCE.seals.approachTelegraphS);
    expect(seal.hp).toBe(seal.maxHp);
    expect(seal.phaseIndex).toBe(0);
    expect(seal.phaseCount).toBe(STUB_SEAL_DEFINITION.phaseCount);
    expect(seal.hpPerPhase).toBeCloseTo(seal.maxHp / seal.phaseCount, 9);
  });
});

describe('stepSealEncounter: approach', () => {
  it('counts down and transitions to fighting exactly once approachTelegraphS elapses', () => {
    let seal = createSealEncounter(0, STUB_SEAL_DEFINITION);
    // A couple of steps short of the boundary, comfortably clear of float-accumulation
    // drift on the DT sum, must still be approaching.
    const steps = Math.round(BALANCE.seals.approachTelegraphS / DT);
    for (let i = 0; i < steps - 2; i++) {
      const result = stepSealEncounter(seal, STUB_SEAL_DEFINITION, makeCtx());
      seal = result.seal;
      expect(seal.status).toBe('approaching');
    }
    // A couple of steps past the boundary must have crossed it.
    for (let i = 0; i < 4; i++) {
      seal = stepSealEncounter(seal, STUB_SEAL_DEFINITION, makeCtx()).seal;
    }
    expect(seal.status).toBe('fighting');
    expect(seal.bossState).not.toBeNull();
  });

  it('never deals damage or lets the boss act while approaching', () => {
    let seal = createSealEncounter(0, STUB_SEAL_DEFINITION);
    for (let i = 0; i < 30; i++) {
      seal = stepSealEncounter(seal, STUB_SEAL_DEFINITION, makeCtx()).seal;
    }
    expect(seal.status).toBe('approaching');
    const afterDamage = applySealDamage(seal, 1000);
    expect(afterDamage).toBe(seal); // no-op: applySealDamage only acts while 'fighting'
  });
});

describe('computeSealZ', () => {
  it('starts at the normal wave-spawn distance and closes to engagementZU by the end of approach', () => {
    const seal = createSealEncounter(0, STUB_SEAL_DEFINITION);
    expect(computeSealZ(seal)).toBeCloseTo(BALANCE.director.spawnDistanceU, 9);

    const almostThere = { ...seal, approachRemainingS: 0.0001 };
    expect(computeSealZ(almostThere)).toBeGreaterThanOrEqual(BALANCE.seals.engagementZU);
    expect(computeSealZ(almostThere)).toBeLessThan(BALANCE.director.spawnDistanceU);
  });

  it('holds at engagementZU once fighting', () => {
    const seal = { ...createSealEncounter(0, STUB_SEAL_DEFINITION), status: 'fighting' as const };
    expect(computeSealZ(seal)).toBe(BALANCE.seals.engagementZU);
  });
});

describe('applySealDamage', () => {
  function fightingSeal(phaseCount: number, maxHp: number) {
    const seal = createSealEncounter(0, { ...STUB_SEAL_DEFINITION, phaseCount });
    return { ...seal, status: 'fighting' as const, maxHp, hp: maxHp, hpPerPhase: maxHp / phaseCount, bossState: {} };
  }

  it('drains hp 1:1 when not staggered', () => {
    const seal = fightingSeal(3, 300);
    const after = applySealDamage(seal, 40);
    expect(after.hp).toBe(260);
    expect(after.staggerRemainingS).toBe(0);
  });

  it('starts a stagger window the instant a segment boundary is crossed', () => {
    const seal = fightingSeal(3, 300); // 100 hp per phase
    const after = applySealDamage(seal, 150); // crosses the first boundary (hp 150 < 200 threshold)
    expect(after.hp).toBe(150);
    expect(after.staggerRemainingS).toBe(BALANCE.seals.phaseStaggerWindowS);
  });

  it('doubles damage while staggered', () => {
    const seal = { ...fightingSeal(3, 300), staggerRemainingS: BALANCE.seals.phaseStaggerWindowS, hp: 150 };
    const after = applySealDamage(seal, 40);
    expect(after.hp).toBe(150 - 40 * BALANCE.seals.phaseStaggerDamageMult);
  });

  it('breaks immediately once hp reaches 0, regardless of stagger state', () => {
    const seal = fightingSeal(3, 300);
    const after = applySealDamage(seal, 9999);
    expect(after.status).toBe('broken');
    expect(after.hp).toBe(0);
    expect(after.staggerRemainingS).toBe(0);
  });

  it('is a no-op once already broken', () => {
    const seal = { ...fightingSeal(3, 300), status: 'broken' as const, hp: 0 };
    const after = applySealDamage(seal, 40);
    expect(after).toBe(seal);
  });
});

describe('stepSealEncounter: stagger -> next phase', () => {
  it('advances phaseIndex and resets boss state only once the stagger window fully elapses', () => {
    const definition = STUB_SEAL_DEFINITION;
    let seal = createSealEncounter(0, definition);
    seal = { ...seal, status: 'fighting', bossState: definition.createBossState(0, new RngRegistry(1)) };
    seal = applySealDamage(seal, seal.hpPerPhase); // cross into stagger
    expect(seal.staggerRemainingS).toBeGreaterThan(0);
    expect(seal.phaseIndex).toBe(0); // not yet advanced

    const staggerSteps = Math.round(BALANCE.seals.phaseStaggerWindowS / DT);
    for (let i = 0; i < staggerSteps - 2; i++) {
      seal = stepSealEncounter(seal, definition, makeCtx()).seal;
      expect(seal.phaseIndex).toBe(0);
    }
    for (let i = 0; i < 4; i++) {
      seal = stepSealEncounter(seal, definition, makeCtx()).seal;
    }
    expect(seal.phaseIndex).toBe(1);
    expect(seal.staggerRemainingS).toBe(0);
  });
});

describe('startAttack / stepAttack: the shared telegraph shape', () => {
  it('clamps below-minimum requests up to minAttackTelegraphS', () => {
    const attack = startAttack(0.01);
    expect(attack.telegraphDurationS).toBe(BALANCE.seals.minAttackTelegraphS);
  });

  it('never resolves before its telegraph duration elapses', () => {
    let attack = startAttack(BALANCE.seals.minAttackTelegraphS);
    const steps = Math.round(BALANCE.seals.minAttackTelegraphS / DT);
    for (let i = 0; i < steps - 1; i++) {
      const result = stepAttack(attack, DT);
      attack = result.state;
      expect(result.justResolved).toBe(false);
      expect(attack.phase).toBe('telegraphing');
    }
  });

  it('resolves exactly once, the step the duration is crossed', () => {
    let attack = startAttack(BALANCE.seals.minAttackTelegraphS);
    let resolvedCount = 0;
    for (let i = 0; i < 200; i++) {
      const result = stepAttack(attack, DT);
      attack = result.state;
      if (result.justResolved) resolvedCount++;
    }
    expect(resolvedCount).toBe(1);
    expect(attack.phase).toBe('resolved');
  });
});

describe('stub Seal: full integration through World', () => {
  it('the fight cycles through every phase and ends broken when enough damage lands', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, STUB_SEAL_DEFINITION);

    // Fast-forward past the approach.
    const approachSteps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
    for (let i = 0; i < approachSteps; i++) stepWorld(world, DT, NO_INPUT);
    expect(world.seal?.status).toBe('fighting');

    const seenPhases = new Set<number>();
    let steps = 0;
    while (world.seal !== null && steps < 100000) {
      seenPhases.add(world.seal.phaseIndex);
      // Only chip damage in while not staggered — applying more during the stagger
      // window (where it's deliberately allowed to carry over at 2x, see
      // applySealDamage's own tests above) could jump phaseIndex past an
      // intermediate phase entirely once the window elapses, which is correct
      // framework behaviour but would make this test's "saw every phase" assertion
      // seed-dependent rather than a reliable check of the cycle itself.
      if (world.seal.status === 'fighting' && world.seal.staggerRemainingS === 0) {
        world.seal = applySealDamage(world.seal, world.seal.hpPerPhase / 30);
      }
      stepWorld(world, DT, NO_INPUT);
      steps++;
    }

    expect(world.seal).toBeNull();
    expect(world.sealDefinition).toBeNull();
    expect(world.sealsBroken).toBe(1);
    expect(seenPhases.size).toBe(STUB_SEAL_DEFINITION.phaseCount);
  });

  it('every attack telegraphs before it can cost a Stroke — dodging to the other lane half avoids the hit entirely', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, STUB_SEAL_DEFINITION);
    const approachSteps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
    for (let i = 0; i < approachSteps; i++) stepWorld(world, DT, NO_INPUT);

    const startCount = world.line.strokes.length;
    let sawTelegraphBeforeHit = true;
    let anyTelegraphSeen = false;

    for (let i = 0; i < 600 && world.seal !== null; i++) {
      const telegraph = stubActiveTelegraph(world.seal.bossState);
      if (telegraph !== null) {
        anyTelegraphSeen = true;
        // Always dodge to the opposite side of whatever's telegraphed.
        const targetX = telegraph.side === 'left' ? BALANCE.lane.brushClampX : -BALANCE.lane.brushClampX;
        const delta = Math.sign(targetX - world.brushTargetX) * BALANCE.control.keyboardUPerS * DT;
        stepWorld(world, DT, { lateralDelta: delta, holding: false });
      } else {
        stepWorld(world, DT, NO_INPUT);
      }
      if (world.line.strokes.length < startCount) sawTelegraphBeforeHit = false;
    }

    expect(anyTelegraphSeen).toBe(true);
    expect(sawTelegraphBeforeHit).toBe(true); // dodging every telegraphed attack took zero Strokes
  });

  it('a Stroke is lost if the Brush stays on the telegraphed half through resolution', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, STUB_SEAL_DEFINITION);
    const approachSteps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
    for (let i = 0; i < approachSteps; i++) stepWorld(world, DT, NO_INPUT);

    const startCount = world.line.strokes.length;
    let tookDamage = false;
    for (let i = 0; i < 600 && world.seal !== null && !tookDamage; i++) {
      stepWorld(world, DT, NO_INPUT); // never moves — sits wherever the telegraph lands
      if (world.line.strokes.length < startCount) tookDamage = true;
    }

    expect(tookDamage).toBe(true);
    expect(world.deathCause).toBeNull(); // startCount is well above 1, shouldn't have died
  });

  it('pauses Blot-wave/Gate/Sealstack spawning during the encounter but keeps Slip runs going', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, STUB_SEAL_DEFINITION);
    const nextWaveBefore = world.nextWaveAtTimeS;
    const nextGateBefore = world.nextGateAtDistanceU;
    const nextSealstackBefore = world.nextSealstackAtDistanceU;
    const nextSlipBefore = world.nextSlipBudgetAtDistanceU;

    // Run well past when a wave/Gate/Sealstack would ordinarily have fired.
    for (let i = 0; i < Math.round(20 / DT); i++) stepWorld(world, DT, NO_INPUT);

    expect(world.blotPool.activeCount).toBe(0);
    expect(world.currentGatePair).toBeNull();
    expect(world.sealstackPool.activeCount).toBe(0);
    expect(world.nextWaveAtTimeS).toBe(nextWaveBefore);
    expect(world.nextGateAtDistanceU).toBe(nextGateBefore);
    expect(world.nextSealstackAtDistanceU).toBe(nextSealstackBefore);
    // Slips are the one exception (GAME_DESIGN.md §8.2) — its own threshold should have
    // advanced at least once given 20s of travel comfortably clears slipBudget.perU.
    expect(world.nextSlipBudgetAtDistanceU).toBeGreaterThan(nextSlipBefore);
  });
});
