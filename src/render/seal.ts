// Seal rendering (Task 3.1) — a minimal but real visual proving the framework's own
// mechanics (approach, phases, telegraph-before-hit) are visible, not the polished
// per-boss art Tasks 3.2-3.4 own. `palette.ts` already documents vermilion as "Tome
// class, Seals, danger," so accents here lean on that rather than inventing a new hue.

import type { ProjectionParams } from './camera.js';
import { project } from './projection.js';
import { PALETTE } from './palette.js';
import { fillQuad, type Quad } from './strokes.js';
import { stubActiveTelegraph } from '../sim/seals/stub.js';
import { smearActiveVisual } from '../sim/seals/smear.js';
import { pressActiveVisual } from '../sim/seals/press.js';
import type { SealEncounterState } from '../sim/seals/framework.js';
import { computeSealZ, SEAL_X } from '../sim/world.js';
import { BALANCE } from '../sim/config.js';

const BODY_HALF_WIDTH_U = 1.5;
const BODY_HEIGHT_U = 2.4;
const APPROACH_MARK_HALF_WIDTH_U = 0.3;
const APPROACH_MARK_HEIGHT_U = 3;

function bodyQuad(x: number, z: number, halfWidth: number, height: number, params: ProjectionParams): Quad {
  return [
    project(x - halfWidth, 0, z, params),
    project(x + halfWidth, 0, z, params),
    project(x + halfWidth, height, z, params),
    project(x - halfWidth, height, z, params),
  ];
}

function drawApproachMark(ctx: CanvasRenderingContext2D, params: ProjectionParams, z: number): void {
  // "A vertical seal-mark rises in the distance" (GAME_DESIGN.md §8.2) — a slim,
  // deliberately ominous vermilion sliver, distinct from any Blot or Stroke silhouette.
  const quad = bodyQuad(SEAL_X, z, APPROACH_MARK_HALF_WIDTH_U, APPROACH_MARK_HEIGHT_U, params);
  fillQuad(ctx, quad, PALETTE.vermilion);
}

function drawBody(ctx: CanvasRenderingContext2D, params: ProjectionParams, z: number, staggered: boolean): void {
  const quad = bodyQuad(SEAL_X, z, BODY_HALF_WIDTH_U, BODY_HEIGHT_U, params);
  // Staggered = vulnerable = visibly lit up, not just a stat change — the ×2 damage
  // window (GAME_DESIGN.md §8.2) should read as "hit it now" at a glance.
  fillQuad(ctx, quad, staggered ? PALETTE.vermilion : PALETTE.blot);
  if (staggered) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = PALETTE.bone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(quad[0].screenX, quad[0].screenY);
    ctx.lineTo(quad[1].screenX, quad[1].screenY);
    ctx.lineTo(quad[2].screenX, quad[2].screenY);
    ctx.lineTo(quad[3].screenX, quad[3].screenY);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

const HP_BAR_TOP_FRACTION = 0.06;
const HP_BAR_WIDTH_FRACTION = 0.6;
const HP_BAR_HEIGHT_PX = 10;
const HP_BAR_SEGMENT_GAP_PX = 3;

/** Screen-space, not world-projected — a boss HP bar that shrank with perspective
 *  distance would be unreadable exactly when it matters least (a boss at range). */
function drawHpBar(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  seal: SealEncounterState,
): void {
  const barWidth = cssWidth * HP_BAR_WIDTH_FRACTION;
  const left = (cssWidth - barWidth) / 2;
  const top = cssHeight * HP_BAR_TOP_FRACTION;
  const segmentWidth = (barWidth - HP_BAR_SEGMENT_GAP_PX * (seal.phaseCount - 1)) / seal.phaseCount;

  ctx.save();
  ctx.fillStyle = PALETTE.deep;
  ctx.fillRect(left, top, barWidth, HP_BAR_HEIGHT_PX);

  for (let i = 0; i < seal.phaseCount; i++) {
    const segmentX = left + i * (segmentWidth + HP_BAR_SEGMENT_GAP_PX);
    const segmentHpFloor = seal.maxHp - (i + 1) * seal.hpPerPhase;
    const fillFraction = Math.max(0, Math.min(1, (seal.hp - segmentHpFloor) / seal.hpPerPhase));
    if (fillFraction <= 0) continue;
    ctx.fillStyle = seal.staggerRemainingS > 0 ? PALETTE.vermilion : PALETTE.jade;
    ctx.fillRect(segmentX, top, segmentWidth * fillFraction, HP_BAR_HEIGHT_PX);
  }
  ctx.restore();
}

const TELEGRAPH_FLASH_HZ = 6;
const TELEGRAPH_HALF_WIDTH_U = 4.5;
const TELEGRAPH_NEAR_Z = -0.4;
const TELEGRAPH_FAR_Z = 6;

/** The stub's one attack, "Pulse": a telegraphed lane half, flashing faster as the
 *  telegraph nears resolution — a purely cosmetic urgency cue on top of the mechanical
 *  guarantee (framework.ts's `startAttack`/`stepAttack`) that the telegraph itself
 *  always runs its full `minAttackTelegraphS` before anything can be hit. */
function drawStubTelegraph(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  seal: SealEncounterState,
  timeS: number,
): void {
  const telegraph = stubActiveTelegraph(seal.bossState);
  if (telegraph === null) return;

  const flash = Math.sin(timeS * TELEGRAPH_FLASH_HZ * Math.PI * 2) > 0;
  if (!flash) return;

  const xMin = telegraph.side === 'left' ? -TELEGRAPH_HALF_WIDTH_U : 0;
  const xMax = telegraph.side === 'left' ? 0 : TELEGRAPH_HALF_WIDTH_U;
  const quad: Quad = [
    project(xMin, 0, TELEGRAPH_NEAR_Z, params),
    project(xMax, 0, TELEGRAPH_NEAR_Z, params),
    project(xMax, 0, TELEGRAPH_FAR_Z, params),
    project(xMin, 0, TELEGRAPH_FAR_Z, params),
  ];
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.35 * telegraph.progressFraction; // brightens as it nears resolution
  fillQuad(ctx, quad, PALETTE.vermilion);
  ctx.restore();
}

const SMEAR_ZONE_NEAR_Z = -0.4;
const SMEAR_ZONE_FAR_Z = 8;

/**
 * The Smear's one attack ("sweeps an arm laterally across two thirds of the lane,"
 * GAME_DESIGN.md §8.2), all three of its stages read as distinct shapes/motion, not
 * three colours of the same flash: the telegraph is a thin gathering sliver at the
 * sweep's *start* position (where the ink is pulling in from); the sweep itself is the
 * arm's actual current width, moving; the phase-3 residue is a static, fading stain left
 * at the sweep's *end* position.
 */
function drawSmearVisual(ctx: CanvasRenderingContext2D, params: ProjectionParams, seal: SealEncounterState): void {
  const visual = smearActiveVisual(seal.bossState);
  if (visual === null) return;

  const halfWidth = visual.stage === 'telegraph' ? 0.3 : visual.armHalfWidthU;
  const alpha =
    visual.stage === 'residue'
      ? 0.5 * (1 - visual.progressFraction) // fades out as the residue's danger window elapses
      : 0.3 + 0.4 * visual.progressFraction; // telegraph/sweep both brighten toward resolution

  const quad: Quad = [
    project(visual.centerX - halfWidth, 0, SMEAR_ZONE_NEAR_Z, params),
    project(visual.centerX + halfWidth, 0, SMEAR_ZONE_NEAR_Z, params),
    project(visual.centerX + halfWidth, 0, SMEAR_ZONE_FAR_Z, params),
    project(visual.centerX - halfWidth, 0, SMEAR_ZONE_FAR_Z, params),
  ];
  ctx.save();
  ctx.globalAlpha = alpha;
  fillQuad(ctx, quad, PALETTE.vermilion);
  ctx.restore();
}

const PRESS_ZONE_NEAR_Z = -0.4;
const PRESS_ZONE_FAR_Z = 8;
const PRESS_LANE_HALF_WIDTH_U = BALANCE.lane.halfWidth;

/**
 * The Press's slam: "outside the ring or in the one gap in it," reinterpreted for a
 * lane with no radial dimension as "everywhere except a gap window is dangerous." Each
 * active ring (one normally, two in phase 2) is drawn as the lane *minus its own gap* —
 * two flanking quads either side of the gap — at a translucent alpha, so a single ring's
 * danger reads as one wash, and phase 2's two overlapping rings compound into visibly
 * darker vermilion everywhere except the shared safe gap, without any special-casing.
 */
function drawPressVisual(ctx: CanvasRenderingContext2D, params: ProjectionParams, seal: SealEncounterState): void {
  const visual = pressActiveVisual(seal.bossState);
  if (visual === null) return;

  const alpha = 0.22 + 0.28 * visual.progressFraction; // brightens toward resolution, like the Smear
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const gapCenter of visual.gapCenters) {
    const gapMin = gapCenter - visual.gapHalfWidthU;
    const gapMax = gapCenter + visual.gapHalfWidthU;
    if (gapMin > -PRESS_LANE_HALF_WIDTH_U) {
      const quad: Quad = [
        project(-PRESS_LANE_HALF_WIDTH_U, 0, PRESS_ZONE_NEAR_Z, params),
        project(gapMin, 0, PRESS_ZONE_NEAR_Z, params),
        project(gapMin, 0, PRESS_ZONE_FAR_Z, params),
        project(-PRESS_LANE_HALF_WIDTH_U, 0, PRESS_ZONE_FAR_Z, params),
      ];
      fillQuad(ctx, quad, PALETTE.vermilion);
    }
    if (gapMax < PRESS_LANE_HALF_WIDTH_U) {
      const quad: Quad = [
        project(gapMax, 0, PRESS_ZONE_NEAR_Z, params),
        project(PRESS_LANE_HALF_WIDTH_U, 0, PRESS_ZONE_NEAR_Z, params),
        project(PRESS_LANE_HALF_WIDTH_U, 0, PRESS_ZONE_FAR_Z, params),
        project(gapMax, 0, PRESS_ZONE_FAR_Z, params),
      ];
      fillQuad(ctx, quad, PALETTE.vermilion);
    }
  }
  ctx.restore();
}

function drawBossAttackVisual(
  ctx: CanvasRenderingContext2D,
  params: ProjectionParams,
  seal: SealEncounterState,
  timeS: number,
): void {
  if (seal.definitionId === 'stub') {
    drawStubTelegraph(ctx, params, seal, timeS);
  } else if (seal.definitionId === 'smear') {
    drawSmearVisual(ctx, params, seal);
  } else if (seal.definitionId === 'press') {
    drawPressVisual(ctx, params, seal);
  }
}

export function drawSeal(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  params: ProjectionParams,
  seal: SealEncounterState,
  timeS: number,
): void {
  const z = computeSealZ(seal);

  if (seal.status === 'approaching') {
    drawApproachMark(ctx, params, z);
    return;
  }
  if (seal.status === 'broken') return;

  drawBossAttackVisual(ctx, params, seal, timeS);
  drawBody(ctx, params, z, seal.staggerRemainingS > 0);
  drawHpBar(ctx, cssWidth, cssHeight, seal);
}
