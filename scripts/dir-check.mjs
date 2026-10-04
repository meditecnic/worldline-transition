#!/usr/bin/env node
// Direction selector check (real clicks): normal entry offers only SG -> beta / beta -> SG with the
// project readings; standby shows the chosen direction's source.
// Usage: node scripts/dir-check.mjs [--base http://127.0.0.1:5180/]
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
const errors = [];
const out = {};
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + q, { waitUntil: 'networkidle' });
  return page;
}
const radios = (p) => p.$$eval('input[name="direction"]', (els) => els.map((e) => ({ value: e.value, checked: e.checked, label: e.nextElementSibling?.textContent })));
// normal entry (with the test hook only to read the state)
{
  const p = await open('?test=1&rs=0.25');
  const st = () => p.evaluate(() => window.__amadeusDemo.state());
  out.normal = { radios: await radios(p), hint: await p.textContent('#dirHint'), idleOrigin: (await st()).origin, status: await p.textContent('#status') };
  await p.check('input[name="direction"][value="b2sg"]');
  out.normalB2sg = { hint: await p.textContent('#dirHint'), idleOrigin: (await st()).origin, status: await p.textContent('#status') };
  await p.check('input[name="direction"][value="sg2b"]');
  out.normalBack = { hint: await p.textContent('#dirHint'), idleOrigin: (await st()).origin };
  // seek defaults follow the direction; explicit readings win
  out.seekDefault = await p.evaluate(() => {
    const d = window.__amadeusDemo;
    const a = d.seek(7.7, 'success');
    const b = d.seek(7.7, 'success', { dir: 'b2sg' });
    const c = d.seek(7.7, 'fail', { dir: 'b2sg' });
    return { sg2b: [a.shown, a.target], b2sg: [b.shown, b.target], b2sgFail: c.shown };
  });
  await p.close();
}
// normal entry without the hook: still only two choices
{
  const p = await open('?rs=0.25');
  out.plain = { radios: await radios(p), hook: await p.evaluate(() => typeof window.__amadeusDemo) };
  await p.close();
}
const ok =
  out.normal.radios.length === 2 &&
  out.normal.radios[0].value === 'sg2b' && out.normal.radios[0].checked &&
  out.normal.idleOrigin === '1.048596' && out.normal.hint === '1.048596% → 1.129848%' &&
  out.normalB2sg.idleOrigin === '1.129848' && out.normalB2sg.hint === '1.129848% → 1.048596%' &&
  out.normalBack.idleOrigin === '1.048596' &&
  out.seekDefault.sg2b[0] === '1.129848' && out.seekDefault.b2sg[0] === '1.048596' && out.seekDefault.b2sgFail !== '1.048596' &&
  out.plain.radios.length === 2 && out.plain.hook === 'undefined' &&
  errors.length === 0;
console.log(JSON.stringify({ ok, out, errors }, null, 1));
await browser.close();
