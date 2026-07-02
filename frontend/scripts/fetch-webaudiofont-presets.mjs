#!/usr/bin/env node
/**
 * fetch-webaudiofont-presets — one-time dev-side download of the webaudiofont
 * preset files the piano Producer's gmSynth needs, into
 * `frontend/public/webaudiofont/` so the kiosk serves them itself (OFFLINE at
 * runtime — this script is the only thing that ever touches surikov's CDN).
 *
 * Filenames + preset-variable names are resolved with webaudiofont's own
 * loader catalog (findInstrument/instrumentInfo, findDrum/drumInfo), so they
 * always match what gmSynth.js resolves at runtime. The npm dist is a plain
 * script with no exports; we evaluate it in a Function scope to obtain the
 * WebAudioFontPlayer constructor (same trick gmSynth.js uses).
 *
 * Usage:  node frontend/scripts/fetch-webaudiofont-presets.mjs [--force]
 * Idempotent: existing files are skipped unless --force.
 */
import { readFileSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const outDir = join(frontendRoot, 'public', 'webaudiofont');
const force = process.argv.includes('--force');

// Starter set (GM program numbers): acoustic grand, e-piano 1, nylon guitar,
// steel guitar, acoustic bass, fingered bass, string ensemble, synth pad 1.
const PROGRAMS = [0, 4, 24, 25, 32, 33, 48, 88];
// GM percussion pitches (one webaudiofont file per drum piece): kick, snare,
// closed hat, low tom, open hat, mid tom, crash, high tom, ride.
// Keep in sync with DRUM_NOTES in
// frontend/src/modules/Piano/PianoKiosk/producer/gmSynth.js.
const DRUM_PITCHES = [36, 38, 42, 45, 46, 47, 49, 50, 51];

// ── obtain the loader catalog from the npm dist (no exports → Function eval) ──
const distPath = join(frontendRoot, 'node_modules', 'webaudiofont', 'npm', 'dist', 'WebAudioFontPlayer.js');
const source = readFileSync(distPath, 'utf8');
// eslint-disable-next-line no-new-func
const WebAudioFontPlayer = new Function(`${source}\n;return WebAudioFontPlayer;`)();
const loader = new WebAudioFontPlayer().loader;

const targets = [
  ...PROGRAMS.map((program) => {
    const info = loader.instrumentInfo(loader.findInstrument(program));
    return { label: `program ${program} (${info.title})`, url: info.url, variable: info.variable };
  }),
  ...DRUM_PITCHES.map((pitch) => {
    const info = loader.drumInfo(loader.findDrum(pitch));
    return { label: `drum ${pitch} (${info.title})`, url: info.url, variable: info.variable };
  }),
];

mkdirSync(outDir, { recursive: true });

let totalBytes = 0;
let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const t of targets) {
  const file = basename(new URL(t.url).pathname);
  const dest = join(outDir, file);
  if (!force && existsSync(dest)) {
    const size = statSync(dest).size;
    totalBytes += size;
    skipped += 1;
    console.log(`skip  ${file}  (${(size / 1024).toFixed(0)} KB)  ${t.label}`);
    continue;
  }
  try {
    const resp = await fetch(t.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    // Sanity: the file must define the variable gmSynth will extract.
    if (!text.includes(t.variable)) throw new Error(`payload does not define ${t.variable}`);
    writeFileSync(dest, text);
    const size = Buffer.byteLength(text);
    totalBytes += size;
    downloaded += 1;
    console.log(`fetch ${file}  (${(size / 1024).toFixed(0)} KB)  ${t.label}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${file}  ${t.label}: ${err.message}`);
  }
}

console.log(`\n${downloaded} downloaded, ${skipped} skipped, ${failed} failed — total ${(totalBytes / 1024 / 1024).toFixed(1)} MB in ${outDir}`);
if (failed > 0) process.exit(1);
