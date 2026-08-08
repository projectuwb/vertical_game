// sim → render/audio event schema (Task 4.4, first real use of Task 1.4's EventBus).
// Lives in its own file, not world.ts, so the individual subsystem modules that emit
// these (projectiles.ts today; world.ts itself for the rest) can share the type without
// a circular import on world.ts, which is what actually composes and imports all of them.
//
// The four events GAME_DESIGN.md §12's audio paragraph names (Fire per class,
// Recruitment, Gate, Seal), plus `flourishTriggered` (Task 5.4, TECH_SPEC.md §11:
// "Haptics via Capacitor Haptics on Seal impact, Flourish, and Line loss" — a real sweep
// firing has no other externally-observable World signal `platform/haptics.ts`'s
// consumer could diff against, unlike Line loss and Seal-impact stroke loss, which
// main.ts already observes directly by comparing `world.line.strokes.length` step to
// step). /audio and /platform are the only real consumers today, but /render could
// subscribe to the same bus for hit-flash-style cosmetic feedback later without /sim
// ever knowing either of them exists.

import type { EventBus } from '../core/events.js';
import type { StrokeClass } from './stroke.js';

export interface GameEvents {
  readonly fire: { readonly class: StrokeClass };
  readonly recruit: { readonly class: StrokeClass };
  readonly gateResolved: Record<string, never>;
  readonly sealApproach: { readonly sealIndex: number };
  readonly flourishTriggered: Record<string, never>;
}

export type GameEventBus = EventBus<GameEvents>;
