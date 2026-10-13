/**
 * Test-only: a temp media dir whose `vendor/fonts/noto-sans-kr/NotoSansKR-Regular.otf`
 * is a committed stand-in face (Roboto Condensed Regular), so unit tests can
 * exercise the Hangul wiring without the real 4.5 MB Noto Sans KR. A PDF that
 * routes a Hangul run to the vendor face embeds `RobotoCondensed-Regular`
 * (the workbook theme uses Atkinson for everything else).
 *
 * The real font is asserted by tests/live/adapter/korean-font-installed.test.mjs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorFontDirFor } from "../../../__app_modules/learning/school/server/rendering/documents/vendorFonts.mjs";

const STAND_IN = fileURLToPath(new URL('../../../__backend/assets/fonts/roboto-condensed/RobotoCondensed-Regular.ttf', import.meta.url));

export function makeStandInVendorFontDir() {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-font-standin-'));
  const dir = vendorFontDirFor(mediaDir);
  fs.mkdirSync(path.join(dir, 'noto-sans-kr'), { recursive: true });
  fs.copyFileSync(STAND_IN, path.join(dir, 'noto-sans-kr', 'NotoSansKR-Regular.otf'));
  return dir;
}
