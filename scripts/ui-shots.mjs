#!/usr/bin/env node
// Real-click UI check: idle / running / ended at several viewports, overflow + errors + external requests.
// Usage: node scripts/ui-shots.mjs [--base http://127.0.0.1:5180/] [--out qa/ui] [--rs 0.5]
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt('base', 'http://127.0.0.1:5180/');
const out = opt('out', 'qa/ui');
const rs = opt('rs', '0.5');
mkdirSync(out, { recursive: true });

function findChrome() {
  const root = join(homedir(), '.cache/ms-playwright');
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const full = join(root, d, 'chrome-linux64/chrome');
    if (existsSync(full)) return full;
  }
  throw new Error('chromium not found');
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const sizes = [
  [1920, 1080],
  [1080, 640],
  [390, 844],
];
const report = [];
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url());
  });
  await page.goto(`${base}?rs=${rs}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const overflow = () =>
    page.evaluate(() => {
      const vw = innerWidth;
      const vh = innerHeight;
      const bad = [];
      for (const el of document.querySelectorAll('#app *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > vw + 0.5 || r.left < -0.5 || r.bottom > vh + 0.5) bad.push(`${el.tagName}#${el.id}.${el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      return { scrollW: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 8) };
    });
  const tag = `${w}x${h}`;
  const fontsOk = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight).slice(0, 4));
  await page.screenshot({ path: join(out, `${tag}-idle.png`) });
  const o1 = await overflow();
  await page.click('#introStart');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${tag}-running.png`) });
  const o2 = await overflow();
  await page.waitForFunction(() => document.getElementById('stage').dataset.phase === 'ended', null, { timeout: 90000 });
  await page.screenshot({ path: join(out, `${tag}-ended.png`) });
  const o3 = await overflow();
  const st = await page.evaluate(() => ({ status: document.getElementById('status').textContent, shown: document.getElementById('stage').dataset.shown }));
  report.push({ tag, fontsOk, overflow: [o1, o2, o3], st, errors, external });
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
