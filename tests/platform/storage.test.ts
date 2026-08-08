import { describe, expect, it } from 'vitest';
import { createInMemoryStorage, createStorage } from '../../src/platform/storage.js';

/** A minimal `Storage`-shaped double whose every method throws — the exact "private-mode
 *  Safari" failure mode TECH_SPEC.md §3 calls out. No jsdom dependency (TECH_SPEC.md
 *  §2's dev-dependency list), just enough surface for storage.ts's own usage. */
class AlwaysThrowingStorage {
  get length(): number {
    throw new Error('storage disabled');
  }
  getItem(): never {
    throw new Error('storage disabled');
  }
  setItem(): never {
    throw new Error('storage disabled');
  }
  removeItem(): never {
    throw new Error('storage disabled');
  }
  clear(): never {
    throw new Error('storage disabled');
  }
  key(): never {
    throw new Error('storage disabled');
  }
}

/** A working `Storage`-shaped double backed by a plain Map, for the "real localStorage
 *  works fine" path. */
class FakeWorkingStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

describe('createInMemoryStorage', () => {
  it('round-trips a value and reports non-persistent', () => {
    const storage = createInMemoryStorage();
    expect(storage.isPersistent).toBe(false);
    expect(storage.read('k')).toBeNull();
    expect(storage.write('k', 'v')).toBe(true);
    expect(storage.read('k')).toBe('v');
    expect(storage.remove('k')).toBe(true);
    expect(storage.read('k')).toBeNull();
  });
});

describe('createStorage', () => {
  it('uses the real localStorage-shaped backend when it actually works', () => {
    const fakeWin = { localStorage: new FakeWorkingStorage() as unknown as globalThis.Storage };
    const storage = createStorage(fakeWin);
    expect(storage.isPersistent).toBe(true);
    expect(storage.write('k', 'v')).toBe(true);
    expect(storage.read('k')).toBe('v');
  });

  it('falls back to an in-memory store when even the probe write throws (private-mode Safari)', () => {
    const fakeWin = { localStorage: new AlwaysThrowingStorage() as unknown as globalThis.Storage };
    expect(() => createStorage(fakeWin)).not.toThrow();
    const storage = createStorage(fakeWin);
    expect(storage.isPersistent).toBe(false);
  });

  it('the game runs correctly with storage throwing on every call: read/write/remove never throw and degrade gracefully', () => {
    const fakeWin = { localStorage: new AlwaysThrowingStorage() as unknown as globalThis.Storage };
    const storage = createStorage(fakeWin);

    expect(() => storage.read('inkfall.profile.v1')).not.toThrow();
    expect(storage.read('inkfall.profile.v1')).toBeNull();
    expect(() => storage.write('inkfall.profile.v1', '{}')).not.toThrow();
    // The fallback is in-memory (createStorage already detected the throw at probe
    // time), so writes here actually succeed against the fallback, not the throwing
    // backend — this is what "runs correctly," not "every write silently fails," means.
    expect(storage.write('inkfall.profile.v1', '{}')).toBe(true);
    expect(() => storage.remove('inkfall.profile.v1')).not.toThrow();
  });

  it('individual method throws after a successful probe still degrade to false/null, never throw', () => {
    // A backend that passes the initial probe but throws on a *later* call (e.g. quota
    // exceeded mid-session) — BrowserLocalStorage wraps every method independently, not
    // just the constructor probe, so this must still degrade gracefully rather than
    // crash the caller.
    let shouldThrow = false;
    const flaky = {
      getItem(key: string): string | null {
        if (shouldThrow) throw new Error('quota exceeded');
        return key === 'probe' ? null : null;
      },
      setItem(_key: string, _value: string): void {
        if (shouldThrow) throw new Error('quota exceeded');
      },
      removeItem(_key: string): void {
        if (shouldThrow) throw new Error('quota exceeded');
      },
    } as unknown as globalThis.Storage;

    const storage = createStorage({ localStorage: flaky });
    expect(storage.isPersistent).toBe(true); // probe succeeded

    shouldThrow = true;
    expect(() => storage.read('k')).not.toThrow();
    expect(storage.read('k')).toBeNull();
    expect(() => storage.write('k', 'v')).not.toThrow();
    expect(storage.write('k', 'v')).toBe(false);
    expect(() => storage.remove('k')).not.toThrow();
    expect(storage.remove('k')).toBe(false);
  });
});
