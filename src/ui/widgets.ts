// Shared UI widgets (Task 4.3): small, dependency-free DOM builders every /ui screen
// composes from. Real <button>/<input> elements throughout — keyboard navigation (tab
// order, Enter/Space to activate, native `disabled` for "unaffordable/maxed is inert")
// falls out of using the actual platform elements rather than reimplementing focus
// management by hand, which is also why screens are DOM overlays over the game canvas
// rather than another Canvas 2D layer (logged in DECISIONS.md).

import { PALETTE } from '../render/palette.js';

// GAME_DESIGN.md §12: display face is Shippori Mincho B1, UI face is Zen Kaku Gothic
// New — both OFL, vendored (Task 7.7). Same system-font fallback shape hud.ts already
// used for the Task 2.11 death overlay this task's summary screen replaces.
const DISPLAY_FONT_STACK = 'Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif';
const UI_FONT_STACK = '"Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans", sans-serif';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element.style, style);
  return element;
}

/**
 * A full-viewport screen backdrop plus a centred, scrollable content column. Every
 * /ui screen is one of these, hidden via `display: none` rather than destroyed and
 * rebuilt on every transition — cheap, and it preserves scroll position if a player
 * returns to the Inkstone mid-session.
 */
export function createScreenOverlay(): { root: HTMLDivElement; content: HTMLDivElement } {
  const root = el('div', {
    position: 'absolute',
    inset: '0',
    background: PALETTE.deep,
    color: PALETTE.bone,
    fontFamily: UI_FONT_STACK,
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    overflowY: 'auto',
    boxSizing: 'border-box',
    padding:
      'max(28px, calc(env(safe-area-inset-top) + 12px)) max(20px, env(safe-area-inset-right)) max(28px, calc(env(safe-area-inset-bottom) + 12px)) max(20px, env(safe-area-inset-left))',
  });
  const content = el('div', {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '14px',
  });
  root.appendChild(content);
  return { root, content };
}

export function setScreenVisible(root: HTMLDivElement, visible: boolean): void {
  root.style.display = visible ? 'flex' : 'none';
}

export function createHeading(text: string): HTMLHeadingElement {
  const heading = el('h1', {
    fontFamily: DISPLAY_FONT_STACK,
    fontSize: '30px',
    fontWeight: '700',
    margin: '6px 0 4px',
    color: PALETTE.bone,
    textAlign: 'center',
  });
  heading.textContent = text;
  return heading;
}

export function createParagraph(text: string, opts: { muted?: boolean } = {}): HTMLParagraphElement {
  const p = el('p', {
    margin: '0',
    fontSize: '14px',
    lineHeight: '1.5',
    textAlign: 'center',
    color: PALETTE.bone,
    opacity: opts.muted === true ? '0.7' : '1',
  });
  p.textContent = text;
  return p;
}

export function createButton(label: string, onClick: () => void, opts: { primary?: boolean } = {}): HTMLButtonElement {
  const button = el('button', {
    font: `600 16px/1.3 ${UI_FONT_STACK}`,
    padding: '13px 20px',
    minHeight: '44px', // Task 5.3's eventual ≥44px hit-target rule, honoured from the start
    borderRadius: '8px',
    border: `1px solid ${PALETTE.bone}`,
    background: opts.primary === true ? PALETTE.goldLeaf : 'transparent',
    color: opts.primary === true ? PALETTE.deep : PALETTE.bone,
    cursor: 'pointer',
    width: '100%',
  });
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function createLinkButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    font: `14px/1.3 ${UI_FONT_STACK}`,
    padding: '10px',
    minHeight: '44px',
    border: 'none',
    background: 'transparent',
    color: PALETTE.bone,
    opacity: '0.75',
    cursor: 'pointer',
    textDecoration: 'underline',
  });
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export interface StatRow {
  readonly element: HTMLDivElement;
  setValue(value: string): void;
}

export function createStatRow(label: string, value: string, opts: { highlight?: boolean } = {}): StatRow {
  const row = el('div', {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '16px',
    padding: '3px 0',
  });
  const labelEl = el('span', { color: PALETTE.bone, opacity: '0.75' });
  labelEl.textContent = label;
  const valueEl = el('span', {
    color: opts.highlight === true ? PALETTE.goldLeaf : PALETTE.bone,
    fontWeight: '600',
  });
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return { element: row, setValue: (v: string) => (valueEl.textContent = v) };
}

export function createDivider(): HTMLHRElement {
  return el('hr', { border: 'none', borderTop: `1px solid ${PALETTE.bone}22`, margin: '4px 0', width: '100%' });
}

export interface TrackRowOptions {
  readonly name: string;
  readonly effectPerLevel: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly costLabel: string;
  readonly affordable: boolean;
  readonly maxed: boolean;
  readonly onBuy: () => void;
}

/** GAME_DESIGN.md §10: "each track a horizontal row of 10 filled/unfilled marks.
 *  Affordable upgrades glow gold-leaf; unaffordable are inert. No confirmation dialogs
 *  — tapping buys." The whole row *is* the buy button — `disabled` when maxed or
 *  unaffordable makes "inert" a real native state, not just a dimmed style. */
export function createTrackRow(opts: TrackRowOptions): HTMLButtonElement {
  const canBuy = opts.affordable && !opts.maxed;
  const row = el('button', {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
    minHeight: '44px', // Task 5.3's ≥44px hit-target rule
    boxSizing: 'border-box',
    padding: '12px 14px',
    borderRadius: '8px',
    border: `1px solid ${canBuy ? PALETTE.goldLeaf : PALETTE.bone + '33'}`,
    background: canBuy ? PALETTE.goldLeaf + '14' : 'transparent',
    color: PALETTE.bone,
    fontFamily: UI_FONT_STACK,
    textAlign: 'left',
    cursor: canBuy ? 'pointer' : 'default',
    opacity: opts.maxed ? '0.6' : '1',
  });
  row.disabled = !canBuy;

  const topLine = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' });
  const nameEl = el('span', { fontWeight: '700', fontSize: '16px' });
  nameEl.textContent = opts.name;
  const costEl = el('span', {
    fontSize: '14px',
    color: opts.maxed ? PALETTE.bone : canBuy ? PALETTE.goldLeaf : PALETTE.bone,
    opacity: opts.maxed ? '0.7' : canBuy ? '1' : '0.6',
  });
  costEl.textContent = opts.costLabel;
  topLine.append(nameEl, costEl);

  const effectEl = el('div', { fontSize: '13px', opacity: '0.8' });
  effectEl.textContent = opts.effectPerLevel;

  const marks = el('div', { display: 'flex', gap: '3px' });
  for (let i = 0; i < opts.maxLevel; i++) {
    const filled = i < opts.level;
    marks.appendChild(
      el('span', {
        width: '14px',
        height: '14px',
        borderRadius: '3px',
        background: filled ? PALETTE.goldLeaf : 'transparent',
        border: `1px solid ${filled ? PALETTE.goldLeaf : PALETTE.bone + '55'}`,
        display: 'inline-block',
      }),
    );
  }

  row.append(topLine, effectEl, marks);
  row.addEventListener('click', () => {
    if (canBuy) opts.onBuy();
  });
  return row;
}

export interface ToggleRowOptions {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function createToggleRow(opts: ToggleRowOptions): HTMLLabelElement {
  const row = el('label', {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 2px',
    fontSize: '16px',
    cursor: 'pointer',
    minHeight: '44px',
  });
  const labelEl = el('span', {});
  labelEl.textContent = opts.label;
  const checkbox = el('input', { width: '22px', height: '22px', cursor: 'pointer' });
  checkbox.type = 'checkbox';
  checkbox.checked = opts.checked;
  checkbox.addEventListener('change', () => opts.onChange(checkbox.checked));
  row.append(labelEl, checkbox);
  return row;
}

export function createTextArea(placeholder: string): HTMLTextAreaElement {
  const textarea = el('textarea', {
    width: '100%',
    minHeight: '80px',
    boxSizing: 'border-box',
    padding: '10px',
    borderRadius: '6px',
    border: `1px solid ${PALETTE.bone}55`,
    background: PALETTE.slate,
    color: PALETTE.bone,
    font: `13px/1.4 ${UI_FONT_STACK}`,
    resize: 'vertical',
  });
  textarea.placeholder = placeholder;
  return textarea;
}
