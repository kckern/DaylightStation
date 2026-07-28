/**
 * OPTICAL VERIFICATION — is the ink where the record says it is?
 *
 * THE GAP THIS CLOSES
 *   `DocumentPdfRenderer` draws each OMR bubble and records its centre and
 *   radius in the same statement; `VirtualOmrReader` grades against that record.
 *   Writer and reader share one number, so nothing in the suite could tell the
 *   difference between "the geometry is right" and "the geometry is wrong in the
 *   same way on both sides". The form-map golden pins the RECORDED numbers, not
 *   the ink. A real scanner reading real paper does not consult the form map,
 *   and a bubble printed 3pt from where it was recorded marks a child's right
 *   answer wrong.
 *
 *   The same blind spot covered the QR: `codeMap` reports what the draw loop
 *   emitted, and until this file nothing had decoded the printed symbol with
 *   something that did not draw it.
 *
 * HOW
 *   The real curriculum fixture is rendered, rasterized at 300dpi, and then
 *   MEASURED: bubbles are located by finding the holes ink encloses and fitting
 *   a circle to the surrounding rim at sub-pixel resolution, and the symbol is
 *   located by its finder patterns and decoded module by module. Neither reads
 *   the renderer's output structures. See `#testlib/school/opticalScan.mjs` and
 *   `#testlib/school/qrDecode.mjs`.
 *
 * NO SKIPS
 *   Missing `pdftoppm` throws with install instructions. A suite that skips
 *   itself here would report green while checking the one thing nothing else
 *   checks.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import {
  OPTICAL_DPI, CENTRE_TOLERANCE_PT, RADIUS_TOLERANCE_PT, CIRCLE_RESIDUAL_TOLERANCE_PT,
  rasterizeForOptics, measurePrintedMarks, decodePrintedCodes, checkPrintedMarks,
} from '#testlib/school/opticalHarness.mjs';
import { pxToPt } from '#testlib/school/opticalScan.mjs';
import { requirePdftoppm } from '#testlib/school/rasterize.mjs';
import { documentPdfTheme } from '#rendering/school/documents/documentPdfTheme.mjs';
import { GOLDEN_CASES, renderCase, createGoldenRenderer } from './golden/goldenHarness.mjs';

const OMR_CASE = GOLDEN_CASES.find((c) => c.formMapSnapshot);

/** A token shaped like a real one: the `sch:` prefix plus 16 charset characters. */
const REALISTIC_TOKEN = 'sch:9F3KMNPQ2RSTUVWX';

const codeDocument = () => ({
  id: 'optical-code-doc',
  seed: 1,
  target: ['letter'],
  blocks: [
    { type: 'rich_text', md: 'Do the work, then scan below.' },
    { type: 'scan_action', action: 'recovery', label: 'Scan for another copy' },
  ],
});

describe('optical: printed bubbles agree with the recorded form map', () => {
  let rendered;
  let pageImages;
  let measured;

  beforeAll(async () => {
    requirePdftoppm();
    rendered = await renderCase(OMR_CASE);
    pageImages = await rasterizeForOptics(rendered.pdf, 'omr-optical');
    measured = measurePrintedMarks(pageImages, rendered.formMap);
  }, 120000);

  it('rasterizes the fixture at optical density', () => {
    expect(OPTICAL_DPI).toBe(300);
    expect(pageImages).toHaveLength(rendered.pageCount);
    for (const page of pageImages) {
      expect(page.width).toBe(Math.round((612 * OPTICAL_DPI) / 72));
      expect(page.height).toBe(Math.round((792 * OPTICAL_DPI) / 72));
    }
  });

  it('finds exactly as many printed circles as the form map records, page by page', () => {
    // Bidirectional on purpose. Too few means a recorded bubble was never
    // printed; too many means the page carries a bubble nothing will grade.
    // The detector's size band is 3pt–11pt radius, so a bubble printed at the
    // wrong size goes missing here rather than being quietly accepted.
    expect(rendered.formMap.marks).toHaveLength(24);
    expect(measured.perPage).toEqual([
      { page: 1, detected: 20, recorded: 20 },
      { page: 2, detected: 4, recorded: 4 },
    ]);
  });

  it('has real ink at every recorded centre, within a fraction of a bubble radius', () => {
    const offenders = measured.matches
      .filter((m) => m.deviationPt > CENTRE_TOLERANCE_PT)
      .map((m) => `${m.mark.itemId}/${m.mark.choice} off by ${m.deviationPt.toFixed(4)}pt`);
    expect(offenders).toEqual([]);
    // The tolerance is 0.8% of the 6.5pt bubble radius. Reporting the worst
    // case makes a drift toward the limit visible long before it fails.
    expect(measured.worstDeviationPt).toBeLessThanOrEqual(CENTRE_TOLERANCE_PT);
    expect(CENTRE_TOLERANCE_PT).toBeLessThan(0.05 * 6.5);
  });

  it('prints each bubble at the radius it recorded', () => {
    const offenders = measured.matches
      .filter((m) => m.radiusDeviationPt > RADIUS_TOLERANCE_PT)
      .map((m) => `${m.mark.itemId}/${m.mark.choice}: printed ${m.circle.rPt.toFixed(4)}pt vs recorded ${m.mark.rPt}pt`);
    expect(offenders).toEqual([]);
    expect(measured.worstRadiusDeviationPt).toBeLessThanOrEqual(RADIUS_TOLERANCE_PT);
  });

  it('measured circles, not smudges', () => {
    // A high fit residual would mean the ring the rays found was not round —
    // i.e. the measurement latched onto something that is not a bubble, and the
    // agreement above would be meaningless.
    expect(measured.worstResidualPt).toBeLessThanOrEqual(CIRCLE_RESIDUAL_TOLERANCE_PT);
    for (const match of measured.matches) {
      expect(match.circle.rays, `${match.mark.itemId}/${match.mark.choice} rim is not closed`).toBeGreaterThan(700);
    }
  });

  it('reports the measured agreement as a number, not a verdict', () => {
    // Recorded against printed, worst case over all 24 marks. If this ever
    // climbs off the floor it is a real finding about the renderer, not a
    // reason to widen a tolerance.
    expect(measured.worstDeviationPt).toBeLessThan(0.01);
    expect(checkPrintedMarks(pageImages, rendered.formMap).failures).toEqual([]);
  });

  it('goes red when a recorded centre is moved off the ink', () => {
    // The proof that the check above can fail. A 3pt offset is the same defect
    // the sabotage suite injects into the renderer; here it is applied to the
    // record so the mechanism is exercised without a module swap.
    const sabotaged = {
      ...rendered.formMap,
      marks: rendered.formMap.marks.map((mark, index) => (index === 7 ? { ...mark, xPt: mark.xPt + 3 } : mark)),
    };
    const { failures } = checkPrintedMarks(pageImages, sabotaged);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(' ')).toMatch(/recorded centre .* but the ink is at/);
  });

  it('goes red when a recorded radius does not match the printed rim', () => {
    const sabotaged = {
      ...rendered.formMap,
      marks: rendered.formMap.marks.map((mark, index) => (index === 3 ? { ...mark, rPt: mark.rPt + 1 } : mark)),
    };
    const { failures } = checkPrintedMarks(pageImages, sabotaged);
    expect(failures.join(' ')).toMatch(/printed rim measures/);
  });
});

describe('optical: the printed QR decodes to the token it was handed', () => {
  let rendered;
  let pageImages;
  let decoded;

  beforeAll(async () => {
    requirePdftoppm();
    rendered = await renderCase(OMR_CASE);
    pageImages = await rasterizeForOptics(rendered.pdf, 'omr-optical-qr');
    decoded = decodePrintedCodes(pageImages);
  }, 120000);

  it('finds a symbol on exactly the pages codeMap claims one', () => {
    const claimed = new Set(rendered.codeMap.map((c) => c.page));
    const found = new Set(decoded.filter((d) => d.symbols.length > 0).map((d) => d.page));
    expect([...found].sort()).toEqual([...claimed].sort());
    expect(claimed.size).toBeGreaterThan(0);
  });

  it('decodes the fixture symbol with a decoder that did not draw it', () => {
    const symbols = decoded.flatMap((d) => d.symbols);
    expect(symbols).toHaveLength(rendered.codeMap.length);
    expect(symbols[0].text).toBe(rendered.codeMap[0].text);
    expect(symbols[0].moduleCount).toBe(rendered.codeMap[0].moduleCount);
    expect(symbols[0].darkModules).toBe(rendered.codeMap[0].darkModules);
    // Both format-information copies read as the same valid BCH codeword: the
    // grid was sampled in register, not by luck.
    expect(symbols[0].formatCopiesAgree).toBe(true);
    expect(symbols[0].formatDistance).toBe(0);
    expect(symbols[0].ecLevel).toBe('M');
  });

  it('prints the symbol at the position and size codeMap reports', () => {
    // The payload check above would pass for a symbol printed in the wrong
    // place or at the wrong scale. This is the bubble check applied to the
    // code: measured ink against the record, in points.
    const [symbol] = decoded.flatMap((d) => d.symbols);
    const [code] = rendered.codeMap;
    const quiet = documentPdfTheme.action.qrQuietModules;
    const modulePt = code.sizePt / (code.moduleCount + 2 * quiet);
    const expectedOriginXPt = code.xPt + quiet * modulePt;
    const expectedOriginYPt = code.yPt + quiet * modulePt;

    // Half a module: the grid is pinned to a thresholded edge, so a whole
    // module of drift is the smallest error that could mean anything.
    const tolerancePt = modulePt / 2;
    expect(Math.abs(pxToPt(symbol.originXPx, OPTICAL_DPI) - expectedOriginXPt)).toBeLessThan(tolerancePt);
    expect(Math.abs(pxToPt(symbol.originYPx, OPTICAL_DPI) - expectedOriginYPt)).toBeLessThan(tolerancePt);
    expect(Math.abs((symbol.modulePx * 72) / OPTICAL_DPI - modulePt)).toBeLessThan(modulePt * 0.02);
  });
});

describe('optical: the printed QR decodes across the payloads School mints', () => {
  const cases = [
    { label: 'a realistic minted token', token: REALISTIC_TOKEN },
    { label: 'a short byte payload', token: 'sch:ABC123' },
    { label: 'a payload wide enough to need two error-correction blocks', token: `sch:${'ABCDEFGH'.repeat(9)}` },
  ];

  for (const { label, token } of cases) {
    it(`decodes ${label}`, async () => {
      requirePdftoppm();
      const out = await createGoldenRenderer().render(codeDocument(), { tokens: { recovery: token } });
      const pageImages = await rasterizeForOptics(out.pdf, 'code-optical');
      const symbols = decodePrintedCodes(pageImages).flatMap((d) => d.symbols);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].text).toBe(token);
      expect(symbols[0].text).toBe(out.codeMap[0].text);
    }, 120000);
  }

  it('does not decode one token as another', async () => {
    requirePdftoppm();
    const out = await createGoldenRenderer().render(codeDocument(), { tokens: { recovery: 'sch:AAAA1111BBBB2222' } });
    const pageImages = await rasterizeForOptics(out.pdf, 'code-optical-other');
    const [symbol] = decodePrintedCodes(pageImages).flatMap((d) => d.symbols);
    expect(symbol.text).not.toBe(REALISTIC_TOKEN);
    expect(symbol.text).toBe('sch:AAAA1111BBBB2222');
  }, 120000);

  it('finds no symbol on a document with no scannable ticket', async () => {
    requirePdftoppm();
    const plain = { id: 'optical-plain', seed: 1, target: ['letter'], blocks: [{ type: 'rich_text', md: 'No code here.' }] };
    const out = await createGoldenRenderer().render(plain);
    expect(out.codeMap).toEqual([]);
    const pageImages = await rasterizeForOptics(out.pdf, 'code-optical-plain');
    expect(decodePrintedCodes(pageImages).flatMap((d) => d.symbols)).toEqual([]);
  }, 120000);
});
