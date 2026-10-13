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
import { fileExists, dirExists, readTextFromPath } from '#system/utils/FileIO.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
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
let lazyResolver = null;
const warned = new Set();

/** Composition sets this once from the configured media dir. */
export function setDefaultVendorFontDir(dir) {
  defaultVendorFontDir = dir || null;
  if (dir) lazyResolver = null;
}
/** The explicit default, else (CLI runs) the env-resolved dir, computed at first use. */
export function getDefaultVendorFontDir() {
  if (!defaultVendorFontDir && lazyResolver) defaultVendorFontDir = lazyResolver() ?? null;
  return defaultVendorFontDir;
}

/** `<mediaDir>/vendor/fonts`: the `/vendor` route's dir (vendorApi.mjs vendorDirFor) plus `fonts`; mediaDir is ConfigService.getMediaDir(). */
export const vendorFontDirFor = (mediaDir) => (mediaDir ? join(mediaDir, 'vendor', 'fonts') : null);

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));

/**
 * Vendor font dir for a CLI run (no composition, no ConfigService, and possibly
 * no dotenv yet or no env at all inside the container). Same media dir
 * install:assets and the backend use. Order: DAYLIGHT_MEDIA_PATH, then
 * DAYLIGHT_BASE_PATH/media (shell env, then a `.env` in cwd or the repo root),
 * then `<cwd>/media` when it holds vendor/fonts (the container's /usr/src/app).
 */
export function vendorFontDirFromEnv({
  env = process.env, cwd = process.cwd(), envFiles = [join(cwd, '.env'), join(REPO_ROOT, '.env')],
} = {}) {
  const fromFiles = {};
  for (const file of [...envFiles].reverse()) {
    try { if (fileExists(file)) Object.assign(fromFiles, dotenv.parse(readTextFromPath(file))); } catch { /* unreadable .env: ignore */ }
  }
  const get = (key) => env[key] || fromFiles[key] || null;
  const media = get('DAYLIGHT_MEDIA_PATH') || (get('DAYLIGHT_BASE_PATH') ? join(get('DAYLIGHT_BASE_PATH'), 'media') : null);
  if (media) return vendorFontDirFor(media);
  const local = vendorFontDirFor(join(cwd, 'media'));
  return dirExists(local) ? local : null;
}

/** CLI entry points call this at import; the env is only read at first use, after any dotenv.config(). */
export function enableEnvVendorFontDir(opts) {
  lazyResolver = () => vendorFontDirFromEnv(opts);
  defaultVendorFontDir = null;
}

/**
 * Resolve a vendor font file. Returns `{ path, missing }`; a missing file is
 * logged once (warn) and left to the caller to fail at the point of use.
 */
export function resolveVendorFont(file, vendorFontDir = getDefaultVendorFontDir()) {
  const path = vendorFontDir ? join(vendorFontDir, file) : null;
  const missing = !path || !fileExists(path);
  const key = `${vendorFontDir ?? ''}::${file}`;
  if (missing && !warned.has(key)) {
    warned.add(key);
    logger.warn('school.vendor-font.missing', {
      file, dir: vendorFontDir ?? null, fix: 'npm run install:assets',
    });
  }
  return { path, missing };
}

export const warnedKeys = () => [...warned];

/** Test seam: forget which fonts were already warned about. */
export function resetVendorFontWarnings() { warned.clear(); }
