// Typed object pools (TECH_SPEC.md §5). Every entity kind that can appear in numbers
// (projectiles, blot, strokes, particles, floating numbers) is pre-allocated once at
// startup and recycled forever after — acquire()/release() never call `new` and never
// grow an array, so the simulation and render hot paths stay allocation-free.

/** Pooled items carry their own slot index so release() is O(1) with no lookup structure. */
export interface PoolItem {
  poolIndex: number;
}

export class Pool<T extends PoolItem> {
  private readonly items: T[];
  private active = 0;

  constructor(capacity: number, factory: (index: number) => T) {
    this.items = new Array<T>(capacity);
    for (let i = 0; i < capacity; i++) {
      const item = factory(i);
      item.poolIndex = i;
      this.items[i] = item;
    }
  }

  get capacity(): number {
    return this.items.length;
  }

  get activeCount(): number {
    return this.active;
  }

  /** Returns a recycled item, or `undefined` if the pool is exhausted. Never allocates. */
  acquire(): T | undefined {
    if (this.active >= this.items.length) {
      return undefined;
    }
    // Pool internals are the one place non-null assertions are allowed (TECH_SPEC.md §13):
    // every slot [0, capacity) was filled by the factory in the constructor.
    const item = this.items[this.active]!;
    this.active++;
    return item;
  }

  /** Returns an item to the pool. Throws if it isn't currently active (double release, or foreign item). */
  release(item: T): void {
    const idx = item.poolIndex;
    const lastActive = this.active - 1;
    if (idx < 0 || idx > lastActive || this.items[idx] !== item) {
      throw new Error('Pool.release: item is not currently active in this pool');
    }
    // Swap-remove: move the boundary item into the released slot, and park the
    // released item at the new boundary. Pure index bookkeeping, no allocation.
    const boundaryItem = this.items[lastActive]!;
    this.items[idx] = boundaryItem;
    boundaryItem.poolIndex = idx;
    this.items[lastActive] = item;
    item.poolIndex = lastActive;
    this.active--;
  }

  /** Releases every active item at once (e.g. clearing between Passages). */
  releaseAll(): void {
    this.active = 0;
  }

  /**
   * Direct access to the active item at `index` (0 = front of the active set). For
   * backward-iteration-with-release patterns, where forEachActive's guarantee that the
   * active set doesn't change mid-iteration isn't what you want (e.g. despawning
   * projectiles past their range every step) — release()'s swap-remove is safe to call
   * mid-loop only when iterating from `activeCount - 1` down to `0`.
   */
  get(index: number): T {
    if (index < 0 || index >= this.active) {
      throw new Error('Pool.get: index out of range for the active set');
    }
    return this.items[index]!;
  }

  /** Iterates active items only, front-to-back. Plain indexed loop — no allocation. */
  forEachActive(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.active; i++) {
      fn(this.items[i]!, i);
    }
  }
}
