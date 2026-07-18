// icons.test.jsx — the Composer's icon language, pinned.
//
// The rule these tests enforce is a DEVICE constraint, not a taste preference:
// the kiosk tablet's WebView has no font covering the Unicode music block or the
// symbol glyphs this toolbar reached for (U+1D15x noteheads, U+266x notes,
// U+21B6/B7 undo-redo, U+2630, U+24D8, U+FF0B, U+232B), so every one of them
// painted as a TOFU BOX on the only screen this mode ever runs on. Hand-drawn
// inline SVG is the only representation that is reliably there.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as icons from './icons.jsx';

const NAMES = [
  'IconUndo', 'IconRedo', 'IconBackspace', 'IconPlay', 'IconPause',
  'IconSongs', 'IconInfo', 'IconPlus', 'IconDot', 'IconQuarterRest', 'IconClose',
];

// Anything in this class renders as tofu on the kiosk. Kept as escapes so this
// file can assert the rule without itself tripping the source scan below.
const TOFU = /[♩-♬\u{1D13D}\u{1D13E}↶↷☰ⓘ＋⌫\u{2715}\u{1F3B9}]/u;

describe('Composer icon set', () => {
  it('exports every icon the toolbar needs', () => {
    for (const n of NAMES) expect(typeof icons[n], `${n} should be exported`).toBe('function');
  });

  it.each(NAMES)('%s draws an SVG on the house 24-unit grid', (name) => {
    const { container } = render(icons[name]({}));
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // One grid for the whole set, so icons stay optically consistent when they
    // sit shoulder to shoulder in the toolbar at different rendered sizes.
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it.each(NAMES)('%s is decorative — the BUTTON supplies the accessible name', (name) => {
    const { container } = render(icons[name]({}));
    expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    // An icon that announced itself would double up with the aria-label its
    // button already carries ("Undo undo"), so it must stay out of the tree.
    expect(container.querySelector('svg').getAttribute('aria-label')).toBeNull();
  });

  it.each(NAMES)('%s inherits colour rather than hard-coding it', (name) => {
    const { container } = render(icons[name]({}));
    const html = container.innerHTML;
    expect(html).toMatch(/currentColor/);
    // A literal colour would survive the accent-fill / disabled / danger states
    // unchanged and go invisible on one of them.
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it.each(NAMES)('%s renders no Unicode glyph of its own', (name) => {
    const { container } = render(icons[name]({}));
    expect(container.textContent).not.toMatch(TOFU);
  });

  it.each(NAMES)('%s takes a size so one drawing serves every call site', (name) => {
    const { container } = render(icons[name]({ size: 40 }));
    expect(container.querySelector('svg').getAttribute('width')).toBe('40');
    expect(container.querySelector('svg').getAttribute('height')).toBe('40');
  });
});

// The point of the icon set is that NOTHING in the mode still reaches for a
// Unicode glyph. A component test can only speak for the component it renders,
// so this scans the mode's own source — the guard that actually holds the line
// when someone adds a control later.
describe('Composer source carries no tofu glyphs', () => {
  const dir = new URL('.', import.meta.url).pathname;
  const sources = readdirSync(dir).filter((f) => /\.(jsx?|scss)$/.test(f) && !/\.test\./.test(f));

  it('finds source files to scan (guards against a silently empty sweep)', () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  // Comments are exempt: naming the offending characters is how the files
  // explain WHY they draw instead of typeset, and that explanation is the thing
  // stopping the next person reintroducing them. Only glyphs that can reach the
  // DOM are a defect. (Crude stripper — it would also blank a glyph sitting
  // after a `//` inside a string literal, which no call site here does.)
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it.each(sources)('%s uses SVG, not Unicode symbols', (file) => {
    const code = stripComments(readFileSync(join(dir, file), 'utf8'));
    const hit = code.match(TOFU);
    expect(hit, hit ? `${file} renders "${hit[0]}" — draw it in icons.jsx instead` : '').toBeNull();
  });

  it('actually inspects code, not a file blanked by the comment stripper', () => {
    // Guard on the guard: if stripComments ever over-matched, every file above
    // would pass vacuously and the rule would silently stop being enforced.
    const code = stripComments(readFileSync(join(dir, 'DurationPalette.jsx'), 'utf8'));
    expect(code).toMatch(/NoteGlyph/);
    expect(code).toMatch(/IconBackspace/);
  });
});
