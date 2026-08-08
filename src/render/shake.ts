// Camera shake (GAME_DESIGN.md §12's "motion rules," Task 7.10): "camera shake only on
// Seal impacts and Flourish, ≤4px, ≤180ms... Respect prefers-reduced-motion by halving
// shake... never by removing gameplay feedback." Purely cosmetic — never read by /sim,
// so it lives entirely outside World (no determinism requirement) as a small piece of
// state main.ts owns and reassigns on trigger, the same shape as everything else in
// /render that decays a `*AtS` timestamp over a fixed duration (effects.ts's
// `flashAlpha`, trail.ts's persistence window).

import type { GameEventBus } from '../sim/events.js';

const SHAKE_DURATION_S = 0.18;
const SHAKE_MAX_PX = 4;

export interface ShakeState {
  readonly triggeredAtS: number | null;
}

export function createShakeState(): ShakeState {
  return { triggeredAtS: null };
}

export function triggerShake(timeS: number): ShakeState {
  return { triggeredAtS: timeS };
}

export interface ShakeOffset {
  readonly dx: number;
  readonly dy: number;
}

const NO_SHAKE: ShakeOffset = { dx: 0, dy: 0 };

/**
 * A fresh random direction each call (rather than one fixed direction decaying in a
 * straight line) is what reads as "shake" rather than "screen slides a few px and
 * settles" — /render is the one place outside the seeded PRNG `Math.random` is allowed
 * (this never touches gameplay state, so determinism doesn't apply). `reducedMotion`
 * halves the amplitude per §12's own instruction, rather than suppressing the shake
 * outright — the trigger is still real feedback either way.
 */
export function currentShakeOffset(state: ShakeState, timeS: number, reducedMotion: boolean): ShakeOffset {
  if (state.triggeredAtS === null) return NO_SHAKE;
  const age = timeS - state.triggeredAtS;
  if (age < 0 || age >= SHAKE_DURATION_S) return NO_SHAKE;
  const amplitude = (reducedMotion ? SHAKE_MAX_PX / 2 : SHAKE_MAX_PX) * (1 - age / SHAKE_DURATION_S);
  const angle = Math.random() * Math.PI * 2;
  return { dx: Math.cos(angle) * amplitude, dy: Math.sin(angle) * amplitude };
}

/** Re-subscribed to each Passage's fresh event bus, same pattern as `attachSfx`/
 *  `attachFlourishHaptics` — GAME_DESIGN.md §12 names Flourish as one of exactly two
 *  camera-shake triggers (the other, Seal impact, is a Stroke-loss diff main.ts already
 *  computes for haptics, not a distinct event). */
export function attachFlourishShake(events: GameEventBus, onTrigger: () => void): void {
  events.on('flourishTriggered', onTrigger);
}
