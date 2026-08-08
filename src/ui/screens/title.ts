// Title screen (Task 4.3, GAME_DESIGN.md §10/§12): the game's entry point. Shows the
// name, the player's best Passage so far (if any — a fresh profile has none), a way in,
// and a way to Settings. The install line TECH_SPEC.md §10 describes ("a single line on
// the title screen after the beforeinstallprompt event") is Task 5.1's — hidden by
// default (`display: none`, matching every other screen's own show/hide convention) until
// `platform/pwa.ts`'s controller reports the prompt is actually available.

import { PALETTE } from '../../render/palette.js';
import type { Profile } from '../../meta/profile.js';
import { STRINGS } from '../strings.js';
import { createButton, createHeading, createLinkButton, createParagraph, createScreenOverlay } from '../widgets.js';

export interface TitleScreen {
  readonly root: HTMLDivElement;
  update(profile: Profile): void;
  setInstallPromptVisible(visible: boolean): void;
}

export function createTitleScreen(callbacks: {
  onBegin: () => void;
  onSettings: () => void;
  onInstall: () => void;
  onDismissInstall: () => void;
}): TitleScreen {
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

  const installRow = document.createElement('div');
  installRow.style.display = 'none';
  installRow.style.flexDirection = 'row';
  installRow.style.alignItems = 'center';
  installRow.style.justifyContent = 'center';
  installRow.style.gap = '6px';
  installRow.style.flexWrap = 'wrap';
  const installText = createParagraph(STRINGS.title.installPrompt, { muted: true });
  installText.style.margin = '0';
  installText.style.flex = '1 1 auto';
  const installAction = createLinkButton(STRINGS.title.installAction, callbacks.onInstall);
  installAction.style.color = PALETTE.goldLeaf;
  installAction.style.opacity = '1';
  const installDismiss = createLinkButton(STRINGS.title.installDismiss, callbacks.onDismissInstall);
  installRow.append(installText, installAction, installDismiss);

  content.append(heading, tagline, bestLine, begin, settings, installRow);

  return {
    root,
    update(profile: Profile): void {
      bestLine.textContent = profile.bestDistanceU > 0 ? STRINGS.title.bestDistance(profile.bestDistanceU) : '';
    },
    setInstallPromptVisible(visible: boolean): void {
      installRow.style.display = visible ? 'flex' : 'none';
    },
  };
}
