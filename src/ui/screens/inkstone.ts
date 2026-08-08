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
import { createButton, createHeading, createParagraph, createScreenOverlay, createTrackRow } from '../widgets.js';

export interface InkstoneScreen {
  readonly root: HTMLDivElement;
  update(profile: Profile): void;
}

export function createInkstoneScreen(callbacks: {
  onPlay: () => void;
  onPurchase: (track: InkstoneTrackId) => void;
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
  // Inkstone is a mandatory pass-through stop in that loop, not a persistent hub, so
  // "Play" is its only exit. No Back button: there's nowhere upstream of it to return
  // to that isn't either the summary screen just left, or Title (reachable at the end
  // of any Passage, not from mid-shop).
  const play = createButton(STRINGS.inkstone.play, callbacks.onPlay, { primary: true });

  content.append(heading, goldLine, trackList, play);

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
