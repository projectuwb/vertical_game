// Drag-relative input → InputFrame (GAME_DESIGN.md §3, TECH_SPEC.md §4). The only output
// of this module is an immutable InputFrame per fixed step — the sim consumes that and
// never touches the DOM, pointer, or keyboard directly.

import { BALANCE } from '../sim/config.js';

/**
 * `lateralDelta` is already in world units for this fixed step (both touch-drag pixels
 * and keyboard rate are converted here, in /platform) — the sim just needs "how far did
 * the control move this step," regardless of which input method produced it. Turning
 * that into an actual Brush position (critically damped, per §3) is the sim's job
 * (src/sim/line.ts), so a recorded input tape replays identically regardless of the
 * real device's frame timing.
 */
export interface InputFrame {
  readonly lateralDelta: number;
  readonly holding: boolean;
  readonly dtFixed: number;
}

const TOUCH_UNITS_PER_PIXEL = BALANCE.control.dragUnitsPerPixel;
const KEYBOARD_LATERAL_SPEED = BALANCE.control.keyboardUPerS;

export class InputSampler {
  private readonly target: HTMLElement;
  private readonly doc: Document;

  private activePointerId: number | null = null;
  private pointerActive = false;
  private lastClientX = 0;
  private accumulatedPixelDeltaX = 0;

  private leftHeld = false;
  private rightHeld = false;
  /** Desktop hold-to-Flourish key. Undefined in the spec beyond "no other inputs
   *  except hold-to-Flourish" (GAME_DESIGN.md §3); bound to Space (see DECISIONS.md). */
  private flourishKeyHeld = false;

  constructor(target: HTMLElement, doc: Document = document) {
    this.target = target;
    this.doc = doc;
    target.addEventListener('pointerdown', this.onPointerDown);
    doc.addEventListener('pointermove', this.onPointerMove);
    doc.addEventListener('pointerup', this.onPointerUp);
    doc.addEventListener('pointercancel', this.onPointerUp);
    doc.addEventListener('keydown', this.onKeyDown);
    doc.addEventListener('keyup', this.onKeyUp);
  }

  /** Consumes and resets the accumulated drag delta; call exactly once per fixed step. */
  sample(dtFixed: number): InputFrame {
    const touchDeltaWorld = this.accumulatedPixelDeltaX * TOUCH_UNITS_PER_PIXEL;
    this.accumulatedPixelDeltaX = 0;

    let keyboardDeltaWorld = 0;
    if (this.leftHeld && !this.rightHeld) {
      keyboardDeltaWorld = -KEYBOARD_LATERAL_SPEED * dtFixed;
    } else if (this.rightHeld && !this.leftHeld) {
      keyboardDeltaWorld = KEYBOARD_LATERAL_SPEED * dtFixed;
    }

    return {
      lateralDelta: touchDeltaWorld + keyboardDeltaWorld,
      holding: this.pointerActive || this.flourishKeyHeld,
      dtFixed,
    };
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.doc.removeEventListener('pointermove', this.onPointerMove);
    this.doc.removeEventListener('pointerup', this.onPointerUp);
    this.doc.removeEventListener('pointercancel', this.onPointerUp);
    this.doc.removeEventListener('keydown', this.onKeyDown);
    this.doc.removeEventListener('keyup', this.onKeyUp);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return; // one touch drives lateral control at a time
    this.activePointerId = e.pointerId;
    this.pointerActive = true;
    this.lastClientX = e.clientX;
    this.target.setPointerCapture?.(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.accumulatedPixelDeltaX += e.clientX - this.lastClientX;
    this.lastClientX = e.clientX;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.pointerActive = false;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.leftHeld = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.rightHeld = true;
        break;
      case 'Space':
        this.flourishKeyHeld = true;
        e.preventDefault();
        break;
      default:
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.leftHeld = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.rightHeld = false;
        break;
      case 'Space':
        this.flourishKeyHeld = false;
        break;
      default:
        break;
    }
  };
}
