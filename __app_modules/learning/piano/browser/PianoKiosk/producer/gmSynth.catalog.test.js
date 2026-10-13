import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { GM_PROGRAMS, DRUM_NOTES } from './presetManifest.js';

/**
 * Preset/catalog drift guard — no mocks, no media mount needed. Walks the
 * manifest lists through the REAL installed webaudiofont catalog (the exact
 * resolution path both gmSynth.js and frontend/scripts/fetch-webaudiofont-
 * presets.mjs use) and asserts every resolved preset file is declared in
 * assets.manifest.yml, with no orphan webaudiofont entries. Fails when someone
 * edits the preset lists without updating the asset manifest, or when a
 * webaudiofont upgrade changes which variant its catalog picks for a program.
 * That the files are actually INSTALLED is tests/live/adapter/
 * webaudiofont-installed.test.mjs (it needs the real media volume).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

// The npm dist has no module exports — extract the constructor Function-scope
// style, same as gmSynth.js / the fetch script.
const require = createRequire(import.meta.url);
const distPath = require.resolve('webaudiofont'); // package main = npm/dist/WebAudioFontPlayer.js
const source = readFileSync(distPath, 'utf8');
const WebAudioFontPlayer = new Function(`${source}\n;return WebAudioFontPlayer;`)();
const loader = new WebAudioFontPlayer().loader;

const fileFor = (url) => basename(new URL(url).pathname);

const manifest = yaml.load(readFileSync(join(repoRoot, 'assets.manifest.yml'), 'utf8'));
const declared = new Set(
  (manifest.assets || manifest.entries || manifest)
    .map((e) => e.target)
    .filter((t) => typeof t === 'string' && t.startsWith('webaudiofont/'))
    .map((t) => basename(t)),
);
const MSG = (file) => `${file} is not declared in assets.manifest.yml (add it, then npm run install:assets)`;

describe('gmSynth preset catalog drift guard', () => {
  it('the asset manifest declares webaudiofont presets', () => {
    expect(declared.size).toBeGreaterThan(0);
  });

  it.each(GM_PROGRAMS)('program %i resolves to a preset declared in assets.manifest.yml', (program) => {
    const file = fileFor(loader.instrumentInfo(loader.findInstrument(program)).url);
    expect(declared.has(file), MSG(file)).toBe(true);
  });

  it.each(DRUM_NOTES)('drum pitch %i resolves to a preset declared in assets.manifest.yml', (pitch) => {
    const file = fileFor(loader.drumInfo(loader.findDrum(pitch)).url);
    expect(declared.has(file), MSG(file)).toBe(true);
  });

  it('declares no orphan presets the manifest lists no longer reference', () => {
    const expected = new Set([
      ...GM_PROGRAMS.map((p) => fileFor(loader.instrumentInfo(loader.findInstrument(p)).url)),
      ...DRUM_NOTES.map((n) => fileFor(loader.drumInfo(loader.findDrum(n)).url)),
    ]);
    expect([...declared].filter((f) => !expected.has(f))).toEqual([]);
  });
});
