import { describe, expect, it } from 'vitest';
import { BALANCE, type InkstoneTrackId } from '../../src/sim/config.js';
import { NO_UPGRADES } from '../../src/sim/upgradeEffects.js';
import { spawnBlot } from '../../src/sim/blot.js';
import { spawnSlip } from '../../src/sim/slips.js';
import { createWorld, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };

function levelsWith(track: InkstoneTrackId, level: number): Readonly<Record<InkstoneTrackId, number>> {
  return { ...NO_UPGRADES, [track]: level };
}

describe('Task 4.2: every Inkstone track measurably changes stepWorld behaviour, not just its own stored level', () => {
  it('Opening Stroke: the Line starts (and peaks) larger by exactly strokesPerLevel * level', () => {
    const level = 4;
    const world = createWorld(1, levelsWith('openingStroke', level));
    const expectedCount = BALANCE.line.startCount + level * BALANCE.inkstone.openingStroke.strokesPerLevel;
    expect(world.line.strokes).toHaveLength(expectedCount);
    expect(world.peakLineCount).toBe(expectedCount);
  });

  it('Grind: a Blot in range loses more HP over an identical (short, non-lethal) window at a higher level', () => {
    // Short window and a beefy target (Crust, 25 HP) so the comparison never runs into
    // the target actually dying partway through — a dead Blot's pool slot gets reused
    // (swap-remove) by the very next Director-spawned wave, which would make re-reading
    // `blot.hp` from a stale/replaced pool object meaningless. Holding a direct
    // reference to the spawned Blot (not re-querying the pool by index) sidesteps that
    // entirely, but staying well short of lethal keeps the comparison honest either way.
    function hpAfter(level: number): number {
      const world = createWorld(1, levelsWith('grind', level));
      const blot = spawnBlot(world.blotPool, 'crust', 0, BALANCE.director.spawnDistanceU)!;
      // The first shots take ~3s to travel the 45u spawn distance and land (projectiles
      // aren't instant-hit) — measured empirically, the first hit lands around step 165.
      // 250 steps (~4.2s) gives a comfortable margin past that first hit while staying
      // well short of Crust's 25 HP (a natural, undodged Crust otherwise dies around
      // ~7.5s in, per the "firing eventually kills a Blot" test elsewhere).
      for (let i = 0; i < 250; i++) stepWorld(world, DT, NO_INPUT);
      expect(blot.hp).toBeGreaterThan(0); // sanity: still alive, the comparison is meaningful
      expect(blot.hp).toBeLessThan(25); // sanity: actually took damage, not still untouched
      return blot.hp;
    }

    const baseline = hpAfter(0);
    const upgraded = hpAfter(BALANCE.inkstone.levelsPerTrack);
    expect(upgraded).toBeLessThan(baseline);
  });

  it('Nib: more projectiles spawn over an identical short window at a higher level', () => {
    function projectilesAfter(level: number): number {
      const world = createWorld(1, levelsWith('nib', level));
      // No target spawned — nothing despawns from a hit within this short window, so the
      // pool's active count is purely "how many have been fired so far."
      for (let i = 0; i < 20; i++) stepWorld(world, DT, NO_INPUT);
      return world.projectilePool.activeCount;
    }

    const baseline = projectilesAfter(0);
    const upgraded = projectilesAfter(BALANCE.inkstone.levelsPerTrack);
    expect(upgraded).toBeGreaterThan(baseline);
  });

  it('Well: the Passage starts at (and refills up to) a higher Wetness cap', () => {
    const level = 5;
    const bonus = level * BALANCE.inkstone.well.wetnessCapPerLevel;
    const world = createWorld(1, levelsWith('well', level));
    expect(world.wetness.current).toBe(BALANCE.wetness.max + bonus);

    // Drain well below the base cap (the higher starting cap means this needs more
    // draining than a zero-Well Passage would), then hold long enough to refill past it.
    const drainStepsNeeded = Math.ceil((bonus + 10) / BALANCE.wetness.drainPerSWhileFiring / DT);
    for (let i = 0; i < drainStepsNeeded; i++) stepWorld(world, DT, NO_INPUT);
    expect(world.wetness.current).toBeLessThan(BALANCE.wetness.max);
    const holdSteps = Math.ceil((BALANCE.wetness.refillDelayS + 5) / DT);
    for (let i = 0; i < holdSteps; i++) stepWorld(world, DT, { lateralDelta: 0, holding: true });
    expect(world.wetness.current).toBeGreaterThan(BALANCE.wetness.max);
    expect(world.wetness.current).toBeLessThanOrEqual(BALANCE.wetness.max + bonus);
  });

  it('Reach: a fired projectile travels farther before its range runs out', () => {
    function maxRangeAfterOneShot(level: number): number {
      const world = createWorld(1, levelsWith('reach', level));
      let steps = 0;
      while (world.projectilePool.activeCount === 0 && steps < 60) {
        stepWorld(world, DT, NO_INPUT);
        steps++;
      }
      expect(world.projectilePool.activeCount).toBeGreaterThan(0);
      return world.projectilePool.get(0).maxRangeU;
    }

    const baseline = maxRangeAfterOneShot(0);
    const upgraded = maxRangeAfterOneShot(BALANCE.inkstone.levelsPerTrack);
    expect(upgraded).toBeGreaterThan(baseline);
  });

  it('Reach: a Slip in range loses more HP over an identical (short, non-lethal) window at a higher level', () => {
    function slipHpAfter(level: number): number {
      const world = createWorld(1, levelsWith('reach', level));
      // plusTwentyFive: high HP (40) and a wide hit radius (spans a third of the lane),
      // so it's reliably hit regardless of muzzle alignment — but a short window still
      // keeps it well short of dying and being pool-recycled by the next Director spawn.
      const slip = spawnSlip(world.slipPool, 'plusTwentyFive', 'hane', 0, 20)!;
      for (let i = 0; i < 60; i++) stepWorld(world, DT, NO_INPUT);
      expect(slip.hp).toBeGreaterThan(0); // sanity: still alive, the comparison is meaningful
      expect(slip.hp).toBeLessThan(BALANCE.slips.plusTwentyFive.hp); // sanity: actually took damage
      return slip.hp;
    }

    const baseline = slipHpAfter(0);
    const upgraded = slipHpAfter(BALANCE.inkstone.levelsPerTrack);
    expect(upgraded).toBeLessThan(baseline);
  });

  it('Flourish Study: a released charge starts a shorter cooldown at a higher level', () => {
    function cooldownRemainingAfterTrigger(level: number): number {
      const world = createWorld(1, levelsWith('flourishStudy', level));
      stepWorld(world, DT, { lateralDelta: 0, holding: true }); // begin charging
      const chargeSteps = Math.ceil((BALANCE.flourish.chargeTimeS + 0.1) / DT);
      for (let i = 0; i < chargeSteps; i++) stepWorld(world, DT, { lateralDelta: 0, holding: true });
      stepWorld(world, DT, NO_INPUT); // release — triggers
      return world.flourish.cooldownUntilS - world.timeS;
    }

    const baseline = cooldownRemainingAfterTrigger(0);
    const upgraded = cooldownRemainingAfterTrigger(BALANCE.inkstone.levelsPerTrack);
    expect(upgraded).toBeLessThan(baseline);
    expect(upgraded).toBeCloseTo(BALANCE.inkstone.flourishStudy.cooldownFloorS, 3);
  });

  it('Second Draft: a Line hitting 0 revives instead of dying when a revive is available', () => {
    const world = createWorld(1, levelsWith('secondDraft', 1));
    world.line = { strokes: [{ class: 'hane' }] }; // one Stroke from death
    world.peakLineCount = 50;
    spawnBlot(world.blotPool, 'smudge', 0, -1); // already at/past the Brush — kills on contact

    stepWorld(world, DT, NO_INPUT);

    expect(world.isDead).toBe(false);
    expect(world.deathCause).toBeNull();
    expect(world.revivesRemaining).toBe(0); // the one revive was just spent
    const expectedReviveCount = Math.ceil(50 * BALANCE.inkstone.secondDraft.revivePeakFraction);
    expect(world.line.strokes).toHaveLength(expectedReviveCount);
  });

  it('Second Draft: with zero revives available, the Line hitting 0 ends the Passage as normal', () => {
    const world = createWorld(1, NO_UPGRADES);
    world.line = { strokes: [{ class: 'hane' }] };
    spawnBlot(world.blotPool, 'smudge', 0, -1);

    stepWorld(world, DT, NO_INPUT);

    expect(world.isDead).toBe(true);
    expect(world.deathCause).toBe('blot');
    expect(world.line.strokes).toHaveLength(0);
  });

  it('Second Draft: a used-up revive budget behaves exactly like having none once exhausted', () => {
    const world = createWorld(1, levelsWith('secondDraft', 1)); // exactly 1 revive
    world.peakLineCount = 10;
    world.revivesRemaining = 0; // simulate having already spent it earlier in the Passage
    world.line = { strokes: [{ class: 'hane' }] };
    spawnBlot(world.blotPool, 'smudge', 0, -1);

    stepWorld(world, DT, NO_INPUT);

    expect(world.isDead).toBe(true);
    expect(world.deathCause).toBe('blot');
  });
});
