import type { SoundId } from '@/shared/protocol';

/**
 * The soundboard is synthesized with WebAudio: no audio files to license, ship or have blocked by
 * Netflix's CSP, and only the sound's *name* ever travels to the friend.
 */

export const SOUNDS: { id: SoundId; label: string; emoji: string }[] = [
  { id: 'applause', label: 'Applause', emoji: '👏' },
  { id: 'rimshot', label: 'Rimshot', emoji: '🥁' },
  { id: 'gasp', label: 'Gasp', emoji: '😮' },
  { id: 'dundun', label: 'Dun dun', emoji: '🎬' },
  { id: 'airhorn', label: 'Airhorn', emoji: '📣' },
  { id: 'boing', label: 'Boing', emoji: '🪀' },
  { id: 'trombone', label: 'Sad trombone', emoji: '🎺' },
  { id: 'raspberry', label: 'Raspberry', emoji: '😛' },
];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { c: AudioContext; out: GainNode } | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.7;
      const squash = ctx.createDynamicsCompressor(); // keep stacked sounds from clipping
      master.connect(squash).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { c: ctx, out: master! };
  } catch { return null; }
}

interface ToneOpts { type: OscillatorType; f0: number; f1?: number; t: number; dur: number; gain: number; attack?: number; lowpass?: number; vibrato?: [number, number]; detune?: number }

function tone(c: AudioContext, out: AudioNode, o: ToneOpts) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type;
  osc.detune.value = o.detune ?? 0;
  osc.frequency.setValueAtTime(o.f0, c.currentTime + o.t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, c.currentTime + o.t + o.dur);
  const t0 = c.currentTime + o.t;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let node: AudioNode = osc;
  if (o.lowpass) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; osc.connect(f); node = f; }
  node.connect(g).connect(out);
  if (o.vibrato) {
    const lfo = c.createOscillator(); const depth = c.createGain();
    lfo.frequency.value = o.vibrato[0]; depth.gain.value = o.vibrato[1];
    lfo.connect(depth).connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
  }
  osc.start(t0); osc.stop(t0 + o.dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

interface NoiseOpts { t: number; dur: number; gain: number; type: BiquadFilterType; f0: number; f1?: number; q?: number }
function noise(c: AudioContext, out: AudioNode, o: NoiseOpts) {
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter(); f.type = o.type; f.Q.value = o.q ?? 1;
  const g = c.createGain();
  const t0 = c.currentTime + o.t;
  f.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + Math.min(0.02, o.dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0, Math.random());
  src.stop(t0 + o.dur + 0.05);
}

const PLAYERS: Record<SoundId, (c: AudioContext, o: AudioNode) => void> = {
  applause(c, o) {
    for (let i = 0; i < 46; i++) {
      const t = i * 0.035 + Math.random() * 0.03;
      const swell = Math.sin(Math.min(1, t / 1.7) * Math.PI); // builds then fades
      noise(c, o, { t, dur: 0.04, gain: 0.05 + 0.3 * swell * Math.random(), type: 'bandpass', f0: 1200 + Math.random() * 2200, q: 0.8 });
    }
  },
  rimshot(c, o) {
    tone(c, o, { type: 'sine', f0: 150, f1: 55, t: 0, dur: 0.16, gain: 0.7 });
    noise(c, o, { t: 0, dur: 0.1, gain: 0.25, type: 'highpass', f0: 1800 });
    tone(c, o, { type: 'sine', f0: 190, f1: 70, t: 0.2, dur: 0.16, gain: 0.7 });
    noise(c, o, { t: 0.2, dur: 0.1, gain: 0.25, type: 'highpass', f0: 1800 });
    noise(c, o, { t: 0.42, dur: 0.9, gain: 0.3, type: 'highpass', f0: 6500 });
  },
  gasp(c, o) {
    noise(c, o, { t: 0, dur: 0.55, gain: 0.55, type: 'bandpass', f0: 700, f1: 2600, q: 2.5 });
  },
  dundun(c, o) {
    [[0, 98, 0.45], [0.55, 98, 0.45], [1.1, 73, 1.4]].forEach(([t, f, d]) => {
      tone(c, o, { type: 'sawtooth', f0: f!, t: t!, dur: d!, gain: 0.5, lowpass: 700, attack: 0.02 });
      tone(c, o, { type: 'square', f0: f! / 2, t: t!, dur: d!, gain: 0.3, lowpass: 300, attack: 0.02 });
    });
  },
  airhorn(c, o) {
    for (const [t, d] of [[0, 0.32], [0.4, 0.8]] as const) {
      for (const f of [392, 494, 587]) for (const det of [-9, 9]) tone(c, o, { type: 'sawtooth', f0: f, t, dur: d, gain: 0.07, lowpass: 2600, attack: 0.02, detune: det });
    }
  },
  boing(c, o) {
    tone(c, o, { type: 'sine', f0: 160, f1: 900, t: 0, dur: 0.12, gain: 0.6, vibrato: [18, 40] });
    tone(c, o, { type: 'sine', f0: 900, f1: 130, t: 0.12, dur: 0.5, gain: 0.6, vibrato: [18, 40] });
  },
  trombone(c, o) {
    [[0, 233, 0.32], [0.38, 220, 0.32], [0.76, 208, 0.32]].forEach(([t, f, d]) =>
      tone(c, o, { type: 'sawtooth', f0: f!, t: t!, dur: d!, gain: 0.3, lowpass: 900, vibrato: [5, 3] }));
    tone(c, o, { type: 'sawtooth', f0: 196, f1: 150, t: 1.14, dur: 1, gain: 0.3, lowpass: 900, vibrato: [6, 6], attack: 0.04 });
  },
  raspberry(c, o) {
    const osc = c.createOscillator(); const g = c.createGain(); const lfo = c.createOscillator(); const lg = c.createGain();
    const t0 = c.currentTime;
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(95, t0); osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.75);
    lfo.type = 'square'; lfo.frequency.value = 34; lg.gain.value = 0.25;
    g.gain.setValueAtTime(0.35, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    lfo.connect(lg).connect(g.gain);
    osc.connect(g).connect(o);
    osc.start(t0); lfo.start(t0); osc.stop(t0 + 0.85); lfo.stop(t0 + 0.85);
    noise(c, o, { t: 0, dur: 0.7, gain: 0.12, type: 'lowpass', f0: 500 });
  },
};

export function playSound(id: SoundId): void {
  const a = audio();
  if (a) PLAYERS[id](a.c, a.out);
}
