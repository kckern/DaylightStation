import { deriveMatte, rgbToHsv } from '../../../backend/src/2_domains/art/deriveMatte.mjs';

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];
const satOf = (hex) => rgbToHsv(hexToRgb(hex))[1];
const valOf = (hex) => rgbToHsv(hexToRgb(hex))[2];

describe('deriveMatte', () => {
  it('near-greyscale → warm neutral (brown), R>=G>=B', () => {
    const m = deriveMatte([200, 198, 195]); // saturation ~0.025
    expect(m.branch).toBe('neutral');
    const [r, g, b] = hexToRgb(m.base);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(b); // warm: amber/brown
  });

  it('colorful cool → match, hue preserved (blue), muted', () => {
    const m = deriveMatte([117, 135, 156]); // cool blue, sat ~0.25
    expect(m.branch).toBe('match');
    const [r, g, b] = hexToRgb(m.base);
    expect(b).toBeGreaterThan(r); // still cool
    expect(b).toBeGreaterThan(g);
    expect(satOf(m.base)).toBeLessThanOrEqual(0.19); // sat ceiling 0.18 (+rounding)
    expect(valOf(m.base)).toBeGreaterThanOrEqual(0.29);
    expect(valOf(m.base)).toBeLessThanOrEqual(0.53);
  });

  it('guardrail: a vivid input never yields a vibrant matte', () => {
    const m = deriveMatte([255, 0, 0]); // pure red, sat 1.0
    expect(satOf(m.base)).toBeLessThanOrEqual(0.19);
    expect(valOf(m.base)).toBeLessThanOrEqual(0.53);
  });

  it('mat brightness tracks the painting (dark < light)', () => {
    const dark = deriveMatte([20, 40, 60]);
    const light = deriveMatte([150, 175, 205]);
    expect(valOf(dark.base)).toBeLessThan(valOf(light.base));
  });

  it('bevel ordering: bottom (lit) > base > top (shadow)', () => {
    const m = deriveMatte([117, 135, 156]);
    expect(sum(hexToRgb(m.bevelBottom))).toBeGreaterThan(sum(hexToRgb(m.base)));
    expect(sum(hexToRgb(m.base))).toBeGreaterThan(sum(hexToRgb(m.bevelTop)));
  });

  it('pure black and pure white never produce NaN — all slots valid hex', () => {
    for (const input of [[0, 0, 0], [255, 255, 255]]) {
      const m = deriveMatte(input);
      for (const hex of Object.values(m).filter((x) => typeof x === 'string' && x.startsWith('#'))) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(hexToRgb(hex).some(Number.isNaN)).toBe(false);
      }
    }
  });
});
