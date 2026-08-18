// frontend/src/modules/Piano/noUnicodeGlyphs.test.js
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

/**
 * House rule (audit F2): pictorial button content is inline SVG, NEVER a
 * Unicode symbol glyph — the tablet WebView renders many of them as tofu.
 * Files fixed by the wave-1 migration must STAY clean; surfaces awaiting later
 * waves are grandfathered below and the list must only ever SHRINK.
 *
 * The guard covers every Piano tree that puts a face on a button, not just the
 * kiosk: `ui/` holds the shared icon set, and `game-platform/` holds the chrome
 * every game renders. It lives at the Piano root (rather than inside one of
 * them) so no tree polices its own siblings and every grandfathered key reads
 * as a plain path from here.
 */
const BANNED = /[▶◀◼■●▲▼▸◂▾★☆⟲✕♪−]/u; // U+2212 minus sign included; ASCII '-' is fine
// Musical spellings (♯ ♭ ♩ …) are allowed — they are notation, not chrome.

// Keys are `relative(ROOT, file)` — i.e. paths from modules/Piano, so they all
// begin with the tree they live in.
const GRANDFATHERED = new Set([
  'PianoKiosk/producer/TransportBar.jsx',
  'PianoKiosk/producer/CaptureCard.jsx',
  'PianoKiosk/producer/GainStrip.jsx',
  'PianoKiosk/producer/SongPicker.jsx',
  'PianoKiosk/producer/VoicePicker.jsx',
  'PianoKiosk/producer/LibraryBrowser.jsx',
  'PianoKiosk/producer/AddLayerSheet.jsx',
  'PianoKiosk/producer/SongView.jsx',
  'PianoKiosk/producer/TempoSheet.jsx',
  'PianoKiosk/modes/Producer/Producer.jsx', // Producer mode shell; wraps producer/ (later wave) and
  // clones producer/SongPicker.jsx's dismiss-resume chip verbatim (✕) — same unmigrated feature.
  'PianoKiosk/modes/Studio/StudioRecordings.jsx',
  'PianoKiosk/modes/Videos/PianoContextRail.jsx',
  'PianoKiosk/modes/Videos/RepertoireBrowser.jsx',
  // Pre-existing, surfaced (not introduced) when game-platform came under this
  // guard: the stepper's down-button face is a bare U+2212 against an ASCII '+'
  // on the up-button. `ui/icons/svg/{minus,plus}.svg` both exist, so the real
  // fix is a matched Icon pair — deliberately not folded into the icon-hoist
  // commit, which contracted for no behaviour change on a shared game control.
  'game-platform/chrome/GameStepper.jsx',
]);

const ROOT = dirname(fileURLToPath(import.meta.url));
// Every Piano tree that renders a button face. Adding a tree here is how new
// surfaces come under the rule — a tree that is absent is simply ungoverned.
const GOVERNED_TREES = ['PianoKiosk', 'ui', 'game-platform'];

const jsxFiles = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.jsx') && !name.includes('.test.')) jsxFiles.push(p);
  }
}
for (const tree of GOVERNED_TREES) {
  // Throws if a tree is renamed out from under the guard. Failing collection
  // with the path in the message beats silently governing one tree less —
  // a directory walk that finds nothing looks exactly like a clean pass.
  walk(join(ROOT, tree));
}
// Filesystem order varies by platform; sort so the case list is diffable.
jsxFiles.sort();

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no Unicode glyphs as button faces', () => {
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
