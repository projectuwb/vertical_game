// GAME_DESIGN.md §12 — the complete palette. "Exactly these, no others without logging
// a decision." Shared across every /render module so a colour only ever lives here once.
//
// Task 7.5 ("palette variants unlocked by milestones") is the logged exception the
// header line above already anticipates. Two constraints from §12's own palette table
// stay fixed across every variant, never offered as something a variant changes:
// Gold Leaf ("currency and only currency" — its colour is a semantic identity, not a
// mood) and Blot ("always the darkest thing on screen" — the mass-legibility mechanic,
// render/blot.ts's tier system, depends on this literally being true). Every variant
// only ever re-tunes the three Stroke-class colours (bone/jade/vermilion) and the
// background pair (slate/deep) — a genuinely different mood, never a functional change.
//
// `PALETTE` is a single mutable object (not `as const`), read by property access
// everywhere (`PALETTE.jade`, never destructured into a new binding at import time) —
// `setPaletteVariant` below reassigns its properties in place via `Object.assign`, so
// every existing call site across every /render module picks up a swap with zero
// changes needed there. Two derived caches elsewhere (`strokes.ts`'s `CLASS_COLOR`,
// `trail.ts`'s `CLASS_RGB`) are computed once from `PALETTE.jade`/etc at module load —
// `onPaletteChange` lets them re-derive themselves the same way, in the same in-place
// style, instead of drifting after a swap.

export interface PaletteColors {
  slate: string;
  deep: string;
  bone: string;
  jade: string;
  vermilion: string;
  goldLeaf: string;
  blot: string;
}

export type PaletteVariantId = 'default' | 'nocturne' | 'vermeil';

export const PALETTE_VARIANT_IDS: readonly PaletteVariantId[] = ['default', 'nocturne', 'vermeil'];

const GOLD_LEAF = '#C9A227'; // currency and only currency — fixed, see header comment
const BLOT = '#0E1116'; // always the darkest thing on screen — fixed, see header comment

const VARIANTS: Record<PaletteVariantId, PaletteColors> = {
  default: {
    slate: '#2A3440', // ground, road surface
    deep: '#171E26', // water either side, vignette
    bone: '#E8E2D4', // Harai class, road markings, primary text
    jade: '#4FB79A', // Hane class, positive gates
    vermilion: '#D33A2C', // Tome class, Seals, danger
    goldLeaf: GOLD_LEAF,
    blot: BLOT,
  },
  // A cooler, deeper-night mood — background pushed toward blue-black, the two accent
  // classes shifted toward cyan/magenta so the trio stays exactly as pairwise-distinct
  // (both by hue and by the same silhouette shapes underneath) as the default.
  nocturne: {
    slate: '#242C3D',
    deep: '#0F1420',
    bone: '#DCE4E8',
    jade: '#4FC7D6',
    vermilion: '#C23E7A',
    goldLeaf: GOLD_LEAF,
    blot: BLOT,
  },
  // A warmer, sun-dried mood — background toward umber, the two accent classes shifted
  // toward olive/amber, still comfortably distinct from bone and from each other.
  vermeil: {
    slate: '#3A2E24',
    deep: '#221A14',
    bone: '#EEE2C8',
    jade: '#8FA84A',
    vermilion: '#E0642A',
    goldLeaf: GOLD_LEAF,
    blot: BLOT,
  },
};

export const PALETTE: PaletteColors = { ...VARIANTS.default };

type Listener = () => void;
const listeners: Listener[] = [];

/** Registered by `strokes.ts`/`trail.ts` to re-derive their own palette-derived caches
 *  in place after a variant swap — see this file's header comment. Fires in module
 *  dependency order (`trail.ts` imports from `strokes.ts`, so `strokes.ts`'s listener
 *  is always registered, and therefore always runs, first), which is what lets
 *  `trail.ts`'s listener safely read `strokes.ts`'s already-updated `CLASS_COLOR`. */
export function onPaletteChange(listener: Listener): void {
  listeners.push(listener);
}

export function setPaletteVariant(id: PaletteVariantId): void {
  Object.assign(PALETTE, VARIANTS[id] ?? VARIANTS.default);
  for (const listener of listeners) listener();
}

export type PaletteColor = PaletteColors[keyof PaletteColors];

/**
 * Task 7.5's "unlocked by milestones" half — pure and parameterized on plain values
 * (not the `Profile` type itself) so this stays a one-directional dependency: /render
 * never needs to import /meta just to answer "is this variant unlocked yet." `default`
 * is always unlocked (nothing to earn for the palette every fresh profile starts with).
 */
export interface PaletteUnlockStats {
  readonly bestDistanceU: number;
  readonly totalSealsBroken: number;
}

const UNLOCK_REQUIREMENTS: Record<Exclude<PaletteVariantId, 'default'>, { readonly label: string; readonly isMet: (stats: PaletteUnlockStats) => boolean }> = {
  nocturne: {
    label: 'Reach 500u in a single Passage',
    isMet: (stats) => stats.bestDistanceU >= 500,
  },
  vermeil: {
    label: 'Break 3 Seals total',
    isMet: (stats) => stats.totalSealsBroken >= 3,
  },
};

export function isPaletteVariantUnlocked(id: PaletteVariantId, stats: PaletteUnlockStats): boolean {
  if (id === 'default') return true;
  return UNLOCK_REQUIREMENTS[id].isMet(stats);
}

/** Human-readable unlock requirement — `null` for `default`, which needs no unlocking. */
export function paletteVariantUnlockLabel(id: PaletteVariantId): string | null {
  if (id === 'default') return null;
  return UNLOCK_REQUIREMENTS[id].label;
}
