/**
 * webaudiofont presets are installed on the media volume.
 *
 * Needs the REAL media mount (assets are served from <media>/vendor/webaudiofont
 * by the /vendor route), so it lives in the live tier, not the unit gate.
 * Fails — never skips — when anything is missing, naming the fix.
 *
 * Usage: DAYLIGHT_MEDIA_PATH=<media> npx vitest run --config tests/_infrastructure/config/vitest.config.mjs tests/live/adapter/webaudiofont-installed.test.mjs
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import { GM_PROGRAMS, DRUM_NOTES } from '../../../__app_modules/learning/piano/browser/PianoKiosk/producer/presetManifest.js';

const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const WebAudioFontPlayer = new Function(`${readFileSync(require.resolve('webaudiofont'), 'utf8')}\n;return WebAudioFontPlayer;`)();
const loader = new WebAudioFontPlayer().loader;

function mediaDir() {
  if (process.env.DAYLIGHT_MEDIA_PATH) return process.env.DAYLIGHT_MEDIA_PATH;
  if (process.env.DAYLIGHT_BASE_PATH) return join(process.env.DAYLIGHT_BASE_PATH, 'media');
  return null;
}
const dir = mediaDir() && join(mediaDir(), 'vendor', 'webaudiofont');
const fix = 'run `npm run install:assets` (set DAYLIGHT_MEDIA_PATH)';

const targets = [
  ...GM_PROGRAMS.map((p) => ({ label: `program ${p}`, info: loader.instrumentInfo(loader.findInstrument(p)) })),
  ...DRUM_NOTES.map((n) => ({ label: `drum ${n}`, info: loader.drumInfo(loader.findDrum(n)) })),
];

describe('webaudiofont presets installed under media/vendor', () => {
  it('the vendor/webaudiofont dir exists', () => {
    expect(dir, `DAYLIGHT_MEDIA_PATH is not set — ${fix}`).toBeTruthy();
    expect(existsSync(dir), `${dir} is absent — ${fix}`).toBe(true);
  });

  it.each(targets.map((t) => [t.label, t]))('%s preset file present and defines its variable', (_l, t) => {
    expect(dir, `DAYLIGHT_MEDIA_PATH is not set — ${fix}`).toBeTruthy();
    const file = basename(new URL(t.info.url).pathname);
    const full = join(dir, file);
    expect(existsSync(full), `missing ${file} — ${fix}`).toBe(true);
    expect(readFileSync(full, 'utf8')).toContain(t.info.variable);
  });
});
