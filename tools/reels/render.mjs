/**
 * Renders a reel's HTML composition to a silent 1080x1920 H.264 file by
 * seeking the page frame by frame and piping screenshots into ffmpeg.
 *
 *   node render.mjs reel1            -> build/reel1.silent.mp4
 *   node render.mjs reel1 --stills 0,3.5,12   -> build/stills/reel1-<t>.png (review)
 *   node render.mjs all
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { REELS } from './specs/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(here, 'build');
const FPS = 30;

const args = process.argv.slice(2);
const which = args[0] || 'all';
const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;
// --from <seconds|sceneId>: re-render only from that point and splice it into the existing silent file.
const fromArg = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
import { spawnSync } from 'node:child_process';
const ids = which === 'all' ? REELS.map((r) => r.id) : which.split(',');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });

for (const id of ids) {
  const timeline = JSON.parse(fs.readFileSync(path.join(BUILD, `${id}.timeline.json`), 'utf8'));
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.addInitScript((tl) => { window.TIMELINE = tl; }, timeline);
  await page.goto(pathToFileURL(path.join(here, `${id}.html`)).href);
  await page.evaluate(() => window.__ready());

  if (stillsArg) {
    fs.mkdirSync(path.join(BUILD, 'stills'), { recursive: true });
    for (const ts of stillsArg.split(',').map(Number)) {
      await page.evaluate((t) => window.__seek(t), ts);
      const out = path.join(BUILD, 'stills', `${id}-${ts.toFixed(2)}.png`);
      await page.screenshot({ path: out, type: 'png' });
      console.log('still', out);
    }
    await page.close();
    continue;
  }

  const total = timeline.total;
  const frames = Math.ceil(total * FPS);
  const fromT = fromArg == null ? 0 : (isNaN(+fromArg) ? timeline.byId[fromArg].start : +fromArg);
  const firstFrame = Math.ceil(fromT * FPS);
  const finalOut = path.join(BUILD, `${id}.silent.mp4`);
  const out = fromArg == null ? finalOut : path.join(BUILD, `${id}.silent.part.mp4`);
  const ff = spawn(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const t0 = Date.now();
  for (let i = firstFrame; i < frames; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => window.__seek(tt), t);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) process.stdout.write(`  ${id} frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  console.log(`${id}: ${frames - firstFrame} frames -> ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (fromArg != null) {
    const spliced = path.join(BUILD, `${id}.silent.spliced.mp4`);
    const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', finalOut, '-i', out,
      '-filter_complex', `[0:v]trim=end_frame=${firstFrame},setpts=PTS-STARTPTS[a];[a][1:v]concat=n=2:v=1:a=0[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', spliced], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    fs.renameSync(spliced, finalOut);
    fs.unlinkSync(out);
    console.log(`${id}: spliced from frame ${firstFrame} into ${finalOut}`);
  }
  await page.close();
}

await browser.close();
