// The shape a recorded Passage needs to be reproduced bit-for-bit (Task 7.2) — seed +
// the exact `WorldInput` tape `stepWorld` consumed each fixed step, plus whether the
// scripted first-run opening (GAME_DESIGN.md §13) was active, since that changes early
// Director behaviour and has to match for a faithful replay. Shared between main.ts
// (which records it and drives live playback) and Task 7.4's `render/scroll.ts` (which
// replays it silently, off-loop, to reconstruct a whole Passage's ink trail).

import type { WorldInput } from '../sim/world.js';

export interface Replay {
  readonly seed: number;
  readonly firstRunTeaching: boolean;
  readonly inputs: readonly WorldInput[];
}
