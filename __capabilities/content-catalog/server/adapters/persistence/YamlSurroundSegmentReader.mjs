import path from 'path';
import {
  buildContainedPath,
  dirExists,
  listYamlFiles,
  loadYamlSafe,
} from '#system/utils/FileIO.mjs';

/**
 * Reads surround sidecars and their works as timed segment lists, for the
 * `surround-segments` saved-query source.
 *
 * Deliberately not the playback capability's surround store: content-catalog
 * may not import it, and the queue source needs only the timing and the
 * segment facts (kind, song, confidence), none of the frame. The two trees and
 * their pairing rules are the same:
 *
 * - `<rootDir>/<works>/*.yml` are sidecars: `match.contentId`, `work`,
 *   `spans: [[start, end], ...]` and `confidence: [...]`, both positional
 *   against the work's segments.
 * - `<libraryDir>/<domain>/**\/<work>.yml` is the work, where `<domain>` is the
 *   first folder of `<works>` and `<work>` is the sidecar's `composer/slug`.
 *   Its segments come from `segments:` or from nested `groups:`, flattened in
 *   order.
 *
 * Files and folders starting with `_` are authoring scaffolding and skipped.
 * Never throws: an unreadable file is skipped, a missing work is logged.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isReserved = (relPath) => relPath.split('/').some((part) => part.startsWith('_'));
const SEGMENT_KEYS = ['segments', 'chapters', 'movements'];

/**
 * A work's segments in play order: the first non-empty flat list, else the
 * `groups:` tree walked depth-first (a group's own segments before its
 * children's).
 * @param {Object} work
 * @returns {Object[]}
 */
export function flattenWorkSegments(work) {
  if (!isPlainObject(work)) return [];
  for (const key of SEGMENT_KEYS) {
    const list = asArray(work[key]).filter(isPlainObject);
    if (list.length) return list;
  }
  const out = [];
  const walk = (groups) => {
    for (const group of asArray(groups)) {
      if (!isPlainObject(group)) continue;
      for (const segment of asArray(group.segments)) if (isPlainObject(segment)) out.push(segment);
      walk(group.groups);
    }
  };
  walk(work.groups);
  return out;
}

const spanOf = (entry) => (Array.isArray(entry) && entry.length >= 2
  ? { start: entry[0], end: entry[1] }
  : { start: undefined, end: undefined });

/**
 * One sidecar and its work as a segment sidecar (see segmentItems).
 * @param {{ doc: Object, work: Object }} input
 */
export function pairSidecar({ doc, work }) {
  const spans = asArray(doc?.spans);
  const confidence = asArray(doc?.confidence);
  const piece = isPlainObject(doc?.piece) ? doc.piece : {};
  return {
    contentId: String(doc?.match?.contentId),
    title: piece.title ?? work?.title ?? doc?.match?.title ?? '',
    year: piece.year ?? work?.year ?? null,
    segments: flattenWorkSegments(work).map((segment, i) => ({
      ...segment,
      ...spanOf(spans[i]),
      confidence: confidence[i] ?? undefined,
    })),
  };
}

export class YamlSurroundSegmentReader {
  #rootDir;
  #libraryDir;
  #logger;

  /**
   * @param {Object} options
   * @param {string} options.rootDir - Sidecar tree (data/content/surround)
   * @param {string} options.libraryDir - Work tree (data/content/library)
   * @param {Object} [options.logger]
   */
  constructor({ rootDir, libraryDir, logger = null }) {
    this.#rootDir = path.resolve(rootDir);
    this.#libraryDir = path.resolve(libraryDir);
    this.#logger = logger;
  }

  /**
   * @param {string} works - Sidecar folder under the surround tree, e.g. `season/choir`
   * @returns {Array<import('../../domain/services/surroundSegments.mjs').SegmentSidecar>}
   */
  read(works) {
    if (typeof works !== 'string' || !works.trim()) return [];
    const folder = buildContainedPath(this.#rootDir, works.trim());
    if (!folder || !dirExists(folder)) return [];
    const domain = path.relative(this.#rootDir, folder).split(path.sep)[0];
    const libraryRoot = buildContainedPath(this.#libraryDir, domain);

    const out = [];
    let libraryIndex = null;
    for (const name of listYamlFiles(folder, { recursive: true })) {
      if (isReserved(name)) continue;
      const doc = loadYamlSafe(path.join(folder, name));
      if (!isPlainObject(doc) || !doc.match?.contentId || typeof doc.work !== 'string') continue;
      let work = libraryRoot ? loadYamlSafe(path.join(libraryRoot, doc.work)) : null;
      if (!isPlainObject(work) && libraryRoot) {
        // A corpus may file a work under grouping folders; find it by its tail.
        libraryIndex ??= listYamlFiles(libraryRoot, { recursive: true });
        const match = libraryIndex.find((rel) => !isReserved(rel) && rel.endsWith(`/${doc.work}`));
        work = match ? loadYamlSafe(path.join(libraryRoot, match)) : null;
      }
      if (!isPlainObject(work)) {
        this.#logger?.warn?.('surround-segments.work.missing', { works, file: name, work: doc.work });
        continue;
      }
      out.push(pairSidecar({ doc, work }));
    }
    return out;
  }
}

export default YamlSurroundSegmentReader;
