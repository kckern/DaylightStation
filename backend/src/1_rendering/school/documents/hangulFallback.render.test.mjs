import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { SCRIPT_FALLBACKS, createMeasurementDocument, measureDocumentFragments, withScriptFont } from './measure.mjs';
import { documentPdfTheme } from './documentPdfTheme.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const FONTS = fileURLToPath(new URL('../../../../assets/fonts', import.meta.url));
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
    const [, body] = measureDocumentFragments(doc, { doc: createMeasurementDocument({ theme }), theme, texToSvg });
    const runs = body.lines?.flatMap((line) => line.runs) ?? body.nodes.flatMap((node) => node.lines ?? []).flatMap((line) => line.runs);
    expect(runs.length).toBeGreaterThan(0);
    const hangulRuns = runs.filter((run) => /[가-힣]/.test(run.text));
    const latinRuns = runs.filter((run) => /^[A-Za-z?]+$/.test(run.text));
    expect(hangulRuns.length).toBeGreaterThan(0);
    expect(latinRuns.length).toBeGreaterThan(0);
    expect(hangulRuns.every((run) => run.font === 'hangul')).toBe(true);
    expect(latinRuns.every((run) => run.font !== 'hangul')).toBe(true);
  });
  it('the house font has no Hangul glyph; Noto Sans KR has every one the lexicon uses', () => {
    const atkinson = fontkit.openSync(path.join(FONTS, 'atkinson-hyperlegible/AtkinsonHyperlegible-Regular.ttf'));
    const noto = fontkit.openSync(path.join(FONTS, 'noto-sans-kr/NotoSansKR-Regular.otf'));
    expect(atkinson.glyphForCodePoint('가'.codePointAt(0)).id).toBe(0);
    for (const ch of '안녕하세요히계선생님친구들이름뭐예가위풀책지우개바인더종색연필간식한국학교') {
      expect(noto.glyphForCodePoint(ch.codePointAt(0)).id, ch).not.toBe(0);
    }
  });
  it('embeds Noto Sans KR in a real PDF render', async () => {
    const renderer = createDocumentPdfRenderer({ theme, texToSvg });
    const { pdf } = await renderer.render(doc, { studentName: 'Learner' });
    expect(pdf.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansKR-Regular/);
  });
});
