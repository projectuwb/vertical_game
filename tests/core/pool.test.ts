import { describe, expect, it } from 'vitest';
import { Pool, type PoolItem } from '../../src/core/pool.js';

interface Dummy extends PoolItem {
  id: number;
  value: number;
}

function makePool(capacity: number): Pool<Dummy> {
  return new Pool<Dummy>(capacity, (index) => ({ poolIndex: index, id: index, value: 0 }));
}

describe('Pool', () => {
  it('acquires up to capacity, then returns undefined', () => {
    const pool = makePool(4);
    const items = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()];
    expect(items.every((i) => i !== undefined)).toBe(true);
    expect(pool.activeCount).toBe(4);
    expect(pool.acquire()).toBeUndefined();
  });

  it('never allocates a new item after construction, no matter how many acquire/release cycles run', () => {
    let factoryCalls = 0;
    const pool = new Pool<Dummy>(100, (index) => {
      factoryCalls++;
      return { poolIndex: index, id: index, value: 0 };
    });
    expect(factoryCalls).toBe(100);

    for (let cycle = 0; cycle < 600; cycle++) {
      const acquired: Dummy[] = [];
      for (let i = 0; i < 100; i++) {
        const item = pool.acquire();
        if (item !== undefined) acquired.push(item);
      }
      for (const item of acquired) {
        pool.release(item);
      }
    }

    expect(factoryCalls).toBe(100);
    expect(pool.activeCount).toBe(0);
  });

  it('heap growth over 600 acquire/release cycles stays bounded', () => {
    const pool = new Pool<Dummy>(2048, (index) => ({ poolIndex: index, id: index, value: 0 }));
    // Warm up so JIT/inline-cache setup doesn't skew the measurement.
    for (let i = 0; i < 50; i++) {
      const items: Dummy[] = [];
      for (let j = 0; j < 2048; j++) {
        const item = pool.acquire();
        if (item !== undefined) items.push(item);
      }
      for (const item of items) pool.release(item);
    }

    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 600; i++) {
      const items: Dummy[] = [];
      for (let j = 0; j < 2048; j++) {
        const item = pool.acquire();
        if (item !== undefined) {
          item.value = j;
          items.push(item);
        }
      }
      for (const item of items) pool.release(item);
    }
    const after = process.memoryUsage().heapUsed;

    // Generous threshold: this catches an accidental per-cycle allocation (e.g. a
    // stray array literal in acquire/release), not GC scheduling noise.
    expect(after - before).toBeLessThan(20 * 1024 * 1024);
  });

  it('release() makes an item acquirable again and preserves identity', () => {
    const pool = makePool(2);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    pool.release(a!);
    expect(pool.activeCount).toBe(1);
    const c = pool.acquire();
    expect(c).toBe(a);
  });

  it('releaseAll() frees every active item at once', () => {
    const pool = makePool(5);
    for (let i = 0; i < 5; i++) pool.acquire();
    expect(pool.activeCount).toBe(5);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.acquire()).toBeDefined();
  });

  it('forEachActive visits exactly the active items, not released ones', () => {
    const pool = makePool(5);
    const items = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()];
    pool.release(items[1]!);
    pool.release(items[3]!);

    const seen: number[] = [];
    pool.forEachActive((item) => seen.push(item.id));

    expect(seen.sort()).toEqual([0, 2, 4]);
  });

  it('throws on double release', () => {
    const pool = makePool(2);
    const a = pool.acquire();
    pool.release(a!);
    expect(() => pool.release(a!)).toThrow();
  });

  it('get() returns the active item at an index, and rejects out-of-range indices', () => {
    const pool = makePool(3);
    pool.acquire();
    pool.acquire();
    expect(pool.get(0).id).toBe(0);
    expect(pool.get(1).id).toBe(1);
    expect(() => pool.get(2)).toThrow();
    expect(() => pool.get(-1)).toThrow();
  });

  it('get() supports safe backward-iteration-with-release (the projectile-expiry pattern)', () => {
    const pool = makePool(5);
    for (let i = 0; i < 5; i++) pool.acquire();

    const visited: number[] = [];
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const item = pool.get(i);
      visited.push(item.id);
      if (item.id % 2 === 0) pool.release(item);
    }

    expect(visited.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(pool.activeCount).toBe(2);
    const remaining: number[] = [];
    pool.forEachActive((item) => remaining.push(item.id));
    expect(remaining.sort((a, b) => a - b)).toEqual([1, 3]);
  });
});
