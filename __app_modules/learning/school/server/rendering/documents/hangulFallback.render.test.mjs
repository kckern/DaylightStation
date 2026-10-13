import { describe, expect, it } from 'vitest';
import { createDocumentPdfRenderer } from "./DocumentPdfRenderer.mjs";
import { SCRIPT_FALLBACKS, createMeasurementDocument, measureDocumentFragments, withScriptFont } from "./measure.mjs";
import { documentPdfTheme } from "./documentPdfTheme.mjs";
import { createWorkbookTheme } from "./workbookTheme.mjs";
import { texToSvg } from "./mathSvg.mjs";
import { makeStandInVendorFontDir } from "../../../../../../tests/_lib/school/vendorFontStandIn.mjs";

const theme = createWorkbookTheme({ typeScale: 'young' });

const doc = {
  id: 'hangul-fallback', title: 'Korean check', seed: 1, variant: 0, target: ['letter'],
  blocks: [{ type: 'rich_text', md: 'What does **가위** mean? **안녕하세요**' }],
};

describe('script fallback table', () => {
  it('every fallback names a face every theme defines, keyed by script', () => {
    expect(SCRIPT_FALLBACKS.map((row) => row.script)).toContain('hangul');
    for (const row of SCRIPT_FALLBACKS) {
      expect(theme.fonts[row.fontKey]?.file, row.script).toBeTruthy();
      expect(documentPdfTheme.fonts[row.fontKey]?.file, row.script).toBeTruthy();
    }
  });
});

describe('Hangul font fallback', () => {
  it('sets any run containing Hangul in the hangul face and leaves Latin runs alone', () => {
    expect(withScriptFont({ text: '가위', font: 'bold' })).toEqual({ text: '가위', font: 'hangul' });
    expect(withScriptFont({ text: 'What does', font: 'regular' })).toEqual({ text: 'What does', font: 'regular' });
    const [, body] = measureDocumentFragments(doc, { doc: createMeasurementDocument({ theme, vendorFontDir: makeStandInVendorFontDir() }), theme, texToSvg });
    const runs = body.lines?.flatMap((line) => line.runs) ?? body.nodes.flatMap((node) => node.lines ?? []).flatMap((line) => line.runs);
    expect(runs.length).toBeGreaterThan(0);
    const hangulRuns = runs.filter((run) => /[가-힣]/.test(run.text));
    const latinRuns = runs.filter((run) => /^[A-Za-z?]+$/.test(run.text));
    expect(hangulRuns.length).toBeGreaterThan(0);
    expect(latinRuns.length).toBeGreaterThan(0);
    expect(hangulRuns.every((run) => run.font === 'hangul')).toBe(true);
    expect(latinRuns.every((run) => run.font !== 'hangul')).toBe(true);
  });
  it('routes Hangul runs to the vendor font file in a real PDF render', async () => {
    // Stand-in face: the real Noto Sans KR is on the media volume and is asserted by
    // tests/live/adapter/korean-font-installed.test.mjs.
    const renderer = createDocumentPdfRenderer({ theme, texToSvg, vendorFontDir: makeStandInVendorFontDir() });
    const { pdf } = await renderer.render(doc, { studentName: 'Learner' });
    expect(pdf.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+RobotoCondensed-Regular/);
  });
});
