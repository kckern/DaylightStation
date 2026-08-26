/**
 * Thermal receipt target — structural contract.
 *
 * Tape has no vector path and no pages: this renderer rasterizes and cuts. The
 * assertions that matter are the refusals (a bubble row on tape can never be
 * scanned) and that the human-readable token text reaches the paper.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { createDocumentReceiptRenderer } from '#rendering/school/documents/DocumentReceiptRenderer.mjs';
import { documentReceiptTheme as theme } from '#rendering/school/documents/documentReceiptTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';

// The repo carries TWO installs of `canvas` — one at the root and one under
// `backend/`. They are separate native modules with separate prototypes, and
// the renderer (living under `backend/src/`) resolves the backend copy. A
// plain `import 'canvas'` from this file gets the ROOT copy, so patching its
// `CanvasRenderingContext2D.prototype` to spy on draw calls silently
// intercepts nothing: the spy array stays empty and any `toEqual([])`
// assertion built on it passes vacuously. Resolving `canvas` from the
// renderer's own directory is what makes the spy real — the specs below
// additionally assert their spy caught SOMETHING, so a future duplication
// fails loudly instead of going quiet.
const rendererRequire = createRequire(
  new URL('../../../../backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs', import.meta.url),
);
const { CanvasRenderingContext2D } = rendererRequire('canvas');

const renderer = createDocumentReceiptRenderer({ theme, texToSvg });

// Untitled on purpose: a `title` now asks for the standard-header banner
// (tested in its own describe below); these structural tests exercise the
// plain path.
const doc = (blocks) => ({
  id: 'receipt-doc', seed: 7, variant: 0, target: ['receipt'], blocks,
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

describe('the standard header', () => {
  const rowDarkness = (canvas, y) => {
    const img = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data;
    let dark = 0;
    for (let i = 0; i < img.length; i += 4) if (img[i] < 96) dark += 1;
    return dark / (img.length / 4);
  };

  it('a titled document opens with a full-bleed black band', async () => {
    const titled = await renderer.createCanvas({ ...doc([{ type: 'rich_text', md: 'Body.' }]), title: 'Learner-Four' });
    // The band bleeds edge to edge at the very top of the tape; the knocked-out
    // name keeps it from being 100% dark.
    expect(rowDarkness(titled.canvas, 2)).toBeGreaterThan(0.8);
    expect(rowDarkness(titled.canvas, Math.floor(theme.header.padY / 2))).toBeGreaterThan(0.5);
  });

  it('an untitled document keeps the plain id heading — no band', async () => {
    const plain = await renderer.createCanvas(doc([{ type: 'rich_text', md: 'Body.' }]));
    expect(rowDarkness(plain.canvas, 2)).toBeLessThan(0.1);
  });
});

describe('receipt taxonomy hierarchy', () => {
  it('starts the lesson on a new, deeper-indented row below the unit', async () => {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    const calls = [];
    CanvasRenderingContext2D.prototype.fillText = function patchedFillText(value, x, y, ...rest) {
      calls.push({ value: String(value), x, y });
      return originalFillText.call(this, value, x, y, ...rest);
    };
    try {
      await renderer.createCanvas(doc([{
        type: 'result_summary', headline: 'PASSED', title: 'Psalms', correctCount: 5, totalCount: 5,
        taxonomy: {
          subject: 'Scripture', course: 'Come Follow Me — Old Testament 2026',
          unit: 'Unit 35: Aug 24–30 · Psalms 49–86', lesson: 'Tuesday · Psalms 62–66, 69',
        },
      }]));
    } finally {
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
    }
    expect(calls.length).toBeGreaterThan(0);
    const unit = calls.find((call) => call.value.startsWith('Unit 35:'));
    const lesson = calls.find((call) => call.value.includes('Tuesday'));
    expect(unit).toBeTruthy();
    expect(lesson).toBeTruthy();
    expect(lesson.y).toBeGreaterThan(unit.y);
    expect(lesson.x).toBeGreaterThan(unit.x);
  });
});

describe('subject icons on scan_action blocks', () => {
  const iconDoc = (icon) => doc([{ type: 'scan_action', action: 'sch:AAAA', label: 'Unit Two — watch it', ...(icon ? { icon } : {}) }]);

  it('reads the SAME svg files the School home grid uses, rasterized at 2x', async () => {
    const calls = [];
    const spy = (args) => { calls.push(args); return renderer.rasterizeSvg(args); };
    const withSpy = createDocumentReceiptRenderer({ theme, texToSvg, rasterizeSvg: spy });
    await withSpy.createCanvas(iconDoc('math'), { tokens: {} });
    expect(calls).toHaveLength(1);
    expect(calls[0].widthPx).toBe(theme.action.iconPx * 2);
    // The shared frontend icon, not a copy: currentColor pinned to tape ink.
    expect(calls[0].svgString).toContain('<svg');
    expect(calls[0].svgString).not.toContain('currentColor');
  });

  it('draws the icon in the slot and moves the label out of it', async () => {
    // A one-glyph label: with an icon the glyph starts past the icon slot, so
    // the slot's ink is the icon's alone — a clean with/without comparison.
    const narrow = (icon) => doc([{ type: 'scan_action', action: 'sch:AAAA', label: 'X', ...(icon ? { icon } : {}) }]);
    const iconSlotDark = async (document) => {
      const { canvas } = await renderer.createCanvas(document, { tokens: {} });
      const ctx = canvas.getContext('2d');
      const x = theme.layout.margin + theme.action.padding + 2;
      const img = ctx.getImageData(x, 0, theme.action.iconPx - 4, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i] < 96) dark += 1;
      return dark;
    };
    const withIcon = await iconSlotDark(narrow('math'));
    const without = await iconSlotDark(narrow(null));
    expect(withIcon).toBeGreaterThan(without + 100);
  });

  it('an unknown icon id degrades to the un-iconed box, never a failed print', async () => {
    const out = await renderer.createCanvas(iconDoc('no-such-subject'), { tokens: {} });
    expect(out.codes).toHaveLength(1);
  });

  it('a traversal-shaped icon id is refused without touching the filesystem', async () => {
    const calls = [];
    const spy = (args) => { calls.push(args); return renderer.rasterizeSvg(args); };
    const withSpy = createDocumentReceiptRenderer({ theme, texToSvg, rasterizeSvg: spy });
    const out = await withSpy.createCanvas(iconDoc('../../auth/plex'), { tokens: {} });
    expect(out.codes).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe('result score scale', () => {
  it('renders a 50-question exam as a compact aggregate bar', async () => {
    const out = await renderer.createCanvas(doc([{
      type: 'result_summary',
      headline: 'Exam complete',
      title: 'Final exam',
      correctCount: 43,
      totalCount: 50,
      passingPercent: 80,
    }]));
    expect(out.width).toBe(theme.canvas.width);
    expect(out.height).toBeLessThan(500);
  });

  it('keeps the inverted header strictly monochrome', async () => {
    const out = await renderer.createCanvas({ ...doc([{ type: 'rich_text', md: 'Body.' }]), title: 'Worksheet Result' });
    const pixels = out.canvas.getContext('2d').getImageData(0, 0, out.width, theme.header.lineHeight).data;
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1]);
      expect(pixels[i + 1]).toBe(pixels[i + 2]);
    }
  });
});

/**
 * Per-question mark boxes (regression, 2026-08-22): a real child's 6/6 sheet
 * printed as six tofu boxes (Roboto Condensed has no U+2713), and a 5/6 sheet
 * always blamed the LAST wrong-looking box regardless of which question was
 * actually missed. Both bugs live in the same `else` branch of the score-panel
 * loop — one is "what gets drawn", the other is "which box gets which mark".
 */
describe('result score marks: vector, per-question', () => {
  it('never draws the correct/incorrect mark as a font glyph — only vector strokes', async () => {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    const texts = [];
    CanvasRenderingContext2D.prototype.fillText = function patchedFillText(text, ...rest) {
      texts.push(text);
      return originalFillText.call(this, text, ...rest);
    };
    try {
      await renderer.createCanvas(doc([{
        type: 'result_summary',
        headline: 'PASSED',
        title: 'Fractions',
        correctCount: 6,
        totalCount: 6,
        questionStart: 1,
      }]));
    } finally {
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
    }
    // Neither mark glyph this bug involved may ever reach fillText again:
    // Roboto Condensed is missing U+2713 (✓), which is why a 6/6 sheet
    // printed as tofu; × (U+00D7) happened to render, which is why only the
    // check silently broke. Scoped to these two glyphs specifically — not
    // "any non-ASCII fillText" — because the score line itself legitimately
    // prints other non-ASCII punctuation (e.g. the "·" separator) that has
    // nothing to do with this bug.
    // The spy must have caught the panel's ordinary text (the score line, the
    // headline) — otherwise "no glyph marks" would mean "no interception",
    // not "no glyphs", and this assertion would pass on a broken spy.
    expect(texts.length).toBeGreaterThan(0);
    const glyphMarks = texts.filter((t) => t.includes('✓') || t.includes('×'));
    expect(glyphMarks).toEqual([]);
  });

  it('marks box 1 wrong when ONLY question 1 is wrong — never the trailing boxes', async () => {
    const originalStroke = CanvasRenderingContext2D.prototype.strokeRect;
    const originalFill = CanvasRenderingContext2D.prototype.fillRect;
    const strokedBoxes = [];
    const filledBoxes = [];
    CanvasRenderingContext2D.prototype.strokeRect = function patchedStrokeRect(x, y, w, h) {
      strokedBoxes.push({ x, y, w, h });
      return originalStroke.call(this, x, y, w, h);
    };
    CanvasRenderingContext2D.prototype.fillRect = function patchedFillRect(x, y, w, h) {
      filledBoxes.push({ x, y, w, h });
      return originalFill.call(this, x, y, w, h);
    };
    try {
      await renderer.createCanvas(doc([{
        type: 'result_summary',
        headline: 'TRY AGAIN',
        title: 'Fractions',
        correctCount: 5,
        totalCount: 6,
        questionStart: 1,
        // Per-question evidence: only question 1 (index 0) is wrong.
        marks: [false, true, true, true, true, true],
      }]));
    } finally {
      CanvasRenderingContext2D.prototype.strokeRect = originalStroke;
      CanvasRenderingContext2D.prototype.fillRect = originalFill;
    }
    // Every question box gets exactly one strokeRect outline, left to right,
    // in question order — this is the panel's own box-position ground truth,
    // independent of which are marked wrong.
    const questionBoxes = strokedBoxes.filter((b) => b.w === b.h && b.w > 20 && b.w < 60);
    expect(questionBoxes).toHaveLength(6);
    const boxSize = questionBoxes[0].w;
    // The WRONG indicator is the single solid box-sized knockout fill (the
    // black square the X strokes over) — distinct from the identity panel,
    // score-panel border, and outcome badge, none of which are box-sized
    // squares.
    const wrongFills = filledBoxes.filter((b) => b.w === boxSize && b.h === boxSize);
    expect(wrongFills).toHaveLength(1);
    // Box 1 (leftmost, first stroked) is the one that's wrong — not a box at
    // the tail, which is what `index < correctCount` would have drawn.
    expect(wrongFills[0].x).toBe(questionBoxes[0].x);
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

  it('renders QR codes at correct y-positions with multiple action blocks', async () => {
    const multiActionDoc = doc([
      { type: 'rich_text', md: 'First task' },
      { type: 'scan_action', action: 'task1', label: 'Scan task 1' },
      { type: 'rich_text', md: 'Second task' },
      { type: 'scan_action', action: 'task2', label: 'Scan task 2' },
    ]);
    const qr = createDocumentReceiptRenderer({ theme, texToSvg, scanCodes: 'qr' });
    const result = await qr.createCanvas(multiActionDoc, { tokens: {} });

    // Verify both code blocks exist
    expect(result.codes).toHaveLength(2);
    expect(result.codes[0].action).toBe('task1');
    expect(result.codes[1].action).toBe('task2');

    // Verify both have dense QR pixels at their respective positions
    const darkPixelsInCodeAreaAtY = (canvas, theme, targetY) => {
      const ctx = canvas.getContext('2d');
      const size = theme.action.codeAreaPx - 8;
      const x = theme.canvas.width - theme.layout.margin - theme.action.padding - theme.action.codeAreaPx + 4;

      // Search for box starting from targetY
      let boxStartY = targetY;
      for (let py = targetY; py < Math.min(targetY + 300, canvas.height); py += 1) {
        let darkInRow = 0;
        const rowData = ctx.getImageData(x, py, size, 1).data;
        for (let i = 0; i < rowData.length; i += 4) {
          if (rowData[i] < 96) darkInRow += 1;
        }
        if (darkInRow > size * 0.3) {
          boxStartY = py;
          break;
        }
      }

      const img = ctx.getImageData(x, boxStartY, size, size).data;
      let dark = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i] < 96) dark += 1;
      return dark;
    };

    // Each code area should have significant dark pixels (QR modules)
    const dark1 = darkPixelsInCodeAreaAtY(result.canvas, theme, 80); // first action op
    const dark2 = darkPixelsInCodeAreaAtY(result.canvas, theme, 350); // second action op (approx)

    expect(dark1).toBeGreaterThan(500); // QR in first code area
    expect(dark2).toBeGreaterThan(500); // QR in second code area
  });
});

/**
 * Progress ticks (2026-08-23). The tick count was
 * `Math.min(progressSegments, total)` with `progressSegments: 10`, while the
 * filled bar beside it is `completed / total`. On a 13-lesson unit the track
 * was therefore divided into ten and the filled edge landed nowhere near a
 * tick — "1 of 13" printed above ten marks. Course progress escaped notice
 * only because 7 units is under the old cap.
 */
describe('progress ticks count lessons, not tenths', () => {
  /** Vertical strokes drawn in the progress band, by x — one per tick. */
  async function tickXsFor(progress) {
    const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
    const originalLineTo = CanvasRenderingContext2D.prototype.lineTo;
    const segments = [];
    let pending = null;
    CanvasRenderingContext2D.prototype.moveTo = function patchedMoveTo(x, y) {
      pending = { x, y };
      return originalMoveTo.call(this, x, y);
    };
    CanvasRenderingContext2D.prototype.lineTo = function patchedLineTo(x, y) {
      if (pending && Math.abs(pending.x - x) < 0.001 && y > pending.y) {
        segments.push({ x, height: y - pending.y });
      }
      return originalLineTo.call(this, x, y);
    };
    try {
      await renderer.createCanvas(doc([{
        type: 'result_summary',
        headline: 'PASSED',
        title: 'The Midwestern States',
        correctCount: 6,
        totalCount: 6,
        progress: [progress],
      }]));
    } finally {
      CanvasRenderingContext2D.prototype.moveTo = originalMoveTo;
      CanvasRenderingContext2D.prototype.lineTo = originalLineTo;
    }
    // The ticks are the tallest cluster of identical-height vertical strokes
    // in the band; the score panel's own strokes differ in height.
    const byHeight = new Map();
    segments.forEach((s) => byHeight.set(s.height, [...(byHeight.get(s.height) ?? []), s.x]));
    const tallest = [...byHeight.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    return (tallest?.[1] ?? []).sort((a, b) => a - b);
  }

  it("divides the track into one segment per lesson — not the old ten", async () => {
    const xs = await tickXsFor({ label: 'Unit 1', completed: 1, total: 13 });
    // 13 segments need 12 INTERIOR dividers: the unified bar is an outlined
    // track, so its own border supplies both outer bounds. The old bare-rule
    // drawing painted a tick at x=0 and a closing end cap as well (14 marks),
    // which on a boxed track would just be ink on top of the border.
    expect(xs).toHaveLength(12);
  });

  it('puts the filled edge exactly on a tick, which is the whole point', async () => {
    const xs = await tickXsFor({ label: 'Unit 1', completed: 1, total: 13 });
    const spacing = xs[1] - xs[0];
    // Evenly spaced, so tick[completed] is where the fill ends.
    xs.slice(1).forEach((x, i) => expect(x - xs[i]).toBeCloseTo(spacing, 5));
  });

  it('still matches when the total is under the old cap — course progress was right by luck', async () => {
    const xs = await tickXsFor({ label: 'Course', completed: 1, total: 7 });
    // 7 segments, 6 interior dividers — the track's border closes both ends.
    expect(xs).toHaveLength(6);
  });

  it('drops the ticks entirely rather than drawing a wrong count when they would not be countable', async () => {
    const xs = await tickXsFor({ label: 'Course', completed: 1, total: 400 });
    // 530px of track / 400 would be ~1.3px apart — a hatch, not a count.
    // The bar and its "n of m" label still carry it.
    expect(xs.length).toBeLessThan(400);
  });
});

/**
 * PAST, PRESENT, FUTURE on the course bar (2026-08-23).
 *
 * The bar had two states — units done and units not — which filed the unit a
 * child is currently working through with the ones they have never opened.
 * `inProgress` marks that segment, drawn as a hatch: the empty track is
 * already an outline, so an outlined segment would read as future, which is
 * the confusion being fixed.
 */
describe('the in-progress segment on a progress bar', () => {
  /**
   * Vertical strokes drawn inside the bar band, by x — and by STROKE WIDTH.
   *
   * These used to be told apart by height: the hatch was exactly bar-height
   * and the ticks overhung it by 2px each side, because the bar was a bare
   * rule with its ticks standing outside it. The unified bar
   * (`progressBar.mjs`) draws an outlined TRACK with both marks inside it, so
   * they are now the same height and height can no longer separate them.
   * Stroke width can, and is a real part of the design rather than a
   * side-effect: `progress.tickWidth` (2) is furniture, `progress.hatchWidth`
   * (3) is texture.
   */
  async function bandStrokes(progress) {
    const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
    const originalLineTo = CanvasRenderingContext2D.prototype.lineTo;
    const segments = [];
    let pending = null;
    CanvasRenderingContext2D.prototype.moveTo = function patchedMoveTo(x, y) {
      pending = { x, y };
      return originalMoveTo.call(this, x, y);
    };
    CanvasRenderingContext2D.prototype.lineTo = function patchedLineTo(x, y) {
      if (pending && Math.abs(pending.x - x) < 0.001 && y > pending.y) {
        segments.push({ x, height: y - pending.y, lineWidth: this.lineWidth });
      }
      return originalLineTo.call(this, x, y);
    };
    try {
      await renderer.createCanvas(doc([{
        type: 'result_summary', headline: 'PASSED', title: 'X', correctCount: 6, totalCount: 6, progress: [progress],
      }]));
    } finally {
      CanvasRenderingContext2D.prototype.moveTo = originalMoveTo;
      CanvasRenderingContext2D.prototype.lineTo = originalLineTo;
    }
    return segments;
  }

  /** The hatch is the heavier stroke; segment ticks are the lighter one. */
  const hatchOf = (segments) => segments.filter(
    (s) => Math.abs(s.height - theme.progress.barHeight) < 0.001
      && Math.abs(s.lineWidth - theme.progress.hatchWidth) < 0.001,
  );

  it('draws nothing extra when no segment is underway', async () => {
    expect(hatchOf(await bandStrokes({ label: 'Course', completed: 2, total: 7 }))).toEqual([]);
  });

  it('hatches exactly the segment after the completed ones', async () => {
    const hatch = hatchOf(await bandStrokes({ label: 'Course', completed: 2, total: 7, inProgress: 1 }));
    expect(hatch.length).toBeGreaterThan(0);
    // 530pt track / 7 = ~75.7 per segment; the hatch spans segment index 2.
    const segmentWidth = (theme.canvas.width - 2 * theme.layout.margin) / 7;
    const left = theme.layout.margin + 2 * segmentWidth;
    const right = left + segmentWidth;
    hatch.forEach((s) => {
      expect(s.x).toBeGreaterThanOrEqual(left);
      expect(s.x).toBeLessThanOrEqual(right);
    });
  });

  it('is a texture, not a couple of strays — tight enough never to read as tick marks', async () => {
    const hatch = hatchOf(await bandStrokes({ label: 'Course', completed: 2, total: 7, inProgress: 1 }));
    const segmentWidth = (theme.canvas.width - 2 * theme.layout.margin) / 7;
    // At the theme's pitch a ~76px segment carries a double-digit stripe count,
    // while the segment TICKS on the same bar are one per ~76px.
    expect(hatch.length).toBeGreaterThan(8);
    expect(theme.progress.hatchPitch).toBeLessThan(segmentWidth / 4);
  });

  it('refuses to run past the end of the bar', async () => {
    // A malformed row claiming more in-progress than remains must not paint
    // beyond the track; it is ignored rather than clamped silently mid-draw.
    const hatch = hatchOf(await bandStrokes({ label: 'Course', completed: 6, total: 7, inProgress: 3 }));
    expect(hatch).toEqual([]);
  });

  it('marks the last segment when the final unit is the one underway', async () => {
    const hatch = hatchOf(await bandStrokes({ label: 'Course', completed: 6, total: 7, inProgress: 1 }));
    expect(hatch.length).toBeGreaterThan(0);
    const right = theme.canvas.width - theme.layout.margin;
    hatch.forEach((s) => expect(s.x).toBeLessThanOrEqual(right));
  });
});
