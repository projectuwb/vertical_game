// Determinism kit (TECH_SPEC.md §4). All gameplay randomness must flow through a
// generator minted here — `Math.random` is banned outside /render by an ESLint rule
// (eslint.config.js) so a cosmetic roll can never silently shift a gameplay roll.

/** A seeded generator: call it to get the next float in [0, 1). */
export type RngFn = () => number;

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Chosen over
 * `Math.random` specifically because it is seedable and its output sequence is
 * fully determined by the seed, which is what makes replays and the balance
 * harness (TECH_SPEC.md §6) possible.
 */
export function mulberry32(seed: number): RngFn {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit — used to turn a `(seed, concern)` pair into an independent seed. */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function deriveSeed(baseSeed: number, salt: string): number {
  return fnv1a32(`${baseSeed >>> 0}:${salt}`);
}

/** The independent randomness streams a Passage needs (TECH_SPEC.md §4). */
export const RNG_CONCERNS = ['director', 'gates', 'slips', 'seals', 'cosmetic'] as const;
export type RngConcern = (typeof RNG_CONCERNS)[number];

/**
 * One mulberry32 stream per concern, all derived from a single Passage seed.
 * Keeping concerns independent means adding a cosmetic-only roll anywhere in the
 * game never perturbs the sequence gates/slips/director/seals see, so a replay
 * recorded before the change still reproduces bit-for-bit after it.
 */
export class RngRegistry {
  readonly seed: number;
  private readonly generators: Record<RngConcern, RngFn>;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.generators = {
      director: mulberry32(deriveSeed(this.seed, 'director')),
      gates: mulberry32(deriveSeed(this.seed, 'gates')),
      slips: mulberry32(deriveSeed(this.seed, 'slips')),
      seals: mulberry32(deriveSeed(this.seed, 'seals')),
      cosmetic: mulberry32(deriveSeed(this.seed, 'cosmetic')),
    };
  }

  next(concern: RngConcern): number {
    return this.generators[concern]();
  }

  /** Uniform float in [min, max). */
  range(concern: RngConcern, min: number, max: number): number {
    return min + this.next(concern) * (max - min);
  }

  /** Uniform integer in [minInclusive, maxExclusive). */
  int(concern: RngConcern, minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(concern, minInclusive, maxExclusive));
  }

  /** True with probability `probability` (0..1). */
  chance(concern: RngConcern, probability: number): boolean {
    return this.next(concern) < probability;
  }

  /** Picks one element uniformly. Throws on an empty array — a design bug, not runtime input. */
  pick<T>(concern: RngConcern, items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('RngRegistry.pick: items must be non-empty');
    }
    const index = this.int(concern, 0, items.length);
    // int() is derived from a float strictly < 1, so index < items.length always holds.
    return items[index] as T;
  }
}

/**
 * cyrb53 — a fast, well-distributed non-cryptographic string hash. Used to reduce a
 * canonical snapshot of world/RNG state to a short comparable string for the
 * determinism test (TECH_SPEC.md §12): two runs with the same seed and input tape
 * must produce identical hashes at the same step.
 */
export function hashState(value: unknown): string {
  const str = canonicalStringify(value);
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36);
}

/** JSON.stringify with sorted object keys, so key insertion order never affects the hash. */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[key] = (val as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return val;
  });
}
