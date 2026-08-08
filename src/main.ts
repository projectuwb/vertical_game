// Application bootstrap. Wires platform → sim → render → ui. Fleshed out across
// Phase 1-4.
//
// As of Task 2.7, the actual simulation wiring lives entirely in sim/world.ts
// (createWorld/stepWorld) — this file just samples input, calls stepWorld once per fixed
// step, and draws whatever World currently holds. As of Task 4.3, this file also owns
// the top-level screen state machine (title/playing/summary/inkstone/settings,
// ui/screens/run.ts's AppState) and the Profile persistence loop around it — the World
// itself still knows nothing about any of that (TECH_SPEC.md §2: /sim never imports
// /platform, /render, or /ui).

import {
  attachVisibilityAutoPause,
  FixedStepLoop,
  mountDebugOverlay,
  runInBrowser,
  type LoopCallbacks,
} from './core/loop.js';
import { InputSampler } from './platform/input.js';
import { Viewport } from './platform/viewport.js';
import { createStorage } from './platform/storage.js';
import { createInstallPromptController, createWakeLockController, registerServiceWorker } from './platform/pwa.js';
import { attachFlourishHaptics, fireLineLossHaptic } from './platform/haptics.js';
import { App } from '@capacitor/app';
import { computeRowClassCounts, type LineState } from './sim/line.js';
import type { StrokeClass } from './sim/stroke.js';
import { BALANCE } from './sim/config.js';
import { BLOT_CLASSES, spawnBlot, type Blot } from './sim/blot.js';
import { pickSlipClass, spawnSlip, type Slip, type SlipKind } from './sim/slips.js';
import { generateGatePair } from './sim/gates.js';
import { spawnSealstack } from './sim/sealstacks.js';
import { createWorld, startSealEncounter, stepWorld, type World } from './sim/world.js';
import { computePressure } from './sim/director.js';
import { computeGoldLeaf } from './meta/economy.js';
import { loadProfile, saveProfile, recordRunResult, type Profile, type ProfileSettings } from './meta/profile.js';
import { purchaseUpgrade } from './meta/upgrades.js';
import { STUB_SEAL_DEFINITION } from './sim/seals/stub.js';
import { SMEAR_SEAL_DEFINITION } from './sim/seals/smear.js';
import { PRESS_SEAL_DEFINITION } from './sim/seals/press.js';
import { BLANK_SEAL_DEFINITION } from './sim/seals/blank.js';
import { RngRegistry } from './core/rng.js';
import { nowMs } from './core/time.js';
import type { Pool } from './core/pool.js';
import { computeProjectionParams } from './render/camera.js';
import { drawGatePair, drawRoad, drawSealstacks, drawSkyWater, resetRoadTrailBase } from './render/road.js';
import { drawBrush, drawJoiningRecruits, drawLine, drawProjectiles, drawSlips } from './render/strokes.js';
import { drawBlot } from './render/blot.js';
import { drawPhraseEffects } from './render/effects.js';
import { drawSeal, isRoadMarkingsErased } from './render/seal.js';
import { drawInkBleed, drawInkTrail } from './render/trail.js';
import { inkBleedFraction } from './render/hud.js';
import { OffscreenLayers } from './render/layers.js';
import { createAdaptiveQualityManager } from './render/quality.js';
import { createTitleScreen } from './ui/screens/title.js';
import { createSummaryScreen } from './ui/screens/summary.js';
import { createInkstoneScreen } from './ui/screens/inkstone.js';
import { createSettingsScreen } from './ui/screens/settings.js';
import type { AppState } from './ui/screens/run.js';
import { setScreenVisible } from './ui/widgets.js';
import { getMixer, resumeAudioContext } from './audio/synth.js';
import { attachSfx } from './audio/sfx.js';
import { createMusicController } from './audio/music.js';

const BRUSH_CLAMP = BALANCE.lane.brushClampX;
/** The Brush's fixed world-space depth: the road scrolls past it, not the other way
 *  round. Matches world.ts's own (private) BRUSH_Z exactly. */
const BRUSH_Z = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Task 2.2's debug control: mixed-class Lines at fixed sizes, to check formation
 *  layout and density-block behaviour independent of real recruitment (Task 2.5). */
function buildDebugLine(count: number): LineState {
  const classes: StrokeClass[] = ['hane', 'tome', 'harai'];
  const strokes = Array.from({ length: count }, (_, i) => ({
    class: classes[i % classes.length] as StrokeClass,
  }));
  return { strokes };
}

/** Task 2.9's debug control: a pure-class Line, front row and all — the fastest way to
 *  check Phrase detection/effects/5-of-a-kind escalation without waiting on real Slip
 *  recruitment to happen to line up 3+ of one class at the front. */
function buildDebugPureLine(cls: StrokeClass, count: number): LineState {
  return { strokes: Array.from({ length: count }, () => ({ class: cls })) };
}

/** Task 2.4's debug control: a mixed-class wave spread across the lane and stacked back
 *  into the distance, to check mass rendering and 60fps at up to 900 concurrent Blot. */
function spawnDebugBlotWave(pool: Pool<Blot>, count: number): void {
  const columns = 9;
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const rowDepth = Math.floor(i / columns);
    const x = (col - (columns - 1) / 2) * 0.9;
    const z = 40 + rowDepth * 3;
    const cls = BLOT_CLASSES[i % BLOT_CLASSES.length] as (typeof BLOT_CLASSES)[number];
    spawnBlot(pool, cls, x, z);
  }
}

/** Task 2.5's debug control: a run of Slips staked ahead, class chosen the same way the
 *  real Spawn Director (Task 2.7, world.ts's spawnSlipRun) does — least-held-class-
 *  weighted via the seeded 'slips' RNG concern. Uses a decoupled debug RngRegistry
 *  rather than world.rng, so pressing a debug key never perturbs the real Director's
 *  own sequence. */
function spawnDebugSlipRun(
  pool: Pool<Slip>,
  kind: SlipKind,
  count: number,
  line: LineState,
  debugRng: RngRegistry,
): void {
  const { front, back } = computeRowClassCounts(line);
  const counts: Record<StrokeClass, number> = {
    hane: front.hane + back.hane,
    tome: front.tome + back.tome,
    harai: front.harai + back.harai,
  };
  const cls = pickSlipClass(counts, debugRng);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.7;
    spawnSlip(pool, kind, cls, x, 30);
  }
}

function bootstrap(): void {
  const app = document.getElementById('app');
  if (app === null) {
    throw new Error('missing #app root element');
  }

  const viewport = new Viewport(app);
  const input = new InputSampler(viewport.canvas);

  const initialMetrics = viewport.getMetrics();
  const layers = new OffscreenLayers(
    initialMetrics.cssWidth,
    initialMetrics.cssHeight,
    initialMetrics.devicePixelRatio,
  );
  let lastCssWidth = initialMetrics.cssWidth;
  let lastCssHeight = initialMetrics.cssHeight;
  let lastDpr = initialMetrics.devicePixelRatio;

  // Task 5.2, TECH_SPEC.md §8: degrades render-only detail (never simulation rate —
  // `recordFrame` is only ever called from the `render` callback below, `update` never
  // touches it) under sustained low real-world frame rate.
  const quality = createAdaptiveQualityManager();
  let lastRenderMs: number | null = null;
  let renderFrameCount = 0;

  const storage = createStorage();
  let profile: Profile = loadProfile(storage);

  registerServiceWorker();
  const installPrompt = createInstallPromptController(storage);
  const wakeLock = createWakeLockController();

  // TECH_SPEC.md §4: every Passage records its seed for reproduction; Settings (Task
  // 4.3) exposes the most recent one. Decoupled from world.rng (see spawnDebugSlipRun
  // below) for the debug RNG stream.
  let lastSeed: number | null = null;
  let world: World = createWorld(Date.now(), profile.upgradeLevels);
  const debugRng = new RngRegistry(Date.now());

  // Audio (Task 4.4): the mixer/AudioContext is created immediately (it may start
  // `suspended` — that's fine, nothing plays until it's resumed) so `setMuted` can be
  // applied from the loaded Profile right away; actually producing sound needs a real
  // user gesture, which the one-time listener below provides regardless of which
  // element the player first interacts with. `attachSfx` is re-subscribed to each new
  // World's own fresh event bus inside `beginPassage`.
  const mixer = getMixer();
  mixer.setMuted(profile.settings.muted);
  const music = createMusicController(mixer);
  attachSfx(world.events);
  attachFlourishHaptics(world.events);
  document.addEventListener(
    'pointerdown',
    () => resumeAudioContext(mixer),
    { once: true },
  );
  document.addEventListener(
    'keydown',
    () => resumeAudioContext(mixer),
    { once: true },
  );

  // Real wall-clock time of death (Task 2.11) — world.timeS itself freezes the instant
  // isDead flips (stepWorld returns before advancing it), so the death sequence's own
  // timing (ink bleed) has to come from somewhere that keeps ticking.
  let deathAtRealMs: number | null = null;

  let appState: AppState = 'title';

  function setAppState(next: AppState): void {
    appState = next;
    setScreenVisible(titleScreen.root, next === 'title');
    setScreenVisible(summaryScreen.root, next === 'summary');
    setScreenVisible(inkstoneScreen.root, next === 'inkstone');
    setScreenVisible(settingsScreen.root, next === 'settings');
  }

  function beginPassage(): void {
    const seed = Date.now();
    lastSeed = seed;
    // GAME_DESIGN.md §13: the scripted opening only ever applies to a profile's very
    // first-ever Passage — `recordRunResult` (in `handlePassageDeath`) increments
    // `totalPassages` the instant this one ends, so it can never fire twice.
    world = createWorld(seed, profile.upgradeLevels, profile.totalPassages === 0);
    // This Passage's own fresh event bus — the old one (and its listeners) is now unreachable.
    attachSfx(world.events);
    attachFlourishHaptics(world.events);
    deathAtRealMs = null;
    layers.requestRoadTrailReset();
    setAppState('playing');
    wakeLock.acquire(); // TECH_SPEC.md §10: "wake lock requested during a Passage where supported"
  }

  function refreshInkstoneScreen(): void {
    inkstoneScreen.update(profile);
  }

  function refreshSettingsScreen(): void {
    settingsScreen.update({ profile, isPersistent: storage.isPersistent, lastSeed });
  }

  // GAME_DESIGN.md §10: "Death → run summary → Inkstone → run again," exactly two taps
  // (summary's Continue, Inkstone's Play) — called once, the instant a Passage's death
  // is first observed.
  function handlePassageDeath(): void {
    wakeLock.release();
    deathAtRealMs = nowMs();
    const previousBestDistanceU = profile.bestDistanceU;
    const goldLeaf = computeGoldLeaf(
      world.blotKilled,
      world.distanceU,
      world.sealsBroken,
      profile.upgradeLevels.leaf,
    );
    profile = recordRunResult(profile, {
      seed: lastSeed ?? 0,
      distanceU: world.distanceU,
      peakLine: world.peakLineCount,
      sealsBroken: world.sealsBroken,
      goldLeafEarned: goldLeaf,
      timestampMs: Date.now(),
    });
    saveProfile(storage, profile);

    summaryScreen.show({
      distanceU: world.distanceU,
      peakLine: world.peakLineCount,
      blotKilled: world.blotKilled,
      sealsBroken: world.sealsBroken,
      goldLeaf,
      deathCause: world.deathCause ?? 'blot',
      previousBestDistanceU,
    });
    setAppState('summary');
  }

  const titleScreen = createTitleScreen({
    onBegin: beginPassage,
    onSettings: () => {
      refreshSettingsScreen();
      setAppState('settings');
    },
    onInstall: () => installPrompt.promptInstall(),
    onDismissInstall: () => installPrompt.dismiss(),
  });
  installPrompt.onAvailabilityChange((available) => titleScreen.setInstallPromptVisible(available));
  const summaryScreen = createSummaryScreen({
    onContinue: () => {
      refreshInkstoneScreen();
      setAppState('inkstone');
    },
  });
  const inkstoneScreen = createInkstoneScreen({
    onPlay: beginPassage,
    onPurchase: (track) => {
      profile = purchaseUpgrade(profile, track) ?? profile;
      saveProfile(storage, profile);
      refreshInkstoneScreen();
    },
  });
  const settingsScreen = createSettingsScreen({
    // Settings is only ever reached from Title (see ui/screens/run.ts's own note on
    // why the Inkstone/summary flow doesn't route through it) — "Back" always returns
    // there.
    onBack: () => setAppState('title'),
    onSettingChange: (settings: ProfileSettings) => {
      profile = { ...profile, settings };
      saveProfile(storage, profile);
      mixer.setMuted(profile.settings.muted); // "Mute persists" (GAME_DESIGN.md §12) — and applies immediately
      refreshSettingsScreen(); // keeps the live export blob in sync with the toggle just flipped
    },
    onImport: (imported: Profile) => {
      profile = imported;
      saveProfile(storage, profile);
      mixer.setMuted(profile.settings.muted);
      refreshSettingsScreen();
    },
  });

  app.append(titleScreen.root, summaryScreen.root, inkstoneScreen.root, settingsScreen.root);
  titleScreen.update(profile);
  setAppState('title');

  const callbacks: LoopCallbacks = {
    update: (dtFixed: number): void => {
      if (appState !== 'playing') return;
      const frame = input.sample(dtFixed);
      const strokesBefore = world.line.strokes.length;
      const sealActiveBefore = world.seal !== null;
      stepWorld(world, dtFixed, { lateralDelta: frame.lateralDelta, holding: frame.holding });
      // TECH_SPEC.md §11: haptics on Line loss and Seal impact — no dedicated /sim event
      // for either (Task 4.4 deliberately scoped GameEvents to §12's audio-only list),
      // so this diffs the Line's own Stroke count the same way every other per-step
      // main.ts concern (e.g. the death check right below) already reads World directly.
      fireLineLossHaptic(strokesBefore - world.line.strokes.length, sealActiveBefore);
      if (world.isDead && deathAtRealMs === null) {
        handlePassageDeath();
      }
      // GAME_DESIGN.md §12: tempo tied to Pressure, dropping to a single drone while a
      // Seal is near (approaching or fighting — "near" covers both, not just the fight
      // itself, since the drone should already be settling in during the approach).
      music.setPressure(computePressure(world.timeS, world.line.strokes.length));
      music.setSealNear(world.seal !== null);
    },
    render: (_alpha: number): void => {
      const nowRenderMs = nowMs();
      if (lastRenderMs !== null) quality.recordFrame(nowRenderMs - lastRenderMs);
      lastRenderMs = nowRenderMs;
      renderFrameCount++;
      const currentQuality = quality.current();

      const metrics = viewport.getMetrics();
      if (
        metrics.cssWidth !== lastCssWidth ||
        metrics.cssHeight !== lastCssHeight ||
        metrics.devicePixelRatio !== lastDpr
      ) {
        layers.resize(metrics.cssWidth, metrics.cssHeight, metrics.devicePixelRatio);
        lastCssWidth = metrics.cssWidth;
        lastCssHeight = metrics.cssHeight;
        lastDpr = metrics.devicePixelRatio;
      }

      // The game canvas only matters while actually playing, or frozen behind the
      // translucent summary screen right after death — Title/Inkstone/Settings are
      // fully opaque DOM overlays, so there's nothing to gain by keeping the canvas
      // scene current underneath them.
      if (appState !== 'playing' && appState !== 'summary') return;

      const params = computeProjectionParams(metrics.cssWidth, metrics.cssHeight);
      const brushX = clamp(world.brushFollower.position, -BRUSH_CLAMP, BRUSH_CLAMP);

      if (layers.needsSkyWaterRegen) {
        drawSkyWater(layers.skyWaterCtx, metrics.cssWidth, metrics.cssHeight, params);
        layers.markSkyWaterClean();
      }
      if (layers.needsRoadTrailReset) {
        resetRoadTrailBase(layers.roadTrailCtx, metrics.cssWidth, metrics.cssHeight, params);
        layers.markRoadTrailClean();
      }

      drawRoad(layers.roadTrailCtx, params, world.distanceU, isRoadMarkingsErased(world.seal));
      // TECH_SPEC.md §8's "trail resolution" degrade step: skip repainting the trail on
      // some frames under sustained low fps rather than every frame — the road+trail
      // layer never clears itself (it's a persisting accumulation, road.ts), so a
      // skipped frame simply doesn't add fresh ink that frame, it doesn't leave a gap.
      if (renderFrameCount % currentQuality.trailPaintEveryNthFrame === 0) {
        drawInkTrail(layers.roadTrailCtx, params, brushX, BRUSH_Z, world.line, world.timeS, profile.settings.reducedMotion);
      }

      const deathElapsedS = deathAtRealMs === null ? 0 : (nowMs() - deathAtRealMs) / 1000;
      if (world.isDead) {
        drawInkBleed(layers.roadTrailCtx, params, brushX, BRUSH_Z, inkBleedFraction(deathElapsedS));
      }

      layers.clearActors();
      drawBlot(layers.actorsCtx, params, world.blotPool, BRUSH_Z);
      drawSlips(layers.actorsCtx, params, world.slipPool, profile.settings.shapesOnly);
      if (world.currentGatePair !== null) {
        drawGatePair(layers.actorsCtx, params, world.currentGatePair, world.gatePairZ);
      }
      drawSealstacks(layers.actorsCtx, params, world.sealstackPool);
      if (world.seal !== null) {
        drawSeal(layers.actorsCtx, metrics.cssWidth, metrics.cssHeight, params, world.seal, world.timeS);
      }
      drawLine(layers.actorsCtx, params, brushX, BRUSH_Z, world.line, currentQuality, profile.settings.shapesOnly);
      drawJoiningRecruits(layers.actorsCtx, params, world.joiningRecruitPool);
      drawProjectiles(layers.actorsCtx, params, world.projectilePool);
      drawPhraseEffects(layers.actorsCtx, params, world.phrase, brushX, BRUSH_Z, world.timeS);
      drawBrush(layers.actorsCtx, params, brushX, BRUSH_Z, world.wetness, world.flourish, world.timeS);

      layers.compositeInto(viewport.ctx);
    },
  };

  const loop = new FixedStepLoop(callbacks);
  attachVisibilityAutoPause(loop);
  runInBrowser(loop);

  // The Wake Lock API releases itself automatically whenever the document goes hidden
  // (the spec's own behaviour, not something this app requests) — re-acquiring here on
  // return covers the common "switched app, came back mid-Passage" case that
  // `attachVisibilityAutoPause` above already resumes the loop for.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && appState === 'playing') wakeLock.acquire();
  });

  // TECH_SPEC.md §11: "hardware back button mapped to pause/back-out (never straight to
  // exit from a Passage)." The `backButton` event only ever fires inside a real Android
  // WebView (Capacitor's own web implementation of `@capacitor/app` never dispatches it
  // in a plain browser), so this is inert everywhere else without needing its own guard.
  // Settings is the one screen with a real in-app "back" target (Title); everywhere else
  // there's nowhere further back to go *within* the app, so the choice is minimize
  // (mid-Passage — preserves World state entirely, the "pause" this task asks for) or
  // exit (every other screen — profile progress is already saved by the time any of
  // them can be showing, so there's nothing to lose).
  App.addListener('backButton', () => {
    if (appState === 'settings') {
      setAppState('title');
    } else if (appState === 'playing') {
      App.minimizeApp();
    } else {
      App.exitApp();
    }
  });

  const debugRequested = new URLSearchParams(window.location.search).get('debug') === '1';

  if (debugRequested) {
    mountDebugOverlay(loop, app);

    const debugLineSizes: Record<string, number> = {
      Digit1: 1,
      Digit2: 5,
      Digit3: 37,
      Digit4: 120,
      Digit5: 400,
    };
    const debugBlotWaveSizes: Record<string, number> = {
      Digit6: 150,
      Digit7: 400,
      Digit8: 900,
    };
    document.addEventListener('keydown', (e) => {
      const lineSize = debugLineSizes[e.code];
      if (lineSize !== undefined) {
        world.line = buildDebugLine(lineSize);
      }
      const waveSize = debugBlotWaveSizes[e.code];
      if (waveSize !== undefined) {
        world.blotPool.releaseAll();
        spawnDebugBlotWave(world.blotPool, waveSize);
      }
      if (e.code === 'Digit9') {
        spawnDebugSlipRun(world.slipPool, 'plusOne', 8, world.line, debugRng);
      }
      if (e.code === 'Digit0') {
        spawnDebugSlipRun(world.slipPool, 'plusTwentyFive', 1, world.line, debugRng);
      }
      if (e.code === 'KeyG') {
        world.currentGatePair = generateGatePair(debugRng);
        world.gatePairZ = 40;
      }
      if (e.code === 'KeyH') {
        spawnSealstack(world.sealstackPool, debugRng.chance('cosmetic', 0.5) ? 'left' : 'right', 40);
      }
      if (e.code === 'KeyR') {
        // Debug-only fast restart: straight back into a fresh Passage, skipping the
        // summary/Inkstone stop the real death flow always takes.
        beginPassage();
      }
      if (e.code === 'KeyJ') {
        world.line = buildDebugPureLine('hane', BALANCE.phrase.rowSize);
      }
      if (e.code === 'KeyK') {
        world.line = buildDebugPureLine('tome', BALANCE.phrase.rowSize);
      }
      if (e.code === 'KeyL') {
        world.line = buildDebugPureLine('harai', BALANCE.phrase.rowSize);
      }
      if (e.code === 'KeyB') {
        // Task 3.1's debug hook: starts the stub Seal at sealIndex 0. Real Director-
        // driven cadence (GAME_DESIGN.md §8.2's 75s arcade loop) is Task 3.5.
        startSealEncounter(world, 0, STUB_SEAL_DEFINITION);
      }
      if (e.code === 'KeyM') {
        // Task 3.2's debug hook: starts The Smear (the first real boss) at sealIndex 0.
        startSealEncounter(world, 0, SMEAR_SEAL_DEFINITION);
      }
      if (e.code === 'KeyN') {
        // Task 3.3's debug hook: starts The Press at sealIndex 0.
        startSealEncounter(world, 0, PRESS_SEAL_DEFINITION);
      }
      if (e.code === 'KeyV') {
        // Task 3.4's debug hook: starts The Blank at sealIndex 0.
        startSealEncounter(world, 0, BLANK_SEAL_DEFINITION);
      }
      if (e.code === 'KeyT') {
        // Task 4.3's debug hook: jumps straight to the title screen from anywhere.
        titleScreen.update(profile);
        setAppState('title');
      }
    });
  }
}

bootstrap();
