// frontend/src/modules/Piano/PianoKiosk/transport/noUnicodeGlyphs.test.js
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

/**
 * House rule (audit F2): pictorial button content is inline SVG, NEVER a
 * Unicode symbol glyph — the tablet WebView renders many of them as tofu.
 * This test scans PianoKiosk JSX (plus the shared Piano/ui set the kiosk
 * renders its button faces from) for the banned glyphs. Files fixed by the
 * wave-1 migration must STAY clean; surfaces awaiting later waves are grand-
 * fathered below and the list must only ever SHRINK.
 */
const BANNED = /[▶◀◼■●▲▼▸◂▾★☆⟲✕♪−]/u; // U+2212 minus sign included; ASCII '-' is fine
// Musical spellings (♯ ♭ ♩ …) are allowed — they are notation, not chrome.
const GRANDFATHERED = new Set([
  'producer/TransportBar.jsx',
  'producer/CaptureCard.jsx',
  'producer/GainStrip.jsx',
  'producer/SongPicker.jsx',
  'producer/VoicePicker.jsx',
  'producer/LibraryBrowser.jsx',
  'producer/AddLayerSheet.jsx',
  'producer/SongView.jsx',
  'producer/TempoSheet.jsx',
  'modes/Producer/Producer.jsx', // Producer mode shell; wraps producer/ (later wave) and
  // clones producer/SongPicker.jsx's dismiss-resume chip verbatim (✕) — same unmigrated feature.
  'modes/Studio/StudioRecordings.jsx',
  'modes/Videos/PianoContextRail.jsx',
  'modes/Videos/RepertoireBrowser.jsx',
]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The icon set lives outside the kiosk (modules/Piano/ui/icons) but supplies the
// kiosk's button faces, so it stays inside this guard.
const SHARED_UI = join(ROOT, '..', 'ui');
const jsxFiles = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.jsx') && !name.includes('.test.')) jsxFiles.push(p);
  }
}
walk(ROOT);
walk(SHARED_UI);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no Unicode glyphs as kiosk button faces', () => {
  it('scans a sane number of files', () => {
    expect(jsxFiles.length).toBeGreaterThan(50);
  });

  it.each(jsxFiles.map((f) => [relative(ROOT, f), f]))('%s is glyph-clean', (rel, abs) => {
    if (GRANDFATHERED.has(rel)) return; // later-wave surface; tracked in the audit
    expect(stripComments(readFileSync(abs, 'utf8'))).not.toMatch(BANNED);
  });

  it('grandfathered files still exist (remove entries as waves land)', () => {
    for (const rel of GRANDFATHERED) statSync(join(ROOT, rel)); // throws if stale
  });
});
