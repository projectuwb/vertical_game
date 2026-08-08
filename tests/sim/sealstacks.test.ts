import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import {
  createSealstackPool,
  isBrushInSealstackZone,
  resolveSealstackContact,
  resolveSealstackDeaths,
  spawnSealstack,
  updateSealstackMotion,
} from '../../src/sim/sealstacks.js';

describe('spawnSealstack', () => {
  it('sets hp from BALANCE', () => {
    const pool = createSealstackPool();
    const s = spawnSealstack(pool, 'left', 50);
    expect(s?.hp).toBe(BALANCE.sealstacks.hp);
  });
});

describe('updateSealstackMotion', () => {
  it('shifts z at the world forward speed — no speed stat of its own (like Slips)', () => {
    const pool = createSealstackPool();
    const s = spawnSealstack(pool, 'left', 50);
    if (s === undefined) throw new Error('spawn failed');
    updateSealstackMotion(pool, 1);
    expect(s.z).toBeCloseTo(50 - BALANCE.forwardSpeed.baseUPerS, 9);
  });
});

describe('isBrushInSealstackZone', () => {
  it('left stack blocks negative x, right stack blocks non-negative x', () => {
    expect(isBrushInSealstackZone('left', -1)).toBe(true);
    expect(isBrushInSealstackZone('left', 1)).toBe(false);
    expect(isBrushInSealstackZone('right', 1)).toBe(true);
    expect(isBrushInSealstackZone('right', -1)).toBe(false);
  });
});

describe('resolveSealstackDeaths', () => {
  it('releases stacks shot down to hp <= 0, leaves survivors', () => {
    const pool = createSealstackPool();
    const dead = spawnSealstack(pool, 'left', 10);
    const alive = spawnSealstack(pool, 'right', 10);
    if (dead === undefined || alive === undefined) throw new Error('spawn failed');
    dead.hp = 0;

    resolveSealstackDeaths(pool);

    expect(pool.activeCount).toBe(1);
    let survivorSide = '';
    pool.forEachActive((s) => (survivorSide = s.side));
    expect(survivorSide).toBe('right');
  });
});

describe('resolveSealstackContact', () => {
  it('a surviving stack on the Brush side costs ceil(remainingHP / 12) Strokes', () => {
    const pool = createSealstackPool();
    const s = spawnSealstack(pool, 'left', -1); // already at/past the Brush
    if (s === undefined) throw new Error('spawn failed');
    s.hp = 25;

    const strokesLost = resolveSealstackContact(pool, 0, -2); // Brush on the left (blocked) side
    expect(strokesLost).toBe(Math.ceil(25 / BALANCE.sealstacks.hpToStrokeLossDivisor));
    expect(pool.activeCount).toBe(0);
  });

  it('dodging to the other side costs nothing, and the stack still clears', () => {
    const pool = createSealstackPool();
    const s = spawnSealstack(pool, 'left', -1);
    if (s === undefined) throw new Error('spawn failed');

    const strokesLost = resolveSealstackContact(pool, 0, 2); // Brush on the right — dodged
    expect(strokesLost).toBe(0);
    expect(pool.activeCount).toBe(0);
  });

  it('a stack not yet at the Brush does not resolve', () => {
    const pool = createSealstackPool();
    const s = spawnSealstack(pool, 'left', 10);
    if (s === undefined) throw new Error('spawn failed');

    const strokesLost = resolveSealstackContact(pool, 0, -1);
    expect(strokesLost).toBe(0);
    expect(pool.activeCount).toBe(1);
  });

  it('at contact, every stack past the Brush clears — only the one on the blocked side costs Strokes', () => {
    const pool = createSealstackPool();
    const a = spawnSealstack(pool, 'left', -1);
    const b = spawnSealstack(pool, 'right', -1);
    if (a === undefined || b === undefined) throw new Error('spawn failed');
    a.hp = 12; // ceil(12/12) = 1, and the Brush is on the left (blocked) side below
    b.hp = 13; // on the right — not blocking this Brush position, so no penalty

    const strokesLost = resolveSealstackContact(pool, 0, -1);
    expect(strokesLost).toBe(1);
    expect(pool.activeCount).toBe(0); // both cleared: one paid for, one dodged
  });

  it('sums correctly when two stacks on the same side both contact in one step', () => {
    const pool = createSealstackPool();
    const a = spawnSealstack(pool, 'left', -1);
    const b = spawnSealstack(pool, 'left', -2);
    if (a === undefined || b === undefined) throw new Error('spawn failed');
    a.hp = 12; // ceil(12/12) = 1
    b.hp = 13; // ceil(13/12) = 2

    const strokesLost = resolveSealstackContact(pool, 0, -1);
    expect(strokesLost).toBe(3);
    expect(pool.activeCount).toBe(0);
  });
});
