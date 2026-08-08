// Blot unit types + behaviour (GAME_DESIGN.md §8.1, Task 2.4). Like projectiles.ts, this
// mutates a Pool<Blot> in place by design — up to 900 active units is squarely the
// per-frame hot path Pool<T> exists for.

import { Pool, type PoolItem } from '../core/pool.js';
import { BALANCE } from './config.js';

export type BlotClass = 'smudge' | 'runner' | 'crust' | 'splitter' | 'blotter' | 'drifter';

export const BLOT_CLASSES: readonly BlotClass[] = [
  'smudge',
  'runner',
  'crust',
  'splitter',
  'blotter',
  'drifter',
];

export interface Blot extends PoolItem {
  class: BlotClass;
  x: number;
  z: number;
  hp: number;
  /** Drifter only: current lateral heading. */
  strafeDirection: 1 | -1;
  /** Blotter only: seconds since its last ink lob. */
  lobTimer: number;
  /** Blotter only: true once it has reached its stop distance and holds position. */
  stopped: boolean;
  /** Tome Phrase's Press staggers on hit (GAME_DESIGN.md §4/§5) — a sim-time deadline
   *  rather than a countdown, so it composes with pause/catch-up the same way every
   *  other timestamp field in /sim does. 0 = never staggered. */
  staggeredUntilS: number;
}

export function createBlotPool(): Pool<Blot> {
  return new Pool<Blot>(BALANCE.pools.blotCapacity, (index) => ({
    poolIndex: index,
    class: 'smudge',
    x: 0,
    z: 0,
    hp: 0,
    strafeDirection: 1,
    lobTimer: 0,
    stopped: false,
    staggeredUntilS: 0,
  }));
}

export function spawnBlot(pool: Pool<Blot>, cls: BlotClass, x: number, z: number): Blot | undefined {
  const blot = pool.acquire();
  if (blot === undefined) return undefined; // pool exhausted — a perf ceiling, not a gameplay bug
  const stats = BALANCE.blot[cls];
  blot.class = cls;
  blot.x = x;
  blot.z = z;
  blot.hp = stats.hp;
  blot.strafeDirection = 1;
  blot.lobTimer = 0;
  blot.stopped = false;
  blot.staggeredUntilS = 0;
  return blot;
}

export function isBlotStaggered(b: Blot, timeS: number): boolean {
  return b.staggeredUntilS > timeS;
}

const LANE_HALF_WIDTH = BALANCE.lane.halfWidth;

/**
 * Marches every active Blot toward the Brush (decreasing z). Drifter also strafes
 * laterally, bouncing off the lane edges; Blotter holds at its stop distance and lobs
 * ink on a timer instead of closing the rest of the way in (GAME_DESIGN.md §8.1). A
 * staggered Blot (Tome Phrase's Press) skips its whole turn — no march, no strafe, no
 * lob-timer progress — until `staggeredUntilS` passes. Returns how many ink lobs landed
 * this step — each costs the Line 1 Stroke, distinct from Line-contact loss
 * (resolveLineContact below). `timeS` defaults to 0 so call sites that never stagger
 * anything (most tests) don't need to pass it.
 */
export function updateBlotMotion(pool: Pool<Blot>, dt: number, brushZ: number, timeS = 0): number {
  let lobsLanded = 0;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const b = pool.get(i);
    if (isBlotStaggered(b, timeS)) continue;

    if (b.class === 'blotter') {
      const distanceToBrush = b.z - brushZ;
      if (distanceToBrush > BALANCE.blot.blotter.stopDistanceU) {
        b.z -= BALANCE.blot.blotter.speedUPerS * dt;
      } else {
        b.stopped = true;
        b.lobTimer += dt;
        if (b.lobTimer >= BALANCE.blot.blotter.lobIntervalS) {
          b.lobTimer -= BALANCE.blot.blotter.lobIntervalS;
          lobsLanded++;
        }
      }
      continue;
    }

    b.z -= BALANCE.blot[b.class].speedUPerS * dt;

    if (b.class === 'drifter') {
      b.x += b.strafeDirection * BALANCE.blot.drifter.strafeUPerS * dt;
      if (b.x > LANE_HALF_WIDTH) {
        b.x = LANE_HALF_WIDTH;
        b.strafeDirection = -1;
      } else if (b.x < -LANE_HALF_WIDTH) {
        b.x = -LANE_HALF_WIDTH;
        b.strafeDirection = 1;
      }
    }
  }
  return lobsLanded;
}

export interface LineContactResult {
  readonly strokesLost: number;
  /** Did a Crust land its contact this step? Task 4.6's "Deaths from Crust" §11 target
   *  reads this on whichever step actually empties the Line, via world.ts's
   *  `killLineIfEmpty`. */
  readonly crustInvolved: boolean;
}

/**
 * Any Blot reaching the front of the Line kills 1 Stroke and dies — Crust kills 3
 * (GAME_DESIGN.md §5). Releases every Blot that made contact and returns the total
 * Strokes lost this step.
 */
export function resolveLineContact(pool: Pool<Blot>, brushZ: number): LineContactResult {
  let strokesLost = 0;
  let crustInvolved = false;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const b = pool.get(i);
    if (b.z <= brushZ) {
      if (b.class === 'crust') {
        strokesLost += BALANCE.blot.crust.contactStrokeLoss;
        crustInvolved = true;
      } else {
        strokesLost += BALANCE.line.normalContactStrokeLoss;
      }
      pool.release(b);
    }
  }
  return { strokesLost, crustInvolved };
}

/**
 * Releases every Blot at hp <= 0. Splitter spawns 3 Smudges spread across ±1u
 * (GAME_DESIGN.md §8.1) at its death position. Newly spawned Smudges always land at
 * pool indices ≥ the current scan position, so calling this mid-backward-iteration
 * (as collision.ts does) never revisits or skips an item — see the Pool.get() doc
 * comment in core/pool.ts for the general argument.
 *
 * Returns how many Blot actually died this step (not counting Splitter's spawned
 * children) — the economy (Gold Leaf per kill, GAME_DESIGN.md §10) needs that count.
 */
export function resolveBlotDeaths(pool: Pool<Blot>): number {
  let killedCount = 0;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const b = pool.get(i);
    if (b.hp > 0) continue;

    killedCount++;
    const wasSplitter = b.class === 'splitter';
    const deathX = b.x;
    const deathZ = b.z;
    pool.release(b);

    if (wasSplitter) {
      const offset = BALANCE.blot.splitter.spawnOffsetU;
      spawnBlot(pool, 'smudge', deathX - offset, deathZ);
      spawnBlot(pool, 'smudge', deathX, deathZ);
      spawnBlot(pool, 'smudge', deathX + offset, deathZ);
    }
  }
  return killedCount;
}

export type BlotRenderTier = 'individual' | 'mass';

/** TECH_SPEC.md §5: above `massThresholdCount` active Blot, only those within
 *  `massRenderDistanceU` of the Brush get full individual detail. */
export function classifyBlotForRender(activeCount: number, distanceFromBrushU: number): BlotRenderTier {
  if (activeCount <= BALANCE.blotRender.massThresholdCount) return 'individual';
  return distanceFromBrushU <= BALANCE.blotRender.massRenderDistanceU ? 'individual' : 'mass';
}
