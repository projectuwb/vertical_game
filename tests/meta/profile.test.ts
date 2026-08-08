import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { createInMemoryStorage } from '../../src/platform/storage.js';
import type { KeyValueStorage } from '../../src/platform/storage.js';
import {
  CURRENT_SCHEMA_VERSION,
  INKSTONE_TRACK_IDS,
  PROFILE_STORAGE_KEY,
  createDefaultProfile,
  exportProfile,
  importProfile,
  loadProfile,
  recordRunResult,
  saveProfile,
  type Profile,
} from '../../src/meta/profile.js';

/** A `KeyValueStorage` whose every method throws — Task 4.1's own acceptance bar
 *  ("the game runs correctly with storage throwing on every call") applies at *this*
 *  layer too, not just inside platform/storage.ts's own fallback (a caller could hand
 *  loadProfile/saveProfile a raw, unwrapped backend directly, e.g. a future test or a
 *  Capacitor storage plugin that behaves differently). */
class AlwaysThrowingStorage implements KeyValueStorage {
  readonly isPersistent = true;
  read(): never {
    throw new Error('storage disabled');
  }
  write(): never {
    throw new Error('storage disabled');
  }
  remove(): never {
    throw new Error('storage disabled');
  }
}

describe('createDefaultProfile', () => {
  it('starts every Inkstone track at level 0 and every counter at 0', () => {
    const profile = createDefaultProfile();
    expect(profile.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(profile.goldLeaf).toBe(0);
    expect(profile.bestDistanceU).toBe(0);
    expect(profile.bestPeakLine).toBe(0);
    expect(profile.totalSealsBroken).toBe(0);
    expect(profile.totalPassages).toBe(0);
    expect(profile.runHistory).toEqual([]);
    for (const id of INKSTONE_TRACK_IDS) {
      expect(profile.upgradeLevels[id]).toBe(0);
    }
  });

  it('INKSTONE_TRACK_IDS matches BALANCE.inkstone\'s track keys exactly', () => {
    const configKeys = Object.keys(BALANCE.inkstone).filter(
      (k) => k !== 'levelsPerTrack' && k !== 'costGrowthPerLevel',
    );
    expect([...INKSTONE_TRACK_IDS].sort()).toEqual([...configKeys].sort());
  });
});

describe('loadProfile', () => {
  it('returns a default profile when nothing has been saved yet', () => {
    const storage = createInMemoryStorage();
    expect(loadProfile(storage)).toEqual(createDefaultProfile());
  });

  it('returns a default profile (never throws) for malformed JSON', () => {
    const storage = createInMemoryStorage();
    storage.write(PROFILE_STORAGE_KEY, '{not json');
    expect(() => loadProfile(storage)).not.toThrow();
    expect(loadProfile(storage)).toEqual(createDefaultProfile());
  });

  it('returns a default profile for an unrecognized/future schemaVersion', () => {
    const storage = createInMemoryStorage();
    storage.write(PROFILE_STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(loadProfile(storage)).toEqual(createDefaultProfile());
  });

  it('sanitizes individual corrupt fields instead of discarding the whole profile', () => {
    const storage = createInMemoryStorage();
    storage.write(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        goldLeaf: -50, // invalid: negative
        upgradeLevels: { grind: 999 }, // invalid: exceeds levelsPerTrack, and most tracks missing
        bestDistanceU: 1234, // valid
        bestPeakLine: 'not a number', // invalid
        totalSealsBroken: 3, // valid
        totalPassages: 7, // valid
        settings: { muted: 'yes' }, // invalid, and other fields missing
        runHistory: 'not an array', // invalid
      }),
    );

    const profile = loadProfile(storage);
    expect(profile.goldLeaf).toBe(0); // fell back
    expect(profile.upgradeLevels.grind).toBe(0); // fell back (out of range)
    expect(profile.upgradeLevels.nib).toBe(0); // fell back (missing)
    expect(profile.bestDistanceU).toBe(1234); // preserved
    expect(profile.bestPeakLine).toBe(0); // fell back
    expect(profile.totalSealsBroken).toBe(3); // preserved
    expect(profile.totalPassages).toBe(7); // preserved
    expect(profile.settings.muted).toBe(false); // fell back
    expect(profile.runHistory).toEqual([]); // fell back
  });

  it('the game runs correctly with storage throwing on every call: loadProfile never throws', () => {
    const throwing = new AlwaysThrowingStorage();
    expect(() => loadProfile(throwing)).not.toThrow();
    expect(loadProfile(throwing)).toEqual(createDefaultProfile());
  });
});

describe('saveProfile / loadProfile round trip', () => {
  it('a saved profile loads back identically', () => {
    const storage = createInMemoryStorage();
    const profile = recordRunResult(createDefaultProfile(), {
      seed: 7,
      distanceU: 500,
      peakLine: 42,
      sealsBroken: 2,
      goldLeafEarned: 300,
      timestampMs: 1000,
    });
    expect(saveProfile(storage, profile)).toBe(true);
    expect(loadProfile(storage)).toEqual(profile);
  });

  it('the game runs correctly with storage throwing on every call: saveProfile never throws and reports failure', () => {
    const throwing = new AlwaysThrowingStorage();
    const profile = createDefaultProfile();
    expect(() => saveProfile(throwing, profile)).not.toThrow();
    expect(saveProfile(throwing, profile)).toBe(false);
  });
});

describe('exportProfile / importProfile', () => {
  it('round-trips a profile through a JSON string', () => {
    const profile = recordRunResult(createDefaultProfile(), {
      seed: 1,
      distanceU: 100,
      peakLine: 10,
      sealsBroken: 0,
      goldLeafEarned: 50,
      timestampMs: 1,
    });
    const blob = exportProfile(profile);
    expect(typeof blob).toBe('string');
    expect(importProfile(blob)).toEqual(profile);
  });

  it('importProfile returns null (never throws) for garbage input', () => {
    expect(() => importProfile('not json at all')).not.toThrow();
    expect(importProfile('not json at all')).toBeNull();
    expect(importProfile('{"schemaVersion": 99}')).toBeNull();
    expect(importProfile('{"noSchemaVersionHere": true}')).toBeNull();
  });
});

describe('recordRunResult', () => {
  it('accumulates Gold Leaf, totals, and pushes a history entry', () => {
    const after = recordRunResult(createDefaultProfile(), {
      seed: 1,
      distanceU: 200,
      peakLine: 30,
      sealsBroken: 1,
      goldLeafEarned: 150,
      timestampMs: 500,
    });
    expect(after.goldLeaf).toBe(150);
    expect(after.totalPassages).toBe(1);
    expect(after.totalSealsBroken).toBe(1);
    expect(after.bestDistanceU).toBe(200);
    expect(after.bestPeakLine).toBe(30);
    expect(after.runHistory).toHaveLength(1);
    expect(after.runHistory[0]).toEqual({
      seed: 1,
      distanceU: 200,
      peakLine: 30,
      sealsBroken: 1,
      goldLeafEarned: 150,
      timestampMs: 500,
    });
  });

  it('bests only ever increase, even after a smaller run', () => {
    let profile: Profile = recordRunResult(createDefaultProfile(), {
      seed: 1,
      distanceU: 500,
      peakLine: 80,
      sealsBroken: 2,
      goldLeafEarned: 100,
      timestampMs: 1,
    });
    profile = recordRunResult(profile, {
      seed: 2,
      distanceU: 50,
      peakLine: 5,
      sealsBroken: 0,
      goldLeafEarned: 10,
      timestampMs: 2,
    });
    expect(profile.bestDistanceU).toBe(500);
    expect(profile.bestPeakLine).toBe(80);
    expect(profile.goldLeaf).toBe(110); // Gold Leaf itself still accumulates, unlike bests
    expect(profile.totalPassages).toBe(2);
  });

  it('caps the rolling history at 40 entries, dropping the oldest first', () => {
    let profile = createDefaultProfile();
    for (let i = 0; i < 45; i++) {
      profile = recordRunResult(profile, {
        seed: i,
        distanceU: i,
        peakLine: i,
        sealsBroken: 0,
        goldLeafEarned: 1,
        timestampMs: i,
      });
    }
    expect(profile.runHistory).toHaveLength(40);
    expect(profile.runHistory[0]?.seed).toBe(5); // the first 5 (seeds 0-4) were dropped
    expect(profile.runHistory[39]?.seed).toBe(44);
    expect(profile.totalPassages).toBe(45); // totals aren't capped, only the rolling log
  });
});
