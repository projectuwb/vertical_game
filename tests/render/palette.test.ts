import { afterEach, describe, expect, it } from 'vitest';
import {
  isPaletteVariantUnlocked,
  onPaletteChange,
  PALETTE,
  paletteVariantUnlockLabel,
  PALETTE_VARIANT_IDS,
  setPaletteVariant,
} from '../../src/render/palette.js';
import { CLASS_COLOR } from '../../src/render/strokes.js';

// Every test here mutates the module-level PALETTE singleton (Task 7.5's whole
// mechanism) — reset it afterward so no test's variant choice leaks into another test
// in this file, matching a module-level-state discipline this codebase doesn't usually
// need but this specific feature genuinely does.
afterEach(() => {
  setPaletteVariant('default');
});

describe('setPaletteVariant', () => {
  it('mutates PALETTE in place — the same object reference before and after', () => {
    const ref = PALETTE;
    setPaletteVariant('nocturne');
    expect(PALETTE).toBe(ref);
    expect(PALETTE.jade).not.toBe('#4FB79A'); // changed to nocturne's own jade
  });

  it('falling back to default restores the exact original values', () => {
    const originalJade = PALETTE.jade;
    const originalBlot = PALETTE.blot;
    setPaletteVariant('vermeil');
    expect(PALETTE.jade).not.toBe(originalJade);
    setPaletteVariant('default');
    expect(PALETTE.jade).toBe(originalJade);
    expect(PALETTE.blot).toBe(originalBlot); // fixed across every variant, see palette.ts's header
  });

  it('Gold Leaf and Blot never change across any variant — fixed by design, not by accident', () => {
    const goldLeaf = PALETTE.goldLeaf;
    const blot = PALETTE.blot;
    for (const id of PALETTE_VARIANT_IDS) {
      setPaletteVariant(id);
      expect(PALETTE.goldLeaf).toBe(goldLeaf);
      expect(PALETTE.blot).toBe(blot);
    }
  });

  it('every variant keeps the three Stroke-class colours pairwise distinct from each other and from the background', () => {
    for (const id of PALETTE_VARIANT_IDS) {
      setPaletteVariant(id);
      const classColors = [PALETTE.jade, PALETTE.vermilion, PALETTE.bone];
      expect(new Set(classColors).size).toBe(3);
      for (const c of classColors) {
        expect(c).not.toBe(PALETTE.slate);
        expect(c).not.toBe(PALETTE.deep);
      }
    }
  });

  it("propagates to strokes.ts's CLASS_COLOR, not just PALETTE itself", () => {
    setPaletteVariant('nocturne');
    expect(CLASS_COLOR.hane).toBe(PALETTE.jade);
    expect(CLASS_COLOR.tome).toBe(PALETTE.vermilion);
    expect(CLASS_COLOR.harai).toBe(PALETTE.bone);
  });
});

describe('onPaletteChange', () => {
  it('fires every registered listener on a variant swap', () => {
    let calls = 0;
    onPaletteChange(() => {
      calls++;
    });
    setPaletteVariant('vermeil');
    expect(calls).toBe(1);
    setPaletteVariant('default');
    expect(calls).toBe(2);
  });
});

describe('isPaletteVariantUnlocked / paletteVariantUnlockLabel', () => {
  it('default is always unlocked and has no unlock label', () => {
    expect(isPaletteVariantUnlocked('default', { bestDistanceU: 0, totalSealsBroken: 0 })).toBe(true);
    expect(paletteVariantUnlockLabel('default')).toBeNull();
  });

  it('nocturne unlocks at 500u best distance, not before', () => {
    expect(isPaletteVariantUnlocked('nocturne', { bestDistanceU: 499, totalSealsBroken: 0 })).toBe(false);
    expect(isPaletteVariantUnlocked('nocturne', { bestDistanceU: 500, totalSealsBroken: 0 })).toBe(true);
    expect(paletteVariantUnlockLabel('nocturne')).not.toBeNull();
  });

  it('vermeil unlocks at 3 total Seals broken, not before', () => {
    expect(isPaletteVariantUnlocked('vermeil', { bestDistanceU: 0, totalSealsBroken: 2 })).toBe(false);
    expect(isPaletteVariantUnlocked('vermeil', { bestDistanceU: 0, totalSealsBroken: 3 })).toBe(true);
    expect(paletteVariantUnlockLabel('vermeil')).not.toBeNull();
  });
});
