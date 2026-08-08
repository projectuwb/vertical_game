// Safe localStorage wrapper (Task 4.1, TECH_SPEC.md §3): "Wrap all access in
// /platform/storage.ts with try/catch — private-mode Safari throws, and the game must
// run fine with persistence silently disabled (in-memory profile, one quiet line on the
// settings screen)." Every method here is individually try/catch-wrapped — private-mode
// Safari can throw on the very first call, on some later call once quota is hit, or (in
// its oldest form) just from touching `window.localStorage` at all — so no single
// try/catch placed "around the risky bit" would actually cover every real failure mode.

export interface KeyValueStorage {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): boolean;
  /** False for the in-memory fallback — nothing written through it survives a reload.
   *  Exists so a future settings screen can show "not saving" per TECH_SPEC.md §3,
   *  without needing to re-probe storage itself. */
  readonly isPersistent: boolean;
}

class InMemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  readonly isPersistent = false;

  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  write(key: string, value: string): boolean {
    this.map.set(key, value);
    return true;
  }
  remove(key: string): boolean {
    this.map.delete(key);
    return true;
  }
}

class BrowserLocalStorage implements KeyValueStorage {
  readonly isPersistent = true;

  constructor(private readonly storage: globalThis.Storage) {}

  read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }
  write(key: string, value: string): boolean {
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  remove(key: string): boolean {
    try {
      this.storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}

const PROBE_KEY = 'inkfall.storageProbe';

/**
 * Picks a real, working `localStorage`-backed store, or falls back to an in-memory one
 * — private-mode Safari can throw on the `window.localStorage` getter itself, not just
 * on `setItem`/`getItem`, so the fallback decision has to be made by actually trying a
 * full write-then-remove probe, not just checking that the property exists. `win` is
 * injectable (defaults to the real `window`) so tests can supply a fake that throws on
 * demand without a real DOM.
 */
export function createStorage(win: { localStorage: globalThis.Storage } = window): KeyValueStorage {
  try {
    const raw = win.localStorage;
    raw.setItem(PROBE_KEY, '1');
    raw.removeItem(PROBE_KEY);
    return new BrowserLocalStorage(raw);
  } catch {
    return new InMemoryStorage();
  }
}

/** For tests, and for anywhere that explicitly wants a non-persistent store (e.g. a
 *  "try before you save" flow) rather than the auto-detecting `createStorage`. */
export function createInMemoryStorage(): KeyValueStorage {
  return new InMemoryStorage();
}
