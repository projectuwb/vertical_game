// Task 7.1: a deterministic "daily seed" every player gets on the same UTC calendar
// day, plus a compact, copyable result string. GAME_DESIGN.md doesn't name this feature
// (logged as this task's own design in DECISIONS.md) — the shape borrows from the
// familiar "one puzzle a day, share your result as plain text" pattern, kept here as
// zero-network: the seed is derived purely from the date, and "sharing" is copy-to-
// clipboard of a plain string, never a submission anywhere (CLAUDE.md's "zero cost,
// offline-first, no analytics" constraints rule out anything else).

function utcDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** FNV-1a, 32-bit — a small, well-known, deterministic string hash, chosen only because
 *  it's simple enough to write from scratch (TECH_SPEC.md §2: no runtime dependencies).
 *  This produces the single *seed number* `createWorld` consumes, exactly the role
 *  `Date.now()` plays for an ordinary Passage — it is not part of the seeded-RNG
 *  determinism chain (`core/rng.ts`'s `RngRegistry`) itself. */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Every call on the same UTC calendar day returns the same seed — the whole point of a
 *  "daily." Defaults to the real current time; the parameter exists for tests. */
export function computeDailySeed(date: Date = new Date()): number {
  return fnv1a32(utcDateKey(date));
}

const MS_PER_DAY = 86400000;

/** Days since the Unix epoch (UTC) — a simple, ever-increasing "Day #" that needs no
 *  arbitrary game-specific launch-date decision (there isn't a real one yet). */
export function dailyDayNumber(date: Date = new Date()): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

export interface DailyResult {
  readonly dayNumber: number;
  readonly distanceU: number;
  readonly peakLine: number;
  readonly sealsBroken: number;
  /** Already the display string (e.g. `STRINGS.deathCause[cause]`), not the raw
   *  `DeathCause` union — keeps this module out of /ui's presentation concerns, the same
   *  layering /sim already keeps relative to /render/ui/audio/platform. */
  readonly deathCauseText: string;
}

/** A compact, plain-text, comparable-across-players summary — no emoji grid (this isn't
 *  a discrete-guess puzzle like the games that popularised the format), just the same
 *  numbers the summary screen already shows, in one copyable block. */
export function formatDailyShareText(result: DailyResult): string {
  const sealWord = result.sealsBroken === 1 ? 'Seal' : 'Seals';
  return [
    `INKFALL — Day #${result.dayNumber}`,
    `${Math.floor(result.distanceU)}u · Peak Line ${result.peakLine} · ${result.sealsBroken} ${sealWord} broken`,
    result.deathCauseText,
  ].join('\n');
}
