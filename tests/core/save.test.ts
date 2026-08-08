import { describe, expect, it } from 'vitest';
import { runMigrations, safeJsonParse, type Migration, type VersionedData } from '../../src/core/save.js';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null (never throws) on malformed JSON', () => {
    expect(() => safeJsonParse('{not json')).not.toThrow();
    expect(safeJsonParse('{not json')).toBeNull();
  });
});

describe('runMigrations', () => {
  // No real schema below version 1 has ever shipped in this game — there is no actual
  // legacy data to migrate. This synthetic "v0 -> v1" fixture exists purely to prove
  // the chain *mechanism* itself (repeated application, current-version passthrough,
  // unrecoverable-path detection) generalizes correctly, so a future real migration is
  // a one-line addition to a migration table, not new infrastructure. See DECISIONS.md.
  interface FixtureV0 extends VersionedData {
    readonly schemaVersion: 0;
    readonly oldName: string;
  }
  interface FixtureV1 extends VersionedData {
    readonly schemaVersion: 1;
    readonly newName: string;
  }
  const v0ToV1: Migration = (data) => {
    const v0 = data as FixtureV0;
    return { schemaVersion: 1, newName: v0.oldName } satisfies FixtureV1;
  };
  const MIGRATIONS: Readonly<Record<number, Migration>> = { 0: v0ToV1 };

  it('applies a registered migration to reach the current version', () => {
    const v0: FixtureV0 = { schemaVersion: 0, oldName: 'hello' };
    const result = runMigrations<FixtureV1>(v0, MIGRATIONS, 1);
    expect(result).toEqual({ schemaVersion: 1, newName: 'hello' });
  });

  it('chains through multiple migrations to reach a version two steps ahead', () => {
    interface FixtureV2 extends VersionedData {
      readonly schemaVersion: 2;
      readonly newName: string;
      readonly extra: boolean;
    }
    const v1ToV2: Migration = (data) => {
      const v1 = data as FixtureV1;
      return { schemaVersion: 2, newName: v1.newName, extra: true } satisfies FixtureV2;
    };
    const chained: Readonly<Record<number, Migration>> = { 0: v0ToV1, 1: v1ToV2 };
    const v0: FixtureV0 = { schemaVersion: 0, oldName: 'hello' };
    const result = runMigrations<FixtureV2>(v0, chained, 2);
    expect(result).toEqual({ schemaVersion: 2, newName: 'hello', extra: true });
  });

  it('passes already-current-version data through unchanged', () => {
    const current: FixtureV1 = { schemaVersion: 1, newName: 'already there' };
    const result = runMigrations<FixtureV1>(current, MIGRATIONS, 1);
    expect(result).toEqual(current);
  });

  it('returns null for a version with no registered migration step (unrecoverable)', () => {
    const orphan: VersionedData = { schemaVersion: 5 };
    expect(runMigrations(orphan, MIGRATIONS, 1)).toBeNull();
  });

  it('returns null rather than attempting a downgrade from a newer-than-known version', () => {
    const fromTheFuture: VersionedData = { schemaVersion: 2 };
    expect(runMigrations(fromTheFuture, MIGRATIONS, 1)).toBeNull();
  });

  it('returns null instead of looping forever on a cyclic migration table', () => {
    const cyclic: Readonly<Record<number, Migration>> = {
      0: () => ({ schemaVersion: 1 }),
      1: () => ({ schemaVersion: 0 }),
    };
    const start: VersionedData = { schemaVersion: 0 };
    expect(runMigrations(start, cyclic, 2)).toBeNull();
  });
});
