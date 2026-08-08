// Capacitor Haptics wrapper (Task 5.4, TECH_SPEC.md §11: "Haptics via Capacitor Haptics
// on Seal impact, Flourish, and Line loss; degrade silently on web"). `@capacitor/haptics`
// itself already degrades to a silent no-op in a plain browser (Capacitor's own web
// implementation of the plugin) — this module's own `.catch` on every call is belt and
// braces for the one real remaining failure mode: a device with the API present but no
// actual vibration hardware/permission, which should never surface as an app-breaking
// error over something this purely cosmetic.

import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { GameEventBus } from '../sim/events.js';

function safeImpact(style: ImpactStyle): void {
  Haptics.impact({ style }).catch(() => {
    // No haptics hardware, no permission, or plain web — nothing to recover from.
  });
}

/**
 * Subscribes to a Passage's event bus for the two events `/sim` already emits that
 * TECH_SPEC.md §11 names (`flourishTriggered`; Seal-impact/Line-loss have no dedicated
 * event — see `attachLineLossHaptics` below, which instead diffs `World.line.strokes`
 * directly, the same way `main.ts` already tracks other per-step deltas). One call per
 * fresh World's own bus, same lifetime as `attachSfx` (Task 4.4).
 */
export function attachFlourishHaptics(events: GameEventBus): void {
  events.on('flourishTriggered', () => safeImpact(ImpactStyle.Medium));
}

/**
 * Call once per fixed step from `main.ts`'s `update` callback, after `stepWorld` — no
 * `/sim` event exists for "the Line just lost N Strokes" (Task 4.4 deliberately scoped
 * `GameEvents` to only what §12's *audio* paragraph names), so this diffs
 * `world.line.strokes.length` directly instead of adding one. Distinguishes a Seal's own
 * attack from ordinary Blot/Gate/Sealstack contact by whether a Seal encounter was
 * active the moment the loss happened (`sealActive`) — TECH_SPEC.md §11 asks for two
 * different haptic cues, not one generic "you got hit."
 */
export function fireLineLossHaptic(strokesLostThisStep: number, sealActive: boolean): void {
  if (strokesLostThisStep <= 0) return;
  safeImpact(sealActive ? ImpactStyle.Heavy : ImpactStyle.Light);
}
