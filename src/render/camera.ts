// Fixed pseudo-3D camera (TECH_SPEC.md §5, GAME_DESIGN.md §3: "a fixed camera behind and
// above the Brush looking down the scroll"). Not a full 3D view matrix — this is
// deliberately the simplified perspective-divide TECH_SPEC.md §5 specifies, not a
// rotated camera basis, which is what keeps projection.ts a handful of multiplies.

export const CAMERA_X = 0;
export const CAMERA_Y = 4.2;
export const CAMERA_Z = -6.5;
export const LOOK_AT_X = 0;
export const LOOK_AT_Y = 0.8;
export const LOOK_AT_Z = 14;
/** Scale factor numerator in the perspective divide (TECH_SPEC.md §5: "focal ≈ 9.2"). */
export const FOCAL = 9.2;
/** Depth floor so scale never blows up as an object approaches the camera plane. */
export const NEAR_CLIP = 0.6;

export interface ProjectionParams {
  readonly cx: number;
  readonly cy: number;
  readonly unit: number;
  readonly horizonOffsetPx: number;
}

// TECH_SPEC.md §5 gives the formula but leaves screen framing (cx/cy/unit/horizonOffset)
// to the implementation. Both are expressed as fractions of the canvas box, not fixed
// pixel counts, so the framing is identical at every letterboxed size/aspect (Task 2.1's
// "resizing preserves proportions" requirement) instead of only at one reference size.
//
// HORIZON_OFFSET_FRACTION: how far above vertical centre the vanishing point sits —
// chosen so the horizon lands roughly a third of the way down a portrait screen,
// leaving most of the frame for the receding road ahead of the Brush.
// UNIT_SCALE_FRACTION: chosen so the 9-unit lane fills about 90% of screen width at the
// Brush's own depth (~6.5u ahead of the camera), with a visible margin of water either side.
const HORIZON_OFFSET_FRACTION = 0.12;
const UNIT_SCALE_FRACTION = 0.035;

export function computeProjectionParams(cssWidth: number, cssHeight: number): ProjectionParams {
  return {
    cx: cssWidth / 2,
    cy: cssHeight / 2,
    unit: cssWidth * UNIT_SCALE_FRACTION,
    horizonOffsetPx: -cssHeight * HORIZON_OFFSET_FRACTION,
  };
}
