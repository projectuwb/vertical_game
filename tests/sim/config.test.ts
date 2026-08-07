import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';

describe('BALANCE', () => {
  it('is deeply frozen', () => {
    expect(Object.isFrozen(BALANCE)).toBe(true);
    expect(Object.isFrozen(BALANCE.strokes)).toBe(true);
    expect(Object.isFrozen(BALANCE.strokes.hane)).toBe(true);
    expect(Object.isFrozen(BALANCE.seals.order)).toBe(true);

    expect(() => {
      'use strict';
      // @ts-expect-error — deliberately testing that a frozen object rejects mutation.
      BALANCE.strokes.hane.damage = 999;
    }).toThrow(TypeError);
    expect(BALANCE.strokes.hane.damage).toBe(1);
  });

  it('matches spot-checked values from GAME_DESIGN.md', () => {
    // §3
    expect(BALANCE.lane.width).toBe(9);
    expect(BALANCE.forwardSpeed.capUPerS).toBe(34);
    expect(BALANCE.control.dragUnitsPerPixel).toBe(0.028);
    // §4
    expect(BALANCE.strokes.tome.damage).toBe(9);
    expect(BALANCE.strokes.harai.vsSlips).toBe(2.0);
    expect(BALANCE.phrase.cycleS).toBe(3.0);
    // §5
    expect(BALANCE.line.startCount).toBe(3);
    expect(BALANCE.line.rowSize * BALANCE.line.densityBlockRowThreshold).toBe(60);
    // §6
    expect(BALANCE.wetness.drainPerSWhileFiring).toBe(6.0);
    expect(BALANCE.flourish.cost).toBe(40);
    // §8
    expect(BALANCE.blot.crust.hp).toBe(25);
    expect(BALANCE.seals.hpBase).toBe(420);
    expect(BALANCE.seals.hpGrowthPerIndex).toBe(1.62);
    // §9
    expect(BALANCE.director.waveIntervalMinS).toBe(2.4);
    // §10
    expect(BALANCE.economy.goldLeafPerSealBroken).toBe(120);
    expect(BALANCE.inkstone.secondDraft.reviveLevels).toEqual([1, 4, 8]);
  });

  it('computes the seal HP curve as 420 * 1.62^index', () => {
    const hp = (index: number): number =>
      BALANCE.seals.hpBase * Math.pow(BALANCE.seals.hpGrowthPerIndex, index);
    expect(hp(0)).toBeCloseTo(420, 6);
    expect(hp(1)).toBeCloseTo(680.4, 6);
  });

  it('computes an Inkstone cost curve as round(base * 1.38^L)', () => {
    const cost = (base: number, level: number): number =>
      Math.round(base * Math.pow(BALANCE.inkstone.costGrowthPerLevel, level));
    expect(cost(BALANCE.inkstone.grind.baseCost, 0)).toBe(30);
    expect(cost(BALANCE.inkstone.grind.baseCost, 5)).toBe(
      Math.round(30 * Math.pow(1.38, 5)),
    );
  });
});

describe('no stray gameplay magic numbers in /sim', () => {
  // Enforces Task 1.6's acceptance criterion mechanically: every /sim source file other
  // than config.ts must draw its numbers from BALANCE. Heuristic, not a full parser —
  // exempts 0, 1 (and their negatives), and literals used as array indices ([n]).
  const simDir = join(__dirname, '../../src/sim');

  function listSimFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...listSimFiles(full));
      } else if (entry.endsWith('.ts') && entry !== 'config.ts') {
        files.push(full);
      }
    }
    return files;
  }

  function stripCommentsAndStrings(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  }

  function findMagicNumbers(source: string): string[] {
    const cleaned = stripCommentsAndStrings(source);
    const offenders: string[] = [];
    const numberPattern = /-?\b\d+(?:\.\d+)?\b/g;
    let match: RegExpExecArray | null;
    while ((match = numberPattern.exec(cleaned)) !== null) {
      const token = match[0];
      const value = Number(token);
      if (value === 0 || value === 1 || value === -1) continue;

      const start = match.index;
      const before = cleaned.slice(Math.max(0, start - 1), start);
      const end = start + token.length;
      const after = cleaned.slice(end, end + 1);
      // Array index: `[<number>]`.
      if (before === '[' && after === ']') continue;

      const lineNumber = cleaned.slice(0, start).split('\n').length;
      offenders.push(`${token} on line ${lineNumber}`);
    }
    return offenders;
  }

  for (const file of listSimFiles(simDir)) {
    const relative = file.slice(simDir.length + 1);
    it(`${relative} has no stray numeric literals`, () => {
      const source = readFileSync(file, 'utf8');
      const offenders = findMagicNumbers(source);
      expect(offenders).toEqual([]);
    });
  }
});
