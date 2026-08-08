import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { BALANCE } from '../../src/sim/config.js';
import {
  computeComposition,
  computePressure,
  computeSlipBudgetPer100U,
  computeWaveIntervalS,
  computeWaveSize,
  createMercyState,
  isMercyActive,
  pickBlotClass,
  planSlipSpawn,
  updateMercyState,
} from '../../src/sim/director.js';

describe('computePressure', () => {
  // GAME_DESIGN.md §9's exact formula is `1 + t/38 + log2(max(N,1)) * 0.55` — Task 4.6's
  // balance pass retunes `pressureTimeDivisorS`/`pressureLineLogMultiplier` away from
  // those starting values (line 3's own "starting value... may be tuned" carve-out), so
  // this test checks the *formula's shape* against BALANCE's live tunables rather than
  // pinning the original literals.
  it('matches the §9 formula shape: 1 + t/pressureTimeDivisorS + log2(max(N,1)) * pressureLineLogMultiplier', () => {
    const d = BALANCE.director;
    expect(computePressure(0, 1)).toBeCloseTo(1, 9); // log2(1) = 0
    expect(computePressure(d.pressureTimeDivisorS, 1)).toBeCloseTo(2, 9); // t/divisor = 1
    expect(computePressure(0, 8)).toBeCloseTo(1 + Math.log2(8) * d.pressureLineLogMultiplier, 9);
  });

  it('treats N <= 0 the same as N = 1 (log2 floor)', () => {
    expect(computePressure(10, 0)).toBe(computePressure(10, 1));
  });
});

describe('computeWaveIntervalS', () => {
  it('matches max(2.4, 7.5 - t/32)', () => {
    expect(computeWaveIntervalS(0)).toBeCloseTo(7.5, 9);
    expect(computeWaveIntervalS(32)).toBeCloseTo(6.5, 9);
  });

  it('never drops below the 2.4s floor, however large t gets', () => {
    expect(computeWaveIntervalS(100000)).toBe(BALANCE.director.waveIntervalMinS);
  });
});

describe('computeWaveSize', () => {
  // §9's exact formula is `round(4 + P * 3.2)` — waveSizeBase/waveSizeMultiplier are
  // both Task-4.6-tunable (see computePressure's comment above), so this checks the
  // formula shape against BALANCE's live values rather than the original literals.
  it('matches round(waveSizeBase + P * waveSizeMultiplier) under the cap', () => {
    const d = BALANCE.director;
    expect(computeWaveSize(1, 1)).toBe(Math.round(d.waveSizeBase + 1 * d.waveSizeMultiplier));
  });

  it('caps at 240', () => {
    expect(computeWaveSize(1000, 1)).toBe(BALANCE.director.waveSizeCap);
  });

  it('anti-snowball scales wave size up once N crosses lineThreshold', () => {
    const threshold = BALANCE.director.antiSnowball.lineThreshold;
    const normal = computeWaveSize(5, threshold - 1);
    const snowballed = computeWaveSize(5, threshold + 1);
    expect(snowballed).toBeGreaterThan(normal);
  });
});

describe('computeComposition', () => {
  it('is Smudge-only below the low pressure band', () => {
    const w = computeComposition(1, 10, false);
    expect(w.smudge).toBe(1);
    expect(w.runner).toBe(0);
    expect(w.crust).toBe(0);
  });

  it('adds Runner at the low band, keeps it at higher bands (cumulative)', () => {
    const mid = computeComposition(BALANCE.director.composition.pressureMidBand, 10, false);
    expect(mid.runner).toBe(BALANCE.director.composition.runnerChance);
    expect(mid.crust).toBe(BALANCE.director.composition.crustChance);
    expect(mid.blotter).toBe(BALANCE.director.composition.blotterChance);
  });

  it('raises Crust and adds Splitter/Drifter at the high band', () => {
    const high = computeComposition(BALANCE.director.composition.pressureHighBand, 10, false);
    expect(high.crust).toBe(BALANCE.director.composition.crustChanceHigh);
    expect(high.splitter).toBe(BALANCE.director.composition.splitterChanceHigh);
    expect(high.drifter).toBe(BALANCE.director.composition.drifterChanceHigh);
  });

  it('every weight set sums to 1 (smudge fills the remainder)', () => {
    for (const p of [1, 3, 6, 10, 20]) {
      const w = computeComposition(p, 10, false);
      const total = w.smudge + w.runner + w.crust + w.splitter + w.blotter + w.drifter;
      expect(total).toBeCloseTo(1, 9);
    }
  });

  it('the mercy rule suppresses Crust and Splitter entirely', () => {
    const w = computeComposition(20, 10, true);
    expect(w.crust).toBe(0);
    expect(w.splitter).toBe(0);
  });

  it('anti-snowball adds to Crust share above N=400', () => {
    const normal = computeComposition(20, 100, false);
    const snowballed = computeComposition(20, 401, false);
    expect(snowballed.crust).toBeCloseTo(normal.crust + BALANCE.director.antiSnowball.crustShareBonus, 9);
  });
});

describe('pickBlotClass', () => {
  it('only ever returns classes with nonzero weight', () => {
    const rng = new RngRegistry(1);
    const weights = computeComposition(1, 1, false); // smudge-only
    for (let i = 0; i < 200; i++) {
      expect(pickBlotClass(weights, rng)).toBe('smudge');
    }
  });

  it('roughly matches weighted proportions over many draws', () => {
    const rng = new RngRegistry(20260808);
    const weights = { smudge: 0.5, runner: 0.5, crust: 0, splitter: 0, blotter: 0, drifter: 0 };
    let smudgeCount = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (pickBlotClass(weights, rng) === 'smudge') smudgeCount++;
    }
    expect(smudgeCount / n).toBeGreaterThan(0.47);
    expect(smudgeCount / n).toBeLessThan(0.53);
  });
});

describe('computeSlipBudgetPer100U', () => {
  it('matches 18 + P * 6', () => {
    const b = BALANCE.director.slipBudget;
    expect(computeSlipBudgetPer100U(2, false)).toBeCloseTo(b.base + 2 * b.pressureMultiplier, 9);
  });

  it('the mercy rule raises it by slipDensityBonus', () => {
    const base = computeSlipBudgetPer100U(2, false);
    const mercy = computeSlipBudgetPer100U(2, true);
    expect(mercy).toBeCloseTo(base * (1 + BALANCE.director.mercy.slipDensityBonus), 9);
  });
});

describe('planSlipSpawn', () => {
  it('spends on a Banner whenever the budget fully covers it', () => {
    const rng = new RngRegistry(1);
    const plan = planSlipSpawn(BALANCE.slips.plusTwentyFive.hp + 5, rng);
    expect(plan.kind).toBe('plusTwentyFive');
  });

  it('a +1 run count is always clamped to [runMin, runMax]', () => {
    const rng = new RngRegistry(1);
    for (const budget of [0, 5, 50, 500, 5000]) {
      const plan = planSlipSpawn(budget, rng);
      if (plan.kind === 'plusOne') {
        expect(plan.count).toBeGreaterThanOrEqual(BALANCE.slips.plusOne.runMin);
        expect(plan.count).toBeLessThanOrEqual(BALANCE.slips.plusOne.runMax);
      }
    }
  });
});

describe('mercy rule', () => {
  it('does not activate before lineCount has been low for more than durationS', () => {
    let mercy = createMercyState();
    const m = BALANCE.director.mercy;
    mercy = updateMercyState(mercy, 0, m.lineThreshold);
    mercy = updateMercyState(mercy, m.durationS - 0.1, m.lineThreshold);
    expect(isMercyActive(mercy, m.durationS - 0.1)).toBe(false);
  });

  it('activates once N has been at/below the threshold for more than durationS, and lasts suppressDurationS', () => {
    let mercy = createMercyState();
    const m = BALANCE.director.mercy;
    mercy = updateMercyState(mercy, 0, m.lineThreshold);
    const activateAt = m.durationS + 0.1;
    mercy = updateMercyState(mercy, activateAt, m.lineThreshold);
    expect(isMercyActive(mercy, activateAt)).toBe(true);
    expect(isMercyActive(mercy, activateAt + m.suppressDurationS + 0.1)).toBe(false);
  });

  it('resets the low-count timer if N recovers before the threshold duration', () => {
    let mercy = createMercyState();
    const m = BALANCE.director.mercy;
    mercy = updateMercyState(mercy, 0, m.lineThreshold);
    mercy = updateMercyState(mercy, 1, m.lineThreshold + 10); // recovers
    mercy = updateMercyState(mercy, m.durationS + 0.1, m.lineThreshold); // low again, but only briefly
    expect(isMercyActive(mercy, m.durationS + 0.1)).toBe(false);
  });

  it('fires at most once per Passage', () => {
    let mercy = createMercyState();
    const m = BALANCE.director.mercy;
    mercy = updateMercyState(mercy, 0, m.lineThreshold);
    mercy = updateMercyState(mercy, m.durationS + 0.1, m.lineThreshold);
    expect(mercy.usedThisPassage).toBe(true);

    // Let it expire, then go low again — should not reactivate.
    const afterExpiry = m.durationS + 0.1 + m.suppressDurationS + 1;
    mercy = updateMercyState(mercy, afterExpiry, m.lineThreshold);
    mercy = updateMercyState(mercy, afterExpiry + m.durationS + 1, m.lineThreshold);
    expect(isMercyActive(mercy, afterExpiry + m.durationS + 1)).toBe(false);
  });
});
