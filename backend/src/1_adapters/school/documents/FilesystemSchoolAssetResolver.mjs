/**
 * Turn an `asset` block's `ref` into artwork the PDF renderer can draw.
 *
 * A document says `ref: school/math/fraction-strips` and nothing else; where
 * that lives is deployment knowledge, which is why the renderer takes a
 * `resolveAsset` function rather than a path. This is the one that reads SVGs
 * off the data dir, and the composition root wires it.
 *
 * THREE THINGS IT IS CAREFUL ABOUT:
 *
 *  1. **It is synchronous.** `measure.mjs` calls the resolver inside the
 *     measurement pass, which is not async and cannot be made async without
 *     rewriting layout. So this reads with `readFileSync` and caches — a
 *     worksheet reprints often, and the same diagram should not be re-read and
 *     re-parsed every time.
 *  2. **A ref cannot escape the asset root.** Refs come from curriculum YAML,
 *     which a parent edits by hand; `../../../auth/plex.yml` must resolve to
 *     nothing rather than to a secret. The pattern is a whitelist of slug
 *     segments, and the resolved path is re-checked against the root.
 *  3. **A missing asset resolves to `null`, never to a blank.** The renderer
 *     turns that into `UnresolvedAssetError` and refuses to print, because an
 *     empty rectangle where the diagram should be is a child being asked about
 *     a picture that is not on the page. Distinguishing "no artwork" from "no
 *     resolver at all" is what lets `IssueDocument` say which one happened.
 *
 * @module adapters/school/documents/FilesystemSchoolAssetResolver
 */
import path from 'path';
import { fileURLToPath } from 'node:url';
import { readTextFromPath } from '#system/utils/FileIO.mjs';

/**
 * Slug segments only: lowercase, digits, hyphen, underscore, separated by `/`.
 * No dots at all, so `..` is unrepresentable rather than merely filtered.
 */
const REF_PATTERN = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;

/** Point size of an SVG with no intrinsic dimensions we could read. */
const FALLBACK_WIDTH_PT = 400;
const FALLBACK_HEIGHT_PT = 200;
const UNSAFE_SVG = /<\s*(?:script|foreignObject|image)\b|\son[a-z]+\s*=|\s(?:href|xlink:href)\s*=|url\s*\(/iu;

/**
 * The drawn size of an SVG, in points.
 *
 * `viewBox` is preferred over `width`/`height`: it is the coordinate system the
 * paths are actually in, and an SVG whose width says `100%` has no usable
 * number at all. Units are treated as points, which is right for `pt`, right
 * enough for `px` at the 1:1 scale svg-to-pdfkit uses, and never worse than the
 * fallback — the renderer scales to the column width regardless.
 *
 * @param {string} svg
 * @returns {{widthPt: number, heightPt: number}}
 */
export function svgDimensions(svg) {
  const viewBox = /viewBox\s*=\s*["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)\s*["']/.exec(svg);
  if (viewBox) {
    const widthPt = Number(viewBox[3]);
    const heightPt = Number(viewBox[4]);
    if (widthPt > 0 && heightPt > 0) return { widthPt, heightPt };
  }
  const attr = (name) => {
    const m = new RegExp(`<svg[^>]*\\s${name}\\s*=\\s*["']([\\d.]+)\\s*(?:px|pt)?["']`, 'i').exec(svg);
    return m ? Number(m[1]) : 0;
  };
  const widthPt = attr('width');
  const heightPt = attr('height');
  if (widthPt > 0 && heightPt > 0) return { widthPt, heightPt };
  return { widthPt: FALLBACK_WIDTH_PT, heightPt: FALLBACK_HEIGHT_PT };
}

/**
 * @param {object} deps
 * @param {string} deps.rootDir - directory `<ref>.svg` is resolved against
 * @param {object} [deps.logger]
 * @returns {(ref: string) => {svg: string, widthPt: number, heightPt: number}|null}
 */
export function createFileAssetResolver({ rootDir, logger = console } = {}) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new Error('createFileAssetResolver requires a rootDir');
  }
  const root = path.resolve(rootDir);
  const cache = new Map();

  return function resolveAsset(ref) {
    if (cache.has(ref)) return cache.get(ref);

    const miss = (reason) => {
      logger.warn?.('school.asset.unresolved', { ref, reason, root });
      cache.set(ref, null);
      return null;
    };

    if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return miss('malformed-ref');

    const file = path.resolve(root, `${ref}.svg`);
    // Belt and braces behind the pattern: a symlinked root or a future pattern
    // relaxation must not be enough on its own to read outside the tree.
    if (file !== root && !file.startsWith(root + path.sep)) return miss('outside-root');

    let svg;
    try {
      svg = readTextFromPath(file);
    } catch (err) {
      return miss(err.code === 'ENOENT' ? 'not-found' : err.code || 'unreadable');
    }
    if (!svg.includes('<svg')) return miss('not-svg');
    if (UNSAFE_SVG.test(svg)) return miss('unsafe-svg');

    const resolved = { svg, ...svgDimensions(svg) };
    cache.set(ref, resolved);
    return resolved;
  };
}

/**
 * Resolve the real subject icons used by the School frontend.  They live with
 * the shared visual vocabulary rather than curriculum artwork, and their
 * `currentColor`/`1em` browser conventions need a concrete PDF equivalent.
 *
 * This is intentionally a separate, prefix-only resolver: ordinary authored
 * assets keep the data-root safety boundary in `createFileAssetResolver`.
 */
export function createSubjectIconResolver({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../frontend/src/modules/School/home/icons/svg'),
  logger = console,
} = {}) {
  const root = path.resolve(rootDir);
  const cache = new Map();
  const prefix = 'subject-icon:';
  const subjectPattern = /^[a-z0-9][a-z0-9-]*$/;

  return function resolveSubjectIcon(ref) {
    if (typeof ref !== 'string' || !ref.startsWith(prefix)) return null;
    if (cache.has(ref)) return cache.get(ref);
    const subject = ref.slice(prefix.length);
    if (!subjectPattern.test(subject)) {
      logger.warn?.('school.subject_icon.unresolved', { ref, reason: 'malformed-ref' });
      cache.set(ref, null);
      return null;
    }
    const file = path.resolve(root, `${subject}.svg`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      logger.warn?.('school.subject_icon.unresolved', { ref, reason: 'outside-root' });
      cache.set(ref, null);
      return null;
    }
    let raw;
    try {
      raw = readTextFromPath(file);
    } catch (err) {
      logger.warn?.('school.subject_icon.unresolved', { ref, reason: err.code === 'ENOENT' ? 'not-found' : err.code || 'unreadable' });
      cache.set(ref, null);
      return null;
    }
    if (!raw.includes('<svg')) {
      logger.warn?.('school.subject_icon.unresolved', { ref, reason: 'not-svg' });
      cache.set(ref, null);
      return null;
    }
    const svg = raw
      .replaceAll('currentColor', '#000000')
      // Browser icons frequently use width/height="1em".  Leaving a concrete
      // root size lets svg-to-pdf ignore the card's requested dimensions, so
      // strip the browser sizing and let the renderer's width/height options
      // scale the viewBox to the full measured icon rail.
      .replace(/\swidth="[^"]*"/iu, '')
      .replace(/\sheight="[^"]*"/iu, '');
    const resolved = { svg, sourceSvg: raw, ...svgDimensions(svg) };
    cache.set(ref, resolved);
    return resolved;
  };
}

/** Compose the two intentionally disjoint asset namespaces used by School. */
export function createSchoolAssetResolver({ rootDir, subjectIconRootDir, logger = console } = {}) {
  const resolveFile = createFileAssetResolver({ rootDir, logger });
  const resolveSubject = createSubjectIconResolver({ rootDir: subjectIconRootDir, logger });
  return (ref) => (typeof ref === 'string' && ref.startsWith('subject-icon:') ? resolveSubject(ref) : resolveFile(ref));
}

export default createFileAssetResolver;
