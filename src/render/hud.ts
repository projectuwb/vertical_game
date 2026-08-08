// HUD layer (Task 2.11, superseded by Task 4.3's /ui/screens/summary.ts for the actual
// stats display). This file now owns only the one piece of canvas-side death timing
// that still belongs here: how far into its bleed-out the ink trail is, real wall-clock
// seconds since death (world.timeS itself freezes the instant isDead flips). The
// summary screen's own DOM panel is a translucent overlay on top of that continuing
// canvas animation, not a replacement for it.

const BLEED_DURATION_S = 1.2;

export function inkBleedFraction(elapsedS: number): number {
  return Math.min(1, Math.max(0, elapsedS / BLEED_DURATION_S));
}
