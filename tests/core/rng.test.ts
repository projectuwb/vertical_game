import { describe, expect, it } from 'vitest';
import { RNG_CONCERNS, RngRegistry, hashState, mulberry32, type RngConcern } from '../../src/core/rng.js';

function sequence(seed: number, n: number): number[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => rng());
}

describe('mulberry32', () => {
  it('is deterministic: same seed produces the identical sequence', () => {
    expect(sequence(12345, 50)).toEqual(sequence(12345, 50));
  });

  it('produces values within [0, 1)', () => {
    for (const v of sequence(1, 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    expect(sequence(1, 20)).not.toEqual(sequence(2, 20));
  });
});

describe('RngRegistry', () => {
  it('reproduces identical per-concern sequences from the same seed', () => {
    const a = new RngRegistry(9001);
    const b = new RngRegistry(9001);
    for (const concern of RNG_CONCERNS) {
      const drawsA = Array.from({ length: 30 }, () => a.next(concern));
      const drawsB = Array.from({ length: 30 }, () => b.next(concern));
      expect(drawsA).toEqual(drawsB);
    }
  });

  it('gives every concern an independent stream', () => {
    const registry = new RngRegistry(42);
    const streams = new Map<RngConcern, number[]>();
    for (const concern of RNG_CONCERNS) {
      streams.set(
        concern,
        Array.from({ length: 20 }, () => registry.next(concern)),
      );
    }
    const values = Array.from(streams.values());
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        expect(values[i]).not.toEqual(values[j]);
      }
    }
  });

  it("a cosmetic draw never perturbs another concern's sequence", () => {
    const withoutCosmetic = new RngRegistry(777);
    const directorOnly = Array.from({ length: 40 }, () => withoutCosmetic.next('director'));

    const withCosmetic = new RngRegistry(777);
    const interleaved: number[] = [];
    for (let i = 0; i < 40; i++) {
      withCosmetic.next('cosmetic'); // simulates an unrelated cosmetic roll firing every step
      interleaved.push(withCosmetic.next('director'));
    }

    expect(interleaved).toEqual(directorOnly);
  });

  it('chance()/int()/pick() stay within their contracts', () => {
    const registry = new RngRegistry(5);
    let trueCount = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (registry.chance('cosmetic', 0.3)) trueCount++;
      const dieRoll = registry.int('cosmetic', 1, 7);
      expect(dieRoll).toBeGreaterThanOrEqual(1);
      expect(dieRoll).toBeLessThanOrEqual(6);
      const picked = registry.pick('cosmetic', ['a', 'b', 'c'] as const);
      expect(['a', 'b', 'c']).toContain(picked);
    }
    expect(trueCount / n).toBeGreaterThan(0.2);
    expect(trueCount / n).toBeLessThan(0.4);
  });

  it('pick() rejects an empty array', () => {
    const registry = new RngRegistry(1);
    expect(() => registry.pick('cosmetic', [])).toThrow();
  });
});

describe('hashState', () => {
  it('is stable for structurally identical input regardless of key order', () => {
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
  });

  it('differs for different input', () => {
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
  });

  it('hashes nested structures and arrays consistently', () => {
    const value = { line: { n: 37, class: 'Hane' }, blot: [1, 2, 3] };
    expect(hashState(value)).toBe(hashState(structuredClone(value)));
  });
});

describe('determinism: byte-identical world hashes at fixed checkpoints', () => {
  // /sim/world.ts doesn't exist yet (Phase 2) — this exercises the same mechanism
  // (RngRegistry + hashState) the full world-hash determinism test will use once
  // there's a real World to snapshot, per TECH_SPEC.md §12.
  function runTape(seed: number, steps: number): Map<number, string> {
    const registry = new RngRegistry(seed);
    const checkpoints = [100, 1000, 5000];
    const hashes = new Map<number, string>();
    let acc = 0;
    for (let step = 1; step <= steps; step++) {
      acc += registry.next('director') * 3;
      acc += registry.next('gates');
      if (registry.chance('slips', 0.4)) acc += registry.next('slips') * 5;
      acc += registry.int('seals', 0, 100);
      registry.next('cosmetic'); // must not affect the checkpoint hash
      if (checkpoints.includes(step)) {
        hashes.set(step, hashState({ step, acc: Math.round(acc * 1e6) }));
      }
    }
    return hashes;
  }

  it('produces identical hashes at steps 100/1000/5000 for the same seed', () => {
    const runA = runTape(20260807, 5000);
    const runB = runTape(20260807, 5000);
    for (const step of [100, 1000, 5000]) {
      expect(runB.get(step)).toBe(runA.get(step));
    }
  });

  it('diverges for a different seed', () => {
    const runA = runTape(1, 5000);
    const runB = runTape(2, 5000);
    expect(runB.get(5000)).not.toBe(runA.get(5000));
  });
});
