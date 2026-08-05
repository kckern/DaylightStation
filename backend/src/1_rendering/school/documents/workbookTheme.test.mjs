import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbookTheme, WORKBOOK_TYPE_SCALES, WORKBOOK_DENSITIES } from './workbookTheme.mjs';
import { createMeasurementDocument } from './measure.mjs';

const FONT_DIR = fileURLToPath(new URL('../../../../assets/fonts', import.meta.url));

describe('workbookTheme', () => {
  it('ships all four Atkinson Hyperlegible faces plus the OFL license', () => {
    const dir = path.join(FONT_DIR, 'atkinson-hyperlegible');
    for (const file of ['AtkinsonHyperlegible-Regular.ttf', 'AtkinsonHyperlegible-Bold.ttf',
      'AtkinsonHyperlegible-Italic.ttf', 'AtkinsonHyperlegible-BoldItalic.ttf', 'OFL.txt']) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
  });

  it('produces a structurally theme-compatible frozen object with four font styles', () => {
    const theme = createWorkbookTheme();
    expect(Object.isFrozen(theme)).toBe(true);
    for (const key of ['page', 'ink', 'fonts', 'styles', 'spacing', 'furniture']) expect(theme[key], key).toBeDefined();
    for (const style of ['regular', 'bold', 'italic', 'boldItalic']) {
      expect(theme.fonts[style]?.name, style).toMatch(/^workbook-/);
      expect(theme.fonts[style]?.file).toMatch(/^atkinson-hyperlegible\//);
    }
    expect(theme.page.widthPt).toBe(612); // US Letter stays
  });

  it('registers its fonts in a real pdfkit measurement document', () => {
    const doc = createMeasurementDocument({ theme: createWorkbookTheme() });
    expect(() => doc.font('workbook-italic')).not.toThrow();
  });

  it('young scale is larger than standard; compact density is tighter than normal', () => {
    const std = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const young = createWorkbookTheme({ typeScale: 'young', density: 'normal' });
    const compact = createWorkbookTheme({ typeScale: 'standard', density: 'compact' });
    for (const key of Object.keys(std.styles)) {
      expect(young.styles[key].sizePt, `${key}.sizePt`).toBeGreaterThan(std.styles[key].sizePt);
      expect(young.styles[key].leadingPt, `${key}.leadingPt`).toBeGreaterThan(std.styles[key].leadingPt);
    }
    const someGap = (t) => Object.values(t.spacing)[0];
    expect(JSON.stringify(compact.spacing)).not.toBe(JSON.stringify(std.spacing));
    expect(someGap(compact)).toBeDefined();
  });

  it('carries a `question` style — prose measured inside a question fragment — matching `body`’s size/leading but tagged spacingClass "question"', () => {
    // measureNodes' bodyStyleKey defaults to 'question' for text inside a
    // question block (measure.mjs questionFragment); without this key any v2
    // document containing a `question` — the whole point of the `quiz`/
    // `worksheet` archetypes — throws measuring against this theme.
    const theme = createWorkbookTheme();
    expect(theme.styles.question).toBeDefined();
    expect(theme.styles.question.sizePt).toBe(theme.styles.body.sizePt);
    expect(theme.styles.question.leadingPt).toBe(theme.styles.body.leadingPt);
    expect(theme.styles.question.spacingClass).toBe('question');
  });

  it('carries `answerSpace` ruled-line geometry — DocumentPdfRenderer’s drawAnswerSpace destructures it unconditionally', () => {
    // Any document with an `answer_space` block (virtually every worksheet/
    // quiz) throws drawing against this theme without it.
    const theme = createWorkbookTheme();
    expect(theme.answerSpace).toBeDefined();
    for (const key of ['rulePitchPt', 'ruleWidthPt', 'ruleInsetPt', 'padAbovePt']) {
      expect(typeof theme.answerSpace[key], key).toBe('number');
    }
  });

  it('rejects unknown presets', () => {
    expect(() => createWorkbookTheme({ typeScale: 'giant' })).toThrow(/typeScale/);
    expect(() => createWorkbookTheme({ density: 'sardine' })).toThrow(/density/);
  });

  it('leaves the legacy theme and its goldens alone', async () => {
    const { documentPdfTheme } = await import('./documentPdfTheme.mjs');
    expect(documentPdfTheme.fonts.regular.file).toMatch(/roboto-condensed/);
  });
});
