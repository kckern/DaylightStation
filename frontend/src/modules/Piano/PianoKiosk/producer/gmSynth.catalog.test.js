import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GM_PROGRAMS, DRUM_NOTES } from './presetManifest.js';

/**
 * Preset/catalog drift guard — no mocks. Walks the manifest lists through the
 * REAL installed webaudiofont catalog (the exact resolution path both
 * gmSynth.js and frontend/scripts/fetch-webaudiofont-presets.mjs use) and
 * asserts every resolved preset file actually exists in
 * frontend/public/webaudiofont/. Fails when someone edits the manifest without
 * re-running the fetch script, or when a webaudiofont upgrade changes which
 * variant its catalog picks for a program.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '..', '..', '..', '..', 'public', 'webaudiofont');

// The npm dist has no module exports — extract the constructor Function-scope
// style, same as gmSynth.js / the fetch script.
const require = createRequire(import.meta.url);
const distPath = require.resolve('webaudiofont'); // package main = npm/dist/WebAudioFontPlayer.js
const source = readFileSync(distPath, 'utf8');
// eslint-disable-next-line no-new-func
const WebAudioFontPlayer = new Function(`${source}\n;return WebAudioFontPlayer;`)();
const loader = new WebAudioFontPlayer().loader;

const fileFor = (url) => basename(new URL(url).pathname);

describe('gmSynth preset catalog drift guard', () => {
  it('the self-hosted preset folder exists (run frontend/scripts/fetch-webaudiofont-presets.mjs if not)', () => {
    expect(existsSync(publicDir)).toBe(true);
  });

  it.each(GM_PROGRAMS)('program %i resolves to a preset file present in public/webaudiofont', (program) => {
    const info = loader.instrumentInfo(loader.findInstrument(program));
    const file = fileFor(info.url);
    expect(existsSync(join(publicDir, file)), `missing ${file} — run fetch-webaudiofont-presets.mjs`).toBe(true);
    // The file must define the variable gmSynth extracts at runtime.
    const text = readFileSync(join(publicDir, file), 'utf8');
    expect(text).toContain(info.variable);
  });

  it.each(DRUM_NOTES)('drum pitch %i resolves to a preset file present in public/webaudiofont', (pitch) => {
    const info = loader.drumInfo(loader.findDrum(pitch));
    const file = fileFor(info.url);
    expect(existsSync(join(publicDir, file)), `missing ${file} — run fetch-webaudiofont-presets.mjs`).toBe(true);
    const text = readFileSync(join(publicDir, file), 'utf8');
    expect(text).toContain(info.variable);
  });

  it('has no orphan files the manifest no longer references', () => {
    const expected = new Set([
      ...GM_PROGRAMS.map((p) => fileFor(loader.instrumentInfo(loader.findInstrument(p)).url)),
      ...DRUM_NOTES.map((n) => fileFor(loader.drumInfo(loader.findDrum(n)).url)),
    ]);
    const onDisk = readdirSync(publicDir).filter((f) => f.endsWith('.js'));
    const orphans = onDisk.filter((f) => !expected.has(f));
    expect(orphans).toEqual([]);
  });
});
