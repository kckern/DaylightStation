/**
 * webaudiofont presets are installed on the media volume.
 *
 * Needs the REAL media mount (assets are served from <media>/vendor/webaudiofont
 * by the /vendor route), so it lives in the live tier, not the unit gate.
 * Fails — never skips — when anything is missing, naming the fix.
 *
 * Usage: DAYLIGHT_MEDIA_PATH=<media> NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/_infrastructure/config/jest.config.cjs tests/live/adapter/webaudiofont-installed.test.mjs
 */
import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEsm, repoUrl } from './nativeEsm.mjs';

const media = process.env.DAYLIGHT_MEDIA_PATH
  || (process.env.DAYLIGHT_BASE_PATH ? join(process.env.DAYLIGHT_BASE_PATH, 'media') : null);
const dir = media && join(media, 'vendor', 'webaudiofont');

// presetManifest.js is browser ESM (.js) and webaudiofont is a browser global script, so the
// preset list is resolved in native Node (see nativeEsm.mjs) and handed back as JSON.
const targets = JSON.parse(runEsm(`
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { GM_PROGRAMS, DRUM_NOTES } from '${repoUrl('__app_modules/learning/piano/browser/PianoKiosk/producer/presetManifest.js')}';
const require = createRequire(${JSON.stringify(repoUrl('frontend/package.json'))});
const WebAudioFontPlayer = new Function(readFileSync(require.resolve('webaudiofont'), 'utf8') + '\\n;return WebAudioFontPlayer;')();
const loader = new WebAudioFontPlayer().loader;
const file = (info) => ({ file: basename(new URL(info.url).pathname), variable: info.variable });
console.log(JSON.stringify([
  ...GM_PROGRAMS.map((p) => ({ label: 'program ' + p, ...file(loader.instrumentInfo(loader.findInstrument(p))) })),
  ...DRUM_NOTES.map((n) => ({ label: 'drum ' + n, ...file(loader.drumInfo(loader.findDrum(n))) })),
]));`).trim().split('\n').pop());
const fix = 'run `npm run install:assets` (set DAYLIGHT_MEDIA_PATH)';

describe('webaudiofont presets installed under media/vendor', () => {
  it('the vendor/webaudiofont dir exists', () => {
    if (!dir) throw new Error(`DAYLIGHT_MEDIA_PATH is not set — ${fix}`);
    if (!existsSync(dir)) throw new Error(`${dir} is absent — ${fix}`);
  });

  it.each(targets.map((t) => [t.label, t]))('%s preset file present and defines its variable', (_l, t) => {
    if (!dir) throw new Error(`DAYLIGHT_MEDIA_PATH is not set — ${fix}`);
    const full = join(dir, t.file);
    if (!existsSync(full)) throw new Error(`missing ${t.file} — ${fix}`);
    expect(readFileSync(full, 'utf8')).toContain(t.variable);
  });
});
