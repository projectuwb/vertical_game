// Profile schema + migrations (Task 4.1, TECH_SPEC.md §3): "localStorage key
// `inkfall.profile.v1`, JSON, with `schemaVersion` and a migration chain (migrations.ts)
// so future versions never wipe progress. Contents: Gold Leaf, upgrade levels, best
// distance, best Line, Seals broken, total Passages, settings, unlocked Brushes/Scroll
// progress (phase 6), and a 40-run rolling history for the harness to compare against."
//
// Phase-6 fields (unlocked Brushes, Scroll progress) are deliberately not in this v1
// schema — Phase 6 is locked (CLAUDE.md) and nothing in the current game produces that
// data. Adding an empty placeholder now would be exactly the kind of "guess the future
// shape" the migration chain exists to make unnecessary: Task 6.1 adds those fields via
// a real v1->v2 migration when Phase 6 actually starts, same as any other schema change.
// `settings` *is* included now even though none of Audio (4.4)/Accessibility (5.3) is
// built yet, since all three of its fields are already named elsewhere in the spec
// (mute persistence, Shapes-Only, reduced motion) — reserving the shape now avoids a
// migration later purely to add an empty object.

import { BALANCE } from '../sim/config.js';
import { runMigrations, safeJsonParse, type Migration, type VersionedData } from '../core/save.js';
import type { KeyValueStorage } from '../platform/storage.js';

export const PROFILE_STORAGE_KEY = 'inkfall.profile.v1';
export const CURRENT_SCHEMA_VERSION = 1;

/** Mirrors `BALANCE.inkstone`'s eight track keys exactly (`tests/meta/profile.test.ts`
 *  asserts this stays true) — kept as an explicit list rather than derived from
 *  `keyof typeof BALANCE.inkstone` so this file doesn't also pull in the two
 *  non-track keys (`levelsPerTrack`, `costGrowthPerLevel`). */
export type InkstoneTrackId =
  | 'openingStroke'
  | 'grind'
  | 'nib'
  | 'well'
  | 'leaf'
  | 'reach'
  | 'flourishStudy'
  | 'secondDraft';

export const INKSTONE_TRACK_IDS: readonly InkstoneTrackId[] = [
  'openingStroke',
  'grind',
  'nib',
  'well',
  'leaf',
  'reach',
  'flourishStudy',
  'secondDraft',
];

export interface ProfileSettings {
  readonly muted: boolean;
  readonly shapesOnly: boolean;
  readonly reducedMotion: boolean;
}

export interface RunHistoryEntry {
  readonly seed: number;
  readonly distanceU: number;
  readonly peakLine: number;
  readonly sealsBroken: number;
  readonly goldLeafEarned: number;
  readonly timestampMs: number;
}

export interface Profile extends VersionedData {
  readonly schemaVersion: 1;
  readonly goldLeaf: number;
  readonly upgradeLevels: Readonly<Record<InkstoneTrackId, number>>;
  readonly bestDistanceU: number;
  readonly bestPeakLine: number;
  readonly totalSealsBroken: number;
  readonly totalPassages: number;
  readonly settings: ProfileSettings;
  readonly runHistory: readonly RunHistoryEntry[];
}

/** TECH_SPEC.md §3: "a 40-run rolling history for the harness to compare against." Not
 *  a `BALANCE` number — `/sim/config.ts` is GAME_DESIGN.md's numbers specifically, and
 *  this one comes from TECH_SPEC.md instead. */
const RUN_HISTORY_CAP = 40;

export function createDefaultProfile(): Profile {
  const upgradeLevels = {} as Record<InkstoneTrackId, number>;
  for (const id of INKSTONE_TRACK_IDS) upgradeLevels[id] = 0;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    goldLeaf: 0,
    upgradeLevels,
    bestDistanceU: 0,
    bestPeakLine: 0,
    totalSealsBroken: 0,
    totalPassages: 0,
    settings: { muted: false, shapesOnly: false, reducedMotion: false },
    runHistory: [],
  };
}

/** No version below 1 has ever shipped — v1 is this game's very first schema, so this
 *  chain is currently empty. It's still wired all the way through `loadProfile`/
 *  `importProfile` (rather than skipped until "actually needed") so that a real future
 *  v1->v2 migration is a one-line addition to this map, not new infrastructure written
 *  under pressure. Since there's no real legacy data to migrate yet, the *mechanism*
 *  itself (runMigrations, in core/save.ts) is proven against a synthetic fixture in
 *  `tests/meta/profile.test.ts` instead — logged in DECISIONS.md. */
const MIGRATIONS: Readonly<Record<number, Migration>> = {};

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Defends against a *partially* corrupt but structurally-parseable profile (one bad
 * field from a hand-edited import, a future build's slightly different value range)
 * by resetting individual fields to their default rather than discarding an otherwise
 * fine profile over one bad number — the difference between losing a typo and losing a
 * save file.
 */
function sanitizeProfile(data: VersionedData): Profile {
  const raw = data as Partial<Profile>;
  const fallback = createDefaultProfile();

  const upgradeLevels = {} as Record<InkstoneTrackId, number>;
  for (const id of INKSTONE_TRACK_IDS) {
    const level = raw.upgradeLevels?.[id];
    upgradeLevels[id] =
      typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= BALANCE.inkstone.levelsPerTrack
        ? level
        : 0;
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    goldLeaf: isFiniteNonNegative(raw.goldLeaf) ? raw.goldLeaf : fallback.goldLeaf,
    upgradeLevels,
    bestDistanceU: isFiniteNonNegative(raw.bestDistanceU) ? raw.bestDistanceU : fallback.bestDistanceU,
    bestPeakLine: isFiniteNonNegative(raw.bestPeakLine) ? raw.bestPeakLine : fallback.bestPeakLine,
    totalSealsBroken: isFiniteNonNegative(raw.totalSealsBroken) ? raw.totalSealsBroken : fallback.totalSealsBroken,
    totalPassages: isFiniteNonNegative(raw.totalPassages) ? raw.totalPassages : fallback.totalPassages,
    settings: {
      muted: typeof raw.settings?.muted === 'boolean' ? raw.settings.muted : fallback.settings.muted,
      shapesOnly:
        typeof raw.settings?.shapesOnly === 'boolean' ? raw.settings.shapesOnly : fallback.settings.shapesOnly,
      reducedMotion:
        typeof raw.settings?.reducedMotion === 'boolean'
          ? raw.settings.reducedMotion
          : fallback.settings.reducedMotion,
    },
    runHistory: Array.isArray(raw.runHistory) ? raw.runHistory.slice(-RUN_HISTORY_CAP) : fallback.runHistory,
  };
}

function parseToProfile(raw: string): Profile | null {
  const parsed = safeJsonParse(raw);
  if (parsed === null || typeof parsed !== 'object') return null;
  const versioned = parsed as VersionedData;
  if (typeof versioned.schemaVersion !== 'number') return null;
  const migrated = runMigrations<Profile>(versioned, MIGRATIONS, CURRENT_SCHEMA_VERSION);
  if (migrated === null) return null;
  return sanitizeProfile(migrated);
}

/** Never throws — any failure (missing key, malformed JSON, an unrecoverable
 *  schemaVersion, or the storage backend itself throwing) falls back to a fresh
 *  default profile rather than blocking the game from running. */
export function loadProfile(storage: KeyValueStorage): Profile {
  try {
    const raw = storage.read(PROFILE_STORAGE_KEY);
    if (raw === null) return createDefaultProfile();
    return parseToProfile(raw) ?? createDefaultProfile();
  } catch {
    return createDefaultProfile();
  }
}

/** Never throws. Returns whether the write actually persisted — callers can ignore
 *  this (the game plays fine either way), but a future settings screen can use it to
 *  show TECH_SPEC.md §3's "one quiet line" about persistence being unavailable. */
export function saveProfile(storage: KeyValueStorage, profile: Profile): boolean {
  try {
    return storage.write(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    return false;
  }
}

/** TECH_SPEC.md §3: "Include export/import of the profile as a copyable JSON blob in
 *  Settings." This is the underlying function; Task 4.3 wires it to an actual textarea. */
export function exportProfile(profile: Profile): string {
  return JSON.stringify(profile);
}

/** Never throws — malformed or foreign JSON simply fails to import (`null`), same
 *  "don't crash, don't silently corrupt" contract as `loadProfile`. */
export function importProfile(json: string): Profile | null {
  try {
    return parseToProfile(json);
  } catch {
    return null;
  }
}

/** Folds one finished Passage's results into a Profile: bests only ever increase,
 *  totals accumulate, Gold Leaf accumulates, and the rolling history keeps only the
 *  most recent `RUN_HISTORY_CAP` entries (TECH_SPEC.md §3). Pure — callers decide when
 *  (and whether) to `saveProfile` the result. */
export function recordRunResult(
  profile: Profile,
  result: {
    readonly seed: number;
    readonly distanceU: number;
    readonly peakLine: number;
    readonly sealsBroken: number;
    readonly goldLeafEarned: number;
    readonly timestampMs: number;
  },
): Profile {
  const entry: RunHistoryEntry = {
    seed: result.seed,
    distanceU: result.distanceU,
    peakLine: result.peakLine,
    sealsBroken: result.sealsBroken,
    goldLeafEarned: result.goldLeafEarned,
    timestampMs: result.timestampMs,
  };
  return {
    ...profile,
    goldLeaf: profile.goldLeaf + result.goldLeafEarned,
    bestDistanceU: Math.max(profile.bestDistanceU, result.distanceU),
    bestPeakLine: Math.max(profile.bestPeakLine, result.peakLine),
    totalSealsBroken: profile.totalSealsBroken + result.sealsBroken,
    totalPassages: profile.totalPassages + 1,
    runHistory: [...profile.runHistory, entry].slice(-RUN_HISTORY_CAP),
  };
}
