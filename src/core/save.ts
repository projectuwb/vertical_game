// Save-file plumbing shared by /meta (Task 4.1): a generic versioned-migration runner
// and a JSON parse that never throws. Deliberately knows nothing about what a Profile
// actually contains — that's meta/profile.ts's job — so any future /meta save shape
// (e.g. a Phase-6 Scroll-progress file) can reuse this without duplicating it.

export interface VersionedData {
  readonly schemaVersion: number;
}

export type Migration = (data: VersionedData) => VersionedData;

/**
 * Repeatedly applies `migrations[data.schemaVersion]` until `schemaVersion` reaches
 * `currentVersion`. Returns `null` (never throws) if no path forward exists — an
 * unregistered intermediate version, or data claiming a version newer than this build
 * knows about (a downgrade, which is never attempted). Callers treat `null` as
 * "unrecoverable, fall back to a fresh default" — see meta/profile.ts's `loadProfile`.
 */
export function runMigrations<T extends VersionedData>(
  data: VersionedData,
  migrations: Readonly<Record<number, Migration>>,
  currentVersion: number,
): T | null {
  let current = data;
  const seenVersions = new Set<number>();
  while (current.schemaVersion < currentVersion) {
    if (seenVersions.has(current.schemaVersion)) return null; // defends against a cyclic migration table
    seenVersions.add(current.schemaVersion);
    const step = migrations[current.schemaVersion];
    if (step === undefined) return null;
    current = step(current);
  }
  if (current.schemaVersion !== currentVersion) return null;
  return current as T;
}

/** `JSON.parse` that reports failure as `null` instead of throwing — malformed JSON
 *  (a hand-edited import, truncated storage) is an expected input here, not a bug. */
export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
