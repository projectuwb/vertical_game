// In-run HUD/screen glue (Task 4.3): the shared vocabulary main.ts's screen-transition
// wiring uses for which of the game's six states is currently showing — two
// canvas-driven ('playing', gameplay itself; 'replaying', Task 7.2's recorded-input
// playback — neither has a DOM screen over it) and four DOM overlays
// (title/summary/inkstone/settings). Kept here, not inlined in main.ts, so
// /ui owns the shape of "what screen is this" the same way /sim owns World's shape;
// the actual current-state variable and transition logic still live in main.ts, which
// already owns every other piece of top-level mutable app state (`world`, `deathAtRealMs`).
export type AppState = 'title' | 'playing' | 'replaying' | 'summary' | 'inkstone' | 'settings';
