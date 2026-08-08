import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { createWorld, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };
const T = BALANCE.firstRunTeaching;

function stepsFor(seconds: number): number {
  return Math.round(seconds / DT);
}

describe('First-run teaching (GAME_DESIGN.md §13)', () => {
  it('is off (null) for an ordinary Passage — createWorld defaults to no teaching', () => {
    const world = createWorld(1);
    expect(world.firstRunTeaching).toBeNull();
  });

  it('starts at stage "slip" when requested', () => {
    const world = createWorld(1, undefined, true);
    expect(world.firstRunTeaching).toEqual({ stage: 'slip' });
  });

  it('presents nothing at all until the Slip run stage time, even though a normal Passage would already have Director content by then', () => {
    const world = createWorld(1, undefined, true);
    for (let i = 0; i < stepsFor(T.slipAtTimeS) - 2; i++) {
      stepWorld(world, DT, NO_INPUT);
    }
    expect(world.slipPool.activeCount).toBe(0);
    expect(world.currentGatePair).toBeNull();
    expect(world.blotPool.activeCount).toBe(0);
    expect(world.sealstackPool.activeCount).toBe(0);
    expect(world.inkPoolPool.activeCount).toBe(0);
  });

  it('presents exactly one Slip run at slipAtTimeS, then exactly one Gate pair at gateAtTimeS, then exactly one wave at waveAtTimeS, and nothing else — in that order, within the 20s window', () => {
    const world = createWorld(1, undefined, true);

    let sawSlipBeforeGate = false;
    let sawGateBeforeWave = false;
    let slipRunCount = 0;
    let gatePairCount = 0;
    let waveSpawnCount = 0;
    let previousSlipActive = 0;
    let previousGatePresent = false;
    let previousBlotActive = 0;

    for (let i = 0; i < stepsFor(T.windowS) + 2; i++) {
      stepWorld(world, DT, NO_INPUT);

      if (world.slipPool.activeCount > previousSlipActive) {
        slipRunCount++;
        if (world.currentGatePair === null && world.blotPool.activeCount === 0) sawSlipBeforeGate = true;
      }
      previousSlipActive = world.slipPool.activeCount;

      const gatePresent = world.currentGatePair !== null;
      if (gatePresent && !previousGatePresent) {
        gatePairCount++;
        if (world.blotPool.activeCount === 0) sawGateBeforeWave = true;
      }
      previousGatePresent = gatePresent;

      if (world.blotPool.activeCount > previousBlotActive) {
        waveSpawnCount++;
      }
      previousBlotActive = world.blotPool.activeCount;
    }

    expect(slipRunCount).toBe(1);
    expect(gatePairCount).toBe(1);
    expect(waveSpawnCount).toBe(1);
    expect(sawSlipBeforeGate).toBe(true);
    expect(sawGateBeforeWave).toBe(true);
    expect(world.sealstackPool.activeCount).toBe(0); // "nothing else on screen"
    expect(world.inkPoolPool.activeCount).toBe(0);
    expect(world.firstRunTeaching).toEqual({ stage: 'done' });
  });

  it('resumes completely normal Director cadence after the scripted sequence finishes', () => {
    const world = createWorld(1, undefined, true);
    for (let i = 0; i < stepsFor(T.windowS) + 2; i++) {
      stepWorld(world, DT, NO_INPUT);
    }
    expect(world.firstRunTeaching?.stage).toBe('done');

    const gatesAtWindowEnd = world.currentGatePair !== null ? 1 : 0;
    const slipsAtWindowEnd = world.slipPool.activeCount;
    const wavesAtWindowEnd = world.blotPool.activeCount;

    // Run well past the window — a real Passage keeps producing content indefinitely;
    // teaching suppressing it forever would be a stuck-Director bug, not a feature.
    for (let i = 0; i < stepsFor(30); i++) {
      stepWorld(world, DT, NO_INPUT);
    }

    const gatesLater = world.currentGatePair !== null ? 1 : 0;
    expect(gatesLater + world.slipPool.activeCount + world.blotPool.activeCount).toBeGreaterThan(
      gatesAtWindowEnd + slipsAtWindowEnd + wavesAtWindowEnd,
    );
  });
});
