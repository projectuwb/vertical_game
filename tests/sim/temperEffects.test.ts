import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { createLine } from '../../src/sim/line.js';
import { createTemperState, type TemperState } from '../../src/sim/gates.js';
import { createWorld, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };

function temperWith(field: keyof TemperState, stacks: number): TemperState {
  return { ...createTemperState(), [field]: stacks };
}

// Task 7.8: gates.ts's TemperState was accumulated on every Temper Gate resolution but
// never actually applied anywhere in /sim (a discovered, logged gap from Task 4.2). This
// mirrors worldUpgrades.test.ts's "every Inkstone track measurably changes stepWorld
// behaviour" pattern, but for Temper's four stats — set directly on `world.temper`
// (the real path, `applyGateEffect`, is already covered by gates.test.ts) rather than
// walking a Gate pair through, since what's under test here is stepWorld's own
// composition, not gate resolution.
describe('Task 7.8: every Temper stat measurably changes stepWorld behaviour', () => {
  it('rate: more projectiles spawn over an identical short window with rate stacks', () => {
    function projectilesAfter(stacks: number): number {
      const world = createWorld(1);
      world.temper = temperWith('rateStacks', stacks);
      for (let i = 0; i < 20; i++) stepWorld(world, DT, NO_INPUT);
      return world.projectilePool.activeCount;
    }

    const baseline = projectilesAfter(0);
    const withStacks = projectilesAfter(BALANCE.gates.temper.stackCap);
    expect(withStacks).toBeGreaterThan(baseline);
  });

  it('range: a fired projectile travels farther before its range runs out with range stacks', () => {
    function maxRangeAfterOneShot(stacks: number): number {
      const world = createWorld(1);
      world.temper = temperWith('rangeStacks', stacks);
      let steps = 0;
      while (world.projectilePool.activeCount === 0 && steps < 60) {
        stepWorld(world, DT, NO_INPUT);
        steps++;
      }
      expect(world.projectilePool.activeCount).toBeGreaterThan(0);
      return world.projectilePool.get(0).maxRangeU;
    }

    const baseline = maxRangeAfterOneShot(0);
    const withStacks = maxRangeAfterOneShot(BALANCE.gates.temper.stackCap);
    expect(withStacks).toBeGreaterThan(baseline);
  });

  it('splash: a fired Tome projectile has a larger splash radius with splash stacks', () => {
    function tomeSplashRadiusAfterOneShot(stacks: number): number {
      const world = createWorld(1);
      world.temper = temperWith('splashStacks', stacks);
      world.line = createLine(BALANCE.line.startCount, 'tome');
      let steps = 0;
      while (world.projectilePool.activeCount === 0 && steps < 60) {
        stepWorld(world, DT, NO_INPUT);
        steps++;
      }
      expect(world.projectilePool.activeCount).toBeGreaterThan(0);
      return world.projectilePool.get(0).splashRadiusU;
    }

    const baseline = tomeSplashRadiusAfterOneShot(0);
    const withStacks = tomeSplashRadiusAfterOneShot(BALANCE.gates.temper.stackCap);
    expect(baseline).toBe(BALANCE.strokes.tome.splashRadiusU);
    expect(withStacks).toBeGreaterThan(baseline);
  });

  it('wetnessCap: refills up to a higher Wetness cap with wetnessCap stacks', () => {
    const stacks = BALANCE.gates.temper.stackCap;
    const bonus = stacks * BALANCE.gates.temper.wetnessCapBonus;
    const world = createWorld(1);
    world.temper = temperWith('wetnessCapStacks', stacks);
    // Set the drained state directly rather than simulating a real drain (which, over
    // the many real seconds a bonus this large needs to drain past the base cap, risks
    // the undefended zero-upgrades Line actually dying to ordinary Blot contact and
    // permanently freezing stepWorld — worldUpgrades.test.ts's smaller Well bonus never
    // hit this because its drain phase is much shorter). What's under test here is only
    // the refill ceiling, not the drain path itself (already covered elsewhere).
    world.wetness = { current: 0, timeSinceStoppedFiringS: BALANCE.wetness.refillDelayS + 1 };
    const holdSteps = Math.ceil(((bonus + 10) / BALANCE.wetness.refillPerSAfterDelay) / DT);
    for (let i = 0; i < holdSteps; i++) stepWorld(world, DT, { lateralDelta: 0, holding: true });
    expect(world.wetness.current).toBeGreaterThan(BALANCE.wetness.max);
    expect(world.wetness.current).toBeLessThanOrEqual(BALANCE.wetness.max + bonus);
  });
});
