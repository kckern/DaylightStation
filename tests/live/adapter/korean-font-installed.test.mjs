/**
 * Noto Sans KR is installed on the media volume and really embeds in Korean documents.
 *
 * The font is a third-party asset (media/vendor/fonts/noto-sans-kr, installed by
 * `npm run install:assets`), so this needs the REAL media mount and lives in the
 * live tier. Fails — never skips — when it is absent, naming the fix.
 *
 * Usage: DAYLIGHT_MEDIA_PATH=<media> NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/_infrastructure/config/jest.config.cjs tests/live/adapter/korean-font-installed.test.mjs
 */
import { describe, it, expect } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runEsm, repoUrl } from './nativeEsm.mjs';

const media = process.env.DAYLIGHT_MEDIA_PATH
  || (process.env.DAYLIGHT_BASE_PATH ? join(process.env.DAYLIGHT_BASE_PATH, 'media') : null);
const vendorFontDir = media && join(media, 'vendor', 'fonts');
const fontPath = vendorFontDir && join(vendorFontDir, 'noto-sans-kr/NotoSansKR-Regular.otf');
const fix = 'run `npm run install:assets` (set DAYLIGHT_MEDIA_PATH)';
const LEXICON_CHARS = '안녕하세요히계선생님친구들이름뭐예가위풀책지우개바인더종색연필간식한국학교비둘기';
const docs = '__app_modules/learning/school/server/rendering/documents';

// Each snippet runs in native Node ESM (see nativeEsm.mjs) and throws on failure.
const run = (body) => runEsm(`
import * as fontkit from 'fontkit';
import { vendorFontDirFor } from '${repoUrl(`${docs}/vendorFonts.mjs`)}';
import { createDocumentPdfRenderer } from '${repoUrl(`${docs}/DocumentPdfRenderer.mjs`)}';
import { createDocumentReceiptRenderer } from '${repoUrl(`${docs}/DocumentReceiptRenderer.mjs`)}';
import { createWorkbookTheme } from '${repoUrl(`${docs}/workbookTheme.mjs`)}';
import { texToSvg } from '${repoUrl(`${docs}/mathSvg.mjs`)}';
const vendorFontDir = vendorFontDirFor(${JSON.stringify(media)});
const fontPath = ${JSON.stringify(fontPath)};
${body}`);

describe('Noto Sans KR installed under media/vendor', () => {
  it('the font file is present', () => {
    expect(media).toBeTruthy();
    expect(existsSync(fontPath)).toBe(true);
  });
  it('covers every Hangul character the lexicons use', () => {
    expect(() => run(`
const noto = fontkit.openSync(fontPath);
for (const ch of ${JSON.stringify(LEXICON_CHARS)}) if (noto.glyphForCodePoint(ch.codePointAt(0)).id === 0) throw new Error('no glyph for ' + ch);`)).not.toThrow();
  });
  it('embeds in a real Korean PDF', () => {
    expect(() => run(`
const renderer = createDocumentPdfRenderer({ theme: createWorkbookTheme({ typeScale: 'young' }), texToSvg, vendorFontDir });
const { pdf } = await renderer.render({ id: 'k', title: 'Korean', seed: 1, variant: 0, target: ['letter'],
  blocks: [{ type: 'rich_text', md: 'What does **가위** mean?' }] }, { studentName: 'Learner' });
if (!/\\/BaseFont \\/[A-Z]{6}\\+NotoSansKR-Regular/.test(pdf.toString('latin1'))) throw new Error('NotoSansKR not embedded');`)).not.toThrow();
  });
  it('draws on the receipt canvas', () => {
    expect(() => run(`
const { height } = await createDocumentReceiptRenderer({ vendorFontDir }).createCanvas({ id: 'k', title: 'UBKS 비둘기', blocks: [] }, { tokens: {} });
if (!(height > 0)) throw new Error('empty receipt canvas');`)).not.toThrow();
  });
});
