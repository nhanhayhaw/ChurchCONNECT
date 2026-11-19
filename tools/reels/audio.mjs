/**
 * Sound for each reel, then the final mux.
 *
 * Music is synthesised here (a warm pad, a soft piano-like arpeggio, a sub
 * pulse) so the campaign ships with a royalty-free bed and no licensing
 * question; swap build/<reel>.music.wav for a licensed track if preferred.
 * The bed ducks under the narration, sound effects are placed at the scene
 * events the specs declare, and the voice-over is mixed in from the clips the
 * voice-over step produced. Everything is deterministic.
 *
 *   node audio.mjs reel1     -> EKKLESIA_PROMOTIONAL_CAMPAIGN/Reel_01_...mp4 (+ .srt)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { REELS } from './specs/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(here, 'build');
const OUT = path.resolve(here, '../../EKKLESIA_PROMOTIONAL_CAMPAIGN');
const SR = 48000;

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI -> Hz

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds a tone with an ADSR-ish envelope into L/R at `start` seconds. */
function tone(L, R, { f, start, dur, a = 0.01, d = 0.1, s = 0.7, r = 0.3, gain = 0.2, pan = 0, harmonics = [1], detune = 0, shape = 'sine' }) {
  const n0 = Math.floor(start * SR), n1 = Math.min(L.length, Math.floor((start + dur + r) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = n0; i < n1; i++) {
    const t = (i - n0) / SR;
    let env;
    if (t < a) env = t / a;
    else if (t < a + d) env = 1 - (1 - s) * ((t - a) / d);
    else if (t < dur) env = s;
    else env = s * Math.max(0, 1 - (t - dur) / r);
    if (env <= 0) continue;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const amp = harmonics[h];
      if (!amp) continue;
      const ff = f * (h + 1);
      v += amp * Math.sin(TAU * ff * t);
      if (detune) v += amp * 0.5 * Math.sin(TAU * (ff + detune) * t + 1.3);
    }
    if (shape === 'soft') v = Math.tanh(v * 1.4);
    L[i] += v * env * gl;
    R[i] += v * env * gr;
  }
}

/** Filtered noise burst (one-pole low-pass with a sweeping cutoff). */
function noise(L, R, { start, dur, gain = 0.2, from = 800, to = 4000, rnd, env = 'swell', pan = 0 }) {
  const n0 = Math.floor(start * SR), n1 = Math.min(L.length, n0 + Math.floor(dur * SR));
  let y = 0;
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = n0; i < n1; i++) {
    const q = (i - n0) / (n1 - n0);
    const fc = from + (to - from) * q;
    const alpha = Math.min(1, TAU * fc / SR);
    y += alpha * ((rnd() * 2 - 1) - y);
    const e = env === 'swell' ? Math.sin(Math.PI * q) ** 1.5 : Math.pow(1 - q, 3);
    L[i] += y * e * gl; R[i] += y * e * gr;
  }
}

// ---------------------------------------------------------------------------
// Music bed
// ---------------------------------------------------------------------------
function music(total, voRanges, seed = 11) {
  const n = Math.ceil(total * SR);
  const L = new Float64Array(n), R = new Float64Array(n);
  const rnd = mulberry32(seed);
  const bpm = 84, beat = 60 / bpm, bar = beat * 4;
  // D major: I - V - vi - IV, each a bar, voiced for warmth.
  const CHORDS = [
    { root: 50, pad: [62, 66, 69, 74], arp: [74, 78, 81, 86] },   // D
    { root: 45, pad: [61, 64, 69, 73], arp: [73, 76, 81, 85] },   // A
    { root: 47, pad: [62, 66, 71, 74], arp: [74, 78, 83, 86] },   // Bm
    { root: 43, pad: [62, 67, 71, 74], arp: [74, 79, 83, 86] },   // G
  ];
  const bars = Math.ceil(total / bar) + 1;
  for (let b = 0; b < bars; b++) {
    const ch = CHORDS[b % 4];
    const start = b * bar;
    if (start > total) break;
    // Pad: slow attack, detuned, soft.
    for (const [k, m] of ch.pad.entries()) {
      tone(L, R, { f: note(m), start, dur: bar - 0.1, a: 0.9, d: 0.3, s: 0.85, r: 1.2, gain: 0.030, pan: (k - 1.5) * 0.35, harmonics: [1, 0.35, 0.12, 0.05], detune: 0.6 + k * 0.2, shape: 'soft' });
    }
    // Sub: root, gentle.
    tone(L, R, { f: note(ch.root), start, dur: bar - 0.2, a: 0.25, d: 0.2, s: 0.8, r: 0.5, gain: 0.07, harmonics: [1, 0.15] });
    // Soft kick on 1 and 3 (a pitched thump).
    for (const bt of [0, 2]) {
      const t0 = start + bt * beat;
      const n0 = Math.floor(t0 * SR), len = Math.floor(0.28 * SR);
      for (let i = 0; i < len && n0 + i < n; i++) {
        const t = i / SR, f = 42 + 70 * Math.exp(-t * 22);
        const v = Math.sin(TAU * f * t) * Math.exp(-t * 9) * 0.16;
        L[n0 + i] += v; R[n0 + i] += v;
      }
    }
    // Arpeggio: eighth notes, piano-like, a pattern that breathes.
    const pattern = [0, 1, 2, 3, 2, 1, 3, 2];
    for (let s = 0; s < 8; s++) {
      if (b === 0 && s < 4) continue;                       // let the pad open the piece
      const m = ch.arp[pattern[s]] + (s % 4 === 3 ? -12 : 0);
      const vel = 0.055 + 0.02 * ((s % 2) ? 0.4 : 1) + rnd() * 0.01;
      tone(L, R, { f: note(m), start: start + s * beat / 2, dur: 0.05, a: 0.004, d: 0.5, s: 0.0, r: 0.55, gain: vel, pan: (pattern[s] - 1.5) * 0.3, harmonics: [1, 0.5, 0.2, 0.08] });
    }
    // Shaker on the off-beats, barely there.
    for (let s = 1; s < 8; s += 2) noise(L, R, { start: start + s * beat / 2, dur: 0.06, gain: 0.018, from: 6000, to: 9000, rnd, env: 'decay', pan: 0.3 });
  }
  // Intro swell, outro fade, and ducking under the narration.
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let g = Math.min(1, t / 2.5) * Math.min(1, Math.max(0, (total - t) / 2.5));
    let duck = 1;
    for (const [a, b] of voRanges) {
      const fadeIn = 0.25, fadeOut = 0.6;
      if (t >= a - fadeIn && t <= b + fadeOut) {
        const w = t < a ? (t - (a - fadeIn)) / fadeIn : t > b ? 1 - (t - b) / fadeOut : 1;
        duck = Math.min(duck, 1 - 0.62 * Math.max(0, Math.min(1, w)));
      }
    }
    L[i] *= g * duck * 1.4; R[i] *= g * duck * 1.4;
  }
  return { L, R };
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------
const SFX = {
  whoosh(L, R, t, rnd) { noise(L, R, { start: t - 0.35, dur: 0.75, gain: 0.16, from: 300, to: 5000, rnd, env: 'swell' }); },
  riser(L, R, t, rnd) { noise(L, R, { start: t - 1.6, dur: 1.7, gain: 0.10, from: 200, to: 7000, rnd, env: 'swell' }); },
  click(L, R, t, rnd) { noise(L, R, { start: t, dur: 0.035, gain: 0.35, from: 2500, to: 1200, rnd, env: 'decay' }); tone(L, R, { f: 1800, start: t, dur: 0.01, a: 0.001, d: 0.02, s: 0, r: 0.02, gain: 0.08 }); },
  pop(L, R, t) { tone(L, R, { f: 520, start: t, dur: 0.04, a: 0.003, d: 0.08, s: 0, r: 0.06, gain: 0.12, harmonics: [1, 0.3] }); },
  chime(L, R, t) { tone(L, R, { f: note(88), start: t, dur: 0.05, a: 0.003, d: 0.9, s: 0, r: 0.6, gain: 0.11, harmonics: [1, 0.4, 0.1] }); tone(L, R, { f: note(95), start: t + 0.12, dur: 0.05, a: 0.003, d: 1.1, s: 0, r: 0.7, gain: 0.09, harmonics: [1, 0.3] }); },
  alert(L, R, t) { tone(L, R, { f: note(81), start: t, dur: 0.08, a: 0.003, d: 0.5, s: 0, r: 0.4, gain: 0.10, harmonics: [1, 0.5, 0.2] }); tone(L, R, { f: note(81), start: t + 0.16, dur: 0.08, a: 0.003, d: 0.6, s: 0, r: 0.5, gain: 0.10, harmonics: [1, 0.5, 0.2] }); },
  tick(L, R, t, rnd) { noise(L, R, { start: t, dur: 0.02, gain: 0.22, from: 3000, to: 1500, rnd, env: 'decay' }); },
  logo(L, R, t) { for (const [k, m] of [62, 69, 74, 78].entries()) tone(L, R, { f: note(m), start: t + k * 0.09, dur: 1.2, a: 0.02, d: 0.6, s: 0.5, r: 1.6, gain: 0.07, harmonics: [1, 0.3, 0.1], pan: (k - 1.5) * 0.3 }); },
};

// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------
function decodeToFloat(file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('decode failed ' + file + '\n' + r.stderr);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

function srtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
const only = process.argv[2] || 'all';
fs.mkdirSync(OUT, { recursive: true });

for (const reel of REELS) {
  if (only !== 'all' && !only.split(',').includes(reel.id)) continue;
  const tl = JSON.parse(fs.readFileSync(path.join(BUILD, `${reel.id}.timeline.json`), 'utf8'));
  const silent = path.join(BUILD, `${reel.id}.silent.mp4`);
  if (!fs.existsSync(silent)) { console.log(`${reel.id}: no silent render yet, skipping`); continue; }

  const total = tl.total + 0.05;
  const n = Math.ceil(total * SR);
  const voRanges = tl.scenes.filter((s) => s.vo).map((s) => [s.vo.start, s.vo.start + s.vo.dur]);

  // Music bed (also exported on its own for re-use or replacement).
  const { L, R } = music(total, voRanges);
  fs.mkdirSync(path.join(OUT, 'Production_Assets', 'Music'), { recursive: true });
  writeWav(path.join(OUT, 'Production_Assets', 'Music', `${reel.file}_music_bed.wav`), L, R);

  // Sound effects: every scene after the first opens with a whoosh; specs add the rest.
  const rnd = mulberry32(5);
  const events = [];
  tl.scenes.forEach((s, i) => { if (i > 0 && s.id !== 'outro') events.push(['whoosh', s.start]); });
  for (const sc of reel.scenes) {
    const s = tl.byId[sc.id];
    for (const [name, off] of sc.sfx || []) events.push([name, s.start + off]);
    if (sc.id === 'outro') events.push(['logo', s.start + 0.2]);
  }
  for (const [name, t] of events) if (SFX[name]) SFX[name](L, R, Math.max(0, t), rnd);

  // Narration, peak-normalised, placed at its scene offset.
  for (const s of tl.scenes) {
    if (!s.vo) continue;
    const pcm = decodeToFloat(path.join(here, s.vo.file));
    let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const g = peak > 0 ? 0.80 / peak : 1;
    const n0 = Math.floor(s.vo.start * SR);
    for (let i = 0; i < pcm.length && n0 + i < n; i++) { const v = pcm[i] * g; L[n0 + i] += v; R[n0 + i] += v; }
  }

  // Soft limiter so the sum never clips.
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 1.1) * 0.95; R[i] = Math.tanh(R[i] * 1.1) * 0.95; }

  const wav = path.join(BUILD, `${reel.id}.mix.wav`);
  writeWav(wav, L, R);

  const out = path.join(OUT, `${reel.file}.mp4`);
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', silent, '-i', wav,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart',
    '-metadata', `title=Ekklesia - ${reel.title}`, '-metadata', 'artist=Redemption Temple Assemblies of God', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);

  // Subtitles sidecar.
  const srt = tl.subs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n');
  fs.writeFileSync(path.join(OUT, `${reel.file}.srt`), srt);
  fs.mkdirSync(path.join(OUT, 'Production_Assets', 'Subtitles'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'Production_Assets', 'Subtitles', `${reel.file}.srt`), srt);
  console.log(`${reel.id}: ${out} (${tl.total.toFixed(1)}s)`);
}
