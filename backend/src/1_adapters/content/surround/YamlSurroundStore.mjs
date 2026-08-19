// backend/src/1_adapters/content/surround/YamlSurroundStore.mjs
import path from 'path';
import {
  dirExists,
  getStats,
  listDirs,
  listYamlFiles,
  loadYamlFromPath
} from '#system/utils/FileIO.mjs';
import { deepMerge } from '#system/utils/deepMerge.mjs';
import { ISurroundStore } from '#apps/content/ports/ISurroundStore.mjs';

// Definitions live in this reserved folder; every other `_`-prefixed name under
// the tree (folders and files alike) is authoring scaffolding, never a piece.
const DEFINITIONS_DIR = '_surrounds';
const COMPOSER_FILE = '_composer';
// How long a lookup trusts the index without stat-ing the tree. Authoring a
// surround is an edit-refresh loop, and every content adapter here caches at
// startup, so without this each timing tweak costs a backend restart. Playback
// lookups are a handful an hour, not a second, so the walk is free; the window
// exists only so a burst of lookups around one play does not repeat it.
const FRESHNESS_WINDOW_MS = 2000;

const isReserved = (name) => name.startsWith('_');
// Titles are compared on letters and digits only. Everything else — guillemets
// (»«), interpuncts (∙), colons, hyphens, whitespace runs — is separator noise
// that the Plex title carries and the sidecar's authored title does not. The
// \p{L}/\p{N} classes are Unicode-aware, so `Andrés` survives intact.
const normalizeTitle = (v) =>
  (typeof v === 'string' ? v : '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const asArray = (v) => (Array.isArray(v) ? v : []);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// One relation, used by both the lookup-time rebind and the index-time
// pre-warning, so the warning can never disagree with the behavior it predicts.
const titlesOverlap = (a, b) => a.includes(b) || b.includes(a);
// An absent key is authoring intent (the block is optional); a present key of
// the wrong shape is a mistake the type guards quietly paper over.
const isPresent = (v) => v !== undefined && v !== null;
// Work-level fields that surface as payload.piece, disjoint from
// performance-level fields (performance, musicEndsAt) the sidecar supplies.
const PIECE_FIELDS = ['title', 'opus', 'composed', 'year', 'period', 'period_note', 'city', 'premiered'];
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};

/**
 * Index of authored surround sidecars.
 *
 * Tree shape: <rootDir>/<domain>/<composer>/<piece>.yml, with shared composer
 * identity in <composer>/_composer.yml and region layouts in _surrounds/.
 * A surround is enrichment attached to playback responses, not playable
 * content, so this is a plain store — it is not registered as a content source.
 */
export class YamlSurroundStore extends ISurroundStore {
  #byContentId = new Map();
  // Parallel to #byContentId: the rebind lane, walked only after an id miss.
  #byTitle = [];
  // When the serving index was built, and when the tree was last stat-ed.
  #builtAt = 0;
  #lastCheckedAt = 0;

  /**
   * @param {Object} options
   * @param {string} options.rootDir - Root of the performance-sidecar tree (data/content/surround)
   * @param {string} options.libraryDir - Root of the knowledge corpus (data/content/library)
   * @param {Object} options.logger - Structured logger
   */
  constructor({ rootDir, libraryDir, logger }) {
    super();
    this.rootDir = rootDir;
    this.libraryDir = libraryDir;
    // The composed logger arrives as the content router's child (app: 'api'), which
    // would bury surround events among all other content logging. Claim our own
    // `context.app` so the log store can filter this subsystem on its own. The
    // optional call is required: contentApi falls back to bare `console`, which
    // has no child().
    this.logger = logger?.child?.({ app: 'surround', module: 'surround-store' }) ?? logger;
    this.#build();
  }

  /**
   * Resolve the surround payload for a played item.
   * Never throws: a miss, an unreadable tree, or a broken sidecar all yield null
   * so the caller attaches nothing and playback is unaffected.
   *
   * The contentId is the fast path. A Plex rescan mints fresh ratingKeys, which
   * would otherwise orphan every sidecar at once with no symptom but a missing
   * frame, so a miss falls back to matching the authored `match.title` against
   * the live one. The warn it logs is how anyone learns the ids went stale.
   * That fallback answers only when it is sure: two sidecars matching the same
   * live title yield null, not a coin flip.
   *
   * The index is rebuilt in place when a sidecar changes on disk, so an author
   * edits a file and refreshes rather than restarting the backend.
   *
   * Returns a fresh clone each call. The payload is attached verbatim to play
   * and queue responses, where callers may decorate it (asset URLs, defaults);
   * handing out the indexed object would let one such edit persist into every
   * later lookup, and definition blocks are shared across pieces.
   *
   * @param {string} contentId - Compound content ID (e.g. 'plex:663134')
   * @param {string} title - Item title
   * @returns {Object|null} Resolved surround payload, or null
   */
  lookup(contentId, title) {
    try {
      this.#refreshIfStale();

      const payload = this.#byContentId.get(String(contentId));
      if (payload) return structuredClone(payload);

      const candidates = this.#rebind(title);
      if (candidates.length === 1) {
        const [rebound] = candidates;
        // Warn, not info: the sidecar still works, but its contentId is wrong and
        // the message carries everything needed to fix the file by hand.
        this.logger?.warn?.('surround.match.rebound', {
          staleContentId: contentId,
          matchedTitle: rebound.title,
          file: rebound.file,
          contentId: rebound.contentId
        });
        return structuredClone(rebound.payload);
      }
      if (candidates.length > 1) {
        // Refuse rather than guess. A wrong surround is a visible error to whoever
        // is watching — Beethoven's facts pinned over a Vivaldi video — while a
        // missing one is just the un-enriched status quo. Every candidate file is
        // named so the author knows exactly which titles to disambiguate.
        this.logger?.warn?.('surround.match.ambiguous', {
          staleContentId: contentId,
          liveTitle: title,
          candidates: candidates.map(({ file, title: matchedTitle }) => ({ file, title: matchedTitle }))
        });
        return null;
      }

      // The only trace an authoring mistake leaves: failing soft means a wrong
      // contentId is otherwise indistinguishable from an unauthored item.
      this.logger?.debug?.('surround.lookup.miss', { contentId });
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Rebuild the index if a sidecar has changed since it was built.
   *
   * Two guards, and both matter. The window keeps a burst of lookups around one
   * play from re-walking the tree. The mtime comparison is what keeps the
   * rebuild honest: every index-time warning is derived from build-local state,
   * so a rebuild re-emits the whole set from scratch — rebuilding on mere window
   * expiry would make one sidecar nobody ever fixes warn every two seconds for
   * the life of the process.
   *
   * @private
   */
  #refreshIfStale() {
    try {
      const now = Date.now();
      if (now - this.#lastCheckedAt <= FRESHNESS_WINDOW_MS) return;
      // Stamped before the walk, so a tree that has turned unreadable costs one
      // failed stat per window rather than one per lookup.
      this.#lastCheckedAt = now;
      if (this.#newestMtime() <= this.#builtAt) return;
      this.#build();
    } catch {
      // Best-effort by design: a tree deleted or replaced under a running store
      // leaves the last good index serving, and lookup answers as it did before.
    }
  }

  /**
   * Newest mtime anywhere in the sidecar tree, in whole milliseconds.
   *
   * Directories are stat-ed alongside files because a directory mtime is the
   * only record that a sidecar was added or deleted. Reserved names are walked
   * exactly as #build walks them, so a rename into or out of `_`-prefixed
   * scaffolding still registers via the parent directory.
   *
   * @returns {number} 0 when nothing could be stat-ed, which reads as "unchanged"
   * @private
   */
  #newestMtime() {
    let newest = 0;
    const consider = (target) => {
      const stats = getStats(target);
      // Floored: mtimeMs carries sub-millisecond precision that Date.now() does
      // not, so a file written in the same millisecond as the build would
      // otherwise read as newer than it and rebuild on every window, forever.
      if (stats) newest = Math.max(newest, Math.floor(stats.mtimeMs));
    };

    consider(this.rootDir);
    const definitionsDir = path.join(this.rootDir, DEFINITIONS_DIR);
    consider(definitionsDir);
    for (const file of listYamlFiles(definitionsDir, { stripExtension: false })) {
      consider(path.join(definitionsDir, file));
    }

    consider(this.libraryDir);
    for (const domain of listDirs(this.libraryDir).filter((d) => !isReserved(d))) {
      const domainDir = path.join(this.libraryDir, domain);
      consider(domainDir);
      for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
        const composerDir = path.join(domainDir, composer);
        consider(composerDir);
        for (const file of listYamlFiles(composerDir, { stripExtension: false })) {
          consider(path.join(composerDir, file));
        }
      }
    }

    for (const domain of listDirs(this.rootDir).filter((d) => !isReserved(d))) {
      const domainDir = path.join(this.rootDir, domain);
      consider(domainDir);

      for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
        const composerDir = path.join(domainDir, composer);
        consider(composerDir);
        // Unfiltered: _composer.yml is shared identity, and editing it changes
        // every piece under the folder.
        for (const file of listYamlFiles(composerDir, { stripExtension: false })) {
          consider(path.join(composerDir, file));
        }
      }
    }

    return newest;
  }

  /**
   * Collect every piece whose authored title matches the live one, ids having gone stale.
   *
   * Substring, not equality, and in both directions: the live Plex title usually
   * appends the orchestra and conductor to the authored one, but an authored title
   * may equally be the more specific of the two. An empty normalization (a missing
   * or non-string title on either side) matches nothing rather than everything.
   *
   * Every match is returned, never just the first: substring matching is lossy
   * enough that a short authored title (`Spring`) hits whole families of live
   * titles, and picking by walk order would make the answer depend on the
   * filesystem. The caller decides what more than one match means.
   *
   * @param {string} title - Live item title
   * @returns {Array<{ title: string, file: string, contentId: string, payload: Object }>}
   * @private
   */
  #rebind(title) {
    const live = normalizeTitle(title);
    if (!live) return [];

    return this.#byTitle.filter(({ normalized }) => titlesOverlap(normalized, live));
  }

  /**
   * Walk the sidecar tree and build the contentId index.
   *
   * Runs from the constructor and again whenever #refreshIfStale sees a newer
   * mtime. Every counter and collision map here is build-local, so a rebuild
   * re-reports the corpus from scratch rather than inheriting a stale verdict.
   *
   * @private
   */
  #build() {
    const startedAt = Date.now();
    const index = new Map();
    const titles = [];
    // contentId -> the file that claimed it, so a collision can name both sides.
    const claimedBy = new Map();
    // Piece candidates read but rejected. A malformed definition shows up here too,
    // as every piece naming it is rejected in turn.
    let skipped = 0;
    let definitions = new Map();
    let library = { composers: new Map(), works: new Map() };

    try {
      definitions = this.#loadDefinitions();
      library = this.#loadLibrary();

      for (const domain of listDirs(this.rootDir).filter((d) => !isReserved(d))) {
        const domainDir = path.join(this.rootDir, domain);

        for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
          const composerDir = path.join(domainDir, composer);

          const files = listYamlFiles(composerDir, { stripExtension: false })
            .filter((f) => !isReserved(f));

          for (const file of files) {
            // Relative to rootDir, because that is how the author knows the file.
            // Every warning below is addressed to whoever wrote the sidecar.
            const relFile = path.join(domain, composer, file);
            const resolved = this.#resolvePerformance(path.join(composerDir, file), domain, definitions, library, relFile);
            if (!resolved) { skipped += 1; continue; }

            // Last write wins, as before — walk order decides. That is an
            // accident of the filesystem, so name both files rather than
            // letting one sidecar vanish under another without a trace.
            const priorFile = claimedBy.get(resolved.contentId);
            if (priorFile) {
              this.logger?.warn?.('surround.sidecar.duplicate', {
                contentId: resolved.contentId,
                keptFile: relFile,
                droppedFile: priorFile
              });
            }
            claimedBy.set(resolved.contentId, relFile);
            index.set(resolved.contentId, resolved.payload);
            // Only pieces that authored a title are rebindable; the rest are
            // reachable by contentId alone.
            if (resolved.normalized) {
              titles.push({
                normalized: resolved.normalized,
                title: resolved.title,
                file: relFile,
                contentId: resolved.contentId,
                payload: resolved.payload
              });
            }
          }
        }
      }
    } catch {
      // A malformed root leaves whatever was indexed so far; lookups miss quietly.
    }

    // Both lanes swap together: a lookup that misses on contentId falls straight
    // through to #byTitle, so a half-swapped pair would rebind against payloads
    // the rebuilt index no longer holds.
    this.#byContentId = index;
    this.#byTitle = titles;
    // Stamped after the walk, so a sidecar edited while the build was reading it
    // still counts as newer and is picked up on the next window.
    this.#builtAt = Date.now();
    this.#lastCheckedAt = this.#builtAt;
    this.#warnAmbiguousTitles(titles);
    if (typeof this.logger?.info !== 'function') return;
    this.logger.info('surround.index.built', {
      pieces: index.size,
      skipped,
      composers: library.composers.size,
      definitions: definitions.size,
      ms: Date.now() - startedAt
    });
  }

  /**
   * Load region-layout definitions, keyed by filename stem.
   * @returns {Map<string, Object>}
   * @private
   */
  #loadDefinitions() {
    const dir = path.join(this.rootDir, DEFINITIONS_DIR);
    const out = new Map();
    if (!dirExists(dir)) return out;

    for (const file of listYamlFiles(dir, { stripExtension: false })) {
      const parsed = loadYamlFromPath(path.join(dir, file));
      if (!parsed || typeof parsed !== 'object') continue;
      // The filename stem is the lookup key — `id:` inside the file is decorative.
      out.set(file.replace(/\.(yml|yaml)$/, ''), parsed);
    }
    return out;
  }

  /**
   * Load the knowledge corpus: composers and works, keyed the same way a
   * performance sidecar references them (`<composer>/<work-slug>`).
   *
   * Mirrors #build's own walk (same domain/composer/*.yml shape, same
   * reserved-name rule) but over libraryDir instead of rootDir, since the two
   * trees are independent and a performance sidecar may reference a work whose
   * media doesn't exist under the same domain folder name coincidentally — they
   * just happen to share the convention today.
   *
   * @returns {{ composers: Map<string, Object>, works: Map<string, Object> }}
   * @private
   */
  #loadLibrary() {
    const composers = new Map();
    const works = new Map();
    if (!dirExists(this.libraryDir)) return { composers, works };

    for (const domain of listDirs(this.libraryDir).filter((d) => !isReserved(d))) {
      const domainDir = path.join(this.libraryDir, domain);

      for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
        const composerDir = path.join(domainDir, composer);
        const composerBase = loadYamlFromPath(path.join(composerDir, `${COMPOSER_FILE}.yml`));
        if (isPlainObject(composerBase)) composers.set(composer, composerBase);

        const files = listYamlFiles(composerDir, { stripExtension: false }).filter((f) => !isReserved(f));
        for (const file of files) {
          const work = loadYamlFromPath(path.join(composerDir, file));
          if (!isPlainObject(work)) continue;
          const slug = file.replace(/\.(yml|yaml)$/, '');
          works.set(`${composer}/${slug}`, work);
        }
      }
    }

    return { composers, works };
  }

  /**
   * Warn about authored titles that can never be told apart at rebind time.
   *
   * Once the index is built the collision is already knowable, so nobody should
   * have to play the video and read `surround.match.ambiguous` to discover the
   * rebind lane will refuse. Groups are transitive — three titles nesting inside
   * one another are one authoring problem, not three — and this changes no
   * lookup behavior at all; it only says the same thing earlier.
   *
   * @param {Array<{ normalized: string, title: string, file: string }>} titles
   * @private
   */
  #warnAmbiguousTitles(titles) {
    const grouped = new Set();

    for (let i = 0; i < titles.length; i += 1) {
      if (grouped.has(i)) continue;
      grouped.add(i);

      const group = [];
      const queue = [i];
      while (queue.length) {
        const seed = queue.shift();
        group.push(seed);
        for (let j = 0; j < titles.length; j += 1) {
          if (grouped.has(j)) continue;
          if (!titlesOverlap(titles[seed].normalized, titles[j].normalized)) continue;
          grouped.add(j);
          queue.push(j);
        }
      }

      if (group.length < 2) continue;
      this.logger?.warn?.('surround.titles.ambiguous', {
        candidates: group.map((k) => ({ file: titles[k].file, title: titles[k].title }))
      });
    }
  }

  /**
   * Report a sidecar the author needs to fix.
   *
   * `reason` is the single problem to act on first and stays stable enough to
   * aggregate on in the log store; `reasons` carries everything found in the
   * file so one editing pass fixes it rather than one restart per mistake.
   *
   * @param {string} file - Path relative to rootDir
   * @param {string[]} reasons - Ordered, most blocking first
   * @private
   */
  #invalid(file, reasons) {
    this.logger?.warn?.('surround.sidecar.invalid', { file, reason: reasons[0], reasons });
  }

  /**
   * Read one performance sidecar and resolve it against the knowledge corpus
   * into the payload the API attaches verbatim.
   *
   * Precedence, per the design doc: composer <- work <- performance, applied
   * separately to the composer block and the piece block. Movements and cues
   * come from the work; `starts` pairs with them positionally (starts[i] is
   * movements[i]'s start second), which is also how a movement's `note` becomes
   * a synthesized, movement-anchored cue.
   *
   * @returns {{ contentId: string, title: string, normalized: string, payload: Object }|null}
   * @private
   */
  #resolvePerformance(filePath, domain, definitions, library, file) {
    const doc = loadYamlFromPath(filePath);
    if (!isPlainObject(doc)) {
      this.#invalid(file, [isPresent(doc) ? 'not-a-mapping' : 'yaml-unparseable']);
      return null;
    }

    const blocking = [];
    if (!doc.surround) blocking.push('missing-surround');
    if (typeof doc.work !== 'string' || !doc.work.trim()) blocking.push('missing-work');
    if (!isPlainObject(doc.match)) blocking.push(isPresent(doc.match) ? 'match-not-a-mapping' : 'missing-match');
    else if (!doc.match.contentId) blocking.push('missing-match-contentId');
    if (blocking.length) { this.#invalid(file, blocking); return null; }

    const definition = definitions.get(doc.surround);
    if (!definition) {
      this.logger?.warn?.('surround.definition.missing', { id: doc.surround, file });
      return null;
    }

    const work = library.works.get(doc.work);
    if (!work) {
      this.logger?.warn?.('surround.work.missing', { work: doc.work, file });
      return null;
    }
    // The composer slug is the path segment before the work slug — the same
    // convention the sidecar's own folder placement already implies.
    const composerSlug = doc.work.split('/')[0];
    const composerBase = library.composers.get(composerSlug);

    const soft = [];
    if (typeof doc.match.title !== 'string' || !doc.match.title.trim()) soft.push('missing-match-title');
    if (isPresent(doc.starts) && !Array.isArray(doc.starts)) soft.push('starts-not-a-list');
    if (isPresent(doc.cues) && !Array.isArray(doc.cues)) soft.push('cues-not-a-list');
    if (isPresent(doc.composer) && !isPlainObject(doc.composer)) soft.push('composer-not-a-mapping');
    if (isPresent(doc.piece) && !isPlainObject(doc.piece)) soft.push('piece-not-a-mapping');
    if (soft.length) this.#invalid(file, soft);

    const starts = Array.isArray(doc.starts) ? doc.starts : [];
    const movements = asArray(work.movements);
    if (starts.length && starts.length !== movements.length) {
      this.logger?.warn?.('surround.starts.mismatch', { file, starts: starts.length, movements: movements.length });
    }

    const resolvedMovements = movements.map((m, i) => ({ ...m, start: starts[i] }));
    const movementCues = movements
      .map((m, i) => ({ at: starts[i], text: m.note }))
      .filter((c) => typeof c.at === 'number' && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({ at: c.at, render: 'docked', text: c.text }));
    const explicitCues = asArray(doc.cues);
    const cues = [...movementCues, ...explicitCues].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

    const workPiece = pick(work, PIECE_FIELDS);
    const performancePiece = pick(doc, ['performance', 'musicEndsAt']);
    const piece = deepMerge(
      deepMerge(workPiece, performancePiece),
      isPlainObject(doc.piece) ? doc.piece : {}
    );

    const composer = deepMerge(
      deepMerge(isPlainObject(composerBase) ? composerBase : {}, isPlainObject(work.composer) ? work.composer : {}),
      isPlainObject(doc.composer) ? doc.composer : {}
    );

    return {
      contentId: String(doc.match.contentId),
      title: typeof doc.match.title === 'string' ? doc.match.title : '',
      normalized: normalizeTitle(doc.match.title),
      payload: {
        id: doc.surround,
        definition: { regions: definition.regions, collapse: definition.collapse },
        piece,
        movements: resolvedMovements,
        cues,
        facts: asArray(work.facts),
        composer,
        assetBase: `library/${domain}`
      }
    };
  }
}

export default YamlSurroundStore;
