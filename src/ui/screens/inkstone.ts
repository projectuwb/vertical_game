// Inkstone (meta upgrades) screen (Task 4.3, GAME_DESIGN.md §10): "a single scrollable
// slab, each track a horizontal row of 10 filled/unfilled marks. Affordable upgrades
// glow gold-leaf; unaffordable are inert. No confirmation dialogs — tapping buys." The
// track list rebuilds on every `update()` (after a purchase, on first showing) rather
// than diffing in place — this screen is never in the simulation's hot path, so the
// simplicity is free.

import type { Profile } from '../../meta/profile.js';
import { INKSTONE_TRACKS, canAffordUpgrade, computeUpgradeCost } from '../../meta/upgrades.js';
import { STRINGS } from '../strings.js';
import { BALANCE, type InkstoneTrackId } from '../../sim/config.js';
import { createButton, createHeading, createLinkButton, createParagraph, createScreenOverlay, createTrackRow } from '../widgets.js';

export interface InkstoneScreen {
  readonly root: HTMLDivElement;
  update(profile: Profile): void;
}

export function createInkstoneScreen(callbacks: {
  onPlay: () => void;
  onPurchase: (track: InkstoneTrackId) => void;
  onMenu: () => void;
}): InkstoneScreen {
  const { root, content } = createScreenOverlay();

  const heading = createHeading(STRINGS.inkstone.heading);
  const goldLine = createParagraph('');
  goldLine.style.fontSize = '20px';
  goldLine.style.fontWeight = '700';

  const trackList = document.createElement('div');
  trackList.style.display = 'flex';
  trackList.style.flexDirection = 'column';
  trackList.style.gap = '10px';

  // GAME_DESIGN.md §10's loop is "Death → run summary → Inkstone → run again" — the
  // Inkstone is a mandatory pass-through stop in that loop, so "Play" stays the one
  // primary, obvious exit and the fast path is still exactly two taps (Continue, Play).
  // A secondary "Menu" link back to Title was added in Task 7.4: Title had always been
  // reachable "at the end of any Passage, not from mid-shop" (this screen's own original
  // comment, Task 4.3) because Title held nothing worth revisiting mid-session at the
  // time — Daily/Statistics/Photo Mode (Tasks 7.1/7.3/7.4) changed that, and without a
  // way back, those three features become unreachable the moment a player leaves Title
  // for the first time in a session, which no reload should be required to fix.
  const play = createButton(STRINGS.inkstone.play, callbacks.onPlay, { primary: true });
  const menu = createLinkButton(STRINGS.inkstone.menu, callbacks.onMenu);

  content.append(heading, goldLine, trackList, play, menu);

  return {
    root,
    update(profile: Profile): void {
      goldLine.textContent = STRINGS.inkstone.goldLeaf(profile.goldLeaf);
      trackList.replaceChildren(
        ...INKSTONE_TRACKS.map((track) => {
          const level = profile.upgradeLevels[track.id];
          const maxed = level >= BALANCE.inkstone.levelsPerTrack;
          const cost = computeUpgradeCost(track.id, level);
          return createTrackRow({
            name: track.name,
            effectPerLevel: track.effectPerLevel,
            level,
            maxLevel: BALANCE.inkstone.levelsPerTrack,
            costLabel: maxed ? STRINGS.inkstone.maxed : `${cost}`,
            affordable: canAffordUpgrade(profile, track.id),
            maxed,
            onBuy: () => callbacks.onPurchase(track.id),
          });
        }),
      );
    },
  };
}
