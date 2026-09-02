import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART_NAMES, familyArt, voiceArt } from './voiceArt.js';
import { FAMILIES } from './voiceFamilies.js';
import { ALL_VOICES } from './devices/suzukiMdg400.js';

// The licensed illustration pack lives in the household media tree, not the
// repo. On a machine without it the existence check is skipped with a note;
// the mapping tests below still run everywhere.
const BASE = process.env.DAYLIGHT_BASE_PATH || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation';
const ART_DIR = `${BASE}/media/img/music/instruments`;

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

  it('keeps whole-word bass and bass+lead apart from Contrabass and Bassoon', () => {
    expect(voiceArt('Contrabass')).toBe('violin-3');
    expect(voiceArt('Bassoon')).toBe('clarinet');
    expect(voiceArt('Bass + Lead')).toBe('keyboard-1');
  });

  it('returns null for voices the pack cannot picture, so the icon is used', () => {
    expect(voiceArt('Choir Aahs')).toBeNull();
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

  const packPresent = existsSync(ART_DIR);
  it(`every basename the module can return exists as an SVG in the illustration pack${packPresent ? '' : ` (SKIPPED: pack not found at ${ART_DIR})`}`, () => {
    if (!packPresent) return;
    const files = new Set(readdirSync(ART_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));
    const stale = [...ART_NAMES].filter((name) => !files.has(name));
    expect(stale).toEqual([]);
    for (const voice of ALL_VOICES) {
      const art = voiceArt(voice.name);
      if (art !== null) expect(files.has(art), `${voice.name} -> ${art}`).toBe(true);
    }
  });
});
