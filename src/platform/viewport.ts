// Portrait-first responsive canvas (GAME_DESIGN.md §3, TECH_SPEC.md §10). Owns the
// single <canvas> element, its device-pixel-ratio-aware backing store, letterboxing
// against the container, and safe-area inset readout. Pure DOM/layout concern — it
// knows nothing about world space or projection (that's /render/projection.ts, Task 2.1).

/** Supported portrait aspect range (GAME_DESIGN.md §3): 9:21 (tallest) to 3:4 (widest). */
const MIN_ASPECT = 9 / 21;
const MAX_ASPECT = 3 / 4;

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportMetrics {
  /** CSS pixels of the letterboxed canvas box. */
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  safeAreaInsets: SafeAreaInsets;
}

function readSafeAreaInsets(doc: Document): SafeAreaInsets {
  const style = doc.defaultView?.getComputedStyle(doc.documentElement);
  const px = (name: string): number => {
    const value = style?.getPropertyValue(name).trim();
    if (value === undefined || value === '') return 0;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    top: px('--safe-area-top'),
    right: px('--safe-area-right'),
    bottom: px('--safe-area-bottom'),
    left: px('--safe-area-left'),
  };
}

export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  private readonly container: HTMLElement;
  private readonly doc: Document;
  private readonly resizeObserver: ResizeObserver | null;
  private metrics: ViewportMetrics;

  constructor(container: HTMLElement, doc: Document = document) {
    this.container = container;
    this.doc = doc;

    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('2D canvas context unavailable');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    container.appendChild(canvas);

    this.metrics = {
      cssWidth: 0,
      cssHeight: 0,
      devicePixelRatio: 1,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    } else {
      this.resizeObserver = null;
    }
    this.resize();
  }

  getMetrics(): ViewportMetrics {
    return this.metrics;
  }

  /** Recomputes canvas box + backing store from the container's current size. Idempotent. */
  resize(): void {
    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    const containerAspect = containerWidth / containerHeight;
    const clampedAspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, containerAspect));

    // Fit the largest box at `clampedAspect` inside the container; excess space
    // becomes letterbox bars painted by the page background (index.html).
    let cssWidth: number;
    let cssHeight: number;
    if (containerAspect > clampedAspect) {
      cssHeight = containerHeight;
      cssWidth = cssHeight * clampedAspect;
    } else {
      cssWidth = containerWidth;
      cssHeight = cssWidth / clampedAspect;
    }

    const dpr = this.doc.defaultView?.devicePixelRatio ?? 1;

    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    // All subsequent draw calls can be issued in CSS pixel units.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.metrics = {
      cssWidth,
      cssHeight,
      devicePixelRatio: dpr,
      safeAreaInsets: readSafeAreaInsets(this.doc),
    };
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.canvas.remove();
  }
}
