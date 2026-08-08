import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { createBlotPool } from '../../src/sim/blot.js';
import { BALANCE } from '../../src/sim/config.js';
import type { SealStepContext } from '../../src/sim/seals/framework.js';
import { SMEAR_SEAL_DEFINITION, smearActiveVisual } from '../../src/sim/seals/smear.js';
import { createWorld, startSealEncounter, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };

function makeCtx(overrides: Partial<SealStepContext> = {}): SealStepContext {
  return { dt: DT, timeS: 0, brushX: 0, brushZ: 0, rng: new RngRegistry(1), blotPool: createBlotPool(), ...overrides };
}

/** Fast-forwards a World's Seal encounter past the 6s approach, into 'fighting'. */
function skipApproach(world: ReturnType<typeof createWorld>): void {
  const steps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
  for (let i = 0; i < steps; i++) stepWorld(world, DT, NO_INPUT);
}

describe('The Smear: attack cycle', () => {
  it('goes cooldown -> telegraph (gatherPullS) -> sweeping (sweepDurationS) -> cooldown again in a non-final phase', () => {
    let bossState = SMEAR_SEAL_DEFINITION.createBossState(0, new RngRegistry(1));
    let stage: string | null = null;

    const cooldownSteps = Math.round(BALANCE.seals.smear.attackIntervalS / DT) + 2;
    for (let i = 0; i < cooldownSteps; i++) {
      const result = SMEAR_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx());
      bossState = result.bossState;
    }
    stage = smearActiveVisual(bossState)?.stage ?? null;
    expect(stage).toBe('telegraph');

    const telegraphSteps = Math.round(BALANCE.seals.smear.gatherPullS / DT) + 2;
    for (let i = 0; i < telegraphSteps; i++) {
      const result = SMEAR_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx());
      bossState = result.bossState;
    }
    stage = smearActiveVisual(bossState)?.stage ?? null;
    expect(stage).toBe('sweeping');

    const sweepSteps = Math.round(BALANCE.seals.smear.sweepDurationS / DT) + 2;
    for (let i = 0; i < sweepSteps; i++) {
      const result = SMEAR_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx());
      bossState = result.bossState;
    }
    expect(smearActiveVisual(bossState)).toBeNull(); // back to cooldown, nothing active
  });

  it('the telegraph never resolves in under minAttackTelegraphS even if gatherPullS were smaller', () => {
    expect(BALANCE.seals.smear.gatherPullS).toBeGreaterThanOrEqual(BALANCE.seals.minAttackTelegraphS);
  });

  it('only phase 3 (the last phase) transitions into a residue stage after the sweep', () => {
    const lastPhase = BALANCE.seals.smear.phases - 1;
    for (const phaseIndex of [0, 1, lastPhase]) {
      let bossState = SMEAR_SEAL_DEFINITION.createBossState(phaseIndex, new RngRegistry(1));
      const toCooldownEnd = Math.round(BALANCE.seals.smear.attackIntervalS / DT) + 2;
      const toTelegraphEnd = Math.round(BALANCE.seals.smear.gatherPullS / DT) + 2;
      const toSweepEnd = Math.round(BALANCE.seals.smear.sweepDurationS / DT) + 2;
      for (let i = 0; i < toCooldownEnd + toTelegraphEnd + toSweepEnd; i++) {
        bossState = SMEAR_SEAL_DEFINITION.stepBoss(bossState, phaseIndex, makeCtx()).bossState;
      }
      const stage = smearActiveVisual(bossState)?.stage ?? null;
      if (phaseIndex === lastPhase) {
        expect(stage).toBe('residue');
      } else {
        expect(stage).toBeNull();
      }
    }
  });
});

describe('The Smear: sweep hit detection', () => {
  it('costs exactly one Stroke if the Brush is caught anywhere the arm passes over, never more than one per sweep', () => {
    // Brush sits at lane centre the whole time — the arm's sweep is wide enough (2/3 of
    // the lane) that centre is caught regardless of which direction it starts from.
    let bossState = SMEAR_SEAL_DEFINITION.createBossState(0, new RngRegistry(2));
    let totalStrokesLost = 0;

    // Step continuously through cooldown -> telegraph -> sweeping -> cooldown again,
    // accumulating every step's strokesLost — no per-stage iteration budgets to get
    // subtly wrong, and no risk of silently skipping the step a hit actually lands on.
    const totalSteps = Math.round(
      (BALANCE.seals.smear.attackIntervalS + BALANCE.seals.smear.gatherPullS + BALANCE.seals.smear.sweepDurationS) /
        DT +
        4,
    );
    for (let i = 0; i < totalSteps; i++) {
      const result = SMEAR_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ brushX: 0 }));
      bossState = result.bossState;
      totalStrokesLost += result.strokesLost;
    }

    expect(totalStrokesLost).toBe(BALANCE.seals.smear.attackStrokeLoss);
  });

  it('a single stationary position survives an entire sweep, by design — the arm is narrow, only its total reach spans two thirds of the lane', () => {
    // The sweep's total footprint (`sweepReachFraction` of the lane, centred on 0) is
    // where the danger ever reaches; anything outside that, on either side, is safe for
    // the attack's *entire* duration — a real "pick a position and hold it" answer, not
    // a moving gap requiring continuous reflexive tracking.
    const sweepReachU = BALANCE.lane.width * BALANCE.seals.smear.sweepReachFraction;
    expect(sweepReachU).toBeLessThan(BALANCE.lane.width);
    const alwaysSafeMarginU = (BALANCE.lane.width - sweepReachU) / 2;
    expect(alwaysSafeMarginU).toBeGreaterThan(0);
    // And that margin has to actually be reachable within the Brush's own clamp range.
    expect(BALANCE.lane.brushClampX).toBeGreaterThan(sweepReachU / 2);
  });
});

describe('The Smear: a safe position always exists and is always reachable in time', () => {
  it('the full telegraph+sweep reaction window comfortably exceeds worst-case clamp-to-clamp travel time', () => {
    const reactionWindowS = BALANCE.seals.smear.gatherPullS + BALANCE.seals.smear.sweepDurationS;
    const worstCaseTravelU = BALANCE.lane.brushClampX * 2;
    const worstCaseTravelS = worstCaseTravelU / BALANCE.control.keyboardUPerS;
    expect(reactionWindowS).toBeGreaterThan(worstCaseTravelS);
  });
});

describe('The Smear: full integration through World', () => {
  // Parking at either lane edge is safe for the sweep's *entire* footprint regardless
  // of which direction it happens to run (see the "a single stationary position
  // survives an entire sweep" test above) — but firing has no auto-aim (a standing
  // decision since Task 2.7: a muzzle only hits what its own x lines up with), and the
  // Seal sits at the lane's centre — so actually damaging it means coming back to
  // centre between attacks, not camping the edge forever. Dodge only while an attack is
  // actually active; return to centre (where the Line's own muzzles line up with the
  // Seal) the rest of the time.
  function dodgeInput(world: ReturnType<typeof createWorld>): WorldInput {
    const visual = world.seal !== null ? smearActiveVisual(world.seal.bossState) : null;
    const targetX = visual === null ? 0 : BALANCE.lane.brushClampX;
    const delta = Math.sign(targetX - world.brushTargetX) * BALANCE.control.keyboardUPerS * DT;
    return { lateralDelta: delta, holding: false };
  }

  it('the fight cycles through all 3 phases and ends broken while dodging', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, SMEAR_SEAL_DEFINITION);
    // Task 3.5's arcade cadence would otherwise be free to auto-start a second,
    // different-boss encounter partway through these long/multi-attempt loops (real
    // Passage behaviour, but not what this Smear-specific test means to measure).
    world.nextSealAtTimeS = Infinity;
    skipApproach(world);
    expect(world.seal?.status).toBe('fighting');

    // Whether a residue stage is actually observed here depends on exactly how the
    // final phase's HP drains (a kill mid-sweep ends the fight immediately, same as any
    // other Seal — no obligation to sit through a residue window it no longer needs);
    // that the residue stage transition itself works correctly is already covered by
    // "only phase 3 (the last phase) transitions into a residue stage after the sweep"
    // above, so it's not re-asserted here.
    const seenPhases = new Set<number>();
    let steps = 0;
    while (world.seal !== null && steps < 200000) {
      seenPhases.add(world.seal.phaseIndex);
      stepWorld(world, DT, dodgeInput(world));
      steps++;
    }

    expect(world.seal).toBeNull();
    expect(world.sealsBroken).toBe(1);
    expect(seenPhases.size).toBe(SMEAR_SEAL_DEFINITION.phaseCount);
    expect(world.deathCause).toBeNull();
  });

  it('dodging to the edge avoids all Stroke loss for the whole fight', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, SMEAR_SEAL_DEFINITION);
    // Task 3.5's arcade cadence would otherwise be free to auto-start a second,
    // different-boss encounter partway through these long/multi-attempt loops (real
    // Passage behaviour, but not what this Smear-specific test means to measure).
    world.nextSealAtTimeS = Infinity;
    skipApproach(world);

    const startCount = world.line.strokes.length;
    let minObservedLineCount = startCount;
    let steps = 0;
    while (world.seal !== null && steps < 200000) {
      stepWorld(world, DT, dodgeInput(world));
      minObservedLineCount = Math.min(minObservedLineCount, world.line.strokes.length);
      steps++;
    }

    // The Line may grow (Slips keep recruiting throughout the fight, §8.2) but should
    // never shrink — any drop would mean a sweep or the residue actually landed.
    expect(minObservedLineCount).toBeGreaterThanOrEqual(startCount);
    expect(world.deathCause).toBeNull();
  });
});

describe('The Smear: zero-upgrades baseline win rate (measurement, not a pass/fail bar)', () => {
  // Task 3.2's acceptance bar ("the bot beats it at ~40% with level-5 upgrades") can't
  // be measured yet — there's no Inkstone/upgrade system until Task 4.2. This measures
  // the only thing currently measurable: a zero-upgrades baseline, dodging every sweep
  // it can identify and firing continuously otherwise. See DECISIONS.md.
  it('is winnable at zero upgrades for at least some seeds (a real fight, not an impossible one)', () => {
    const SEED_COUNT = 40;
    const MAX_STEPS = Math.round(90 / DT); // 90s hard cap per attempt
    let wins = 0;

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const world = createWorld(seed);
      startSealEncounter(world, 0, SMEAR_SEAL_DEFINITION);
      // Task 3.5's arcade cadence would otherwise be free to auto-start a second,
      // different-boss encounter partway through these long/multi-attempt loops (real
      // Passage behaviour, but not what this Smear-specific test means to measure).
      world.nextSealAtTimeS = Infinity;
      skipApproach(world);

      for (let i = 0; i < MAX_STEPS && world.seal !== null && !world.isDead; i++) {
        const visual = smearActiveVisual(world.seal.bossState);
        let lateralDelta = 0;
        if (visual !== null) {
          const targetX = visual.centerX >= 0 ? -BALANCE.lane.brushClampX : BALANCE.lane.brushClampX;
          lateralDelta = Math.sign(targetX - world.brushTargetX) * BALANCE.control.keyboardUPerS * DT;
        }
        stepWorld(world, DT, { lateralDelta, holding: false });
      }

      if (world.seal === null && !world.isDead) wins++;
    }

    const winRate = wins / SEED_COUNT;
    // Deliberately surfaced: a real baseline number for Task 4.6's balance pass, not
    // something to silently assert away.
    console.log(`[Task 3.2 baseline] The Smear, zero upgrades, ${SEED_COUNT} seeds: ${(winRate * 100).toFixed(1)}% win rate`);
    expect(wins).toBeGreaterThan(0);
  });
});
