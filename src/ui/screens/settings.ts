// Settings screen (Task 4.3, TECH_SPEC.md §3/§9): mute/Shapes-Only/reduced-motion
// toggles (persisted now; actually *consumed* by Tasks 4.4/5.3 once audio/accessibility
// exist — this screen's job is exposing and saving the setting, not implementing what
// it controls), the last Passage's seed (TECH_SPEC.md §4: "every Passage records its
// seed... the summary screen exposes the seed in Settings for reproducing a run in the
// harness"), and profile export/import as a copyable JSON blob.

import type { Profile, ProfileSettings } from '../../meta/profile.js';
import { exportProfile, importProfile } from '../../meta/profile.js';
import { isPaletteVariantUnlocked, paletteVariantUnlockLabel, PALETTE_VARIANT_IDS } from '../../render/palette.js';
import { STRINGS } from '../strings.js';
import {
  createButton,
  createHeading,
  createOptionRow,
  createParagraph,
  createScreenOverlay,
  createTextArea,
  createToggleRow,
} from '../widgets.js';

export interface SettingsScreenData {
  readonly profile: Profile;
  readonly isPersistent: boolean;
  readonly lastSeed: number | null;
}

export interface SettingsScreen {
  readonly root: HTMLDivElement;
  update(data: SettingsScreenData): void;
}

export function createSettingsScreen(callbacks: {
  onBack: () => void;
  onSettingChange: (settings: ProfileSettings) => void;
  onImport: (profile: Profile) => void;
}): SettingsScreen {
  const { root, content } = createScreenOverlay();

  const heading = createHeading(STRINGS.settings.heading);
  const persistenceWarning = createParagraph(STRINGS.settings.persistenceOff, { muted: true });
  persistenceWarning.style.color = 'inherit';

  const togglesHost = document.createElement('div');
  // Task 7.5: palette variants unlocked by milestones.
  const paletteHeading = createParagraph(STRINGS.settings.paletteHeading);
  const paletteHost = document.createElement('div');
  paletteHost.style.display = 'flex';
  paletteHost.style.flexDirection = 'column';
  paletteHost.style.gap = '8px';
  const seedLine = createParagraph('');

  const exportLabel = createParagraph(STRINGS.settings.exportLabel);
  const exportHint = createParagraph(STRINGS.settings.exportHint, { muted: true });
  const exportArea = createTextArea('');
  exportArea.readOnly = true;

  const importLabel = createParagraph(STRINGS.settings.importLabel);
  const importArea = createTextArea(STRINGS.settings.importPlaceholder);
  const importStatus = createParagraph('', { muted: true });
  const importApply = createButton(STRINGS.settings.importApply, () => {
    const imported = importProfile(importArea.value);
    if (imported === null) {
      importStatus.textContent = STRINGS.settings.importFailed;
      return;
    }
    importStatus.textContent = STRINGS.settings.importSucceeded;
    importArea.value = '';
    callbacks.onImport(imported);
  });

  const back = createButton(STRINGS.settings.back, callbacks.onBack);

  content.append(
    heading,
    persistenceWarning,
    togglesHost,
    paletteHeading,
    paletteHost,
    seedLine,
    exportLabel,
    exportHint,
    exportArea,
    importLabel,
    importArea,
    importApply,
    importStatus,
    back,
  );

  return {
    root,
    update(data: SettingsScreenData): void {
      persistenceWarning.style.display = data.isPersistent ? 'none' : 'block';

      togglesHost.replaceChildren(
        createToggleRow({
          label: STRINGS.settings.muted,
          checked: data.profile.settings.muted,
          onChange: (checked) => callbacks.onSettingChange({ ...data.profile.settings, muted: checked }),
        }),
        createToggleRow({
          label: STRINGS.settings.shapesOnly,
          checked: data.profile.settings.shapesOnly,
          onChange: (checked) => callbacks.onSettingChange({ ...data.profile.settings, shapesOnly: checked }),
        }),
        createToggleRow({
          label: STRINGS.settings.reducedMotion,
          checked: data.profile.settings.reducedMotion,
          onChange: (checked) => callbacks.onSettingChange({ ...data.profile.settings, reducedMotion: checked }),
        }),
      );

      const unlockStats = { bestDistanceU: data.profile.bestDistanceU, totalSealsBroken: data.profile.totalSealsBroken };
      paletteHost.replaceChildren(
        ...PALETTE_VARIANT_IDS.map((id) =>
          createOptionRow({
            name: STRINGS.settings.paletteName[id],
            lockedReason: isPaletteVariantUnlocked(id, unlockStats) ? null : paletteVariantUnlockLabel(id),
            selected: data.profile.settings.paletteVariant === id,
            onSelect: () => callbacks.onSettingChange({ ...data.profile.settings, paletteVariant: id }),
          }),
        ),
      );

      seedLine.textContent = data.lastSeed === null ? '' : `${STRINGS.settings.seedLabel}: ${data.lastSeed}`;
      exportArea.value = exportProfile(data.profile);
      importStatus.textContent = '';
    },
  };
}
