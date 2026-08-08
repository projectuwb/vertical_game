// Stroke entity + class stats — Task 2.3 builds the full firing/damage pipeline. The
// class identity itself is declared here now because Task 2.2 (the Line's formation)
// already needs to know what a Stroke *is* before it knows what one *does*.

/** GAME_DESIGN.md §4: Hane (flick), Tome (stop), Harai (sweep). */
export type StrokeClass = 'hane' | 'tome' | 'harai';

export const STROKE_CLASSES: readonly StrokeClass[] = ['hane', 'tome', 'harai'];

/** Capitalised display form — GAME_DESIGN.md §7.2's Conversion Gate labels ("`→ Hane`,
 *  `→ Tome`, `→ Harai`") are the first place a class name needs to appear as on-screen
 *  text rather than just a colour/shape (Task 7.11). */
export const STROKE_CLASS_DISPLAY_NAME: Record<StrokeClass, string> = {
  hane: 'Hane',
  tome: 'Tome',
  harai: 'Harai',
};
