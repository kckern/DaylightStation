import { describe, it, expect } from 'vitest';
import { generateCoverSvg, hueFor, visualWidth, wrapTitle } from './GeneratedCover.mjs';

const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/**
 * Throws unless the markup is well-formed XML. This is the assertion that
 * matters: a malformed SVG is not a degraded cover, it is a BLANK tile,
 * because the browser refuses the whole document.
 *
 * Hand-rolled, and deliberately. `new DOMParser().parseFromString(svg,
 * 'image/svg+xml')` under jsdom accepts `<text>Charlotte&</text>` without a
 * `parsererror` — measured 2026-09-09 — so the obvious version of this helper
 * passes on exactly the bug it was written to catch. The two rules below are
 * the ones this generator can actually break: a bare ampersand (escaping ran
 * before wrapping, splitting an entity across two tspans) and unbalanced tags.
 */
function parse(svg) {
  const bare = ENTITY.exec(svg);
  if (bare) throw new Error(`bare ampersand at ${bare.index}: ${svg.slice(bare.index, bare.index + 24)}`);
  // `[^<>]` not `[^>]`: the looser version swallows `< b</text>` whole as if it
  // were one tag, and then finds nothing left to complain about.
  const stray = svg.replace(/<[^<>]*>/g, '');
  if (/[<>]/.test(stray)) throw new Error(`unescaped angle bracket in text: ${stray.slice(0, 60)}`);
  for (const tag of ['svg', 'text', 'tspan', 'defs', 'linearGradient']) {
    const open = (svg.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
    const close = (svg.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    if (open !== close) throw new Error(`${tag}: ${open} open, ${close} closed`);
  }
  return svg;
}

describe('the well-formedness guard itself', () => {
  it('rejects the split entity that shipped first', () => {
    expect(() => parse('<svg><text>Charlotte&</text><text>apos;s Web</text></svg>')).toThrow(/bare ampersand/);
  });
  it('rejects unescaped markup in a text node', () => {
    expect(() => parse('<svg><text>a < b</text></svg>')).toThrow();
  });
  it('accepts a good document', () => {
    expect(() => parse('<svg><text>ok &amp; fine</text></svg>')).not.toThrow();
  });
});

const textOf = (svg) => svg.replace(/<[^>]*>/g, '');

describe('generateCoverSvg', () => {
  it('draws a well-formed cover carrying the title and the author', () => {
    const svg = generateCoverSvg({ isbn13: '9780064400558', title: 'Pie', authors: ['Sarah Weeks'] });
    expect(() => parse(svg)).not.toThrow();
    expect(textOf(svg)).toContain('Pie');
    expect(textOf(svg)).toContain('Sarah Weeks');
  });

  // The bug that shipped first: escaping BEFORE wrapping split `&apos;` across
  // two tspans, and the browser refused the whole document.
  it("survives a title with an apostrophe, which is where the naive version broke", () => {
    const svg = generateCoverSvg({ isbn13: '9780064400558', title: "Charlotte's Web", authors: ['E. B. White'] });
    expect(() => parse(svg)).not.toThrow();
    expect(svg).not.toMatch(/&<\/tspan>/);
    expect(svg).toContain('&apos;');
  });

  it('escapes markup rather than emitting it', () => {
    const svg = generateCoverSvg({ isbn13: '9780064400558', title: '<script>x</script> & co' });
    expect(() => parse(svg)).not.toThrow();
    expect(svg).not.toContain('<script>');
  });

  it('is the same colour for the same book, every time', () => {
    const once = generateCoverSvg({ isbn13: '9780064400558', title: 'Pie' });
    expect(generateCoverSvg({ isbn13: '9780064400558', title: 'Pie' })).toBe(once);
  });

  it('gives two books in a series different colours, though they differ by one digit', () => {
    expect(hueFor('9780064400558')).not.toBe(hueFor('9780064400559'));
  });

  it('still draws a book when nothing but the number is known', () => {
    const svg = generateCoverSvg({ isbn13: '9780064400558' });
    expect(() => parse(svg)).not.toThrow();
    expect(textOf(svg)).toContain('9780064400558');
  });

  it('clips an unbounded author to the board instead of running off both edges', () => {
    const svg = generateCoverSvg({ isbn13: '9780064400558', title: 'X', authors: ['Someone With A Very Long Name Indeed And More'] });
    expect(textOf(svg)).toContain('…');
    expect(() => parse(svg)).not.toThrow();
  });
});

describe('wrapTitle', () => {
  const opts = { fontSize: 42, maxWidth: 250 };

  it('breaks on words', () => {
    expect(wrapTitle('Early American History', opts).join('|')).not.toContain('Ameri|');
  });

  it('ends a truncated title with an ellipsis, never mid-sentence', () => {
    const lines = wrapTitle('A Really Extraordinarily Long Title That Goes On And On Well Past Any Board', opts);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toMatch(/…$/);
  });

  it('does not add an ellipsis to a title that fitted', () => {
    expect(wrapTitle('Pie', opts).join('')).toBe('Pie');
  });

  it('cuts a single word too long for any line', () => {
    const lines = wrapTitle('Supercalifragilisticexpialidociousandthensome', { fontSize: 42, maxWidth: 150 });
    expect(lines.length).toBeGreaterThan(1);
  });

  it('counts Hangul as full-width, which is what kept a Korean title on the board', () => {
    expect(visualWidth('해바라기')).toBe(8);
    expect(visualWidth('sunflower')).toBe(9);
    const korean = wrapTitle('해바라기 사전(땡땡의 모험 18)', opts);
    for (const line of korean) expect(visualWidth(line)).toBeLessThanOrEqual(12);
  });
});
