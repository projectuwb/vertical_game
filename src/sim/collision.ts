// Collision resolution: projectile ↔ Blot/Slip/Sealstack hit detection and damage
// application (GAME_DESIGN.md §4/§7/§8, Task 2.3/2.4/2.5/2.6).

import type { Pool } from '../core/pool.js';
import { BALANCE } from './config.js';
import { applyArmorMultiplier, registerHit, type Projectile } from './projectiles.js';
import type { Blot, BlotClass } from './blot.js';
import { slipHitRadiusU, type Slip } from './slips.js';
import { isBrushInSealstackZone, type Sealstack } from './sealstacks.js';
import { applySealDamage, type SealEncounterState } from './seals/framework.js';

function damageTargetKind(cls: BlotClass): 'crust' | 'normal' {
  return cls === 'crust' ? 'crust' : 'normal';
}

function applyDamage(blot: Blot, proj: Projectile): void {
  blot.hp -= applyArmorMultiplier(proj.class, proj.damage, damageTargetKind(blot.class));
}

/**
 * Hit-tests every active projectile against every active Blot (a plain O(n·m) scan —
 * at realistic concurrent counts, tens of projectiles against hundreds of Blot, this is
 * trivial at 60fps). A projectile hits at most one Blot per step; Harai's pierce and
 * Tome's splash both apply on that single hit. HP resolution (death, Splitter's split)
 * is a separate pass (blot.ts's resolveBlotDeaths), so this module only ever *reduces*
 * hp, never releases a Blot mid-scan.
 */
export function resolveProjectileBlotCollisions(
  projectilePool: Pool<Projectile>,
  blotPool: Pool<Blot>,
): void {
  const hitRadiusSq = BALANCE.collision.hitRadiusU * BALANCE.collision.hitRadiusU;

  for (let pi = projectilePool.activeCount - 1; pi >= 0; pi--) {
    const proj = projectilePool.get(pi);
    let hitBlot: Blot | undefined;

    for (let bi = blotPool.activeCount - 1; bi >= 0; bi--) {
      const blot = blotPool.get(bi);
      if (blot.hp <= 0) continue; // already dead this step, awaiting resolveBlotDeaths
      const dx = proj.x - blot.x;
      const dz = proj.z - blot.z;
      if (dx * dx + dz * dz <= hitRadiusSq) {
        hitBlot = blot;
        break;
      }
    }

    if (hitBlot === undefined) continue;

    applyDamage(hitBlot, proj);

    if (proj.splashRadiusU > 0) {
      applySplash(blotPool, proj, hitBlot);
    }

    if (registerHit(proj)) {
      projectilePool.release(proj);
    }
  }
}

/** Tome's splash: every other Blot within splashRadiusU of the primary hit also takes full damage. */
function applySplash(blotPool: Pool<Blot>, proj: Projectile, primary: Blot): void {
  const splashSq = proj.splashRadiusU * proj.splashRadiusU;
  for (let bi = blotPool.activeCount - 1; bi >= 0; bi--) {
    const blot = blotPool.get(bi);
    if (blot === primary || blot.hp <= 0) continue;
    const dx = proj.x - blot.x;
    const dz = proj.z - blot.z;
    if (dx * dx + dz * dz <= splashSq) {
      applyDamage(blot, proj);
    }
  }
}

/**
 * Hit-tests every active projectile against every active Slip (GAME_DESIGN.md §4's
 * vsSlips multiplier, §7.1's recruitment). Deliberately no splash here even for Tome —
 * splash is specified in the context of Blot combat, and letting one shot mow down an
 * entire Slip run would undercut §7.1's "shooting is the commitment" framing. A
 * projectile that hits a Slip is otherwise resolved exactly like hitting a Blot: pierce
 * still applies, the projectile is still consumed per registerHit().
 */
export function resolveProjectileSlipCollisions(
  projectilePool: Pool<Projectile>,
  slipPool: Pool<Slip>,
): void {
  for (let pi = projectilePool.activeCount - 1; pi >= 0; pi--) {
    const proj = projectilePool.get(pi);
    let hitSlip: Slip | undefined;

    for (let si = slipPool.activeCount - 1; si >= 0; si--) {
      const slip = slipPool.get(si);
      if (slip.hp <= 0) continue; // already dead this step, awaiting resolveSlipDeaths
      const radius = slipHitRadiusU(slip.kind);
      const dx = proj.x - slip.x;
      const dz = proj.z - slip.z;
      if (dx * dx + dz * dz <= radius * radius) {
        hitSlip = slip;
        break;
      }
    }

    if (hitSlip === undefined) continue;

    hitSlip.hp -= applyArmorMultiplier(proj.class, proj.damage, 'slip');

    if (registerHit(proj)) {
      projectilePool.release(proj);
    }
  }
}

/**
 * Hit-tests every active projectile against every active Sealstack. Sealstacks are wide
 * (they block a full lane-half, GAME_DESIGN.md §7.3) rather than point-like, so the hit
 * test is "is the projectile on the blocked side, within the stack's z-thickness" —
 * the same lane-half predicate `resolveSealstackContact` uses for the Brush, not a
 * circle-vs-circle check. No armour multiplier distinction: Sealstacks aren't a Blot
 * class, so damage applies as if against a 'normal' target.
 */
export function resolveProjectileSealstackCollisions(
  projectilePool: Pool<Projectile>,
  sealstackPool: Pool<Sealstack>,
): void {
  for (let pi = projectilePool.activeCount - 1; pi >= 0; pi--) {
    const proj = projectilePool.get(pi);
    let hitStack: Sealstack | undefined;

    for (let si = sealstackPool.activeCount - 1; si >= 0; si--) {
      const stack = sealstackPool.get(si);
      if (stack.hp <= 0) continue; // already dead this step, awaiting resolveSealstackDeaths
      const withinDepth = Math.abs(proj.z - stack.z) <= BALANCE.sealstacks.thicknessU;
      if (withinDepth && isBrushInSealstackZone(stack.side, proj.x)) {
        hitStack = stack;
        break;
      }
    }

    if (hitStack === undefined) continue;

    hitStack.hp -= applyArmorMultiplier(proj.class, proj.damage, 'normal');

    if (registerHit(proj)) {
      projectilePool.release(proj);
    }
  }
}

/**
 * Hit-tests every active projectile against a fighting Seal's fixed position (a single
 * circle, not a pool — there's at most one Seal encounter at a time). No armour
 * multiplier, same reasoning as Sealstacks/Flourish/Phrases: a Seal isn't a Blot class.
 * Returns the (possibly-staggered-or-broken) updated encounter state; world.ts assigns
 * it back onto `World.seal` since SealEncounterState is immutable, unlike every other
 * pooled entity this module resolves against.
 */
export function resolveProjectileSealCollisions(
  projectilePool: Pool<Projectile>,
  seal: SealEncounterState,
  sealX: number,
  sealZ: number,
): SealEncounterState {
  if (seal.status !== 'fighting') return seal;

  const hitRadiusSq = BALANCE.seals.hitRadiusU * BALANCE.seals.hitRadiusU;
  let current = seal;

  for (let pi = projectilePool.activeCount - 1; pi >= 0; pi--) {
    const proj = projectilePool.get(pi);
    const dx = proj.x - sealX;
    const dz = proj.z - sealZ;
    if (dx * dx + dz * dz > hitRadiusSq) continue;

    current = applySealDamage(current, proj.damage);
    if (registerHit(proj)) {
      projectilePool.release(proj);
    }
    if (current.status === 'broken') break; // no point testing further hits once it's dead
  }

  return current;
}
