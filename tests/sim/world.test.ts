import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { computeGoldLeaf, createWorld, stepWorld, type WorldInput } from '../../src/sim/world.js';
import { spawnBlot } from '../../src/sim/blot.js';
import { spawnSlip } from '../../src/sim/slips.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };

describe('createWorld', () => {
  it('starts with the Line at BALANCE.line.startCount, everything else empty, not dead', () => {
    const world = createWorld(1);
    expect(world.line.strokes).toHaveLength(BALANCE.line.startCount);
    expect(world.projectilePool.activeCount).toBe(0);
    expect(world.blotPool.activeCount).toBe(0);
    expect(world.slipPool.activeCount).toBe(0);
    expect(world.isDead).toBe(false);
    expect(world.deathCause).toBeNull();
  });

  it('is deterministic for a given seed', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    for (let i = 0; i < 300; i++) {
      stepWorld(a, DT, NO_INPUT);
      stepWorld(b, DT, NO_INPUT);
    }
    expect(a.timeS).toBe(b.timeS);
    expect(a.line.strokes.length).toBe(b.line.strokes.length);
    expect(a.blotPool.activeCount).toBe(b.blotPool.activeCount);
    expect(a.isDead).toBe(b.isDead);
  });
});

describe('stepWorld', () => {
  it('moves the Brush toward the lateral target over time', () => {
    const world = createWorld(1);
    for (let i = 0; i < 60; i++) {
      stepWorld(world, DT, { lateralDelta: 0.05, holding: false });
    }
    expect(world.brushFollower.position).toBeGreaterThan(0);
  });

  it('advances time and distance at the configured forward speed', () => {
    const world = createWorld(1);
    for (let i = 0; i < 60; i++) stepWorld(world, DT, NO_INPUT);
    expect(world.timeS).toBeCloseTo(1, 6);
    expect(world.distanceU).toBeCloseTo(BALANCE.forwardSpeed.baseUPerS, 6);
  });

  it('a Blot that reaches the Brush costs Strokes and can end the Passage', () => {
    const world = createWorld(1);
    // Force the Line down to 1 Stroke so a single normal contact ends it.
    world.line = { strokes: [{ class: 'hane' }] };
    spawnBlot(world.blotPool, 'smudge', 0, -1); // already at/past the Brush

    stepWorld(world, DT, NO_INPUT);

    expect(world.line.strokes).toHaveLength(0);
    expect(world.isDead).toBe(true);
    expect(world.deathCause).toBe('blot');
  });

  it('does nothing once the World is dead (no further mutation)', () => {
    const world = createWorld(1);
    world.line = { strokes: [] };
    world.isDead = true;
    world.deathCause = 'blot';
    const timeBefore = world.timeS;

    stepWorld(world, DT, { lateralDelta: 1, holding: true });

    expect(world.timeS).toBe(timeBefore);
  });

  it('firing eventually kills a Blot placed directly in front of the Line', () => {
    // There's no auto-aim (GAME_DESIGN.md §5/§8.1: the player aims by *positioning the
    // Brush*, e.g. Drifter is explicitly designed to "force you to lead your shots"), so
    // only muzzles whose x lines up with the target's x can ever hit it. With a centred,
    // unmoved Brush and the default 3-Stroke start, the front-row column 2 muzzle sits at
    // x=0 (GAME_DESIGN.md §5's formation arc), lining up with a Blot spawned at x=0 — but
    // only 1 in `rowSize` shots comes from that muzzle, so this needs the Blot to spawn
    // far enough out (like a real wave, GAME_DESIGN.md §9's spawnDistanceU) for enough
    // shots to land before it reaches contact, not on top of the Line as a random 1-in-3
    // race would require.
    const world = createWorld(1);
    spawnBlot(world.blotPool, 'smudge', 0, BALANCE.director.spawnDistanceU);

    let steps = 0;
    while (world.blotPool.activeCount > 0 && steps < 600) {
      stepWorld(world, DT, NO_INPUT);
      steps++;
    }

    expect(world.blotPool.activeCount).toBe(0);
    expect(world.blotKilled).toBeGreaterThanOrEqual(1);
  });

  it('a Slip, once shot down, grows the Line via a recruit', () => {
    // Spawned directly at x=0 (rather than via the Director's verge placement, which
    // sits well outside a centred Brush's reach by design — see the Blot test above)
    // so this exercises the shoot -> recruit -> addStroke pipeline without also
    // requiring simulated lateral input to steer the Brush out to the verge.
    const world = createWorld(7);
    spawnSlip(world.slipPool, 'plusOne', 'hane', 0, 20);

    const startCount = world.line.strokes.length;
    let steps = 0;
    let grew = false;
    while (steps < 3600 && !grew) {
      stepWorld(world, DT, NO_INPUT);
      if (world.line.strokes.length > startCount) grew = true;
      steps++;
    }

    expect(grew).toBe(true);
  });

  it('missed Slips do not leak the pool over a long, unshot Passage (regression)', () => {
    // With the Brush held centred (NO_INPUT), every Director-placed Slip run sits at a
    // verge — well outside any muzzle's reach (see the "no auto-aim" DECISIONS.md entry)
    // — so this Passage never lands a single Slip kill. Before resolveMissedSlips, that
    // meant every spawned Slip sat in the pool forever; slipCapacity (64) would exhaust
    // in well under 100s of Passage time and Slip spawning would silently stop.
    const world = createWorld(99);
    for (let i = 0; i < 6000 && !world.isDead; i++) {
      stepWorld(world, DT, NO_INPUT);
    }
    expect(world.slipPool.activeCount).toBeLessThanOrEqual(BALANCE.slips.plusOne.runMax);
  });

  it('runs 2000 fixed steps without throwing or NaN-ing any core field (smoke test for the harness loop)', () => {
    const world = createWorld(123);
    for (let i = 0; i < 2000 && !world.isDead; i++) {
      stepWorld(world, DT, { lateralDelta: i % 2 === 0 ? 0.02 : -0.02, holding: false });
    }
    expect(Number.isFinite(world.timeS)).toBe(true);
    expect(Number.isFinite(world.distanceU)).toBe(true);
    expect(Number.isFinite(world.brushFollower.position)).toBe(true);
  });
});

describe('computeGoldLeaf', () => {
  it('matches GAME_DESIGN.md §10: blotKilled + floor(distance/8) + sealsBroken*120', () => {
    const e = BALANCE.economy;
    expect(computeGoldLeaf(10, 800, 1)).toBe(
      10 * e.goldLeafPerBlotKilled + Math.floor(800 / e.goldLeafPerDistanceU) + 1 * e.goldLeafPerSealBroken,
    );
  });

  it('floors the distance term rather than rounding', () => {
    expect(computeGoldLeaf(0, 15, 0)).toBe(Math.floor(15 / BALANCE.economy.goldLeafPerDistanceU));
  });
});
