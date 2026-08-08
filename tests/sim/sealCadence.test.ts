import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/config.js';
import { applySealDamage, computeSealMaxHp } from '../../src/sim/seals/framework.js';
import { SMEAR_SEAL_DEFINITION } from '../../src/sim/seals/smear.js';
import { PRESS_SEAL_DEFINITION } from '../../src/sim/seals/press.js';
import { BLANK_SEAL_DEFINITION } from '../../src/sim/seals/blank.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { createBotState, decideInput } from '../../src/balance/bot.js';
import { setLineCount } from '../../src/sim/line.js';

const DT = 1 / 60;

/** A survivable World stepper — arcadeCadenceS (75s) is long enough that ordinary Blot
 *  attrition can kill even the `mixed` harness bot before the first automatic Seal
 *  encounter ever fires (Task 4.6's balance pass deliberately raised early lethality to
 *  hit the §11 length/peak-Line targets), which would tell this file nothing about
 *  cadence/cycling — exactly the "per-boss fight fairness is out of scope here" this
 *  file already disclaims for `skipApproachThenBreak`. So the stepper also floors the
 *  Line at a safe count whenever ordinary attrition would otherwise end the Passage,
 *  guaranteeing survival to the cadence boundary regardless of how the balance pass
 *  tunes early difficulty — the `mixed` bot's targeting is still what drives play, this
 *  only prevents the *outcome* this file was never testing (a real player's odds of
 *  reaching 75s) from silently gating whether cadence/cycling get exercised at all. */
const SURVIVAL_FLOOR_STROKES = 300;

function stepSurvivably(world: ReturnType<typeof createWorld>, botState: ReturnType<typeof createBotState>): void {
  if (world.line.strokes.length < SURVIVAL_FLOOR_STROKES) {
    world.line = setLineCount(world.line, SURVIVAL_FLOOR_STROKES, 'hane');
    // Belt-and-braces: a single step's damage could in principle exceed the floor's
    // margin and flip isDead before the top-up above runs on the *next* call — clearing
    // it here keeps the Passage alive regardless, since stepWorld permanently early-
    // returns once isDead is set (line 401), which no amount of restocking would undo.
    world.isDead = false;
  }
  stepWorld(world, DT, decideInput('mixed', world, DT, botState));
}

/** Steps a World past its Seal's approach into 'fighting', then one-shots it broken.
 *  This file only cares about cadence timing, cycling order, and HP scaling — per-boss
 *  fight fairness/dodging is already covered in smear.test.ts/press.test.ts/blank.test.ts,
 *  so there's no reason to play out a real fight here. */
function skipApproachThenBreak(world: ReturnType<typeof createWorld>, botState: ReturnType<typeof createBotState>): void {
  const approachSteps = Math.round(BALANCE.seals.approachTelegraphS / DT) + 2;
  for (let i = 0; i < approachSteps && world.seal !== null; i++) stepSurvivably(world, botState);
  if (world.seal !== null) {
    world.seal = applySealDamage(world.seal, world.seal.maxHp);
  }
  stepSurvivably(world, botState); // let stepWorld observe 'broken' and clear world.seal
}

describe('Seal scaling: automatic arcade cadence', () => {
  it('never starts a Seal encounter before arcadeCadenceS of Passage time', () => {
    const world = createWorld(1);
    const botState = createBotState(1);
    const steps = Math.round((BALANCE.seals.arcadeCadenceS - 1) / DT);
    for (let i = 0; i < steps; i++) stepSurvivably(world, botState);
    expect(world.seal).toBeNull();
  });

  it('starts one automatically once arcadeCadenceS elapses, with no debug hook involved', () => {
    const world = createWorld(1);
    const botState = createBotState(1);
    const steps = Math.round((BALANCE.seals.arcadeCadenceS + 1) / DT);
    for (let i = 0; i < steps; i++) stepSurvivably(world, botState);
    expect(world.seal).not.toBeNull();
    expect(world.seal?.status).toBe('approaching');
    expect(world.seal?.definitionId).toBe(SMEAR_SEAL_DEFINITION.id);
    expect(world.seal?.sealIndex).toBe(0);
  });

  it('cycles smear -> press -> blank -> smear again, sealIndex = sealsBroken at each start, HP following the §8.2 curve', () => {
    const world = createWorld(1);
    const botState = createBotState(1);
    const expectedOrder = [
      SMEAR_SEAL_DEFINITION.id,
      PRESS_SEAL_DEFINITION.id,
      BLANK_SEAL_DEFINITION.id,
      SMEAR_SEAL_DEFINITION.id,
    ];

    const toFirst = Math.round((BALANCE.seals.arcadeCadenceS + 1) / DT);
    for (let i = 0; i < toFirst; i++) stepSurvivably(world, botState);

    for (let cycle = 0; cycle < expectedOrder.length; cycle++) {
      expect(world.seal).not.toBeNull();
      expect(world.seal?.definitionId).toBe(expectedOrder[cycle]);
      expect(world.seal?.sealIndex).toBe(cycle);
      expect(world.seal?.maxHp).toBeCloseTo(computeSealMaxHp(cycle));

      skipApproachThenBreak(world, botState);
      expect(world.seal).toBeNull();
      expect(world.sealsBroken).toBe(cycle + 1);

      if (cycle < expectedOrder.length - 1) {
        const toNext = Math.round((BALANCE.seals.arcadeCadenceS + 1) / DT);
        for (let i = 0; i < toNext && world.seal === null; i++) stepSurvivably(world, botState);
      }
    }
  });

  it('never swaps which Seal is active mid-encounter, even once a second cadence threshold has already passed', () => {
    const world = createWorld(1);
    const botState = createBotState(1);
    const toFirst = Math.round((BALANCE.seals.arcadeCadenceS + 1) / DT);
    for (let i = 0; i < toFirst; i++) stepSurvivably(world, botState);
    expect(world.seal?.definitionId).toBe(SMEAR_SEAL_DEFINITION.id);
    const initialDefinitionId = world.seal?.definitionId;

    // Generous cap, well beyond a second 75s threshold — the fight resolves naturally
    // (the bot fires throughout) well inside this, so the loop just watches for a
    // premature swap the whole way, rather than asserting a fixed undamaged duration.
    const maxSteps = Math.round(150 / DT);
    for (let i = 0; i < maxSteps && world.seal !== null && !world.isDead; i++) {
      stepSurvivably(world, botState);
      if (world.seal !== null) {
        expect(world.seal.definitionId).toBe(initialDefinitionId);
      }
    }
  });
});
