// Title screen (Task 4.3, GAME_DESIGN.md §10/§12): the game's entry point. Shows the
// name, the player's best Passage so far (if any — a fresh profile has none), a way in,
// and a way to Settings. Nothing here blocks on network or a service worker; the
// beforeinstallprompt line TECH_SPEC.md §9 describes belongs to Task 5.1 (the PWA
// actually has to be installable first) — logged in DECISIONS.md rather than shown as
// a non-functional placeholder.

import type { Profile } from '../../meta/profile.js';
import { STRINGS } from '../strings.js';
import { createButton, createHeading, createLinkButton, createParagraph, createScreenOverlay } from '../widgets.js';

export interface TitleScreen {
  readonly root: HTMLDivElement;
  update(profile: Profile): void;
}

export function createTitleScreen(callbacks: { onBegin: () => void; onSettings: () => void }): TitleScreen {
  const { root, content } = createScreenOverlay();
  content.style.justifyContent = 'center';
  content.style.flex = '1';
  content.style.gap = '20px';

  const heading = createHeading(STRINGS.title.gameName);
  heading.style.fontSize = '44px';
  const tagline = createParagraph(STRINGS.title.tagline, { muted: true });
  const bestLine = createParagraph('');
  const begin = createButton(STRINGS.title.begin, callbacks.onBegin, { primary: true });
  const settings = createLinkButton(STRINGS.title.settings, callbacks.onSettings);

  content.append(heading, tagline, bestLine, begin, settings);

  return {
    root,
    update(profile: Profile): void {
      bestLine.textContent = profile.bestDistanceU > 0 ? STRINGS.title.bestDistance(profile.bestDistanceU) : '';
    },
  };
}
