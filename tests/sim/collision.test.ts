import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { createBlotPool, spawnBlot } from '../../src/sim/blot.js';
import { createProjectilePool } from '../../src/sim/projectiles.js';
import { resolveProjectileBlotCollisions } from '../../src/sim/collision.js';

function spawnProjectileAt(
  pool: ReturnType<typeof createProjectilePool>,
  cls: 'hane' | 'tome' | 'harai',
  x: number,
  z: number,
  damage: number,
) {
  const p = pool.acquire();
  if (p === undefined) throw new Error('projectile pool exhausted');
  p.class = cls;
  p.x = x;
  p.z = z;
  p.damage = damage;
  p.pierceRemaining = cls === 'harai' ? BALANCE.strokes.harai.pierceCount : 1;
  p.splashRadiusU = cls === 'tome' ? BALANCE.strokes.tome.splashRadiusU : 0;
  p.distanceTraveledU = 0;
  p.maxRangeU = BALANCE.strokes[cls].rangeU;
  return p;
}

describe('resolveProjectileBlotCollisions', () => {
  it('a projectile within the hit radius damages the Blot and is consumed (Hane/Tome, single target)', () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    spawnProjectileAt(projectiles, 'hane', 0, 0, 5);
    const target = spawnBlot(blots, 'smudge', 0, 0);
    if (target === undefined) throw new Error('spawn failed');

    resolveProjectileBlotCollisions(projectiles, blots);

    expect(target.hp).toBeCloseTo(BALANCE.blot.smudge.hp - 5, 9);
    expect(projectiles.activeCount).toBe(0);
  });

  it('a projectile outside the hit radius misses entirely', () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    spawnProjectileAt(projectiles, 'hane', 0, 0, 5);
    const target = spawnBlot(blots, 'smudge', 0, BALANCE.collision.hitRadiusU * 5);
    if (target === undefined) throw new Error('spawn failed');

    resolveProjectileBlotCollisions(projectiles, blots);

    expect(target.hp).toBe(BALANCE.blot.smudge.hp);
    expect(projectiles.activeCount).toBe(1);
  });

  it('applies the §4 armour multiplier against Crust', () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    spawnProjectileAt(projectiles, 'hane', 0, 0, 10);
    const crust = spawnBlot(blots, 'crust', 0, 0);
    if (crust === undefined) throw new Error('spawn failed');

    resolveProjectileBlotCollisions(projectiles, blots);

    expect(crust.hp).toBeCloseTo(BALANCE.blot.crust.hp - 10 * BALANCE.strokes.hane.vsCrust, 9);
  });

  it('Harai survives its first hit (pierce) and is destroyed on the second', () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    const proj = spawnProjectileAt(projectiles, 'harai', 0, 0, 3);
    const first = spawnBlot(blots, 'smudge', 0, 0);
    if (first === undefined) throw new Error('spawn failed');

    resolveProjectileBlotCollisions(projectiles, blots);
    expect(projectiles.activeCount).toBe(1); // still flying
    expect(proj.pierceRemaining).toBe(BALANCE.strokes.harai.pierceCount - 1);
    expect(first.hp).toBeCloseTo(BALANCE.blot.smudge.hp - 3, 9);

    // Move a second target into the same spot for the projectile's next hit.
    first.hp = -100; // remove it from consideration as if it died and was cleaned up
    const second = spawnBlot(blots, 'smudge', 0, 0);
    if (second === undefined) throw new Error('spawn failed');

    resolveProjectileBlotCollisions(projectiles, blots);
    expect(projectiles.activeCount).toBe(0); // pierce budget exhausted
    expect(second.hp).toBeCloseTo(BALANCE.blot.smudge.hp - 3, 9);
  });

  it("Tome's splash damages every other Blot within splashRadiusU of the primary hit", () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    spawnProjectileAt(projectiles, 'tome', 0, 0, 9);
    const primary = spawnBlot(blots, 'smudge', 0, 0);
    const inSplash = spawnBlot(blots, 'smudge', BALANCE.strokes.tome.splashRadiusU * 0.5, 0);
    const outsideSplash = spawnBlot(blots, 'smudge', BALANCE.strokes.tome.splashRadiusU * 5, 0);
    if (primary === undefined || inSplash === undefined || outsideSplash === undefined) {
      throw new Error('spawn failed');
    }

    resolveProjectileBlotCollisions(projectiles, blots);

    expect(primary.hp).toBeLessThan(BALANCE.blot.smudge.hp);
    expect(inSplash.hp).toBeLessThan(BALANCE.blot.smudge.hp);
    expect(outsideSplash.hp).toBe(BALANCE.blot.smudge.hp);
  });

  it('a projectile only hits one Blot per step even when several are in range', () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    spawnProjectileAt(projectiles, 'hane', 0, 0, 5); // Hane has no splash
    spawnBlot(blots, 'smudge', 0, 0);
    spawnBlot(blots, 'smudge', 0.01, 0);

    resolveProjectileBlotCollisions(projectiles, blots);

    let damagedCount = 0;
    blots.forEachActive((b) => {
      if (b.hp < BALANCE.blot.smudge.hp) damagedCount++;
    });
    expect(damagedCount).toBe(1);
  });

  it('does not hit a Blot that is already at hp <= 0 awaiting cleanup', () => {
    const projectiles = createProjectilePool();
    const blots = createBlotPool();
    spawnProjectileAt(projectiles, 'hane', 0, 0, 5);
    const dead = spawnBlot(blots, 'smudge', 0, 0);
    if (dead === undefined) throw new Error('spawn failed');
    dead.hp = 0;

    resolveProjectileBlotCollisions(projectiles, blots);

    expect(dead.hp).toBe(0); // untouched, not driven further negative
    expect(projectiles.activeCount).toBe(1); // never "hit" anything
  });
});
