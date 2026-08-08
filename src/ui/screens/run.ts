// In-run HUD/screen glue (Task 4.3): the shared vocabulary main.ts's screen-transition
// wiring uses for which of the game's five states is currently showing — one
// canvas-driven ('playing', gameplay itself, with no DOM screen over it) and four DOM
// overlays (title/summary/inkstone/settings). Kept here, not inlined in main.ts, so
// /ui owns the shape of "what screen is this" the same way /sim owns World's shape;
// the actual current-state variable and transition logic still live in main.ts, which
// already owns every other piece of top-level mutable app state (`world`, `deathAtRealMs`).
export type AppState = 'title' | 'playing' | 'summary' | 'inkstone' | 'settings';
