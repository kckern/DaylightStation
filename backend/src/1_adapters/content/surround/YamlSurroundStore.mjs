// backend/src/1_adapters/content/surround/YamlSurroundStore.mjs
import path from 'path';
import { realpathSync } from 'node:fs';
import {
  dirExists,
  getStats,
  listDirs,
  listYamlFiles,
  loadYamlFromPath
} from '#system/utils/FileIO.mjs';
import { deepMerge } from '#system/utils/deepMerge.mjs';
import { ISurroundStore } from '#apps/content/ports/ISurroundStore.mjs';
import { toSpans, withOffsets, num } from './segments.mjs';

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
// THE THREE NAMES ONE LIST HAS WORN. `segments:` is the name; `chapters:` was
// the interim general form; `movements:` is what the corpus authored before
// either existed. This reader accepts all three so a corpus of ~1,500
// hand-authored files can be renamed on its own schedule.
//
// THE COMPATIBILITY IS ONE-DIRECTIONAL, AND THE ORDER OF OPERATIONS FOLLOWS
// FROM THAT. New code reads old data. Old code does NOT read new data — a
// deployed build from before this reader knows only `movements:`, so a corpus
// migrated to `segments:` resolves to nothing under it and every classical rail
// on the fleet goes blank. That is not hypothetical; it is how this landed the
// first time, and it cost twenty minutes of dark rails.
//
// So: DEPLOY FIRST, MIGRATE THE DATA SECOND. Never the other way round, and
// never in parallel. The data tree is shared with production over Dropbox, so
// "migrate the data" is live the moment the file is written — there is no
// staging step in which to notice.
//
// FIRST NON-EMPTY WINS, in this order. A file carrying more than one — which
// nothing authors — resolves to `segments:`, then `chapters:`, then
// `movements:`; the loser is ignored rather than merged, because two lists of
// the same music are an authoring mistake with no correct concatenation.
const SEGMENT_KEYS = ['segments', 'chapters', 'movements'];
// The last of them, named because two places need "the pre-rename list" as
// against "whatever list this work authored" — see the fallback in
// #resolvePerformance for why the difference matters.
const LEGACY_SEGMENT_KEY = SEGMENT_KEYS[SEGMENT_KEYS.length - 1];
// Returns the key alongside the list. The key is not decoration: it is the one
// fact that separates "this work authors nothing" from "this work authors a
// name this build does not read", and those two have the same symptom on screen
// (an empty rail) and very different fixes.
const authoredSegments = (work) => {
  for (const key of SEGMENT_KEYS) {
    const list = asArray(work?.[key]);
    if (list.length) return { list, key };
  }
  return { list: [], key: null };
};
// Work-level fields that surface as payload.piece, disjoint from
// performance-level fields (performance, musicEndsAt) the sidecar supplies.
// An allowlist, so it must be kept in sync with the corpus schema: a field
// added to a library work YAML and not added here never reaches the payload,
// and the only symptom is the region rendering without it.
// `short_title` is the work's own alternate name — "Beethoven's Third Symphony"
// beside a `title` of `Symphony No. 3 in E-flat major, "Eroica"`. The band's
// piece register prints it as a standing label (design wave 7) and prints NO
// header at all where it is unauthored, so this field is optional in every
// sense: absent is a supported state, not a gap.
const PIECE_FIELDS = ['title', 'short_title', 'opus', 'composed', 'year', 'period', 'period_note', 'city', 'premiered'];
// A part that NAMES another sidecar rather than restating its timing. The
// authored form is a bare contentId string; a mapping is accepted too, but only
// while it says nothing a reference cannot say — the moment it carries `work` or
// `spans` it is the inline form, which times the CONTAINER's own segments and
// has to be resolved a different way entirely.
const partRef = (part) => {
  if (typeof part === 'string' && part.trim()) return part.trim();
  if (isPlainObject(part) && part.contentId && part.work === undefined && part.spans === undefined) {
    return String(part.contentId);
  }
  return null;
};
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
  // Every media item that appears on some payload's rail, mapped to the payload
  // that carries it and its position on that rail. A single-item sidecar is its
  // own part 0, so this answers for every indexed piece, not just containers.
  #byPart = new Map();
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
   * Resolve the surround payload that PLAYS a given media item, and where on it.
   *
   * `lookup` answers "what is authored against this id"; this answers "what rail
   * is this id a segment of". The two differ only for a container: playing the
   * second étude episode has to raise the whole twenty-seven-segment rail with
   * the position mapped into part 1, not the episode's own standalone frame.
   *
   * A container's claim beats the item's claim on itself, which is the whole
   * point — the episode sidecar still exists and still resolves through
   * `lookup`, it just is not what a caller asking this question wants.
   *
   * Never throws, and returns a fresh clone, for the same reasons `lookup` does.
   *
   * @param {string} contentId - Compound content ID of the played item
   * @returns {{ payload: Object, part: number }|null}
   */
  lookupByPart(contentId) {
    try {
      this.#refreshIfStale();
      const hit = this.#byPart.get(String(contentId));
      if (!hit) {
        this.logger?.debug?.('surround.part.miss', { contentId });
        return null;
      }
      return { payload: structuredClone(hit.payload), part: hit.part };
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

    // Must descend exactly as far as #loadLibraryDir does. When this walk was
    // hard-coded to domain/composer and the corpus grew an era level, editing a
    // work file went unnoticed: the loader read the new corpus but was never
    // asked to, so authoring silently required a restart. A directory's own
    // mtime does not move when a file inside it is rewritten, so stopping short
    // of the files is the same as not watching at all.
    const seen = new Set();
    const descend = (dir) => {
      let real;
      try { real = realpathSync(dir); } catch { real = dir; }
      if (seen.has(real)) return;
      seen.add(real);

      consider(dir);
      for (const file of listYamlFiles(dir, { stripExtension: false })) {
        consider(path.join(dir, file));
      }
      for (const child of listDirs(dir).filter((d) => !isReserved(d))) {
        descend(path.join(dir, child));
      }
    };
    descend(this.libraryDir);

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
   * The walk resolves each sidecar on its own, and composition of containers is
   * a SECOND pass over the result. It has to be: a container names its parts by
   * contentId, and the sidecar for a part may not be read until later in the
   * walk, so nothing that runs inside a single file's resolution can see them.
   *
   * @private
   */
  #build() {
    const startedAt = Date.now();
    const index = new Map();
    const titles = [];
    // Every sidecar that resolved, in walk order — the input to composition and
    // then to indexing, both of which need the whole set before they can run.
    const pieces = [];
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
            pieces.push(resolved);
          }
        }
      }
    } catch {
      // A malformed root leaves whatever resolved so far; lookups miss quietly.
    }

    this.#composeContainers(pieces);
    for (const resolved of pieces) this.#warnUntimed(resolved);

    for (const resolved of pieces) {
      // Last write wins, as before — walk order decides. That is an accident of
      // the filesystem, so name both files rather than letting one sidecar
      // vanish under another without a trace.
      const priorFile = claimedBy.get(resolved.contentId);
      if (priorFile) {
        this.logger?.warn?.('surround.sidecar.duplicate', {
          contentId: resolved.contentId,
          keptFile: resolved.file,
          droppedFile: priorFile
        });
      }
      claimedBy.set(resolved.contentId, resolved.file);
      index.set(resolved.contentId, resolved.payload);
      // Only pieces that authored a title are rebindable; the rest are
      // reachable by contentId alone.
      if (resolved.normalized) {
        titles.push({
          normalized: resolved.normalized,
          title: resolved.title,
          file: resolved.file,
          contentId: resolved.contentId,
          payload: resolved.payload
        });
      }
    }

    // All three lanes swap together: a lookup that misses on contentId falls
    // straight through to #byTitle, so a half-swapped set would rebind against
    // payloads the rebuilt index no longer holds.
    this.#byContentId = index;
    this.#byTitle = titles;
    this.#byPart = this.#indexParts(pieces);
    // Stamped after the walk, so a sidecar edited while the build was reading it
    // still counts as newer and is picked up on the next window.
    this.#builtAt = Date.now();
    this.#lastCheckedAt = this.#builtAt;
    this.#warnAmbiguousTitles(titles);
    if (typeof this.logger?.info !== 'function') return;
    this.logger.info('surround.index.built', {
      pieces: index.size,
      // Pieces that AUTHORED parts, not pieces that ended up with more than one
      // — a container down to a single surviving part is exactly the case worth
      // seeing, and counting the outcome would have reported it as zero.
      containers: pieces.filter((p) => p.parts).length,
      skipped,
      // ONE LINE THAT ANSWERS "DID THE CORPUS RENAME LAND, UNDER A NAME THIS
      // BUILD READS". A healthy corpus is all under one key; a half-migrated one
      // is split; a corpus renamed past what this build knows shows every piece
      // under `none` while `pieces` stays at its usual number, which is the
      // shape that otherwise looks entirely healthy from here.
      segmentKeys: pieces.reduce((acc, p) => {
        const k = p.segmentKey ?? 'none';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
      // Pieces whose rail came out empty. Nonzero here with a normal `pieces`
      // count is the whole-fleet-blank signature.
      empty: pieces.filter((p) => !p.payload.segments.length).length,
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

    // Seen real paths, not joined ones: `listDirs` resolves symlinks, so a loop
    // (`classical/self -> classical/`, one mistyped `ln -s` during a reorg) would
    // otherwise recurse until the stack gives out and take the backend with it.
    const seen = new Set();
    for (const domain of listDirs(this.libraryDir).filter((d) => !isReserved(d))) {
      this.#loadLibraryDir(path.join(this.libraryDir, domain), domain, composers, works, seen);
    }

    return { composers, works };
  }

  /**
   * Index one directory of the corpus, then descend into its subdirectories.
   *
   * A work's identity is `<composer>/<work-slug>` and nothing else. How the
   * corpus files the composer above that — flat under the domain, or grouped by
   * era as `classical/5_romantic/chopin/` — is a filing convenience the author
   * may change at will, so the walk must not encode a depth. The directory that
   * directly contains a work file names its composer; every directory above it
   * is grouping. A regrouping that once emptied the whole index (every sidecar
   * rejected `surround.work.missing`) is then a no-op.
   *
   * @param {string} dir - Directory to index.
   * @param {string} rel - Path of `dir` relative to libraryDir, for warnings.
   * @param {Map<string, Object>} composers - Accumulator, keyed by composer.
   * @param {Map<string, Object>} works - Accumulator, keyed `<composer>/<slug>`.
   * @param {Set<string>} seen - Real paths already indexed, to break symlink cycles.
   * @private
   */
  #loadLibraryDir(dir, rel, composers, works, seen) {
    // An unreadable or vanished directory is not a cycle — fall back to the
    // joined path so the walk still terminates on it rather than throwing.
    let real;
    try { real = realpathSync(dir); } catch { real = dir; }
    if (seen.has(real)) return;
    seen.add(real);

    const composer = path.basename(dir);
    const composerBase = loadYamlFromPath(path.join(dir, `${COMPOSER_FILE}.yml`));
    if (isPlainObject(composerBase)) composers.set(composer, composerBase);

    const files = listYamlFiles(dir, { stripExtension: false }).filter((f) => !isReserved(f));
    for (const file of files) {
      const work = loadYamlFromPath(path.join(dir, file));
      if (!isPlainObject(work)) continue;

      // The corpus gets the same visibility a sidecar gets. `asArray` below
      // flattens a mapping written where a list belongs, and without this the
      // author's only symptom is a segment map that renders empty. Warn and
      // keep going: a work with one bad list is still worth indexing.
      const reasons = [];
      for (const key of [...SEGMENT_KEYS, 'facts']) {
        if (isPresent(work[key]) && !Array.isArray(work[key])) reasons.push(`${key}-not-a-list`);
      }
      if (reasons.length) {
        // Relative to libraryDir, because that is how the author knows the file.
        this.logger?.warn?.('surround.work.invalid', {
          file: path.join(rel, file),
          reason: reasons[0],
          reasons
        });
      }

      // Identity is composer + slug, so two composer folders sharing a basename
      // anywhere in the tree address the same work. Last-write-wins is how this
      // has always behaved, but a depth-free walk makes the collision reachable
      // from folders that never used to sit at the same level — so name it
      // rather than let a work silently become a different composer's.
      const slug = file.replace(/\.(yml|yaml)$/, '');
      const key = `${composer}/${slug}`;
      if (works.has(key)) {
        this.logger?.warn?.('surround.work.duplicate', { work: key, file: path.join(rel, file) });
      }
      works.set(key, work);
    }

    for (const child of listDirs(dir).filter((d) => !isReserved(d))) {
      this.#loadLibraryDir(path.join(dir, child), path.join(rel, child), composers, works, seen);
    }
  }

  /**
   * Flatten a work's segments, following `work:` references into their targets.
   *
   * A reference resolves to a SUBTREE, not a leaf: naming `chopin/etudes-op-10`
   * brings its twelve études with it. `group` records which work a segment came
   * from, because the rail is flat but the labels above it are not.
   *
   * WHICH KEY the list is authored under is `authoredSegments`' business, not
   * this method's — `segments:`, the interim `chapters:` and the original
   * `movements:` all read here, first non-empty winning. A work that authors
   * none of them, or authors an empty one, resolves to nothing and the caller
   * falls back to the legacy list.
   *
   * `group.index` numbers PARTS, not segments, so it is carried by a counter
   * threaded through the recursion rather than derived from whatever the last
   * segment happened to hold. Deriving it is wrong in two ways at once: an
   * inline segment between two references carries no group to read, and a
   * reference whose target expands to nothing leaves the previous part's number
   * standing. Both make the second part index 0 again, and the rail then labels
   * two different sets with one heading.
   *
   * @param {Object} work
   * @param {{works: Map<string,Object>}} library
   * @param {Set<string>} seen - work keys on the path being expanded, to break cycles
   * @param {{work: string, title: string, index: number}|null} group
   * @param {{parts: number}} counter - Parts expanded so far, shared across the whole tree
   */
  #resolveSegments(work, library, seen, group = null, counter = { parts: 0 }) {
    const { list: own } = authoredSegments(work);
    const out = [];
    for (const entry of own) {
      if (!isPlainObject(entry)) continue;
      const ref = typeof entry.work === 'string' ? entry.work.trim() : '';
      if (!ref) { out.push(group ? { ...entry, group } : entry); continue; }

      if (seen.has(ref)) {
        this.logger?.warn?.('surround.segment.cycle', { work: ref });
        continue;
      }
      const target = library.works.get(ref);
      if (!target) {
        this.logger?.warn?.('surround.segment.missing', { work: ref });
        continue;
      }
      // Added before the descent and removed after it, exactly as #loadLibraryDir
      // guards the corpus walk: the set records the path currently being
      // expanded, not everything ever expanded. A container that names the same
      // work twice is a repeat, and a repeat is not a cycle.
      seen.add(ref);
      const childGroup = { work: ref, title: target.title ?? ref, index: counter.parts };
      counter.parts += 1;
      out.push(...this.#resolveSegments(target, library, seen, childGroup, counter));
      seen.delete(ref);
    }
    return out;
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
   * Give every container its parts' segments, on one rail.
   *
   * A part is a contentId, never a timing. The three étude episodes are already
   * authored as ordinary sidecars that resolve and play standalone; the
   * container concatenates what they resolved, and restates nothing. So this
   * takes each part's segments verbatim — their `start`/`end` stay in their own
   * media item's clock — stamps them with the part they came from, and lays the
   * concatenation back onto ONE sounding rail with `withOffsets`. The rail is
   * global; the timings on it are local; that pairing is what lets one frame
   * span seven polonaises.
   *
   * BOTH part forms are resolved here, not just the reference one. The inline
   * form — a one-off container that times its own resolved segments because its
   * media was never authored as separate sidecars — used to be handled while
   * resolving the file, which made classification all-or-nothing: one entry
   * carrying `work:` demoted every bare contentId beside it to an inline entry
   * that matched no segments and inherited the CONTAINER's id, so a third of the
   * rail vanished and a phantom slot pointed at an unplayable season. Judging
   * each entry on its own merits is only possible once both forms resolve in the
   * same place, and it also leaves one rail-building loop rather than two.
   *
   * A part naming a contentId with no sidecar is warned and skipped rather than
   * faulting the container: six polonaises with a rail is worth more than seven
   * with nothing. Surviving parts are numbered densely, so `timeline.parts[n]`
   * is always the part that `segment.part === n` belongs to — a gap there would
   * make every later part's sounding total accrue to the wrong slot.
   *
   * @param {Array<Object>} pieces - Every sidecar that resolved, in walk order
   * @private
   */
  #composeContainers(pieces) {
    const byContentId = new Map();
    for (const piece of pieces) byContentId.set(piece.contentId, piece);

    for (const container of pieces) {
      if (!container.parts) continue;
      // Per container, so one that throws costs only itself. The whole call used
      // to be wrapped, which meant the first container to fail silently emptied
      // the rail of every container after it — the same silent-partial-index
      // shape this subsystem has already been bitten by once.
      try {
        this.#composeOne(container, byContentId);
      } catch {
        // Keeps its provisional empty rail; every other container is unaffected.
      }
    }
  }

  /**
   * Build one container's rail. See #composeContainers for why both part forms
   * land here.
   *
   * @param {Object} container - The resolved piece carrying `parts`
   * @param {Map<string, Object>} byContentId - Every resolved piece, by id
   * @private
   */
  #composeOne(container, byContentId) {
    // Group the container's OWN resolved segments by the work that performs
    // them, so an inline part's spans pair with its own segments. Pairing
    // against the flat list would make one miscounted part shift every later
    // part's timings.
    const byWork = new Map();
    for (const c of container.ownSegments) {
      const key = c.group?.work ?? null;
      if (!byWork.has(key)) byWork.set(key, []);
      byWork.get(key).push(c);
    }

    const segments = [];
    const slots = [];
    // THE FACTS OF THE WORKS THIS CONTAINER PLAYS, by work slug — the middle
    // rung of the band's precedence (frontend `Surround/segments.js`,
    // `factPool`): a segment's own note, then ITS WORK's facts, then the
    // container's. Without this the polonaise season could only ever print the
    // eight facts about the set while a single polonaise was sounding, and the
    // four facts that work authored about ITSELF — the ones a viewer wants
    // while it plays — reached no screen at all.
    //
    // Keyed by `group.work`, which is the same slug the segments are stamped
    // with, so the frontend joins on a value it already has rather than on the
    // part's position (which a dropped part renumbers).
    const groupFacts = {};
    container.parts.forEach((entry, authored) => {
      const ref = partRef(entry);
      const index = slots.length;
      // `authored` is the position in the YAML — the line an author has to go
      // and fix — while `index` is the dense position on the composed rail.
      const mine = ref
        ? this.#referencedSegments(container, ref, authored, byContentId, groupFacts)
        : this.#inlineSegments(container, entry, byWork);
      if (!mine) return;

      const contentId = ref ?? (entry?.contentId ? String(entry.contentId) : container.contentId);
      const performance = isPlainObject(entry) && entry.performance ? entry.performance : undefined;
      for (const segment of mine) {
        segments.push({ ...segment, contentId, part: index, ...(performance ? { performance } : {}) });
      }
      slots.push({ contentId, index, sounding: 0 });
    });

    const placed = withOffsets(this.#renumberGroups(segments));
    for (const segment of placed) {
      const slot = slots[segment.part];
      if (slot) slot.sounding += segment.duration;
    }
    container.payload.segments = placed;
    container.payload.groupFacts = groupFacts;
    container.payload.timeline = {
      totalSounding: placed.reduce((n, c) => n + c.duration, 0),
      parts: slots
    };
  }

  /**
   * Number the groups on a composed rail by their position ON THAT RAIL.
   *
   * `group.index` has to mean "which heading is this, counting along this rail"
   * — and until this ran, it meant "position in whatever produced me". Both
   * sources of a group number from zero independently: `#resolveSegments` uses
   * a counter that is fresh per call, and a part's stamped group used its part
   * index. So an outer container whose two ordinary parts each resolve a work
   * that uses segment references received two groups both claiming index 0, and
   * the band prints one heading over two different sets. No nesting required —
   * two plain sidecars are enough.
   *
   * A run is detected by object identity, not by work: every segment of one
   * group shares the group object it was stamped with, so two consecutive parts
   * that happen to play the SAME work still get two headings — a set played
   * twice is two appearances, the same rule `#resolveSegments` follows when one
   * container names one work twice. An ungrouped segment between two runs
   * closes the run, so a group reappearing after an interlude is numbered again.
   *
   * @param {Array<Object>} segments - The composed rail, in order
   * @returns {Array<Object>} The same segments with groups renumbered
   * @private
   */
  #renumberGroups(segments) {
    let source = null;
    let renumbered = null;
    let index = -1;
    return segments.map((segment) => {
      if (!segment.group) {
        source = null;
        return segment;
      }
      if (segment.group !== source) {
        source = segment.group;
        index += 1;
        // One replacement object shared across the run, so the identity that
        // detected the run survives into the payload for anyone grouping by it.
        renumbered = { ...segment.group, index };
      }
      return { ...segment, group: renumbered };
    });
  }

  /**
   * Segments of the sidecar a reference-form part names, or null to skip it.
   *
   * NESTING IS REFUSED, not supported, for two reasons that outlive the
   * ordering problem. First: composition takes a part's segments and stamps
   * every one of them with THAT PART's contentId. An inner container's segments
   * already name their own leaf media items, so composing it would overwrite
   * real, playable ids with the inner container's own — which is a Plex season,
   * not a media item, and cannot be played or sought. Second: composition runs
   * in walk order, so an inner container may still hold its provisional empty
   * rail when an outer one reads it, and the same data would compose or
   * silently empty depending on how the two files happen to sort.
   *
   * (Group numbering used to be the third reason and no longer is —
   * `#renumberGroups` now owns `group.index` for the whole rail. Supporting
   * nesting would therefore need the contentId question answered and a
   * dependency-ordered pass; the spec scopes nesting out at one level and
   * nothing authors it, so it stays refused rather than half-working.)
   *
   * @param {Object} groupFacts - Accumulator: each part work's own facts, by
   *   slug. Filled here rather than in a second walk because this is the only
   *   place that holds the resolved part beside the group it is stamped with —
   *   a later pass over the composed rail has the slug and no way back to the
   *   sidecar it came from.
   * @private
   */
  #referencedSegments(container, contentId, authored, byContentId, groupFacts = {}) {
    const part = byContentId.get(contentId);
    // A container listing itself is a cycle wearing a different hat.
    if (!part || part === container) {
      this.logger?.warn?.('surround.part.missing', { file: container.file, contentId, index: authored });
      return null;
    }
    if (part.parts) {
      this.logger?.warn?.('surround.part.nested', {
        file: container.file, contentId, index: authored, partFile: part.file
      });
      return null;
    }
    // The heading above these segments names the work the part PLAYS — the
    // part's own `work:`, not the container's. Where a part's own corpus work
    // used segment references it arrived already grouped, and those inner
    // labels are more specific than anything nameable from out here. Neither
    // kind carries its own index: `#renumberGroups` assigns every one of them.
    const group = { work: part.work, title: part.payload.piece?.title ?? part.work };
    // The heading's facts travel with the heading. Only a part that authored
    // some is recorded: an empty entry and an absent one mean the same thing to
    // the band (fall through to the container's facts), and an empty array on
    // the wire is a claim the corpus never made.
    if (part.work && part.payload.facts?.length) groupFacts[part.work] = part.payload.facts;
    return part.payload.segments.map((c) => (c.group ? c : { ...c, group }));
  }

  /**
   * Segments an inline-form part times itself, taken from the container's own
   * resolved list and paired with the spans the entry authored.
   *
   * @private
   */
  #inlineSegments(container, entry, byWork) {
    const key = typeof entry?.work === 'string' ? entry.work.trim() : null;
    const mine = byWork.get(key) ?? [];
    if (Array.isArray(entry?.spans) && entry.spans.length !== mine.length) {
      this.logger?.warn?.('surround.spans.mismatch', {
        file: container.file, work: key, spans: entry.spans.length, segments: mine.length
      });
    }
    const spans = toSpans({ spans: entry?.spans, count: mine.length });
    return mine.map((c, i) => ({ ...c, ...spans[i] }));
  }

  /**
   * Report segments that occupy no width on the rail — where that is a gap
   * rather than the normal authored state.
   *
   * A segment with no usable end is placed at zero width deliberately:
   * `withOffsets` puts only sounding time on the rail. The consequence is that
   * it shares its offset with whatever follows, can never be the "current"
   * segment, and — in a container — puts a part boundary at an ambiguous
   * position. The tie-break for anything mapping a position back to a segment
   * is stated on `withOffsets`: at a shared offset the LATER segment wins.
   *
   * Two cases warn, and one deliberately does not:
   *
   * - A CONTAINER with any untimed segment. This is Task 10's outstanding work
   *   made visible. It is also the only place the gap lands mid-rail, at a part
   *   boundary, where it can send the transport into the wrong media item.
   * - Any piece with an untimed segment that is NOT the last on its rail — a
   *   piece whose timings were never authored at all, rather than one missing
   *   its final bound.
   * - A single item whose LAST segment alone is unterminated stays quiet. That
   *   is the authored shorthand for "runs to the end of the file": the media's
   *   own duration supplies the end at playback and the store cannot know it.
   *   Eight of the nineteen authored pieces are in exactly that state, and
   *   warning about all of them would bury the two cases that matter.
   *
   * This is the successor to `surround.spans.mismatch` as the "timings pending"
   * signal — that warning stood in for it under the superseded design, and the
   * reference design correctly made it unreachable, leaving the gap invisible.
   *
   * @private
   */
  #warnUntimed(piece) {
    const segments = piece.payload.segments;

    // ZERO SEGMENTS IS THE LOUDEST CASE AND USED TO BE THE QUIETEST ONE.
    // Everything below reasons about segments that are on the rail with no
    // width; a piece with NO segments at all fell out at `!untimed.length` and
    // said nothing. That is exactly the signature of a corpus migrated ahead of
    // the deploy — every sidecar resolves, every index counter looks healthy,
    // `surround.index.built` reports the usual piece count, and every rail is
    // empty. It was noticed on a screen instead of in the log store, which is
    // the failure this warning exists to make impossible a second time.
    //
    // `segmentKey` names which of the three spellings actually won, so the log
    // answers "did the corpus rename land under a name this build knows" in one
    // query rather than by reading a YAML file on a mounted volume.
    if (!segments.length) {
      this.logger?.warn?.('surround.segments.none', {
        file: piece.file,
        work: piece.work,
        segmentKey: piece.segmentKey,
        // A container with no parts composed is a different fault from a leaf
        // whose work authored nothing; both land here and the log has to tell
        // them apart.
        parts: piece.parts ? piece.parts.length : 0
      });
      return;
    }

    const untimed = segments.filter((c) => c.duration === 0);
    if (!untimed.length) return;
    const trailingOnly = untimed.length === 1 && untimed[0] === segments[segments.length - 1];
    if (trailingOnly && !piece.parts) return;

    this.logger?.warn?.('surround.segments.untimed', {
      file: piece.file,
      untimed: untimed.length,
      segments: segments.length,
      // Which media items are short a timing, so a container names the sidecars
      // to go and fix rather than only the season that surfaced the gap.
      parts: [...new Set(untimed.map((c) => c.contentId))],
      names: untimed.slice(0, 5).map((c) => c.name).filter((n) => typeof n === 'string')
    });
  }

  /**
   * Map every media item on some rail to the payload that carries it.
   *
   * Two passes, and the order is the behavior: a piece's claim on ITSELF is laid
   * down first, and a container's claim on its parts overwrites it. Playing the
   * second étude episode inside the season has to raise the whole set, so the
   * container has to win — while an item nobody contains still answers with its
   * own payload at part 0.
   *
   * A composed container makes no claim on ITSELF: its slots name its parts, so
   * `lookupByPart(seasonId)` is null by construction. That is right — a Plex
   * season is not a media item and has no position on its own rail — but it
   * means callers cannot migrate off `lookup` wholesale; ask this first and fall
   * back to `lookup` for the id that has no part.
   *
   * @param {Array<Object>} pieces
   * @returns {Map<string, {payload: Object, part: number}>}
   * @private
   */
  #indexParts(pieces) {
    const byPart = new Map();
    const claimedBy = new Map();
    const claim = (piece, wantSelf) => {
      for (const slot of asArray(piece.payload.timeline?.parts)) {
        const id = String(slot.contentId);
        if ((slot.contentId === piece.contentId) !== wantSelf) continue;
        // Only container claims can genuinely collide — a piece's claim on
        // itself is unique because contentIds are already deduped upstream. Two
        // containers naming one episode is an authoring mistake with no right
        // answer, so name both files rather than let walk order decide in
        // silence which rail that episode plays on.
        if (!wantSelf && claimedBy.has(id)) {
          this.logger?.warn?.('surround.part.claimed', {
            contentId: id, keptFile: piece.file, droppedFile: claimedBy.get(id)
          });
        }
        if (!wantSelf) claimedBy.set(id, piece.file);
        byPart.set(id, { payload: piece.payload, part: slot.index });
      }
    };
    for (const piece of pieces) claim(piece, true);
    for (const piece of pieces) claim(piece, false);
    return byPart;
  }

  /**
   * Read one performance sidecar and resolve it against the knowledge corpus
   * into the payload the API attaches verbatim.
   *
   * Precedence, per the design doc: composer <- work <- performance, applied
   * separately to the composer block and the piece block. Segments and cues
   * come from the work; `starts` pairs with them positionally (starts[i] is
   * segments[i]'s start second), which is also how a segment's `note` becomes
   * a synthesized, segment-anchored cue.
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
      // Both halves of the miss, because the two trees are edited separately and
      // the reference alone does not say where the corpus was searched. `expected`
      // is a glob, not a path: #loadLibraryDir keys a work by its composer folder
      // at whatever depth it sits, so the corpus may file it under any number of
      // grouping directories. Naming a single path here would send an author to
      // create a duplicate one level up from the file they already have.
      const [composer, slug] = doc.work.split('/');
      this.logger?.warn?.('surround.work.missing', {
        work: doc.work,
        expected: path.join(domain, '**', composer ?? '', `${slug ?? ''}.yml`),
        file
      });
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
    if (isPresent(doc.parts) && !Array.isArray(doc.parts)) soft.push('parts-not-a-list');
    if (isPresent(doc.composer) && !isPlainObject(doc.composer)) soft.push('composer-not-a-mapping');
    if (isPresent(doc.piece) && !isPlainObject(doc.piece)) soft.push('piece-not-a-mapping');

    // A start is an offset in seconds from the top of the media, so the only
    // usable value is a non-negative finite number. Anything else — a quoted
    // timestamp, a stray null holding a place, a negative from arithmetic
    // against the wrong reference point — is dropped to undefined rather than
    // passed through, the same way every other wrong-typed field here is
    // flattened by a guard. Positions are preserved (map, not filter): starts
    // pairs with segments positionally, so dropping an entry outright would
    // silently shift every later segment's timing by one.
    const rawStarts = Array.isArray(doc.starts) ? doc.starts : [];
    const starts = rawStarts.map(num);
    if (starts.some((v) => v === undefined)) soft.push('starts-entry-invalid');
    if (soft.length) this.#invalid(file, soft);

    // Seeded with the sidecar's own work so a container that lists itself is a
    // cycle on the first hop rather than the second. An empty resolution falls
    // back to the raw legacy list: that is the path every corpus file authored
    // before segment references existed still takes, and `starts` pairs
    // positionally with whichever list wins here.
    //
    // THE FALLBACK IS THE LEGACY KEY ONLY, deliberately not `authoredSegments`.
    // A work that authors `segments:` (or the interim `chapters:`) and whose
    // references all fail to resolve — a cycle, or a target the corpus does not
    // hold — has an empty rail, which is what it has always had. Reading the
    // authored list here instead would put unexpanded `work:` reference entries
    // on the rail, where they would render as segments named after a file path.
    const seenRefs = new Set([doc.work]);
    // Which of the three spellings this work actually authored, carried to the
    // warnings so an empty rail says WHY it is empty. See #warnUntimed.
    const { key: segmentKey } = authoredSegments(work);
    const resolved = this.#resolveSegments(work, library, seenRefs);
    const pieceSegments = resolved.length ? resolved : asArray(work[LEGACY_SEGMENT_KEY]);
    // Length, not content: an author who timed the wrong number of segments has
    // a different problem from one who mistyped a single value, and a dropped
    // entry above still counts toward the length it was authored at.
    if (starts.length && starts.length !== pieceSegments.length) {
      this.logger?.warn?.('surround.starts.mismatch', { file, starts: starts.length, segments: pieceSegments.length });
    }

    const resolvedPieceSegments = pieceSegments.map((m, i) => ({ ...m, start: starts[i] }));

    // Two ways a rail gets its timing, and a sidecar picks by whether it has
    // `parts:` at all.
    //
    // A container's rail is built in the second pass, by #composeContainers,
    // because a part may name a sidecar this walk has not reached yet. Both part
    // forms resolve there — see that method for why classifying them here made
    // one inline entry silently demote every reference beside it. The rail is
    // left EMPTY here on purpose: a container that never composes shows nothing
    // rather than its untimed corpus segments stamped with the season's own id,
    // which would read as real.
    //
    // Everything else — every sidecar authored before any of this existed — is
    // one media item, which is part 0 of a one-part rail.
    const parts = Array.isArray(doc.parts) && doc.parts.length ? doc.parts : null;
    const selfId = String(doc.match.contentId);
    let segments = [];
    let timelineParts = [];

    if (!parts) {
      const spans = toSpans({
        starts: rawStarts, musicEndsAt: doc.musicEndsAt, spans: doc.spans, count: pieceSegments.length
      });
      segments = withOffsets(pieceSegments.map((m, i) => ({ ...m, ...spans[i], contentId: selfId, part: 0 })));
      timelineParts = [{ contentId: selfId, index: 0, sounding: segments.reduce((n, c) => n + c.duration, 0) }];
    }

    const pieceSegmentCues = pieceSegments
      .map((m, i) => ({ at: starts[i], text: m.note }))
      .filter((c) => typeof c.at === 'number' && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({ at: c.at, render: 'docked', text: c.text }));
    const explicitCues = asArray(doc.cues);
    const cues = [...pieceSegmentCues, ...explicitCues].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

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
      contentId: selfId,
      title: typeof doc.match.title === 'string' ? doc.match.title : '',
      normalized: normalizeTitle(doc.match.title),
      // Carried for the second pass and the warnings it emits: which file to
      // name, which work this piece plays, which key that work authored its
      // list under, the parts it is still owed, and the segments an inline part
      // times against.
      file,
      work: doc.work,
      segmentKey,
      parts,
      ownSegments: pieceSegments,
      payload: {
        id: doc.surround,
        // `band` joins `regions`/`collapse` as the third thing a definition
        // says about a frame: which side the NOW register sits on, whether it
        // prints a segment heading, and what density the rail is in (see
        // frontend `modules/Surround/band.js`, which resolves and defaults
        // every one of them, so an unauthored `band` is the normal case).
        definition: {
          regions: definition.regions,
          collapse: definition.collapse,
          band: definition.band
        },
        piece,
        pieceSegments: resolvedPieceSegments,
        segments,
        timeline: { totalSounding: segments.reduce((n, c) => n + c.duration, 0), parts: timelineParts },
        cues,
        facts: asArray(work.facts),
        // Empty unless this piece is a container that composes — #composeOne
        // replaces it with each part work's own facts. Present on every payload
        // so the shape does not change under the frontend when a container
        // fails to compose.
        groupFacts: {},
        composer,
        assetBase: `library/${domain}`
      }
    };
  }
}

export default YamlSurroundStore;
