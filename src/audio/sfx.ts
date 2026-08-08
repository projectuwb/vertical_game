// SFX triggers (Task 4.4, GAME_DESIGN.md §12): "Fire = short filtered noise burst,
// pitch by class (Hane high tick, Tome low thud, Harai brushed sweep). Recruitment = a
// soft rising fifth. Gate = paper tear. Seal = detuned low drone." Exactly these four
// sim/events.ts events, each mapped onto synth.ts primitives — no more, matching what
// §12 actually names.
//
// `attachSfx` subscribes to one Passage's own EventBus (sim/events.ts's GameEventBus,
// fresh per `createWorld`) — main.ts calls it once per `beginPassage()`. Nothing needs
// to explicitly detach the previous Passage's listeners: they go away with the old
// World/EventBus the moment `world` is reassigned, same as every other per-Passage
// object in this codebase.

import { BALANCE } from '../sim/config.js';
import type { GameEventBus } from '../sim/events.js';
import type { StrokeClass } from '../sim/stroke.js';
import { getMixer, playNoiseBurst, playTone, startDrone, type Mixer } from './synth.js';

// Every constant below is a cosmetic audio-tuning number, not a gameplay balance one —
// /audio isn't covered by the "no magic numbers outside config.ts" scanner (it only
// walks /sim), same carve-out /render's own cosmetic constants already use.

// Fire, by class — tuned to match GAME_DESIGN.md §12's own descriptions: Hane a "high
// tick" (very short, high bandpass), Tome a "low thud" (a touch longer, lowpassed),
// Harai a "brushed sweep" (the filter cutoff actually moves during the burst).
function playFireHane(mixer: Mixer): void {
  playNoiseBurst(mixer, { durationS: 0.045, filterType: 'bandpass', filterFreq: 3400, filterQ: 6, gain: 0.16 });
}
function playFireTome(mixer: Mixer): void {
  playNoiseBurst(mixer, { durationS: 0.09, filterType: 'lowpass', filterFreq: 220, filterQ: 0.7, gain: 0.28 });
}
function playFireHarai(mixer: Mixer): void {
  playNoiseBurst(mixer, {
    durationS: 0.14,
    filterType: 'bandpass',
    filterFreq: 900,
    filterSweepToFreq: 2600,
    filterQ: 3,
    gain: 0.15,
  });
}
const FIRE_SFX: Record<StrokeClass, (mixer: Mixer) => void> = {
  hane: playFireHane,
  tome: playFireTome,
  harai: playFireHarai,
};
// Fire is the one event that can arrive many times in a single step (a big Line firing
// several classes' worth of projectiles at once) — throttled per class so a 400-Stroke
// Line reads as "a lot of fire," not a wall of overlapping clicks.
const FIRE_MIN_INTERVAL_S: Record<StrokeClass, number> = { hane: 0.05, tome: 0.09, harai: 0.07 };

// Recruitment: "a soft rising fifth" — two soft sine notes, the second a perfect fifth
// (3:2) above the first, starting shortly after it.
const RECRUIT_BASE_FREQ = 392; // G4
const RECRUIT_FIFTH_RATIO = 3 / 2;
const RECRUIT_STEP_DELAY_S = 0.09;
function playRecruit(mixer: Mixer): void {
  playTone(mixer, { freq: RECRUIT_BASE_FREQ, type: 'sine', durationS: 0.32, gain: 0.13, attackS: 0.02 });
  playTone(mixer, {
    freq: RECRUIT_BASE_FREQ * RECRUIT_FIFTH_RATIO,
    type: 'sine',
    durationS: 0.38,
    gain: 0.13,
    attackS: 0.02,
    startDelayS: RECRUIT_STEP_DELAY_S,
  });
}

// Gate: "paper tear" — a bright, sharply downward-sweeping filtered burst, longer and
// more textured than Fire's clicks/thuds.
function playGateTear(mixer: Mixer): void {
  playNoiseBurst(mixer, {
    durationS: 0.22,
    filterType: 'highpass',
    filterFreq: 4500,
    filterSweepToFreq: 900,
    filterQ: 2,
    gain: 0.22,
  });
}

// Seal: "detuned low drone." A discrete arrival cue, not a persistent state-tracked
// sustain — bounded to the 6s approach itself (GAME_DESIGN.md §8.2), fading out right
// as the fight begins, the same shape every other SFX here has (a one-shot response to
// one event, just a much longer one). The generative *music* dropping to its own single
// drone through the whole encounter is a separate, ongoing behaviour — that's music.ts's
// job, not this bounded cue's.
const SEAL_DRONE_FREQ = 55; // A1
const SEAL_DRONE_FADE_OUT_S = 1.2;
function playSealDrone(mixer: Mixer): void {
  const drone = startDrone(mixer, { freq: SEAL_DRONE_FREQ, detuneCents: 11, gain: 0.12, fadeInS: 1.0 });
  const stopDelayMs = Math.max(0, BALANCE.seals.approachTelegraphS - SEAL_DRONE_FADE_OUT_S) * 1000;
  window.setTimeout(() => drone.stop(SEAL_DRONE_FADE_OUT_S), stopDelayMs);
}

export function attachSfx(events: GameEventBus): void {
  const mixer = getMixer();
  const lastFireAtS: Record<StrokeClass, number> = { hane: -Infinity, tome: -Infinity, harai: -Infinity };

  events.on('fire', ({ class: cls }) => {
    const now = mixer.context.currentTime;
    if (now - lastFireAtS[cls] < FIRE_MIN_INTERVAL_S[cls]) return;
    lastFireAtS[cls] = now;
    FIRE_SFX[cls](mixer);
  });
  events.on('recruit', () => playRecruit(mixer));
  events.on('gateResolved', () => playGateTear(mixer));
  events.on('sealApproach', () => playSealDrone(mixer));
}
