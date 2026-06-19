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

// Only the PNG decoder (pngle + miniz). Grayscale dither + 4bpp packing are done
// in main.cpp (memory-light); Seeed's RGB888 dither_image doesn't fit in PSRAM.
// The E1003 panel wiring (Setup522) is inlined as -D flags in platformio.ini.
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
