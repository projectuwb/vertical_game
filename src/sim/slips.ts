// Slips — recruitment (GAME_DESIGN.md §7.1, Task 2.5).

import { Pool, type PoolItem } from '../core/pool.js';
import type { RngRegistry } from '../core/rng.js';
import { BALANCE } from './config.js';
import type { StrokeClass } from './stroke.js';

export type SlipKind = 'plusOne' | 'plusFive' | 'plusTwentyFive';

const ALL_CLASSES: readonly StrokeClass[] = ['hane', 'tome', 'harai'];

export interface Slip extends PoolItem {
  kind: SlipKind;
  class: StrokeClass;
  x: number;
  z: number;
  hp: number;
}

export function createSlipPool(): Pool<Slip> {
  return new Pool<Slip>(BALANCE.pools.slipCapacity, (index) => ({
    poolIndex: index,
    kind: 'plusOne',
    class: 'hane',
    x: 0,
    z: 0,
    hp: 0,
  }));
}

export function spawnSlip(
  pool: Pool<Slip>,
  kind: SlipKind,
  cls: StrokeClass,
  x: number,
  z: number,
): Slip | undefined {
  const slip = pool.acquire();
  if (slip === undefined) return undefined; // pool exhausted — a perf ceiling, not a gameplay bug
  slip.kind = kind;
  slip.class = cls;
  slip.x = x;
  slip.z = z;
  slip.hp = BALANCE.slips[kind].hp;
  return slip;
}

export function recruitCountFor(kind: SlipKind): number {
  return BALANCE.slips[kind].recruitCount;
}

/**
 * Slips are staked road furniture, not autonomous walkers like Blot — they have no
 * speed stat of their own in GAME_DESIGN.md. What makes them approach the Brush is the
 * same thing that makes the road markings scroll: the world moves at forwardSpeed while
 * the Brush's z stays fixed at 0 (main.ts's BRUSH_Z), so every static entity's z must
 * shift by -forwardSpeed*dt each step to stay visually consistent with the road itself.
 */
export function updateSlipMotion(pool: Pool<Slip>, dt: number): void {
  const step = BALANCE.forwardSpeed.baseUPerS * dt;
  pool.forEachActive((s) => {
    s.z -= step;
  });
}

/** GAME_DESIGN.md §7.3: the +25 Banner "spans a third of the lane" — its hit area
 *  scales with that width; +1/+5 Slips use the same point-ish radius as everything
 *  else (BALANCE.collision.hitRadiusU). */
export function slipHitRadiusU(kind: SlipKind): number {
  if (kind === 'plusTwentyFive') {
    return (BALANCE.lane.width * BALANCE.slips.plusTwentyFive.laneSpanFraction) / 2;
  }
  return BALANCE.collision.hitRadiusU;
}

/**
 * The class currently least represented in the Line is `leastHeldWeightMultiplier`
 * times more likely to appear next (GAME_DESIGN.md §7.1) — keeps offering the choice
 * the player has been declining. Ties break toward hane > tome > harai, arbitrarily but
 * deterministically.
 */
export function computeClassWeights(
  strokeCountsByClass: Record<StrokeClass, number>,
): Record<StrokeClass, number> {
  let leastClass: StrokeClass = ALL_CLASSES[0] as StrokeClass;
  let leastCount = Infinity;
  for (const cls of ALL_CLASSES) {
    if (strokeCountsByClass[cls] < leastCount) {
      leastCount = strokeCountsByClass[cls];
      leastClass = cls;
    }
  }
  const weights: Record<StrokeClass, number> = { hane: 1, tome: 1, harai: 1 };
  weights[leastClass] = BALANCE.slips.leastHeldWeightMultiplier;
  return weights;
}

/** Draws from the `slips` RNG concern (TECH_SPEC.md §4) so this roll never perturbs any
 *  other system's sequence, and a recorded input tape reproduces identically on replay. */
export function pickSlipClass(
  strokeCountsByClass: Record<StrokeClass, number>,
  rng: RngRegistry,
): StrokeClass {
  const weights = computeClassWeights(strokeCountsByClass);
  const total = weights.hane + weights.tome + weights.harai;
  let roll = rng.next('slips') * total;
  for (const cls of ALL_CLASSES) {
    roll -= weights[cls];
    if (roll <= 0) return cls;
  }
  return ALL_CLASSES[ALL_CLASSES.length - 1] as StrokeClass; // float rounding fallback
}

// --- Joining recruits: the runner-joins-the-back animation ---

export interface JoiningRecruit extends PoolItem {
  class: StrokeClass;
  x: number;
  z: number;
  startX: number;
  startZ: number;
  targetX: number;
  targetZ: number;
  elapsedS: number;
}

export function createJoiningRecruitPool(): Pool<JoiningRecruit> {
  return new Pool<JoiningRecruit>(BALANCE.pools.joiningRecruitCapacity, (index) => ({
    poolIndex: index,
    class: 'hane',
    x: 0,
    z: 0,
    startX: 0,
    startZ: 0,
    targetX: 0,
    targetZ: 0,
    elapsedS: 0,
  }));
}

function spawnJoiningRecruit(
  pool: Pool<JoiningRecruit>,
  cls: StrokeClass,
  x: number,
  z: number,
  targetX: number,
  targetZ: number,
): void {
  const r = pool.acquire();
  if (r === undefined) return; // pool exhausted — a perf ceiling, not a gameplay bug
  r.class = cls;
  r.x = x;
  r.z = z;
  r.startX = x;
  r.startZ = z;
  r.targetX = targetX;
  r.targetZ = targetZ;
  r.elapsedS = 0;
}

/**
 * Releases every Slip at hp <= 0 and spawns its recruits as in-flight JoiningRecruits
 * at the Slip's death position, heading for `lineBackTarget` (the world position the
 * next Stroke would occupy — computed by the caller via line.ts's
 * computeFormationSlot(line.strokes.length), since that's an ordinary formation-slot
 * query and doesn't need duplicating here).
 */
export function resolveSlipDeaths(
  slipPool: Pool<Slip>,
  joiningPool: Pool<JoiningRecruit>,
  lineBackTarget: { readonly x: number; readonly z: number },
): void {
  for (let i = slipPool.activeCount - 1; i >= 0; i--) {
    const s = slipPool.get(i);
    if (s.hp > 0) continue;

    const count = recruitCountFor(s.kind);
    const x = s.x;
    const z = s.z;
    const cls = s.class;
    slipPool.release(s);

    for (let n = 0; n < count; n++) {
      spawnJoiningRecruit(joiningPool, cls, x, z, lineBackTarget.x, lineBackTarget.z);
    }
  }
}

/**
 * Moves every in-flight recruit toward its target and releases those that arrive,
 * returning their classes so the caller can addStroke() them onto the real Line. A
 * plain array is fine here — unlike projectiles/Blot this isn't a per-frame-hundreds
 * hot path (a Slip run is at most ~25 recruits arriving over a fraction of a second).
 */
export function updateJoiningRecruits(pool: Pool<JoiningRecruit>, dt: number): StrokeClass[] {
  const arrived: StrokeClass[] = [];
  const duration = BALANCE.slips.recruitTravelDurationS;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const r = pool.get(i);
    r.elapsedS += dt;
    const t = Math.min(1, r.elapsedS / duration);
    r.x = r.startX + (r.targetX - r.startX) * t;
    r.z = r.startZ + (r.targetZ - r.startZ) * t;
    if (t >= 1) {
      arrived.push(r.class);
      pool.release(r);
    }
  }
  return arrived;
}
