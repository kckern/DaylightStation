import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_NAMES, familyArt, voiceArt } from './voiceArt.js';
import { FAMILIES } from './voiceFamilies.js';
import { ALL_VOICES } from './devices/suzukiMdg400.js';

// The licensed illustration pack lives in the household media tree, not the
// repo. The base path comes from the environment, else a .env at the repo
// root (the same two sources tests/_lib/configHelper.mjs reads) — or, for a
// worktree under .worktrees/, the checkout's .env a couple of levels up. With
// neither, the existence check is skipped visibly rather than passing on nothing.
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
function resolveBasePath() {
  if (process.env.DAYLIGHT_BASE_PATH) return process.env.DAYLIGHT_BASE_PATH;
  let dir = REPO_ROOT;
  for (let hop = 0; hop < 3; hop += 1) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) {
      const match = readFileSync(envPath, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.+)$/m);
      return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
    }
    dir = path.dirname(dir);
  }
  return null;
}
const BASE = resolveBasePath();
const ART_DIR = BASE ? path.join(BASE, 'media/img/music/instruments') : null;

describe('voiceArt', () => {
  it('maps common voices to an illustration basename', () => {
    expect(voiceArt('Acoustic Grand')).toBe('upright-piano');
    expect(voiceArt('Electric Piano 1')).toBe('keyboard-1');
    expect(voiceArt('Accordion')).toBe('accordion-1');
    expect(voiceArt('Nylon Guitar')).toBe('acoustic-guitar-1');
    expect(voiceArt('Distortion Guitar')).toBe('electric-guitar-2');
    expect(voiceArt('Finger Bass')).toBe('bass-guitar');
    expect(voiceArt('Violin')).toBe('violin-1');
    expect(voiceArt('Orchestral Harp')).toBe('harp-1');
    expect(voiceArt('Trumpet')).toBe('trumpet-1');
    expect(voiceArt('Tenor Sax')).toBe('saxophone-3');
    expect(voiceArt('Pan Flute')).toBe('pan-flute-1');
    expect(voiceArt('Sawtooth Lead')).toBe('keyboard-1');
    expect(voiceArt('Erhu')).toBe('rebab');
    expect(voiceArt('Pipa')).toBe('oud');
    expect(voiceArt('Woodblock')).toBe('wood-block');
    expect(voiceArt('Ukulele')).toBe('ukulele');
  });

  it('keeps the specific drum pictures ahead of the kit catch-all', () => {
    expect(voiceArt('Taiko Drum')).toBe('tabor-drum');
    expect(voiceArt('Melodic Tom')).toBe('tom-drum');
    expect(voiceArt('Snare Drum')).toBe('snare-drum-1');
    expect(voiceArt('Synth Drum')).toBe('drum-kit');
    expect(voiceArt('Standard Kit')).toBe('drum-kit');
    expect(voiceArt('Steel Drums')).toBeNull();
  });

  it('keeps whole-word bass and bass+lead apart from Contrabass and Bassoon', () => {
    expect(voiceArt('Contrabass')).toBe('violin-3');
    expect(voiceArt('Bassoon')).toBe('clarinet');
    expect(voiceArt('Bass + Lead')).toBe('keyboard-1');
  });

  it('returns null for voices the pack cannot picture, so the icon is used', () => {
    expect(voiceArt('Choir Aahs')).toBeNull();
    expect(voiceArt('French Horn')).toBeNull(); // the pack has no coiled horn; the flugelhorn is a different shape
    expect(voiceArt('Helicopter')).toBeNull();
    expect(voiceArt('')).toBeNull();
    expect(voiceArt(null)).toBeNull();
  });

  it('gives every family one representative illustration except Voices', () => {
    expect(familyArt('pianos')).toBe('upright-piano');
    expect(familyArt('keys')).toBe('accordion-1');
    expect(familyArt('guitars')).toBe('acoustic-guitar-1');
    expect(familyArt('strings')).toBe('violin-1');
    expect(familyArt('voices')).toBeNull();
    expect(familyArt('winds')).toBe('trumpet-1');
    expect(familyArt('synths')).toBe('keyboard-1');
    expect(familyArt('world')).toBe('oud');
    expect(familyArt('fun')).toBe('drum-kit');
    expect(familyArt('mine')).toBeNull();
    for (const family of FAMILIES) expect(familyArt(family.id) === null || ART_NAMES.has(familyArt(family.id))).toBe(true);
  });

  // The coverage figure goes in the test title so the report carries it
  // without a console line (this suite runs with console output swallowed).
  const missing = ALL_VOICES.filter((voice) => voiceArt(voice.name) === null).map((voice) => voice.name);
  const covered = ALL_VOICES.length - missing.length;
  const pct = Math.round((covered / ALL_VOICES.length) * 1000) / 10;
  it(`covers ${covered}/${ALL_VOICES.length} device voices with art (${pct}%, floor 80%); icon-only: ${missing.join(', ')}`, () => {
    expect(covered / ALL_VOICES.length).toBeGreaterThanOrEqual(0.8);
  });

  it('every basename the module can return exists as an SVG in the illustration pack', (ctx) => {
    if (!ART_DIR || !existsSync(ART_DIR)) ctx.skip(`illustration pack not found (${ART_DIR || 'no DAYLIGHT_BASE_PATH in env or .env'})`);
    const files = new Set(readdirSync(ART_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));
    const stale = [...ART_NAMES].filter((name) => !files.has(name));
    expect(stale).toEqual([]);
    for (const voice of ALL_VOICES) {
      const art = voiceArt(voice.name);
      if (art !== null) expect(files.has(art), `${voice.name} -> ${art}`).toBe(true);
    }
  });
});
