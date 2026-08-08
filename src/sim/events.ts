// sim → render/audio event schema (Task 4.4, first real use of Task 1.4's EventBus).
// Lives in its own file, not world.ts, so the individual subsystem modules that emit
// these (projectiles.ts today; world.ts itself for the rest) can share the type without
// a circular import on world.ts, which is what actually composes and imports all of them.
//
// Exactly the four events GAME_DESIGN.md §12's audio paragraph names — no more: Fire
// (per class), Recruitment, Gate, Seal. /audio is the only real consumer today, but
// /render could subscribe to the same bus for hit-flash-style cosmetic feedback later
// without /sim ever knowing either of them exists.

import type { EventBus } from '../core/events.js';
import type { StrokeClass } from './stroke.js';

export interface GameEvents {
  readonly fire: { readonly class: StrokeClass };
  readonly recruit: { readonly class: StrokeClass };
  readonly gateResolved: Record<string, never>;
  readonly sealApproach: { readonly sealIndex: number };
}

export type GameEventBus = EventBus<GameEvents>;
