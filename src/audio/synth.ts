// WebAudio synthesis primitives (Task 4.4, GAME_DESIGN.md §12: "all synthesised at
// runtime"). No audio files anywhere in this repo — every sound here is built at the
// moment it's needed from oscillators, a shared noise buffer, and gain envelopes.
//
// "Audio never blocks the loop" (CLAUDE.md): every function here only ever schedules
// WebAudio graph nodes (all async/event-driven by construction) — nothing here awaits,
// polls, or does synchronous work proportional to sound length. The one thing that
// *would* block — decoding/generating a noise buffer — happens once, lazily, at mixer
// creation, never per-sound.

import { RngRegistry } from '../core/rng.js';

export interface Mixer {
  readonly context: AudioContext;
  readonly sfxBus: GainNode;
  readonly musicBus: GainNode;
  readonly noiseBuffer: AudioBuffer;
  setMuted(muted: boolean): void;
}

export type Bus = 'sfx' | 'music';

// Long enough that every noise-burst SFX (all well under 1s) can play from its start
// without ever needing a rolling read cursor into the buffer.
const NOISE_BUFFER_DURATION_S = 2;

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * NOISE_BUFFER_DURATION_S);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // Cosmetic only, never gameplay-deterministic — reuses the seeded generator purely to
  // stay inside the project-wide Math.random ban (see eslint.config.js's /audio
  // carve-out note for why bare Math.random still isn't used here regardless).
  const rng = new RngRegistry(1);
  for (let i = 0; i < length; i++) {
    data[i] = rng.range('cosmetic', -1, 1);
  }
  return buffer;
}

let mixerInstance: Mixer | null = null;

/** Lazily creates the one AudioContext/mixer the whole game shares. Safe to call
 *  anytime (including before any user gesture) — the context may start `suspended`;
 *  `resumeAudioContext` is what actually needs to run inside a real gesture handler. */
export function getMixer(): Mixer {
  if (mixerInstance !== null) return mixerInstance;
  const context = new AudioContext();
  const sfxBus = context.createGain();
  const musicBus = context.createGain();
  sfxBus.connect(context.destination);
  musicBus.connect(context.destination);
  mixerInstance = {
    context,
    sfxBus,
    musicBus,
    noiseBuffer: createNoiseBuffer(context),
    setMuted(muted: boolean): void {
      const gain = muted ? 0 : 1;
      const now = context.currentTime;
      sfxBus.gain.setValueAtTime(gain, now);
      musicBus.gain.setValueAtTime(gain, now);
    },
  };
  return mixerInstance;
}

/** Browsers refuse to produce sound from an AudioContext until it's resumed inside a
 *  real user gesture — call this from an actual click/keydown handler. */
export function resumeAudioContext(mixer: Mixer): void {
  if (mixer.context.state === 'suspended') {
    void mixer.context.resume();
  }
}

function busGain(mixer: Mixer, bus: Bus): GainNode {
  return bus === 'sfx' ? mixer.sfxBus : mixer.musicBus;
}

export interface NoiseBurstOptions {
  readonly bus?: Bus;
  readonly durationS: number;
  readonly filterType?: BiquadFilterType;
  readonly filterFreq: number;
  /** If set, the filter's cutoff sweeps linearly from `filterFreq` to this over the
   *  burst's duration — Harai's "brushed sweep" and Gate's "paper tear" both want a
   *  moving, not static, texture. */
  readonly filterSweepToFreq?: number;
  readonly filterQ?: number;
  readonly gain?: number;
}

/** A short, filtered burst sourced from the shared noise buffer. */
export function playNoiseBurst(mixer: Mixer, opts: NoiseBurstOptions): void {
  const { context, noiseBuffer } = mixer;
  const now = context.currentTime;

  const source = context.createBufferSource();
  source.buffer = noiseBuffer;

  const filter = context.createBiquadFilter();
  filter.type = opts.filterType ?? 'bandpass';
  filter.Q.value = opts.filterQ ?? 1;
  filter.frequency.setValueAtTime(opts.filterFreq, now);
  if (opts.filterSweepToFreq !== undefined) {
    filter.frequency.linearRampToValueAtTime(opts.filterSweepToFreq, now + opts.durationS);
  }

  const envelope = context.createGain();
  const peak = opts.gain ?? 0.3;
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(peak, now + 0.005);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + opts.durationS);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(busGain(mixer, opts.bus ?? 'sfx'));

  source.start(now, 0, opts.durationS);
  source.stop(now + opts.durationS + 0.02);
}

export interface ToneOptions {
  readonly bus?: Bus;
  readonly freq: number;
  readonly type?: OscillatorType;
  readonly durationS: number;
  readonly gain?: number;
  readonly attackS?: number;
  /** Seconds from now to start the note — lets a caller schedule a short sequence (the
   *  Recruitment "rising fifth" is two of these) precisely on the AudioContext's own
   *  clock rather than a JS timer, which is both more accurate and doesn't need a
   *  setTimeout callback at all. */
  readonly startDelayS?: number;
}

/** A single enveloped oscillator note. */
export function playTone(mixer: Mixer, opts: ToneOptions): void {
  const { context } = mixer;
  const startAt = context.currentTime + (opts.startDelayS ?? 0);

  const osc = context.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.value = opts.freq;

  const envelope = context.createGain();
  const peak = opts.gain ?? 0.25;
  const attack = opts.attackS ?? 0.01;
  envelope.gain.setValueAtTime(0, startAt);
  envelope.gain.linearRampToValueAtTime(peak, startAt + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + opts.durationS);

  osc.connect(envelope);
  envelope.connect(busGain(mixer, opts.bus ?? 'sfx'));
  osc.start(startAt);
  osc.stop(startAt + opts.durationS + 0.02);
}

export interface DroneOptions {
  readonly bus?: Bus;
  readonly freq: number;
  readonly detuneCents?: number;
  readonly gain?: number;
  readonly fadeInS?: number;
  readonly type?: OscillatorType;
}

export interface DroneHandle {
  stop(fadeOutS?: number): void;
}

/** A sustained two-oscillator drone, the second slightly detuned against the first —
 *  Seal's "detuned low drone." Runs until `.stop()` is called; there is no automatic
 *  duration, since a Seal encounter's own length isn't known up front. */
export function startDrone(mixer: Mixer, opts: DroneOptions): DroneHandle {
  const { context } = mixer;
  const now = context.currentTime;

  const envelope = context.createGain();
  const peak = opts.gain ?? 0.15;
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(peak, now + (opts.fadeInS ?? 0.5));
  envelope.connect(busGain(mixer, opts.bus ?? 'sfx'));

  const type = opts.type ?? 'sawtooth';
  const oscA = context.createOscillator();
  oscA.type = type;
  oscA.frequency.value = opts.freq;
  const oscB = context.createOscillator();
  oscB.type = type;
  oscB.frequency.value = opts.freq;
  oscB.detune.value = opts.detuneCents ?? 9;

  oscA.connect(envelope);
  oscB.connect(envelope);
  oscA.start(now);
  oscB.start(now);

  let stopped = false;
  return {
    stop(fadeOutS = 0.6): void {
      if (stopped) return;
      stopped = true;
      const stopNow = context.currentTime;
      const stopAt = stopNow + fadeOutS;
      envelope.gain.cancelScheduledValues(stopNow);
      envelope.gain.setValueAtTime(envelope.gain.value, stopNow);
      envelope.gain.linearRampToValueAtTime(0, stopAt);
      oscA.stop(stopAt + 0.05);
      oscB.stop(stopAt + 0.05);
    },
  };
}
