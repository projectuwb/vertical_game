// Generative music (Task 4.4, GAME_DESIGN.md §12): "a slow generative two-voice
// pattern in a pentatonic scale, tempo tied to Pressure, dropping to a single drone
// before a Seal."
//
// Runs on its own lookahead scheduler — a periodic check that always schedules real
// WebAudio note-start times slightly ahead of "now" via `playTone`'s own `startDelayS`,
// never a note fired synchronously from inside the check itself. That's what "audio
// never blocks the loop" (CLAUDE.md) means in practice: the render loop only ever tells
// this module *what* to play next (current Pressure, whether a Seal is near) through
// `setPressure`/`setSealNear`; it never drives *when* a note actually sounds, and a
// slow/janky frame can never delay or glitch a note that's already scheduled.

import { RngRegistry } from '../core/rng.js';
import { playTone, startDrone, type DroneHandle, type Mixer } from './synth.js';

// A minor pentatonic scale (root, minor 3rd, perfect 4th, perfect 5th, minor 7th, as
// just-intonation ratios) — chosen over major pentatonic for the "wet ink and mineral
// pigment... at night" mood (GAME_DESIGN.md §12); logged in DECISIONS.md. Rooted low
// (D3) so both voices sit under where every SFX in sfx.ts reads clearly on top.
const ROOT_FREQ = 146.83; // D3
const SCALE_RATIOS: readonly number[] = [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5];
const SCALE_FREQS: readonly number[] = [
  ...SCALE_RATIOS.map((r) => ROOT_FREQ * r),
  ...SCALE_RATIOS.map((r) => ROOT_FREQ * r * 2), // one octave up, so voices have room to move against each other
];

const LOOKAHEAD_INTERVAL_MS = 120;
const SCHEDULE_AHEAD_S = 0.3;
// "Slow" (GAME_DESIGN.md §12) at low Pressure, tightening as it climbs — Pressure's own
// formula (sim/director.ts) puts a typical full-length run somewhere around 1 (Passage
// start) to ~17 (a long, large-Line late game), so this saturates well before the
// theoretical max rather than needing Pressure to reach it.
const MIN_NOTE_INTERVAL_S = 0.9;
const MAX_NOTE_INTERVAL_S = 2.6;
const PRESSURE_SATURATION = 12;
const DRONE_FREQ = ROOT_FREQ / 2;
const SEAL_DRONE_FADE_IN_S = 2;
const SEAL_DRONE_FADE_OUT_S = 1.5;

export interface MusicController {
  setPressure(pressure: number): void;
  setSealNear(near: boolean): void;
  stop(): void;
}

interface Voice {
  nextNoteAtS: number;
  readonly type: OscillatorType;
  readonly gain: number;
}

export function createMusicController(mixer: Mixer): MusicController {
  const rng = new RngRegistry(Date.now());
  let pressure = 1;
  let sealNear = false;
  let drone: DroneHandle | null = null;

  const now = mixer.context.currentTime;
  const voiceA: Voice = { nextNoteAtS: now + 0.1, type: 'sine', gain: 0.06 };
  const voiceB: Voice = { nextNoteAtS: now + 0.6, type: 'triangle', gain: 0.045 };

  function noteIntervalS(): number {
    const t = Math.min(1, Math.max(0, (pressure - 1) / PRESSURE_SATURATION));
    return MAX_NOTE_INTERVAL_S - t * (MAX_NOTE_INTERVAL_S - MIN_NOTE_INTERVAL_S);
  }

  function scheduleVoice(voice: Voice, untilS: number): void {
    while (voice.nextNoteAtS < untilS) {
      const freq = SCALE_FREQS[rng.int('cosmetic', 0, SCALE_FREQS.length)] ?? ROOT_FREQ;
      const interval = noteIntervalS();
      playTone(mixer, {
        bus: 'music',
        freq,
        type: voice.type,
        durationS: interval * 0.9,
        gain: voice.gain,
        attackS: 0.08,
        startDelayS: Math.max(0, voice.nextNoteAtS - mixer.context.currentTime),
      });
      voice.nextNoteAtS += interval;
    }
  }

  function tick(): void {
    if (sealNear) return; // dropped to the drone instead — voices just hold, don't advance or backlog
    const untilS = mixer.context.currentTime + SCHEDULE_AHEAD_S;
    scheduleVoice(voiceA, untilS);
    scheduleVoice(voiceB, untilS);
  }

  const intervalHandle = window.setInterval(tick, LOOKAHEAD_INTERVAL_MS);

  return {
    setPressure(p: number): void {
      pressure = p;
    },
    setSealNear(near: boolean): void {
      if (near === sealNear) return;
      sealNear = near;
      if (near) {
        drone = startDrone(mixer, {
          bus: 'music',
          freq: DRONE_FREQ,
          detuneCents: 6,
          gain: 0.05,
          fadeInS: SEAL_DRONE_FADE_IN_S,
        });
      } else {
        drone?.stop(SEAL_DRONE_FADE_OUT_S);
        drone = null;
        // Resume both voices cleanly from "now," not by bursting through however many
        // notes they would have played during the drone — that would read as the
        // music suddenly double-timing right when a Seal fight ends.
        const resumeAt = mixer.context.currentTime + 0.5;
        voiceA.nextNoteAtS = resumeAt;
        voiceB.nextNoteAtS = resumeAt + 0.3;
      }
    },
    stop(): void {
      window.clearInterval(intervalHandle);
      drone?.stop(0.3);
    },
  };
}
