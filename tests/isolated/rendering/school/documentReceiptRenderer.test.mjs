/**
 * Thermal receipt target — structural contract.
 *
 * Tape has no vector path and no pages: this renderer rasterizes and cuts. The
 * assertions that matter are the refusals (a bubble row on tape can never be
 * scanned) and that the human-readable token text reaches the paper.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentReceiptRenderer } from '#rendering/school/documents/DocumentReceiptRenderer.mjs';
import { documentReceiptTheme as theme } from '#rendering/school/documents/documentReceiptTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';

const renderer = createDocumentReceiptRenderer({ theme, texToSvg });

const doc = (blocks) => ({
  id: 'receipt-doc', title: 'Receipt Doc', seed: 7, variant: 0, target: ['receipt'], blocks,
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('createDocumentReceiptRenderer', () => {
  it('renders a PNG canvas at the theme tape width', async () => {
    const { canvas, width, height } = await renderer.createCanvas(doc([
      { type: 'rich_text', md: '## Today\n\nDo the fractions worksheet, then scan it.' },
    ]));
    expect(width).toBe(theme.canvas.width);
    expect(height).toBeGreaterThan(0);
    expect(canvas.toBuffer('image/png').subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  it('grows taller with more content', async () => {
    const short = await renderer.createCanvas(doc([{ type: 'rich_text', md: 'One line.' }]));
    const long = await renderer.createCanvas(doc([
      { type: 'rich_text', md: 'One line.\n\nAnd another paragraph that says considerably more than the first one did.' },
    ]));
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('rasterizes math at 2x the drawn size for tape legibility', async () => {
    const widths = [];
    const spy = ({ svgString, widthPx }) => {
      widths.push(widthPx);
      return renderer.rasterizeSvg({ svgString, widthPx });
    };
    const withSpy = createDocumentReceiptRenderer({ theme, texToSvg, rasterizeSvg: spy });
    const { drawnMath } = await withSpy.createCanvas(doc([
      { type: 'math', tex: '\\frac{2}{3} + \\frac{1}{4}', display: true },
    ]));
    expect(drawnMath).toHaveLength(1);
    expect(widths[0]).toBe(Math.round(drawnMath[0].widthPx * theme.math.rasterScale));
  });

  it('prints the caller-minted token under a scan_action so a human can read it', async () => {
    const { codes } = await renderer.createCanvas(
      doc([{ type: 'scan_action', action: 'scan-worksheet', label: 'Scan when finished' }]),
      { tokens: { 'scan-worksheet': 'TKN-9F3A' } },
    );
    expect(codes).toMatchObject([{ action: 'scan-worksheet', code: 'TKN-9F3A', kind: 'scan_action' }]);
  });

  it('keeps a long unbroken token inside its code area instead of off the tape', async () => {
    const token = 'TKN-4f9a2c7e18b3d05a6e2f11c9';
    const { codes } = await renderer.createCanvas(
      doc([{ type: 'scan_action', action: 'scan-worksheet', label: 'Scan when finished' }]),
      { tokens: { 'scan-worksheet': token } },
    );
    const { lines } = codes[0];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(token);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThan(token.length);
  });

  it('falls back to the action name when no token was minted for it', async () => {
    const { codes } = await renderer.createCanvas(
      doc([{ type: 'media_action', action: 'play:word-problems', label: 'Play the problems' }]),
    );
    expect(codes[0].code).toBe('play:word-problems');
  });

  it('cuts a long document into segments instead of paginating', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: 'rich_text', md: `Step ${i + 1}. Work this one on the worksheet and check it off.`,
    }));
    const { cutPoints, height } = await renderer.createCanvas(doc(many));
    expect(cutPoints.length).toBeGreaterThan(1);
    expect(cutPoints[cutPoints.length - 1]).toBe(height);
    for (const cut of cutPoints) expect(cut).toBeLessThanOrEqual(height);
  });

  it('REFUSES a bubble row — tape can never be scanned by the reader', async () => {
    const sheet = doc([{
      type: 'question',
      itemId: 'q1',
      number: 1,
      blocks: [{ type: 'omr_response', itemId: 'q1', choices: 4 }],
    }]);
    await expect(renderer.createCanvas(sheet)).rejects.toThrow(/omr_response/);
  });

  it('refuses a block type with no receipt rendering rather than dropping it', async () => {
    await expect(renderer.createCanvas(doc([{ type: 'answer_space', minPt: 40, maxPt: 80 }])))
      .rejects.toThrow(/answer_space/);
  });

  it('is deterministic: the same document renders identical pixels', async () => {
    const source = doc([
      { type: 'rich_text', md: '## Checkpoint\n\nRead this, then scan the code.' },
      { type: 'math', tex: '\\frac{1}{2}', display: true },
      { type: 'scan_action', action: 'scan-omr', label: 'Scan to score' },
    ]);
    const first = await renderer.createCanvas(source, { tokens: { 'scan-omr': 'T1' } });
    const second = await renderer.createCanvas(source, { tokens: { 'scan-omr': 'T1' } });
    expect(first.canvas.toBuffer('image/png').equals(second.canvas.toBuffer('image/png'))).toBe(true);
  });
});

describe("scanCodes: 'qr'", () => {
  const scanDoc = doc([{ type: 'scan_action', action: 'sch:ABCDEFGH23456789', label: 'Scan me' }]);

  const darkPixelsInCodeArea = (canvas, theme) => {
    const ctx = canvas.getContext('2d');
    const size = theme.action.codeAreaPx - 8; // inside the border
    const x = theme.canvas.width - theme.layout.margin - theme.action.padding - theme.action.codeAreaPx + 4;
    // Extract the code area column and scan for the border row to locate the box top
    const fullStrip = ctx.getImageData(x, 0, size, canvas.height).data;

    // Find where the box starts by looking for dark pixels (border)
    let boxStartY = 0;
    for (let py = 0; py < canvas.height; py += 1) {
      let darkInRow = 0;
      for (let px = 0; px < size; px += 1) {
        const idx = (py * size + px) * 4;
        if (fullStrip[idx] < 96) darkInRow += 1;
      }
      if (darkInRow > size * 0.3) { // Border row has significant dark pixels
        boxStartY = py;
        break;
      }
    }

    // Sample only the code box interior (size rows from the border start)
    const img = ctx.getImageData(x, boxStartY, size, size).data;
    let dark = 0;
    for (let i = 0; i < img.length; i += 4) if (img[i] < 96) dark += 1;
    return dark;
  };

  it('draws real QR modules into the code area', async () => {
    const qr = createDocumentReceiptRenderer({ theme, texToSvg, scanCodes: 'qr' });
    const box = createDocumentReceiptRenderer({ theme, texToSvg });
    const a = await qr.createCanvas(scanDoc, { tokens: {} });
    const b = await box.createCanvas(scanDoc, { tokens: {} });
    const darkQr = darkPixelsInCodeArea(a.canvas, theme);
    const darkBox = darkPixelsInCodeArea(b.canvas, theme);
    expect(darkQr).toBeGreaterThan(darkBox * 3); // modules vs an empty stroked box
  });

  it('default stays box — construction without the option is unchanged', async () => {
    const r = createDocumentReceiptRenderer({ theme, texToSvg });
    const out = await r.createCanvas(scanDoc, { tokens: {} });
    expect(out.codes).toHaveLength(1); // existing contract intact
  });
});
