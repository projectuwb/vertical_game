// All user-facing strings (Task 4.3, TECH_SPEC.md §13's "All user-facing strings in
// /ui/strings.ts") — one place to read the game's actual voice, and the one file a
// future localisation pass would touch first.

import type { DeathCause } from '../sim/world.js';

export const STRINGS = {
  title: {
    gameName: 'INKFALL',
    tagline: 'Wet ink and mineral pigment, seen from above, at night.',
    begin: 'Begin a Passage',
    settings: 'Settings',
    bestDistance: (u: number): string => `Best Passage: ${Math.floor(u)}u`,
    installPrompt: 'Add INKFALL to your home screen for offline play.',
    installAction: 'Install',
    installDismiss: 'Not now',
    daily: (dayNumber: number): string => `Today's Passage — Day #${dayNumber}`,
  },
  summary: {
    heading: 'Passage ended',
    distance: 'Distance',
    peakLine: 'Peak Line',
    blotUnbound: 'Blot unbound',
    sealsBroken: 'Seals broken',
    goldLeaf: 'Gold Leaf earned',
    newBest: 'New best',
    previousBest: (u: number): string => `Previous best: ${Math.floor(u)}u`,
    continue: 'Continue to the Inkstone',
    copyResult: 'Copy result',
    copied: 'Copied',
  },
  deathCause: {
    blot: 'Overrun',
    gate: 'A Gate cost too much',
    sealstack: 'Blocked and broken',
    seal: 'Broken by the Seal',
  } satisfies Record<DeathCause, string>,
  inkstone: {
    heading: 'The Inkstone',
    goldLeaf: (n: number): string => `${n} Gold Leaf`,
    maxed: 'Maxed',
    play: 'Play',
  },
  settings: {
    heading: 'Settings',
    muted: 'Mute audio',
    shapesOnly: 'Shapes-Only mode',
    reducedMotion: 'Reduce motion',
    seedLabel: 'Last Passage seed',
    persistenceOff: 'Progress is not being saved this session — your browser blocked storage.',
    exportLabel: 'Export profile',
    exportHint: 'Copy this text to back up your progress.',
    importLabel: 'Import profile',
    importPlaceholder: 'Paste an exported profile here',
    importApply: 'Apply',
    importFailed: 'That doesn’t look like a valid INKFALL profile.',
    importSucceeded: 'Profile imported.',
    back: 'Back',
  },
} as const;
