#!/usr/bin/env node
// Pack dist/ into one self-contained HTML that plays when opened straight from disk (file://).
// Browsers refuse <script type="module"> from file://, so the bundle is inlined as a classic
// script at the end of <body>, and the CSS (with its woff2 fonts as data: URIs) is inlined too.
// Usage: npm run build:single   ->   dist-single/amadeus-worldline.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-single');
const outFile = join(outDir, 'amadeus-worldline.html');

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const scriptRe = /<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>\s*/;
const cssRe = /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">\s*/;
const sm = html.match(scriptRe);
const cm = html.match(cssRe);
if (!sm || !cm) throw new Error('unexpected dist/index.html layout: entry script or stylesheet tag not found');

const js = readFileSync(join(dist, sm[1]), 'utf8');
if (/(^|[;}\s])(import|export)\s*[{*"'\w]/.test(js.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""'))) {
  throw new Error('entry bundle has module syntax; it cannot run as a classic script');
}

const cssDir = dirname(join(dist, cm[1]));
// fonts.css declares some chunks for two weights with the same file; inlining both would
// embed the same font twice, so keep only the first face per (family, file, unicode-range).
// The browser then serves weight 500 from the 400 face, which is what it rendered anyway.
const seenFaces = new Set();
const rawCss = readFileSync(join(dist, cm[1]), 'utf8').replace(/@font-face\s*{[^}]*}/g, (face) => {
  const fam = face.match(/font-family:\s*([^;]+)/)?.[1] ?? '';
  const src = face.match(/url\(\s*['"]?([^'")]+)/)?.[1] ?? '';
  const rng = face.match(/unicode-range:\s*([^;}]+)/)?.[1] ?? '';
  const key = `${fam}|${src}|${rng}`;
  if (seenFaces.has(key)) return '';
  seenFaces.add(key);
  return face;
});
const css = rawCss.replace(/url\(\s*['"]?\.\/([^'")]+\.woff2)['"]?\s*\)/g, (_, f) => {
  const b64 = readFileSync(join(cssDir, f)).toString('base64');
  return `url(data:font/woff2;base64,${b64})`;
});
if (/url\(\s*['"]?\.\//.test(css)) throw new Error('stylesheet still references a relative file');

const license = readFileSync(join(dist, 'fonts', 'OFL.txt'), 'utf8');
const safe = (s, tag) => s.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

html = html.replace(cssRe, '').replace(scriptRe, '');
html = html.replace('</head>', `<style>\n${safe(css, 'style')}\n</style>\n</head>`);
// module scripts are strict and scoped; keep that behaviour for the inlined classic script
html = html.replace(
  '</body>',
  `<script>\n(() => {\n'use strict';\n${safe(js, 'script')}\n})();\n</script>\n` +
    `<script type="text/plain" id="font-license">\n${safe(license, 'script')}\n</script>\n</body>`,
);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(outFile, (Buffer.byteLength(html) / 1024 / 1024).toFixed(2), 'MiB');
