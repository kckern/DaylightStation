/**
 * Noto Sans KR is installed on the media volume and really embeds in Korean documents.
 *
 * The font is a third-party asset (media/vendor/fonts/noto-sans-kr, installed by
 * `npm run install:assets`), so this needs the REAL media mount and lives in the
 * live tier. Fails — never skips — when it is absent, naming the fix.
 *
 * Usage: DAYLIGHT_MEDIA_PATH=<media> npx vitest run --config tests/_infrastructure/config/vitest.config.mjs tests/live/adapter/korean-font-installed.test.mjs
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { vendorFontDirFor } from '../../../__app_modules/learning/school/server/rendering/documents/vendorFonts.mjs';
import { createDocumentPdfRenderer } from '../../../__app_modules/learning/school/server/rendering/documents/DocumentPdfRenderer.mjs';
import { createDocumentReceiptRenderer } from '../../../__app_modules/learning/school/server/rendering/documents/DocumentReceiptRenderer.mjs';
import { createWorkbookTheme } from '../../../__app_modules/learning/school/server/rendering/documents/workbookTheme.mjs';
import { texToSvg } from '../../../__app_modules/learning/school/server/rendering/documents/mathSvg.mjs';

const media = process.env.DAYLIGHT_MEDIA_PATH
  || (process.env.DAYLIGHT_BASE_PATH ? join(process.env.DAYLIGHT_BASE_PATH, 'media') : null);
const vendorFontDir = media && vendorFontDirFor(media);
const fontPath = vendorFontDir && join(vendorFontDir, 'noto-sans-kr/NotoSansKR-Regular.otf');
const fix = 'run `npm run install:assets` (set DAYLIGHT_MEDIA_PATH)';
const LEXICON_CHARS = '안녕하세요히계선생님친구들이름뭐예가위풀책지우개바인더종색연필간식한국학교비둘기';

describe('Noto Sans KR installed under media/vendor', () => {
  it('the font file is present', () => {
    expect(media, `DAYLIGHT_MEDIA_PATH is not set — ${fix}`).toBeTruthy();
    expect(existsSync(fontPath), `${fontPath} is absent — ${fix}`).toBe(true);
  });
  it('covers every Hangul character the lexicons use', () => {
    expect(existsSync(fontPath), `${fontPath} is absent — ${fix}`).toBe(true);
    const noto = fontkit.openSync(fontPath);
    for (const ch of LEXICON_CHARS) expect(noto.glyphForCodePoint(ch.codePointAt(0)).id, ch).not.toBe(0);
  });
  it('embeds in a real Korean PDF', async () => {
    expect(existsSync(fontPath), `${fontPath} is absent — ${fix}`).toBe(true);
    const renderer = createDocumentPdfRenderer({ theme: createWorkbookTheme({ typeScale: 'young' }), texToSvg, vendorFontDir });
    const { pdf } = await renderer.render({
      id: 'k', title: 'Korean', seed: 1, variant: 0, target: ['letter'],
      blocks: [{ type: 'rich_text', md: 'What does **가위** mean?' }],
    }, { studentName: 'Learner' });
    expect(pdf.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansKR-Regular/);
  });
  it('draws on the receipt canvas', async () => {
    expect(existsSync(fontPath), `${fontPath} is absent — ${fix}`).toBe(true);
    const { height } = await createDocumentReceiptRenderer({ vendorFontDir })
      .createCanvas({ id: 'k', title: 'UBKS 비둘기', blocks: [] }, { tokens: {} });
    expect(height).toBeGreaterThan(0);
  });
});
