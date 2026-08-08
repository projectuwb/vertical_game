// Sealstacks (GAME_DESIGN.md §7.3, Task 2.6). Like Blot/Slip, mutates a Pool<Sealstack>
// in place — small pool, but the same acquire/release discipline throughout /sim.

import { Pool, type PoolItem } from '../core/pool.js';
import { BALANCE } from './config.js';

/** Which half of the lane the stack blocks — "they occupy one half of the lane, so
 *  they double as a forced lateral commitment" (GAME_DESIGN.md §7.3). */
export type SealstackSide = 'left' | 'right';

export interface Sealstack extends PoolItem {
  side: SealstackSide;
  z: number;
  hp: number;
}

export function createSealstackPool(): Pool<Sealstack> {
  return new Pool<Sealstack>(BALANCE.pools.sealstackCapacity, (index) => ({
    poolIndex: index,
    side: 'left',
    z: 0,
    hp: 0,
  }));
}

export function spawnSealstack(pool: Pool<Sealstack>, side: SealstackSide, z: number): Sealstack | undefined {
  const s = pool.acquire();
  if (s === undefined) return undefined; // pool exhausted — a perf ceiling, not a gameplay bug
  s.side = side;
  s.z = z;
  s.hp = BALANCE.sealstacks.hp;
  return s;
}

/** Static road furniture, like Slips (see slips.ts's updateSlipMotion) — no speed stat
 *  of its own, approaches at the world's scroll rate since the Brush's own z is fixed. */
export function updateSealstackMotion(pool: Pool<Sealstack>, dt: number): void {
  const step = BALANCE.forwardSpeed.baseUPerS * dt;
  pool.forEachActive((s) => {
    s.z -= step;
  });
}

export function isBrushInSealstackZone(side: SealstackSide, brushX: number): boolean {
  return side === 'left' ? brushX < 0 : brushX >= 0;
}

/** Releases every Sealstack shot down to hp <= 0 — successfully cleared, no penalty. */
export function resolveSealstackDeaths(pool: Pool<Sealstack>): void {
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.get(i);
    if (s.hp <= 0) pool.release(s);
  }
}

/**
 * A surviving Sealstack that reaches the Brush costs `ceil(remainingHP / 12)` Strokes
 * if the Brush is on its blocked side — GAME_DESIGN.md §7.3. Dodging to the other half
 * costs nothing; the stack is simply passed. Returns total Strokes lost this step.
 */
export function resolveSealstackContact(pool: Pool<Sealstack>, brushZ: number, brushX: number): number {
  let strokesLost = 0;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.get(i);
    if (s.z <= brushZ) {
      if (isBrushInSealstackZone(s.side, brushX)) {
        strokesLost += Math.ceil(s.hp / BALANCE.sealstacks.hpToStrokeLossDivisor);
      }
      pool.release(s);
    }
  }
  return strokesLost;
}
