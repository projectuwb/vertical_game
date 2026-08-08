// Collision resolution: projectile ↔ Blot/Slip hit detection and damage application
// (GAME_DESIGN.md §4/§7/§8, Task 2.3/2.4/2.5).

import type { Pool } from '../core/pool.js';
import { BALANCE } from './config.js';
import { applyArmorMultiplier, registerHit, type Projectile } from './projectiles.js';
import type { Blot, BlotClass } from './blot.js';
import { slipHitRadiusU, type Slip } from './slips.js';

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
