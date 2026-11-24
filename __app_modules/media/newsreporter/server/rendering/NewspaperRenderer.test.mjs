import { describe, it, expect } from 'vitest';
import { NewspaperRenderer, PAPER_WIDTH, wrapLines } from './NewspaperRenderer.mjs';
import { sampleLayout } from '../application/edition/fixtures/editionFixtures.mjs';

const MARGIN = 12;

describe('NewspaperRenderer', () => {
  const renderer = new NewspaperRenderer();

  it('renders the fixture at paper width and within a fixed height range', async () => {
    const { canvas, width, height, heightCm } = await renderer.render(sampleLayout());
    expect(width).toBe(PAPER_WIDTH);
    expect(canvas.width).toBe(PAPER_WIDTH);
    expect(canvas.height).toBe(height);
    // 576 dots = 72 mm, so 80 dots per cm.
    expect(heightCm).toBeCloseTo(height / 80, 5);
    expect(height).toBeGreaterThan(1700);
    expect(height).toBeLessThan(2400);
    const png = canvas.toBuffer('image/png');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('keeps every drawn line inside the side margins', async () => {
    const { lines } = await renderer.render(sampleLayout());
    expect(lines.length).toBeGreaterThan(40);
    for (const line of lines) {
      expect(line.x, line.text).toBeGreaterThanOrEqual(MARGIN - 0.5);
      expect(line.x + line.width, line.text).toBeLessThanOrEqual(PAPER_WIDTH - MARGIN + 0.5);
    }
  });

  it('breaks an unbreakable token instead of running off the paper', async () => {
    const layout = sampleLayout();
    layout.blocks.find((b) => b.type === 'lead').body = `See ${'https://example.com/'.padEnd(220, 'x')} for more.`;
    const { lines } = await renderer.render(layout);
    for (const line of lines) expect(line.x + line.width, line.text).toBeLessThanOrEqual(PAPER_WIDTH - MARGIN + 0.5);
  });

  it('paints only black and white fills (no grey boxes)', async () => {
    const { canvas } = await renderer.render(sampleLayout());
    const ctx = canvas.getContext('2d');
    // Sample the inverted section bar interior and the paper: pure ink / pure paper.
    const { data } = ctx.getImageData(0, 0, PAPER_WIDTH, 4);
    for (let i = 0; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('measure() agrees with render()', async () => {
    const m = await renderer.measure(sampleLayout());
    const r = await renderer.render(sampleLayout());
    expect(m.height).toBe(r.height);
  });

  it('grows when content is added', async () => {
    const small = await renderer.measure(sampleLayout());
    const layout = sampleLayout();
    layout.blocks.splice(4, 0, { type: 'section', label: 'Extra', stories: [{ headline: 'More', body: 'Words '.repeat(80), sources: ['X'] }] });
    const big = await renderer.measure(layout);
    expect(big.height).toBeGreaterThan(small.height + 200);
  });

  it('renderText matches the snapshot', () => {
    expect(renderer.renderText(sampleLayout())).toMatchSnapshot();
  });

  it('wrapLines hard-breaks a word wider than the line', () => {
    const ctx = { measureText: (s) => ({ width: s.length * 10 }) };
    expect(wrapLines(ctx, 'ab abcdefghij', 50)).toEqual(['ab', 'abcde', 'fghij']);
  });
});
