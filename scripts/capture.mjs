#!/usr/bin/env node
// Deterministic frame capture through the ?test=1 hook (window.__amadeusDemo.seek).
// Usage:
//   node scripts/capture.mjs --base http://127.0.0.1:5179/ --out qa/shots --scenario success \
//        --times 0.2,0.6,1.0 [--w 1920 --h 1080] [--reduced] [--prefix name]
//   node scripts/capture.mjs ... --fps 30 --video qa/video-success.mp4   (all frames + ffmpeg)
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const flag = (k) => args.includes('--' + k);

const base = opt('base', 'http://127.0.0.1:5179/');
const out = opt('out', 'qa/shots');
const scenario = opt('scenario', 'success');
const W = Number(opt('w', '1920'));
const H = Number(opt('h', '1080'));
const reduced = flag('reduced');
const prefix = opt('prefix', scenario + (reduced ? '-rm' : ''));
const fps = Number(opt('fps', '0'));
const video = opt('video', '');
// default: the page's direction (SG -> beta); --dir b2sg / ref, or explicit --origin/--target
const targetReading = opt('target', '');
const originReading = opt('origin', '');
const dirName = opt('dir', '');
const RW = Number(opt('rw', '0'));
const RH = Number(opt('rh', '0'));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = join(homedir(), '.cache/ms-playwright');
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    for (const p of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const full = join(root, d, p);
      if (existsSync(full)) return full;
    }
  }
  throw new Error('chromium not found; set CHROME');
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});
await page.goto(base + '?test=1&ui=0', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__amadeusDemo, null, { timeout: 30000 });
const info = await page.evaluate(() => window.__amadeusDemo.state());
console.log('renderer', JSON.stringify({ hdr: info.hdr, size: info.size }));

const canvas = page.locator('#gl');
let times;
if (fps > 0) {
  const dur = await page.evaluate(([s, r]) => window.__amadeusDemo.duration(s, { reducedMotion: r }), [scenario, reduced]);
  const n = Math.ceil(dur * fps) + Math.round(fps * 0.4);
  times = Array.from({ length: n }, (_, i) => i / fps);
} else {
  times = opt('times', '0.3').split(',').map(Number);
}
const log = [];
if (RW > 0 && RH > 0) {
  const sz = await page.evaluate(([w, h]) => window.__amadeusDemo.setRenderSize(w, h), [RW, RH]);
  console.log('render size', JSON.stringify(sz));
}
for (let i = 0; i < times.length; i++) {
  const t = times[i];
  if (RW > 0 && RH > 0) {
    const res = await page.evaluate(
      ([tt, s, r, tg, og, dn]) => window.__amadeusDemo.grab(tt, s, { reducedMotion: r, ...(tg ? { target: tg } : {}), ...(og ? { origin: og } : {}), ...(dn ? { dir: dn } : {}) }),
      [t, scenario, reduced, targetReading, originReading, dirName],
    );
    const name = fps > 0 ? `${prefix}-${String(i).padStart(4, '0')}.png` : `${prefix}-t${t.toFixed(2)}.png`;
    writeFileSync(join(out, name), Buffer.from(res.png.split(',')[1], 'base64'));
    delete res.png;
    log.push({ file: name, ...res });
    if (fps === 0) console.log(name, res.shot, res.shown);
    continue;
  }
  const res = await page.evaluate(
    ([tt, s, r, tg, og, dn]) => window.__amadeusDemo.seek(tt, s, { reducedMotion: r, ...(tg ? { target: tg } : {}), ...(og ? { origin: og } : {}), ...(dn ? { dir: dn } : {}) }),
    [t, scenario, reduced, targetReading, originReading, dirName],
  );
  const name = fps > 0 ? `${prefix}-${String(i).padStart(4, '0')}.png` : `${prefix}-t${t.toFixed(2)}.png`;
  await canvas.screenshot({ path: join(out, name) });
  log.push({ file: name, ...res });
  if (fps === 0) console.log(name, res.shot, res.shown);
}
if (fps > 0 && video) {
  mkdirSync(dirname(video), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(out, `${prefix}-%04d.png`),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', video]);
  console.log('video', video, times.length, 'frames');
}
console.log(JSON.stringify({ errors }, null, 0));
await browser.close();
