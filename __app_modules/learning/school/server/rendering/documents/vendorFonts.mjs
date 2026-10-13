/**
 * Third-party fonts that live on the media volume (`media/vendor/fonts`,
 * installed by `npm run install:assets`) rather than in the repo.
 *
 * A theme font entry carries `root: 'vendor'` to say so. Everything else keeps
 * resolving against the bundled `__backend/assets/fonts` directory.
 *
 * The directory is injected, never hard-coded: composition derives it from the
 * same media dir the `/vendor` route serves (`vendorDirFor(mediaDir)`) and
 * either passes `vendorFontDir` to a renderer or sets the process default here.
 *
 * @module rendering/school/documents/vendorFonts
 */
import { fileExists } from '#system/utils/FileIO.mjs';
import { join } from 'node:path';
import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({ source: 'backend', app: 'school', context: { component: 'vendor-fonts' } });

/** A vendor font a document needs is not installed on the media volume. */
export class MissingVendorAssetError extends Error {
  constructor(file, dir) {
    super(
      `Vendor font '${file}' is not installed${dir ? ` (looked in ${dir})` : ' (no vendor font directory configured)'}. `
      + 'Korean (Hangul) text cannot render without it. Run `npm run install:assets`.',
    );
    this.name = 'MissingVendorAssetError';
    this.file = file;
    this.dir = dir ?? null;
  }
}

/** Hangul Jamo, Compatibility Jamo, Syllables — what Noto Sans KR is for. */
export const HANGUL_PATTERN = /[ᄀ-ᇿ㄰-㆏가-힯]/;

let defaultVendorFontDir = null;
const warned = new Set();

/** Composition sets this once from the configured media dir. */
export function setDefaultVendorFontDir(dir) {
  defaultVendorFontDir = dir || null;
}
export function getDefaultVendorFontDir() {
  return defaultVendorFontDir;
}

/** `<mediaDir>/vendor/fonts`: the `/vendor` route's dir (vendorApi.mjs vendorDirFor) plus `fonts`; mediaDir is ConfigService.getMediaDir(). */
export const vendorFontDirFor = (mediaDir) => join(mediaDir, 'vendor', 'fonts');

/**
 * Resolve a vendor font file. Returns `{ path, missing }`; a missing file is
 * logged once (warn) and left to the caller to fail at the point of use.
 */
export function resolveVendorFont(file, vendorFontDir = defaultVendorFontDir) {
  const path = vendorFontDir ? join(vendorFontDir, file) : null;
  const missing = !path || !fileExists(path);
  if (missing && !warned.has(file)) {
    warned.add(file);
    logger.warn('school.vendor-font.missing', {
      file, dir: vendorFontDir ?? null, fix: 'npm run install:assets',
    });
  }
  return { path, missing };
}

/** Test seam: forget which fonts were already warned about. */
export function resetVendorFontWarnings() { warned.clear(); }
