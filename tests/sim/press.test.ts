import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../src/core/rng.js';
import { createBlotPool } from '../../src/sim/blot.js';
import { BALANCE } from '../../src/sim/config.js';
import type { SealStepContext } from '../../src/sim/seals/framework.js';
import { PRESS_SEAL_DEFINITION, pressActiveVisual } from '../../src/sim/seals/press.js';
import { createWorld, startSealEncounter, stepWorld, type WorldInput } from '../../src/sim/world.js';

const DT = 1 / 60;
const NO_INPUT: WorldInput = { lateralDelta: 0, holding: false };
const FINAL_PHASE_INDEX = BALANCE.seals.press.phases - 1;
const DUAL_RING_PHASE_INDEX = 1;

function makeCtx(overrides: Partial<SealStepContext> = {}): SealStepContext {
  return { dt: DT, timeS: 0, brushX: 0, brushZ: 0, rng: new RngRegistry(1), blotPool: createBlotPool(), ...overrides };
}

/** Fast-forwards a World's Seal encounter past the 6s approach, into 'fighting'. */
function skipApproach(world: ReturnType<typeof createWorld>): void {
  const steps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
  for (let i = 0; i < steps; i++) stepWorld(world, DT, NO_INPUT);
}

describe('The Press: attack cycle (single ring, phase 1)', () => {
  it('goes cooldown -> telegraph (slamTelegraphS) -> resolves -> cooldown again', () => {
    let bossState = PRESS_SEAL_DEFINITION.createBossState(0, new RngRegistry(1));

    const cooldownSteps = Math.round(BALANCE.seals.press.attackIntervalS / DT) + 2;
    for (let i = 0; i < cooldownSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx()).bossState;
    }
    expect(pressActiveVisual(bossState)?.gapCenters.length).toBe(1);

    const telegraphSteps = Math.round(BALANCE.seals.press.slamTelegraphS / DT) + 2;
    for (let i = 0; i < telegraphSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx()).bossState;
    }
    expect(pressActiveVisual(bossState)).toBeNull(); // resolved, back to cooldown
  });

  it('the telegraph never resolves in under minAttackTelegraphS', () => {
    expect(BALANCE.seals.press.slamTelegraphS).toBeGreaterThanOrEqual(BALANCE.seals.minAttackTelegraphS);
  });

  it('spawns exactly summonPerSlamCount Smudges the instant a slam resolves', () => {
    let bossState = PRESS_SEAL_DEFINITION.createBossState(0, new RngRegistry(1));
    const pool = createBlotPool();

    const cooldownSteps = Math.round(BALANCE.seals.press.attackIntervalS / DT) + 2;
    for (let i = 0; i < cooldownSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ blotPool: pool })).bossState;
    }
    expect(pool.activeCount).toBe(0); // nothing spawned yet — only the telegraph is up

    const telegraphSteps = Math.round(BALANCE.seals.press.slamTelegraphS / DT) + 2;
    for (let i = 0; i < telegraphSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ blotPool: pool })).bossState;
    }
    expect(pool.activeCount).toBe(BALANCE.seals.press.summonPerSlamCount);
  });
});

describe('The Press: slam hit detection', () => {
  it('costs a Stroke if the Brush is outside the gap when the slam resolves', () => {
    let bossState = PRESS_SEAL_DEFINITION.createBossState(0, new RngRegistry(3));
    let totalStrokesLost = 0;
    const totalSteps = Math.round((BALANCE.seals.press.attackIntervalS + BALANCE.seals.press.slamTelegraphS) / DT + 4);
    // A gap's window never extends past the lane edge (its centre range is clamped so
    // centre + half-width tops out exactly at the lane edge), so a position outside the
    // whole lane is unconditionally outside every gap, on every roll.
    const farOutsideLaneX = BALANCE.lane.halfWidth * 10;
    for (let i = 0; i < totalSteps; i++) {
      const result = PRESS_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ brushX: farOutsideLaneX }));
      bossState = result.bossState;
      totalStrokesLost += result.strokesLost;
    }
    expect(totalStrokesLost).toBeGreaterThan(0);
  });

  it('costs no Stroke if the Brush sits at the gap centre when the slam resolves', () => {
    let bossState = PRESS_SEAL_DEFINITION.createBossState(0, new RngRegistry(3));
    let totalStrokesLost = 0;
    let brushX = 0;
    const totalSteps = Math.round((BALANCE.seals.press.attackIntervalS + BALANCE.seals.press.slamTelegraphS) / DT + 4);
    for (let i = 0; i < totalSteps; i++) {
      const visual = pressActiveVisual(bossState);
      if (visual !== null) brushX = visual.gapCenters[0] ?? 0;
      const result = PRESS_SEAL_DEFINITION.stepBoss(bossState, 0, makeCtx({ brushX }));
      bossState = result.bossState;
      totalStrokesLost += result.strokesLost;
    }
    expect(totalStrokesLost).toBe(0);
  });
});

describe('The Press: phase 3 (index 2) 2-beat rhythm', () => {
  it('telegraphs, resolves, pauses for beatGapS, then telegraphs and resolves a second single-ring slam', () => {
    let bossState = PRESS_SEAL_DEFINITION.createBossState(FINAL_PHASE_INDEX, new RngRegistry(1));

    const cooldownSteps = Math.round(BALANCE.seals.press.attackIntervalS / DT) + 2;
    for (let i = 0; i < cooldownSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, FINAL_PHASE_INDEX, makeCtx()).bossState;
    }
    expect(pressActiveVisual(bossState)).not.toBeNull(); // beat 1 telegraphing

    const telegraphSteps = Math.round(BALANCE.seals.press.slamTelegraphS / DT) + 2;
    for (let i = 0; i < telegraphSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, FINAL_PHASE_INDEX, makeCtx()).bossState;
    }
    // Beat 1 just resolved into the inter-beat pause — no active telegraph right now.
    expect(pressActiveVisual(bossState)).toBeNull();

    const beatGapSteps = Math.round(BALANCE.seals.press.beatGapS / DT) + 2;
    for (let i = 0; i < beatGapSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, FINAL_PHASE_INDEX, makeCtx()).bossState;
    }
    expect(pressActiveVisual(bossState)).not.toBeNull(); // beat 2 telegraphing
    expect(pressActiveVisual(bossState)?.gapCenters.length).toBe(1); // never dual — that's phase 2 only

    for (let i = 0; i < telegraphSteps; i++) {
      bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, FINAL_PHASE_INDEX, makeCtx()).bossState;
    }
    expect(pressActiveVisual(bossState)).toBeNull(); // beat 2 resolved, back to the normal cooldown
  });

  it('only the final phase runs a 2-beat sequence — every other phase resolves straight back to cooldown', () => {
    for (const phaseIndex of [0, DUAL_RING_PHASE_INDEX]) {
      let bossState = PRESS_SEAL_DEFINITION.createBossState(phaseIndex, new RngRegistry(1));
      const toCooldownEnd = Math.round(BALANCE.seals.press.attackIntervalS / DT) + 2;
      const toTelegraphEnd = Math.round(BALANCE.seals.press.slamTelegraphS / DT) + 2;
      for (let i = 0; i < toCooldownEnd + toTelegraphEnd; i++) {
        bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, phaseIndex, makeCtx()).bossState;
      }
      expect(pressActiveVisual(bossState)).toBeNull();
    }
  });
});

describe('The Press: dual-ring gaps in phase 2 (index 1) always overlap, by construction', () => {
  it('a safe position exists inside both gaps and is reachable, for every one of 5,000 seeds', () => {
    const cooldownSteps = Math.round(BALANCE.seals.press.attackIntervalS / DT) + 2;

    for (let seed = 1; seed <= 5000; seed++) {
      const rng = new RngRegistry(seed);
      let bossState = PRESS_SEAL_DEFINITION.createBossState(DUAL_RING_PHASE_INDEX, rng);
      for (let i = 0; i < cooldownSteps; i++) {
        bossState = PRESS_SEAL_DEFINITION.stepBoss(bossState, DUAL_RING_PHASE_INDEX, makeCtx({ rng })).bossState;
      }

      const visual = pressActiveVisual(bossState);
      expect(visual).not.toBeNull();
      expect(visual!.gapCenters.length).toBe(2);

      const c1 = visual!.gapCenters[0]!;
      const c2 = visual!.gapCenters[1]!;
      const overlapMin = Math.max(c1 - visual!.gapHalfWidthU, c2 - visual!.gapHalfWidthU);
      const overlapMax = Math.min(c1 + visual!.gapHalfWidthU, c2 + visual!.gapHalfWidthU);
      expect(overlapMax).toBeGreaterThan(overlapMin); // a real, positive-width shared safe interval

      const safeX = (overlapMin + overlapMax) / 2;
      expect(safeX).toBeGreaterThanOrEqual(-BALANCE.lane.brushClampX);
      expect(safeX).toBeLessThanOrEqual(BALANCE.lane.brushClampX);
    }
  });
});

describe('The Press: full integration through World', () => {
  // Chase the active ring(s)' shared safe spot while a slam is telegraphing; return to
  // lane centre (where the Line's own muzzles line up with the Seal — firing has no
  // auto-aim) the rest of the time, same shape as the Smear's integration dodge bot.
  // Unlike the Smear, the Press also summons independent Smudge waves every slam
  // (GAME_DESIGN.md §8.2) — real Blot contact threats a starting, un-upgraded Line's
  // narrow firing spread can't fully intercept, so (unlike the Smear) a perfect ring
  // dodge does not by itself guarantee zero Stroke loss or a win; see the baseline
  // win-rate measurement below. What this integration test actually protects against
  // is a structural bug: the encounter must never get stuck (the historical failure
  // mode here, caught during this task's own development, is `stepWorld` freezing at
  // `isDead` while the loop above only watched `world.seal`).
  function dodgeInput(world: ReturnType<typeof createWorld>): WorldInput {
    const visual = world.seal !== null ? pressActiveVisual(world.seal.bossState) : null;
    const targetX =
      visual === null ? 0 : visual.gapCenters.reduce((sum, c) => sum + c, 0) / visual.gapCenters.length;
    const delta = Math.sign(targetX - world.brushTargetX) * BALANCE.control.keyboardUPerS * DT;
    return { lateralDelta: delta, holding: false };
  }

  it('the fight always terminates — it never gets stuck mid-encounter while dodging', () => {
    const world = createWorld(1);
    startSealEncounter(world, 0, PRESS_SEAL_DEFINITION);
    skipApproach(world);
    expect(world.seal?.status).toBe('fighting');

    const MAX_STEPS = 200000;
    let steps = 0;
    while (world.seal !== null && !world.isDead && steps < MAX_STEPS) {
      stepWorld(world, DT, dodgeInput(world));
      steps++;
    }

    expect(steps).toBeLessThan(MAX_STEPS);
    expect(world.seal === null || world.isDead).toBe(true);
    if (world.seal === null) {
      expect(world.sealsBroken).toBe(1);
    }
  });
});

describe('The Press: zero-upgrades baseline win rate (measurement, not a pass/fail bar)', () => {
  // Unlike the Smear, sitting at lane centre between telegraphs isn't enough here: the
  // Press's own Smudge summons are a real Blot-contact threat, and Slip runs travel
  // along a lane verge (GAME_DESIGN.md §8.2's "growth/survival tension persists into
  // the boss") — so a bot that never detours for either can't demonstrate anything
  // about the fight's real winnability, only about its own laziness. This bot's
  // priority is: dodge an active telegraph first, else intercept the nearest Smudge
  // closing on the Line, else collect the nearest Slip, else hold centre to damage
  // the boss.
  it('is winnable at zero upgrades for at least some seeds (a real fight, not an impossible one)', () => {
    const SEED_COUNT = 40;
    const MAX_STEPS = Math.round(90 / DT); // 90s hard cap per attempt
    let wins = 0;

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const world = createWorld(seed);
      startSealEncounter(world, 0, PRESS_SEAL_DEFINITION);
      skipApproach(world);

      for (let i = 0; i < MAX_STEPS && world.seal !== null && !world.isDead; i++) {
        const visual = pressActiveVisual(world.seal.bossState);
        let targetX = 0;
        if (visual !== null) {
          targetX = visual.gapCenters.reduce((sum, c) => sum + c, 0) / visual.gapCenters.length;
        } else {
          let nearestZ = Infinity;
          let nearestX: number | null = null;
          for (let b = 0; b < world.blotPool.activeCount; b++) {
            const blot = world.blotPool.get(b);
            if (blot.z < nearestZ) {
              nearestZ = blot.z;
              nearestX = blot.x;
            }
          }
          if (nearestX !== null && nearestZ < BALANCE.seals.engagementZU) {
            targetX = nearestX;
          } else if (world.slipPool.activeCount > 0) {
            targetX = world.slipPool.get(0).x;
          }
        }
        const lateralDelta = Math.sign(targetX - world.brushTargetX) * BALANCE.control.keyboardUPerS * DT;
        stepWorld(world, DT, { lateralDelta, holding: false });
      }

      if (world.seal === null && !world.isDead) wins++;
    }

    const winRate = wins / SEED_COUNT;
    console.log(`[Task 3.3 baseline] The Press, zero upgrades, ${SEED_COUNT} seeds: ${(winRate * 100).toFixed(1)}% win rate`);
    expect(wins).toBeGreaterThan(0);
  });
});
