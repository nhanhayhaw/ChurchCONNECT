/**
 * Synthesises the voice-over for every scene, measures each clip, and writes
 * build/<reel>.timeline.json: scene start/end, the clip to play, and the
 * subtitle chunks. Clips are cached by text+voice so re-runs are instant.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { REELS, VOICE, VOICE_RATE } from './specs/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(here, 'build');
const VO = path.join(BUILD, 'vo');
fs.mkdirSync(VO, { recursive: true });

/** ffmpeg-static ships no ffprobe; decode to null and read the final time=. */
export function durationOf(file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const out = (r.stderr || '') + (r.stdout || '');
  const m = [...out.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  if (!m) throw new Error('Could not measure ' + file + '\n' + out);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

async function synth(text, file) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, { rate: VOICE_RATE });
  const chunks = [];
  for await (const c of audioStream) chunks.push(c);
  fs.writeFileSync(file, Buffer.concat(chunks));
}

/** Subtitle chunks: one sentence per chunk, long sentences wrapped evenly at ~max chars. */
function chunk(text, max = 46) {
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    if (s.length <= max) { out.push(s); continue; }
    // Prefer phrase breaks (comma, colon, semicolon); pack phrases up to max.
    const phrases = s.split(/(?<=[,:;])\s+/);
    let cur = '';
    const packed = [];
    for (const ph of phrases) {
      const next = cur ? cur + ' ' + ph : ph;
      if (next.length > max && cur) { packed.push(cur); cur = ph; } else cur = next;
    }
    if (cur) packed.push(cur);
    for (const piece of packed) {
      if (piece.length <= max) { out.push(piece); continue; }
      const words = piece.split(/\s+/);
      const parts = Math.ceil(piece.length / max);
      const target = Math.ceil(words.length / parts);
      for (let i = 0; i < words.length; i += target) out.push(words.slice(i, i + target).join(' '));
    }
  }
  return out;
}

const only = process.argv[2];
for (const reel of REELS) {
  if (only && reel.id !== only) continue;
  let t = 0;
  const scenes = [];
  const subs = [];
  for (const sc of reel.scenes) {
    let voFile = null, voDur = 0;
    if (sc.vo) {
      const key = crypto.createHash('md5').update(VOICE + VOICE_RATE + sc.vo).digest('hex').slice(0, 10);
      voFile = path.join(VO, `${reel.id}-${sc.id}-${key}.mp3`);
      if (!fs.existsSync(voFile)) { process.stdout.write(`  tts ${reel.id}/${sc.id}\n`); await synth(sc.vo, voFile); }
      voDur = durationOf(voFile);
    }
    const delay = sc.voDelay ?? 0.35;
    const voStart = t + delay;
    const dur = Math.max(sc.min, delay + voDur + sc.pad);
    const start = t, end = t + dur;
    scenes.push({
      id: sc.id, start: +start.toFixed(3), end: +end.toFixed(3), dur: +dur.toFixed(3),
      vo: voFile ? { file: path.relative(here, voFile).replace(/\\/g, '/'), start: +voStart.toFixed(3), dur: +voDur.toFixed(3), text: sc.vo } : null,
    });
    if (voFile) {
      const parts = chunk(sc.vo);
      const chars = parts.reduce((a, b) => a + b.length, 0);
      let c = voStart;
      for (const ptxt of parts) {
        const d = voDur * (ptxt.length / chars);
        subs.push({ start: +c.toFixed(3), end: +(c + d - 0.05).toFixed(3), text: ptxt });
        c += d;
      }
    }
    t = end;
  }
  const timeline = {
    id: reel.id, file: reel.file, title: reel.title, total: +t.toFixed(3), scenes,
    byId: Object.fromEntries(scenes.map((s) => [s.id, s])), subs,
  };
  fs.writeFileSync(path.join(BUILD, `${reel.id}.timeline.json`), JSON.stringify(timeline, null, 2));
  console.log(`${reel.id}: ${t.toFixed(1)}s  ` + scenes.map((s) => `${s.id}=${s.dur.toFixed(1)}`).join(' '));
}
