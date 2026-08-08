import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { computeRowClassCounts, type LineState, type LineStroke } from '../../src/sim/line.js';
import type { StrokeClass } from '../../src/sim/stroke.js';
import {
  createPhraseState,
  detectPhraseEligibility,
  isSweepActive,
  stepPhrases,
} from '../../src/sim/phrases.js';
import { createBlotPool, isBlotStaggered, spawnBlot, updateBlotMotion } from '../../src/sim/blot.js';

function stroke(cls: StrokeClass): LineStroke {
  return { class: cls };
}

/** Builds a Line from an explicit front-row array (padded/truncated to rowSize with a
 *  filler class) plus an optional back-row tail, so "front row" composition is exactly
 *  what each test says it is regardless of BALANCE.line.rowSize's actual value. */
function lineFrom(front: StrokeClass[], back: StrokeClass[] = []): LineState {
  const rowSize = BALANCE.line.rowSize;
  if (front.length > rowSize) throw new Error('front row array longer than rowSize');
  return { strokes: [...front.map(stroke), ...back.map(stroke)] };
}

describe('detectPhraseEligibility', () => {
  it('is unqualified below minSameClassInFrontRow', () => {
    for (let count = 0; count < BALANCE.phrase.minSameClassInFrontRow; count++) {
      const e = detectPhraseEligibility(count);
      expect(e.qualified).toBe(false);
      expect(e.isFiveOfKind).toBe(false);
    }
  });

  it('is qualified but not 5-of-a-kind between the threshold and rowSize', () => {
    for (let count = BALANCE.phrase.minSameClassInFrontRow; count < BALANCE.phrase.rowSize; count++) {
      const e = detectPhraseEligibility(count);
      expect(e.qualified).toBe(true);
      expect(e.isFiveOfKind).toBe(false);
    }
  });

  it('is 5-of-a-kind at and above rowSize', () => {
    expect(detectPhraseEligibility(BALANCE.phrase.rowSize)).toEqual({ qualified: true, isFiveOfKind: true });
  });
});

// 30 hand-written formations (Task 2.9's acceptance bar), each asserting the full
// LineState -> computeRowClassCounts -> detectPhraseEligibility pipeline end to end —
// not just the isolated count function above — so the "front row only, arrival order,
// back row never counts" property is exercised for real, per class, at every relevant
// boundary (0, 1, threshold-1, threshold, rowSize-1, rowSize).
interface Formation {
  readonly name: string;
  readonly line: LineState;
  readonly expected: Record<StrokeClass, { qualified: boolean; isFiveOfKind: boolean }>;
}

const UNQUALIFIED = { qualified: false, isFiveOfKind: false };
const QUALIFIED = { qualified: true, isFiveOfKind: false };
const FIVE_OF_KIND = { qualified: true, isFiveOfKind: true };

const FORMATIONS: Formation[] = [
  { name: '5 Hane', line: lineFrom(['hane', 'hane', 'hane', 'hane', 'hane']), expected: { hane: FIVE_OF_KIND, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '5 Tome', line: lineFrom(['tome', 'tome', 'tome', 'tome', 'tome']), expected: { hane: UNQUALIFIED, tome: FIVE_OF_KIND, harai: UNQUALIFIED } },
  { name: '5 Harai', line: lineFrom(['harai', 'harai', 'harai', 'harai', 'harai']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: FIVE_OF_KIND } },
  { name: '4 Hane + 1 Tome', line: lineFrom(['hane', 'hane', 'hane', 'hane', 'tome']), expected: { hane: QUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '4 Tome + 1 Harai', line: lineFrom(['tome', 'tome', 'tome', 'tome', 'harai']), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: '4 Harai + 1 Hane', line: lineFrom(['harai', 'harai', 'harai', 'harai', 'hane']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: QUALIFIED } },
  { name: '3 Hane + 2 Tome (exact threshold)', line: lineFrom(['hane', 'hane', 'hane', 'tome', 'tome']), expected: { hane: QUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '2 Hane + 3 Tome', line: lineFrom(['hane', 'hane', 'tome', 'tome', 'tome']), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: '3 Tome + 2 Harai', line: lineFrom(['tome', 'tome', 'tome', 'harai', 'harai']), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: '2 Tome + 3 Harai', line: lineFrom(['tome', 'tome', 'harai', 'harai', 'harai']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: QUALIFIED } },
  { name: '3 Harai + 2 Hane', line: lineFrom(['harai', 'harai', 'harai', 'hane', 'hane']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: QUALIFIED } },
  { name: '2 Harai + 3 Hane', line: lineFrom(['harai', 'harai', 'hane', 'hane', 'hane']), expected: { hane: QUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: 'even 2/2/1 split (no class reaches 3)', line: lineFrom(['hane', 'hane', 'tome', 'tome', 'harai']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: 'even-ish 2/1/2 split', line: lineFrom(['hane', 'hane', 'tome', 'harai', 'harai']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '1/1/1/1/1 impossible with 3 classes but padded 2/2/1', line: lineFrom(['tome', 'harai', 'tome', 'harai', 'hane']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: 'empty Line', line: lineFrom([]), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '1 Hane only', line: lineFrom(['hane']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '2 Tome only (Line smaller than rowSize)', line: lineFrom(['tome', 'tome']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '3 Harai only (Line smaller than rowSize, still qualifies)', line: lineFrom(['harai', 'harai', 'harai']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: QUALIFIED } },
  { name: '4 Hane only (Line smaller than rowSize)', line: lineFrom(['hane', 'hane', 'hane', 'hane']), expected: { hane: QUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '5 Hane front + 5 Tome back (back row never counts)', line: lineFrom(['hane', 'hane', 'hane', 'hane', 'hane'], ['tome', 'tome', 'tome', 'tome', 'tome']), expected: { hane: FIVE_OF_KIND, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '3 Tome front (qualified) + 20 Harai back (arrival order keeps it in back)', line: lineFrom(['tome', 'tome', 'tome', 'hane', 'hane'], Array<StrokeClass>(20).fill('harai')), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: '5 Harai front + mixed back of 100', line: lineFrom(['harai', 'harai', 'harai', 'harai', 'harai'], Array<StrokeClass>(100).fill('hane')), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: FIVE_OF_KIND } },
  { name: '3 Hane + 1 Tome + 1 Harai', line: lineFrom(['hane', 'hane', 'hane', 'tome', 'harai']), expected: { hane: QUALIFIED, tome: UNQUALIFIED, harai: UNQUALIFIED } },
  { name: '1 Hane + 3 Tome + 1 Harai', line: lineFrom(['hane', 'tome', 'tome', 'tome', 'harai']), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: '1 Hane + 1 Tome + 3 Harai', line: lineFrom(['hane', 'tome', 'harai', 'harai', 'harai']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: QUALIFIED } },
  { name: 'order shuffled: Tome/Hane/Tome/Hane/Tome still 3 Tome', line: lineFrom(['tome', 'hane', 'tome', 'hane', 'tome']), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: 'order shuffled: Harai/Harai/Hane/Harai/Hane still 3 Harai', line: lineFrom(['harai', 'harai', 'hane', 'harai', 'hane']), expected: { hane: UNQUALIFIED, tome: UNQUALIFIED, harai: QUALIFIED } },
  { name: '4 Tome + 1 Hane, large back row of Hane (dilutes overall but not front)', line: lineFrom(['tome', 'tome', 'tome', 'tome', 'hane'], Array<StrokeClass>(395).fill('hane')), expected: { hane: UNQUALIFIED, tome: QUALIFIED, harai: UNQUALIFIED } },
  { name: '5 Tome exactly at N=5 (whole Line is the front row)', line: lineFrom(['tome', 'tome', 'tome', 'tome', 'tome']), expected: { hane: UNQUALIFIED, tome: FIVE_OF_KIND, harai: UNQUALIFIED } },
];

describe('Phrase detection: 30 hand-written formations', () => {
  expect(FORMATIONS.length).toBeGreaterThanOrEqual(30);

  it.each(FORMATIONS)('$name', ({ line, expected }) => {
    const { front } = computeRowClassCounts(line);
    for (const cls of ['hane', 'tome', 'harai'] as const) {
      expect(detectPhraseEligibility(front[cls])).toEqual(expected[cls]);
    }
  });
});

describe('stepPhrases: cycle timing', () => {
  it('fires exactly once every cycleS while a class stays qualified', () => {
    const front = { hane: 3, tome: 0, harai: 0 };
    const blotPool = createBlotPool();
    let state = createPhraseState();
    let firedCount = 0;
    let timeS = 0;
    const dt = 1 / 60;
    const steps = Math.round((BALANCE.phrase.cycleS * 2.5) / dt);
    for (let i = 0; i < steps; i++) {
      timeS += dt;
      const result = stepPhrases(state, dt, timeS, front, blotPool, 0, 0);
      state = result.state;
      firedCount += result.fired.length;
    }
    expect(firedCount).toBe(2); // 2.5 cycles elapsed -> 2 complete fires
  });

  it('resets progress (no partial credit) the instant the class drops below threshold', () => {
    const blotPool = createBlotPool();
    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;

    // Almost a full cycle qualified...
    const almostSteps = Math.round((BALANCE.phrase.cycleS - dt * 2) / dt);
    for (let i = 0; i < almostSteps; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 3, tome: 0, harai: 0 }, blotPool, 0, 0).state;
    }
    expect(state.hane.timeInCycleS).toBeGreaterThan(0);

    // ...then drops out for one step...
    timeS += dt;
    state = stepPhrases(state, dt, timeS, { hane: 2, tome: 0, harai: 0 }, blotPool, 0, 0).state;
    expect(state.hane.timeInCycleS).toBe(0);

    // ...requalifying does not fire early just because it was close before.
    let fired = 0;
    for (let i = 0; i < almostSteps; i++) {
      timeS += dt;
      const result = stepPhrases(state, dt, timeS, { hane: 3, tome: 0, harai: 0 }, blotPool, 0, 0);
      state = result.state;
      fired += result.fired.length;
    }
    expect(fired).toBe(0);
  });

  it('5-of-a-kind uses the faster cycle and reports isFiveOfKind on the fire event', () => {
    const blotPool = createBlotPool();
    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    let firstFire: { cls: StrokeClass; isFiveOfKind: boolean } | undefined;
    const maxSteps = Math.round((BALANCE.phrase.fiveOfKindCycleS + 0.5) / dt);
    for (let i = 0; i < maxSteps && firstFire === undefined; i++) {
      timeS += dt;
      const result = stepPhrases(state, dt, timeS, { hane: 0, tome: 5, harai: 0 }, blotPool, 0, 0);
      state = result.state;
      if (result.fired.length > 0) firstFire = result.fired[0];
    }
    expect(firstFire).toEqual({ cls: 'tome', isFiveOfKind: true });
    expect(timeS).toBeCloseTo(BALANCE.phrase.fiveOfKindCycleS, 1);
  });
});

describe('Hane Phrase — Scatter', () => {
  it('damages the nearest Blot within the forward cone on fire', () => {
    const blotPool = createBlotPool();
    const b = spawnBlot(blotPool, 'smudge', 0, 5);
    if (b === undefined) throw new Error('spawn failed');
    const hpBefore = b.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    for (let i = 0; i < Math.round(BALANCE.phrase.cycleS / dt) + 2; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 3, tome: 0, harai: 0 }, blotPool, 0, 0).state;
    }
    expect(b.hp).toBe(hpBefore - BALANCE.phrase.hane.scatterDamage);
  });

  it('never hits a Blot behind the Brush or outside the 45° cone', () => {
    const blotPool = createBlotPool();
    const behind = spawnBlot(blotPool, 'smudge', 0, -5);
    // Far enough to the side that atan2(dx, dz) exceeds the 22.5° half-angle at this depth.
    const wide = spawnBlot(blotPool, 'smudge', 20, 5);
    if (behind === undefined || wide === undefined) throw new Error('spawn failed');
    const behindHp = behind.hp;
    const wideHp = wide.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    for (let i = 0; i < Math.round(BALANCE.phrase.cycleS / dt) + 2; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 3, tome: 0, harai: 0 }, blotPool, 0, 0).state;
    }
    expect(behind.hp).toBe(behindHp);
    expect(wide.hp).toBe(wideHp);
  });

  it('never hits more than scatterCount Blot in one fire', () => {
    const blotPool = createBlotPool();
    const spread = BALANCE.phrase.hane.scatterCount + 5;
    for (let i = 0; i < spread; i++) {
      spawnBlot(blotPool, 'smudge', 0, 3 + i * 0.01); // tightly packed, all in the cone
    }

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    for (let i = 0; i < Math.round(BALANCE.phrase.cycleS / dt) + 2; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 3, tome: 0, harai: 0 }, blotPool, 0, 0).state;
    }
    let hitCount = 0;
    blotPool.forEachActive((b) => {
      if (b.hp < BALANCE.blot.smudge.hp) hitCount++;
    });
    expect(hitCount).toBe(BALANCE.phrase.hane.scatterCount);
  });

  it('5-of-a-kind deals fiveOfKindDamageMult damage', () => {
    const blotPool = createBlotPool();
    const b = spawnBlot(blotPool, 'crust', 0, 5); // high HP so it survives the hit
    if (b === undefined) throw new Error('spawn failed');
    const hpBefore = b.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    for (let i = 0; i < Math.round(BALANCE.phrase.fiveOfKindCycleS / dt) + 2; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 5, tome: 0, harai: 0 }, blotPool, 0, 0).state;
    }
    expect(hpBefore - b.hp).toBeCloseTo(BALANCE.phrase.hane.scatterDamage * BALANCE.phrase.fiveOfKindDamageMult, 9);
  });
});

describe('Tome Phrase — Press', () => {
  it('damages and staggers a Blot inside the corridor', () => {
    const blotPool = createBlotPool();
    const b = spawnBlot(blotPool, 'crust', 0.5, 10); // inside pressWidthU/pressTravelU, high HP
    if (b === undefined) throw new Error('spawn failed');
    const hpBefore = b.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    for (let i = 0; i < Math.round(BALANCE.phrase.cycleS / dt) + 2; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 0, tome: 3, harai: 0 }, blotPool, 0, 0).state;
    }
    expect(hpBefore - b.hp).toBeCloseTo(BALANCE.phrase.tome.pressDamage, 9);
    // staggeredUntilS was set relative to whichever step actually fired (a couple of
    // buffer steps before this loop's final timeS, since the loop overruns by 2 steps
    // to tolerate float drift on the cycle boundary) — still comfortably within the
    // 0.4s stagger window this soon after.
    expect(isBlotStaggered(b, timeS)).toBe(true);
    expect(b.staggeredUntilS).toBeGreaterThan(timeS);
    expect(b.staggeredUntilS).toBeLessThanOrEqual(timeS + BALANCE.phrase.tome.staggerS);
  });

  it('a staggered Blot does not move', () => {
    const blotPool = createBlotPool();
    const b = spawnBlot(blotPool, 'smudge', 0, 10);
    if (b === undefined) throw new Error('spawn failed');
    b.staggeredUntilS = 5;
    updateBlotMotion(blotPool, 1, 0, 4); // timeS=4 < staggeredUntilS=5
    expect(b.z).toBe(10);
    updateBlotMotion(blotPool, 1, 0, 5.1); // stagger has now expired
    expect(b.z).toBeLessThan(10);
  });

  it('never damages a Blot outside the corridor (too far to the side or beyond pressTravelU)', () => {
    const blotPool = createBlotPool();
    const tooWide = spawnBlot(blotPool, 'smudge', BALANCE.phrase.tome.pressWidthU, 5);
    const tooFar = spawnBlot(blotPool, 'smudge', 0, BALANCE.phrase.tome.pressTravelU + 5);
    if (tooWide === undefined || tooFar === undefined) throw new Error('spawn failed');
    const wideHp = tooWide.hp;
    const farHp = tooFar.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    for (let i = 0; i < Math.round(BALANCE.phrase.cycleS / dt) + 2; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 0, tome: 3, harai: 0 }, blotPool, 0, 0).state;
    }
    expect(tooWide.hp).toBe(wideHp);
    expect(tooFar.hp).toBe(farHp);
  });
});

describe('Harai Phrase — Sweep', () => {
  it('is sustained: ticks sweepDamagePerTick at sweepTicksPerS for sweepDurationS, hitting everything ahead', () => {
    const blotPool = createBlotPool();
    const near = spawnBlot(blotPool, 'crust', -3, 2);
    const far = spawnBlot(blotPool, 'crust', 3, 500); // "pierces everything" — full lane, any depth
    if (near === undefined || far === undefined) throw new Error('spawn failed');
    const nearHpBefore = near.hp;
    const farHpBefore = far.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    // Run past the trigger cycle plus the full sweep duration.
    const totalSteps = Math.round((BALANCE.phrase.cycleS + BALANCE.phrase.harai.sweepDurationS + 0.2) / dt);
    let sawActiveSweep = false;
    for (let i = 0; i < totalSteps; i++) {
      timeS += dt;
      const result = stepPhrases(state, dt, timeS, { hane: 0, tome: 0, harai: 3 }, blotPool, 0, 0);
      state = result.state;
      if (isSweepActive(state.haraiSweep)) sawActiveSweep = true;
    }

    expect(sawActiveSweep).toBe(true);
    expect(isSweepActive(state.haraiSweep)).toBe(false); // has ended by now
    const expectedTicks = Math.floor(BALANCE.phrase.harai.sweepDurationS * BALANCE.phrase.harai.sweepTicksPerS);
    const expectedDamage = expectedTicks * BALANCE.phrase.harai.sweepDamagePerTick;
    expect(nearHpBefore - near.hp).toBeCloseTo(expectedDamage, 6);
    expect(farHpBefore - far.hp).toBeCloseTo(expectedDamage, 6); // "pierces everything"
  });

  it('never damages a Blot behind the Brush', () => {
    const blotPool = createBlotPool();
    const behind = spawnBlot(blotPool, 'smudge', 0, -5);
    if (behind === undefined) throw new Error('spawn failed');
    const hpBefore = behind.hp;

    let state = createPhraseState();
    const dt = 1 / 60;
    let timeS = 0;
    const totalSteps = Math.round((BALANCE.phrase.cycleS + BALANCE.phrase.harai.sweepDurationS + 0.2) / dt);
    for (let i = 0; i < totalSteps; i++) {
      timeS += dt;
      state = stepPhrases(state, dt, timeS, { hane: 0, tome: 0, harai: 3 }, blotPool, 0, 0).state;
    }
    expect(behind.hp).toBe(hpBefore);
  });
});
