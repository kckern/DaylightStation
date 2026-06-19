#!/usr/bin/env node
// =============================================================================
// fetch-deps.mjs — vendor Seeed's tested E1003 decode+dither pipeline into
// lib/seeed/ (gitignored). These are example files from Seeed_GFX (not in the
// library's src/), so we fetch them on demand rather than committing third-party
// code to this public repo.
//
//   node tools/fetch-deps.mjs
// =============================================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(__dirname, '..', 'lib', 'seeed');
mkdirSync(DEST, { recursive: true });

const RAW = 'https://raw.githubusercontent.com/Seeed-Studio/Seeed_GFX/master';
const EX = `${RAW}/examples/ePaper/reTerminal_SDcard_Bitmap/reTerminal_E1003_SDcard_Gray16`;

// Just the PNG decoder (pngle + miniz). BOTH render profiles dither in main.cpp
// with their own memory-light Floyd-Steinberg (grey16 and 6-colour) — Seeed's
// dither_image needs multi-MB whole-image buffers that don't fit on these panels.
const files =
  ['pngle.h', 'pngle.c', 'miniz.h', 'miniz.c'].map(f => [`${EX}/${f}`, f]);

console.log(`Fetching E1003 render pipeline -> ${DEST}`);
let ok = 0;
for (const [url, name] of files) {
  const res = await fetch(url);
  if (!res.ok) { console.error(`  FAIL ${name}: HTTP ${res.status}`); process.exitCode = 1; continue; }
  writeFileSync(path.join(DEST, name), Buffer.from(await res.arrayBuffer()));
  console.log(`  ${name}`);
  ok++;
}
console.log(`Done. (${ok}/${files.length} files)`);
