// The simple perspective divide (TECH_SPEC.md §5) plus the depth-bucketed draw list
// that makes painter's-algorithm back-to-front drawing cheap at hundreds of entities.

import { CAMERA_X, CAMERA_Y, CAMERA_Z, FOCAL, NEAR_CLIP, type ProjectionParams } from './camera.js';

export interface ProjectedPoint {
  readonly screenX: number;
  readonly screenY: number;
  /** World-units-to-pixels scale at this depth — reuse it to size a projected sprite/quad. */
  readonly scale: number;
}

export function project(x: number, y: number, z: number, params: ProjectionParams): ProjectedPoint {
  const depth = z - CAMERA_Z;
  const scale = FOCAL / Math.max(depth, NEAR_CLIP);
  return {
    screenX: params.cx + (x - CAMERA_X) * scale * params.unit,
    screenY: params.cy - (y - CAMERA_Y) * scale * params.unit + params.horizonOffsetPx,
    scale,
  };
}

/**
 * A fixed-capacity, zero-allocation-per-frame draw-order structure (TECH_SPEC.md §5:
 * "64 buckets over the visible z-range, refilled each frame from pooled arrays, never
 * sorted with Array.sort in the hot path"). `add()` just appends to flat pre-allocated
 * typed arrays; `forEachBackToFront()` does a counting sort over those arrays — O(n +
 * bucketCount), no dynamic allocation, no comparator calls.
 *
 * Depth-bucketing is an approximation, not a true sort: two items in the same bucket
 * draw in insertion order regardless of their exact depth. With 64 buckets across the
 * visible z-range that's sub-world-unit resolution near the camera, which is where
 * mis-ordering would actually be visible — it only gets coarser near the horizon, where
 * everything is small enough that draw order stops mattering.
 */
export class DepthBucketList<T> {
  private readonly capacity: number;
  private readonly bucketCount: number;
  private readonly zNear: number;
  private readonly zFar: number;

  private readonly items: (T | undefined)[];
  private readonly depths: Float32Array;
  private readonly bucketOf: Uint16Array;
  private readonly bucketCounts: Uint32Array;
  private readonly bucketStarts: Uint32Array;
  private readonly cursor: Uint32Array;
  private readonly sortedIndices: Uint32Array;
  private count = 0;

  constructor(capacity: number, bucketCount: number, zNear: number, zFar: number) {
    this.capacity = capacity;
    this.bucketCount = bucketCount;
    this.zNear = zNear;
    this.zFar = zFar;

    this.items = new Array(capacity);
    this.depths = new Float32Array(capacity);
    this.bucketOf = new Uint16Array(capacity);
    this.bucketCounts = new Uint32Array(bucketCount);
    this.bucketStarts = new Uint32Array(bucketCount);
    this.cursor = new Uint32Array(bucketCount);
    this.sortedIndices = new Uint32Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  /** Beyond capacity, further items are silently dropped — a perf ceiling, not a gameplay bug. */
  add(item: T, z: number): void {
    if (this.count >= this.capacity) return;
    this.items[this.count] = item;
    this.depths[this.count] = z;
    this.count++;
  }

  private bucketIndexForZ(z: number): number {
    const span = this.zFar - this.zNear;
    const t = span > 0 ? (z - this.zNear) / span : 0;
    const clampedT = t < 0 ? 0 : t > 1 ? 1 : t;
    const idx = Math.floor(clampedT * this.bucketCount);
    return idx >= this.bucketCount ? this.bucketCount - 1 : idx;
  }

  /** Visits every item far → near (painter's algorithm). Zero allocation. */
  forEachBackToFront(fn: (item: T, z: number) => void): void {
    this.bucketCounts.fill(0, 0, this.bucketCount);
    for (let i = 0; i < this.count; i++) {
      const b = this.bucketIndexForZ(this.depths[i] as number);
      this.bucketOf[i] = b;
      this.bucketCounts[b] = (this.bucketCounts[b] as number) + 1;
    }

    let running = 0;
    for (let b = 0; b < this.bucketCount; b++) {
      this.bucketStarts[b] = running;
      this.cursor[b] = running;
      running += this.bucketCounts[b] as number;
    }

    for (let i = 0; i < this.count; i++) {
      const b = this.bucketOf[i] as number;
      const slot = this.cursor[b] as number;
      this.sortedIndices[slot] = i;
      this.cursor[b] = slot + 1;
    }

    for (let b = this.bucketCount - 1; b >= 0; b--) {
      const start = this.bucketStarts[b] as number;
      const end = start + (this.bucketCounts[b] as number);
      for (let s = start; s < end; s++) {
        const itemIndex = this.sortedIndices[s] as number;
        fn(this.items[itemIndex] as T, this.depths[itemIndex] as number);
      }
    }
  }
}
