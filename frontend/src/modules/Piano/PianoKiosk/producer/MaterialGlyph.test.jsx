import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MaterialGlyph, seedFor, glyphColor } from './MaterialGlyph.jsx';

// ── seedFor ──────────────────────────────────────────────────────────────────

describe('seedFor', () => {
  it('harmonic entries (roman) seed from the roman signature', () => {
    expect(seedFor({ roman: ['I', 'V', 'vi', 'IV'], slug: 'axis' })).toBe('roman:I-V-vi-IV');
  });

  it('melodic entries (degrees) seed from the degree contour', () => {
    expect(seedFor({ degrees: [1, 3, 5, 3], slug: 'arp' })).toBe('degrees:1-3-5-3');
  });

  it('roman wins over degrees when both are present', () => {
    expect(seedFor({ roman: ['I', 'IV'], degrees: [1, 4], slug: 'x' })).toBe('roman:I-IV');
  });

  it('groove entries seed from feel + slug', () => {
    expect(seedFor({ type: 'groove', feel: 'swing', slug: 'shuffle-8' })).toBe('groove:swing:shuffle-8');
  });

  it('groove without a feel keeps a stable empty segment', () => {
    expect(seedFor({ type: 'groove', slug: 'four-floor' })).toBe('groove::four-floor');
  });

  it('falls back to slug, then path, then id', () => {
    expect(seedFor({ slug: 'my-take' })).toBe('slug:my-take');
    expect(seedFor({ path: 'takes/2026/a.mid' })).toBe('slug:takes/2026/a.mid');
    expect(seedFor({ id: 'take-77' })).toBe('slug:take-77');
  });

  it('take material without roman/degrees uses the fallback rule', () => {
    expect(seedFor({ kind: 'take', slug: 'evening-jam' })).toBe('slug:evening-jam');
  });

  it('composites hash their children order-insensitively', () => {
    const ab = seedFor({ kind: 'stack', children: ['a', 'b'] });
    const ba = seedFor({ kind: 'stack', children: ['b', 'a'] });
    expect(ab).toBe(ba);
    expect(ab).toBe('stack(a|b)');
  });

  it('section and song composites share the stack rule', () => {
    expect(seedFor({ kind: 'section', children: ['x', 'y'] })).toBe('stack(x|y)');
    expect(seedFor({ kind: 'song', children: ['y', 'x'] })).toBe('stack(x|y)');
  });

  it('composite children may be material objects (seeded recursively)', () => {
    const seed = seedFor({
      kind: 'stack',
      children: [{ roman: ['I', 'V'] }, { type: 'groove', feel: 'straight', slug: 'rock' }],
    });
    expect(seed).toBe('stack(groove:straight:rock|roman:I-V)');
  });

  it('different materials get different seeds', () => {
    const seeds = [
      seedFor({ roman: ['I', 'V', 'vi', 'IV'] }),
      seedFor({ degrees: [1, 5, 6, 4] }),
      seedFor({ type: 'groove', feel: 'swing', slug: 'a' }),
      seedFor({ slug: 'a' }),
    ];
    expect(new Set(seeds).size).toBe(4);
  });
});

// ── glyphColor ───────────────────────────────────────────────────────────────

describe('glyphColor', () => {
  it('returns a stable hue for a fixed seed', () => {
    const a = glyphColor('roman:I-V-vi-IV');
    const b = glyphColor('roman:I-V-vi-IV');
    expect(a.hue).toBe(b.hue);
    // Snapshot the exact number so the palette can never silently drift.
    expect(a.hue).toBe(53);
  });

  it('hue is in range and css has the fixed stage saturation/lightness', () => {
    for (const seed of ['a', 'b', 'roman:I', 'groove::x', 'stack(a|b)']) {
      const { hue, css } = glyphColor(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(359);
      expect(css).toBe(`hsl(${hue} 62% 52%)`);
    }
  });

  it('different seeds spread across hues', () => {
    const hues = new Set(
      Array.from({ length: 20 }, (_, i) => glyphColor(`sample-seed-${i}`).hue),
    );
    expect(hues.size).toBeGreaterThan(15);
  });
});

// ── MaterialGlyph component ──────────────────────────────────────────────────

const harmonic = { roman: ['I', 'V', 'vi', 'IV'], slug: 'axis' };
const groove = { type: 'groove', feel: 'swing', slug: 'shuffle-8' };

function svgFor(props) {
  const { container } = render(<MaterialGlyph {...props} />);
  return container.querySelector('svg');
}

describe('MaterialGlyph', () => {
  it('renders an inline svg at the requested size', () => {
    const svg = svgFor({ material: harmonic, size: 64 });
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('width')).toBe('64');
    expect(svg.getAttribute('height')).toBe('64');
  });

  it('defaults to 48px and passes className through', () => {
    const svg = svgFor({ material: harmonic, className: 'extra-class' });
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('class')).toContain('piano-material-glyph');
    expect(svg.getAttribute('class')).toContain('extra-class');
  });

  it('labels itself from title, falling back to the seed', () => {
    expect(svgFor({ material: harmonic, title: 'Axis loop' }).getAttribute('aria-label')).toBe('Axis loop');
    expect(svgFor({ material: harmonic }).getAttribute('aria-label')).toBe('roman:I-V-vi-IV');
  });

  it('is deterministic: same material renders identical markup', () => {
    const a = render(<MaterialGlyph material={harmonic} />).container.innerHTML;
    const b = render(<MaterialGlyph material={harmonic} />).container.innerHTML;
    expect(a).toBe(b);
  });

  it('distinct seeds render distinct markup (pairwise)', () => {
    const seeds = ['roman:I-V-vi-IV', 'degrees:1-3-5-3', 'slug:evening-jam'];
    const html = seeds.map((seed) => render(<MaterialGlyph seed={seed} />).container.innerHTML);
    expect(html[0]).not.toBe(html[1]);
    expect(html[0]).not.toBe(html[2]);
    expect(html[1]).not.toBe(html[2]);
  });

  it('renders cells as rounded rects for non-groove material', () => {
    const svg = svgFor({ material: harmonic });
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('circle').length).toBe(0);
    // Rounded corners on every cell.
    for (const rect of svg.querySelectorAll('rect')) {
      expect(Number(rect.getAttribute('rx'))).toBeGreaterThan(0);
    }
  });

  it('renders cells as circles for groove material', () => {
    const svg = svgFor({ material: groove });
    expect(svg.querySelectorAll('circle').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('rect').length).toBe(0);
  });

  it('cells all carry the seeded color', () => {
    const svg = svgFor({ material: harmonic });
    const { css } = glyphColor(seedFor(harmonic));
    for (const cell of svg.querySelectorAll('rect')) {
      expect(cell.getAttribute('fill')).toBe(css);
    }
  });

  it('is vertically symmetric: columns 4/3 mirror columns 0/1', () => {
    const svg = svgFor({ material: harmonic });
    // Collect on-cells as "col,row" grid coordinates from rect x/y.
    const on = new Set(
      Array.from(svg.querySelectorAll('rect')).map((r) => {
        const col = Math.floor(Number(r.getAttribute('x')));
        const row = Math.floor(Number(r.getAttribute('y')));
        return `${col},${row}`;
      }),
    );
    for (const key of on) {
      const [col, row] = key.split(',').map(Number);
      expect(on.has(`${4 - col},${row}`)).toBe(true);
    }
  });

  it('an explicit seed prop overrides material', () => {
    const fromSeed = render(<MaterialGlyph material={harmonic} seed="groove:swing:shuffle-8" />).container.innerHTML;
    const grooveOwn = render(<MaterialGlyph material={groove} />).container.innerHTML;
    expect(fromSeed).toBe(grooveOwn);
  });

  it('never renders an empty or full grid across sample seeds', () => {
    for (let i = 0; i < 20; i++) {
      const svg = svgFor({ seed: `spread-check-${i}` });
      const cells = svg.querySelectorAll('rect').length;
      expect(cells).toBeGreaterThan(0);
      expect(cells).toBeLessThan(25);
    }
  });

  it('markup contains no network references', () => {
    const html = render(<MaterialGlyph material={harmonic} title="t" />).container.innerHTML;
    expect(html).not.toContain('http');
  });
});
