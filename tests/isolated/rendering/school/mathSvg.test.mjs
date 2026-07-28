import { describe, it, expect } from 'vitest';
import { texToSvg, MathRenderError } from '../../../../backend/src/1_rendering/school/documents/mathSvg.mjs';

const viewBoxOf = (svgString) => svgString.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const rootTagOf = (svgString) => svgString.slice(0, svgString.indexOf('>') + 1);

// Spike stress corpus (docs/_wip/plans/2026-07-27-school-math-rendering-spike-results.md).
const STRESS_CORPUS = {
  'nested fractions': '\\frac{\\frac{a}{b}}{\\frac{c}{d}}',
  radicals: '\\sqrt[3]{\\frac{x+1}{y-2}}',
  matrix: '\\begin{pmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}',
  'long expression': '3x^2 + 17x - 42 = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} + \\int_0^\\infty e^{-t} \\, dt',
  inequalities: 'x \\ge 3 \\quad y \\ne 4 \\quad z \\le -\\tfrac{1}{2}',
  trig: '\\sin^2\\theta + \\cos^2\\theta = 1',
  'long division': '24 \\enclose{longdiv}{3768}',
  'aligned multi-line': '\\begin{aligned} 2x + 3 &= 11 \\\\ 2x &= 8 \\\\ x &= 4 \\end{aligned}',
  'summation with limits': '\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}',
  'mixed number with text': '\\text{Sally has } 3\\tfrac{1}{2} \\text{ apples}',
};

describe('texToSvg — sizing from the viewBox', () => {
  it('derives widthPt/heightPt from the viewBox at 1000 units per em', () => {
    const { svgString, widthPt, heightPt } = texToSvg('x + 1', { fontSizePt: 12 });
    const [, , vbW, vbH] = viewBoxOf(svgString);
    expect(widthPt).toBeCloseTo((vbW / 1000) * 12, 10);
    expect(heightPt).toBeCloseTo((vbH / 1000) * 12, 10);
    expect(widthPt).toBeGreaterThan(0);
    expect(heightPt).toBeGreaterThan(0);
  });

  it('scales linearly with fontSizePt', () => {
    const small = texToSvg('x + 1', { fontSizePt: 12 });
    const large = texToSvg('x + 1', { fontSizePt: 24 });
    expect(large.widthPt).toBeCloseTo(small.widthPt * 2, 10);
    expect(large.heightPt).toBeCloseTo(small.heightPt * 2, 10);
  });

  it('strips width and height from the root svg tag', () => {
    const { svgString } = texToSvg('x + 1');
    const root = rootTagOf(svgString);
    expect(root).toMatch(/^<svg\b/);
    expect(root).not.toMatch(/\swidth=/);
    expect(root).not.toMatch(/\sheight=/);
  });

  it('leaves no ex-unit width or height attribute anywhere in the output', () => {
    for (const tex of Object.values(STRESS_CORPUS)) {
      const { svgString } = texToSvg(tex);
      expect(svgString, tex).not.toMatch(/(?:width|height)="[^"]*ex"/);
    }
  });

  it('preserves the width/height of nested svg elements (stretchy glyphs)', () => {
    // \overline emits an inner <svg> whose width/height are viewBox units, not
    // ex — stripping them globally would collapse the stretchy rule.
    const { svgString } = texToSvg('\\overline{AB}');
    const nested = svgString.slice(svgString.indexOf('>') + 1);
    expect(nested).toMatch(/<svg\b[^>]*\swidth="[\d.]+"/);
    expect(nested).toMatch(/<svg\b[^>]*\sheight="[\d.]+"/);
  });
});

describe('texToSvg — depth below the baseline', () => {
  it('reports depthPt as (vbY + vbH) scaled to the font size', () => {
    const { svgString, depthPt } = texToSvg('\\frac{1}{2}', { fontSizePt: 12 });
    const [, vbY, , vbH] = viewBoxOf(svgString);
    expect(depthPt).toBeCloseTo(((vbY + vbH) / 1000) * 12, 10);
    expect(depthPt).toBeGreaterThan(0);
  });

  it('reports positive depth for a descender-bearing expression', () => {
    const { depthPt, heightPt } = texToSvg('\\sum_{i=1}^{n} i^2');
    expect(depthPt).toBeGreaterThan(0);
    expect(depthPt).toBeLessThan(heightPt);
  });

  it('reports zero depth for an expression that sits on the baseline', () => {
    expect(texToSvg('X').depthPt).toBe(0);
  });
});

describe('texToSvg — stroke normalization', () => {
  it('promotes inline stroke-width to an attribute for long division', () => {
    const { svgString } = texToSvg('24 \\enclose{longdiv}{3768}');
    expect(svgString).not.toContain('style="stroke-width');
    expect(svgString).toMatch(/stroke-width="67"/);
  });

  it('leaves stroke-width attributes that MathJax already emits as attributes', () => {
    const { svgString } = texToSvg('\\cancel{x+y}');
    expect(svgString).not.toContain('style="stroke-width');
    expect(svgString).toMatch(/<line\b[^>]*stroke-width="67"/);
  });
});

describe('texToSvg — ink colour', () => {
  it('replaces currentColor with the default ink', () => {
    const { svgString } = texToSvg('x + 1');
    expect(svgString).not.toContain('currentColor');
    expect(svgString).toContain('stroke="#000000"');
    expect(svgString).toContain('fill="#000000"');
  });

  it('replaces currentColor with a caller-supplied ink', () => {
    const { svgString } = texToSvg('x + 1', { ink: '#3366cc' });
    expect(svgString).not.toContain('currentColor');
    expect(svgString).toContain('stroke="#3366cc"');
  });

  it('leaves no currentColor in any stress-corpus output', () => {
    for (const tex of Object.values(STRESS_CORPUS)) {
      expect(texToSvg(tex).svgString, tex).not.toContain('currentColor');
    }
  });
});

describe('texToSvg — display vs inline', () => {
  it('renders display and inline modes differently', () => {
    const display = texToSvg('\\sum_{i=1}^{n} i', { display: true });
    const inline = texToSvg('\\sum_{i=1}^{n} i', { display: false });
    expect(inline.svgString).not.toBe(display.svgString);
    expect(inline.widthPt).not.toBeCloseTo(display.widthPt, 6);
  });
});

describe('texToSvg — failing loudly on bad TeX', () => {
  it('throws MathRenderError on malformed TeX', () => {
    expect(() => texToSvg('\\frac{')).toThrow(MathRenderError);
  });

  it('throws MathRenderError on an undefined control sequence', () => {
    // Without this, MathJax's noundefined extension prints the raw command in
    // red on the learner's worksheet instead of failing validation.
    expect(() => texToSvg('\\badmacro x')).toThrow(/Undefined control sequence/);
  });

  it('throws MathRenderError on \\require, which never resolves server-side', () => {
    expect(() => texToSvg('\\require{enclose} 24 \\enclose{longdiv}{3768}')).toThrow(MathRenderError);
  });

  it('carries the offending TeX on the error', () => {
    try {
      texToSvg('\\frac{');
      throw new Error('expected texToSvg to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MathRenderError);
      expect(err.name).toBe('MathRenderError');
      expect(err.tex).toBe('\\frac{');
    }
  });

  it('rejects empty and non-string TeX', () => {
    expect(() => texToSvg('')).toThrow(MathRenderError);
    expect(() => texToSvg('   ')).toThrow(MathRenderError);
    expect(() => texToSvg(null)).toThrow(MathRenderError);
    expect(() => texToSvg(42)).toThrow(MathRenderError);
  });

  it('rejects a non-positive font size', () => {
    expect(() => texToSvg('x', { fontSizePt: 0 })).toThrow(MathRenderError);
    expect(() => texToSvg('x', { fontSizePt: -3 })).toThrow(MathRenderError);
    expect(() => texToSvg('x', { fontSizePt: NaN })).toThrow(MathRenderError);
  });
});

describe('texToSvg — stress corpus', () => {
  for (const [name, tex] of Object.entries(STRESS_CORPUS)) {
    it(`renders ${name} with viewBox-consistent dimensions`, () => {
      const { svgString, widthPt, heightPt, depthPt } = texToSvg(tex, { fontSizePt: 11 });
      const [, , vbW, vbH] = viewBoxOf(svgString);
      expect(svgString.startsWith('<svg')).toBe(true);
      expect(svgString.endsWith('</svg>')).toBe(true);
      expect(widthPt).toBeCloseTo((vbW / 1000) * 11, 10);
      expect(heightPt).toBeCloseTo((vbH / 1000) * 11, 10);
      expect(depthPt).toBeGreaterThanOrEqual(0);
      expect(svgString).not.toContain('merror');
    });
  }
});

describe('texToSvg — singleton document', () => {
  it('produces byte-identical output for repeated calls', () => {
    const first = texToSvg('x^2 + 2x + 1');
    const second = texToSvg('x^2 + 2x + 1');
    expect(second.svgString).toBe(first.svgString);
    expect(second.widthPt).toBe(first.widthPt);
    expect(second.depthPt).toBe(first.depthPt);
  });

  it('recovers after a failed conversion', () => {
    expect(() => texToSvg('\\frac{')).toThrow(MathRenderError);
    expect(texToSvg('x + 1').widthPt).toBeGreaterThan(0);
  });
});
