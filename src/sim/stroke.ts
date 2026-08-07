// Stroke entity + class stats — Task 2.3 builds the full firing/damage pipeline. The
// class identity itself is declared here now because Task 2.2 (the Line's formation)
// already needs to know what a Stroke *is* before it knows what one *does*.

/** GAME_DESIGN.md §4: Hane (flick), Tome (stop), Harai (sweep). */
export type StrokeClass = 'hane' | 'tome' | 'harai';

export const STROKE_CLASSES: readonly StrokeClass[] = ['hane', 'tome', 'harai'];
