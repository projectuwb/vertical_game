import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { BALANCE } from '../../src/sim/config.js';
import { createLine, type LineState } from '../../src/sim/line.js';
import {
  applyGateEffect,
  createTemperState,
  generateGatePair,
  isGenuineDilemma,
  isLegalPair,
  resolveGatePairContact,
  type GatePair,
} from '../../src/sim/gates.js';

describe('generateGatePair — pairing rules hold across 10,000 seeded rolls', () => {
  it('never produces an illegal pair (2 identical, or 2 strictly-bad), and meets the dilemma floor', () => {
    const rng = new RngRegistry(20260808);
    let dilemmaCount = 0;
    const n = 10_000;

    for (let i = 0; i < n; i++) {
      const pair = generateGatePair(rng);
      expect(isLegalPair(pair)).toBe(true);
      if (isGenuineDilemma(pair)) dilemmaCount++;
    }

    expect(dilemmaCount / n).toBeGreaterThanOrEqual(BALANCE.gates.minDilemmaFraction);
  });

  it('is deterministic for a given seed', () => {
    const a = new RngRegistry(42);
    const b = new RngRegistry(42);
    const pairsA = Array.from({ length: 200 }, () => generateGatePair(a));
    const pairsB = Array.from({ length: 200 }, () => generateGatePair(b));
    expect(pairsA).toEqual(pairsB);
  });
});

describe('isLegalPair', () => {
  it('rejects two identical arithmetic gates', () => {
    const pair: GatePair = {
      left: { family: 'arithmetic', effect: { arithmeticOp: 'mul2' } },
      right: { family: 'arithmetic', effect: { arithmeticOp: 'mul2' } },
    };
    expect(isLegalPair(pair)).toBe(false);
  });

  it('rejects two strictly-bad arithmetic gates', () => {
    const pair: GatePair = {
      left: { family: 'arithmetic', effect: { arithmeticOp: 'subTen' } },
      right: { family: 'arithmetic', effect: { arithmeticOp: 'divTwo' } },
    };
    expect(isLegalPair(pair)).toBe(false);
  });

  it('accepts a good-vs-bad safety-valve pair', () => {
    const pair: GatePair = {
      left: { family: 'arithmetic', effect: { arithmeticOp: 'mul2' } },
      right: { family: 'arithmetic', effect: { arithmeticOp: 'subTen' } },
    };
    expect(isLegalPair(pair)).toBe(true);
  });

  it('a Sealed gate paired with a bad-underneath reveal is still legal at generation time (unknown to the player)', () => {
    // Legality is evaluated on what's knowable, not the hidden truth.
    const pair: GatePair = {
      left: { family: 'sealed', effect: { arithmeticOp: 'subTen' } },
      right: { family: 'arithmetic', effect: { arithmeticOp: 'mul2' } },
    };
    expect(isLegalPair(pair)).toBe(true);
  });
});

describe('resolveGatePairContact', () => {
  const pair: GatePair = {
    left: { family: 'arithmetic', effect: { arithmeticOp: 'mul2' } },
    right: { family: 'conversion', effect: { conversionTarget: 'tome' } },
  };

  it('negative x resolves to the left gate', () => {
    expect(resolveGatePairContact(pair, -1)).toBe(pair.left);
  });

  it('non-negative x resolves to the right gate', () => {
    expect(resolveGatePairContact(pair, 0)).toBe(pair.right);
    expect(resolveGatePairContact(pair, 1)).toBe(pair.right);
  });
});

describe('applyGateEffect — arithmetic', () => {
  function line(n: number): LineState {
    return createLine(n, 'hane');
  }

  it('mul2/mul3 multiply the current count', () => {
    const r1 = applyGateEffect(line(10), createTemperState(), { arithmeticOp: 'mul2' });
    expect(r1.line.strokes.length).toBe(20);
    const r2 = applyGateEffect(line(10), createTemperState(), { arithmeticOp: 'mul3' });
    expect(r2.line.strokes.length).toBe(30);
  });

  it('addTwelve/addTwentyFive add to the current count', () => {
    const r1 = applyGateEffect(line(10), createTemperState(), { arithmeticOp: 'addTwelve' });
    expect(r1.line.strokes.length).toBe(22);
    const r2 = applyGateEffect(line(10), createTemperState(), { arithmeticOp: 'addTwentyFive' });
    expect(r2.line.strokes.length).toBe(35);
  });

  it('subTen subtracts, divTwo halves, both clamped at 0', () => {
    const r1 = applyGateEffect(line(10), createTemperState(), { arithmeticOp: 'subTen' });
    expect(r1.line.strokes.length).toBe(0);
    const r2 = applyGateEffect(line(20), createTemperState(), { arithmeticOp: 'divTwo' });
    expect(r2.line.strokes.length).toBe(10);
    const r3 = applyGateEffect(line(3), createTemperState(), { arithmeticOp: 'subTen' });
    expect(r3.line.strokes.length).toBe(0);
  });

  it('never exceeds BALANCE.line.maxCount', () => {
    const r = applyGateEffect(line(BALANCE.line.maxCount), createTemperState(), {
      arithmeticOp: 'mul3',
    });
    expect(r.line.strokes.length).toBe(BALANCE.line.maxCount);
  });
});

describe('applyGateEffect — conversion', () => {
  it('converts every Stroke to the target class', () => {
    const mixed: LineState = {
      strokes: [{ class: 'hane' }, { class: 'tome' }, { class: 'harai' }, { class: 'hane' }],
    };
    const r = applyGateEffect(mixed, createTemperState(), { conversionTarget: 'harai' });
    expect(r.line.strokes.every((s) => s.class === 'harai')).toBe(true);
    expect(r.line.strokes).toHaveLength(4);
  });
});

describe('applyGateEffect — temper', () => {
  it('increments the matching stack by 1, capped at stackCap', () => {
    let temper = createTemperState();
    for (let i = 0; i < BALANCE.gates.temper.stackCap + 3; i++) {
      temper = applyGateEffect(createLine(1, 'hane'), temper, { temperStat: 'rate' }).temper;
    }
    expect(temper.rateStacks).toBe(BALANCE.gates.temper.stackCap);
    expect(temper.rangeStacks).toBe(0);
  });

  it('does not touch the Line', () => {
    const before = createLine(7, 'tome');
    const r = applyGateEffect(before, createTemperState(), { temperStat: 'splash' });
    expect(r.line.strokes).toHaveLength(7);
    expect(r.line.strokes.every((s) => s.class === 'tome')).toBe(true);
  });
});

describe("applyGateEffect — gate maths order (conversion applies after count changes)", () => {
  it('a compound arithmetic+conversion effect grows the Line first, then converts the whole (grown) Line', () => {
    const before = createLine(5, 'hane');
    const r = applyGateEffect(before, createTemperState(), {
      arithmeticOp: 'addTwelve',
      conversionTarget: 'harai',
    });
    // If conversion had wrongly run before the arithmetic growth, the 12 newly-added
    // Strokes would not have been converted, and the Line would not be uniform.
    expect(r.line.strokes).toHaveLength(17);
    expect(r.line.strokes.every((s) => s.class === 'harai')).toBe(true);
  });

  it('a compound effect on a shrinking op still ends uniform after conversion', () => {
    const before: LineState = {
      strokes: Array.from({ length: 20 }, (_, i) => ({
        class: i % 2 === 0 ? ('hane' as const) : ('tome' as const),
      })),
    };
    const r = applyGateEffect(before, createTemperState(), {
      arithmeticOp: 'divTwo',
      conversionTarget: 'harai',
    });
    expect(r.line.strokes).toHaveLength(10);
    expect(r.line.strokes.every((s) => s.class === 'harai')).toBe(true);
  });
});
