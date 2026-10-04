#!/usr/bin/env node
// Real-click regression of the three mock outcomes and the reduced-motion path (low render scale).
// Usage: node scripts/states-check.mjs [--base http://127.0.0.1:5180/] [--dir sg2b|b2sg|both]
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const i = process.argv.indexOf('--base');
const base = i > 0 ? process.argv[i + 1] : 'http://127.0.0.1:5180/';
const root = join(homedir(), '.cache/ms-playwright');
const dir = readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()[0];
const exe = join(root, dir, 'chrome-linux64/chrome');
if (!existsSync(exe)) throw new Error('chromium not found');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base + '?test=1&rs=0.25', { waitUntil: 'networkidle' });
const st = () => page.evaluate(() => window.__amadeusDemo.state());
const out = [];
// both directions of the shared transition, with the project's readings (
// SG 1.048596 %, beta 1.129848 %)
const DIRS = { sg2b: ['1.048596', '1.129848'], b2sg: ['1.129848', '1.048596'] };
async function run(label, dir, scenario, reduced) {
  const [from, to] = DIRS[dir];
  await page.evaluate(() => window.__amadeusDemo.standby());
  await page.check(`input[name="direction"][value="${dir}"]`);
  await page.check(`input[name="scenario"][value="${scenario}"]`);
  if ((await page.isChecked('#reduced')) !== reduced) await page.click('label.switch');
  const idle = await st();
  const hint = await page.textContent('#dirHint');
  await page.click('#btnStart');
  const first = await st();
  let sawWait = false;
  let lockedBeforeResult = false;
  for (let k = 0; k < 400; k++) {
    const s = await st();
    if (s.waiting) sawWait = true;
    if (s.outcome === null && s.shown === to) lockedBeforeResult = true;
    if (s.phase === 'ended') break;
    await page.waitForTimeout(100);
  }
  const s = await st();
  const status = await page.textContent('#status');
  const result = await page.textContent('#resultText');
  const expect = scenario === 'fail' ? from : to;
  const ok = idle.origin === from && first.origin === from && first.target === to && s.phase === 'ended' && s.shown === expect && !lockedBeforeResult && !s.rafScheduled;
  out.push({ label, dir, from, to, idleOrigin: idle.origin, hint, runOrigin: first.origin, runTarget: first.target, phase: s.phase, outcome: s.outcome, shown: s.shown, expect, ok, sawWait, lockedBeforeResult, raf: s.rafScheduled, status, result });
}
const di = process.argv.indexOf('--dir');
const only = di > 0 ? process.argv[di + 1] : 'both';
for (const dir of only === 'both' ? ['sg2b', 'b2sg'] : [only]) {
  await run(`${dir} success`, dir, 'success', false);
  await run(`${dir} slow`, dir, 'slow', false);
  await run(`${dir} fail`, dir, 'fail', false);
  await run(`${dir} rm-success`, dir, 'success', true);
  await run(`${dir} rm-slow`, dir, 'slow', true);
  await run(`${dir} rm-fail`, dir, 'fail', true);
}
console.log(JSON.stringify({ allOk: out.every((o) => o.ok), out, errors }, null, 1));
await browser.close();
