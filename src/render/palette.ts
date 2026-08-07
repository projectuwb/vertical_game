// GAME_DESIGN.md §12 — the complete palette. "Exactly these, no others without logging
// a decision." Shared across every /render module so a colour only ever lives here once.

export const PALETTE = {
  slate: '#2A3440', // ground, road surface
  deep: '#171E26', // water either side, vignette
  bone: '#E8E2D4', // Harai class, road markings, primary text
  jade: '#4FB79A', // Hane class, positive gates
  vermilion: '#D33A2C', // Tome class, Seals, danger
  goldLeaf: '#C9A227', // currency and only currency
  blot: '#0E1116', // the enemy, always the darkest thing on screen
} as const;

export type PaletteColor = (typeof PALETTE)[keyof typeof PALETTE];
