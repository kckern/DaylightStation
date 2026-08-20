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
import { toSpans, withOffsets, num } from './chapters.mjs';

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
// `spans` it is the inline form, which times the CONTAINER's own chapters and
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
   * second étude episode has to raise the whole twenty-seven-chapter rail with
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

    // Second pass. Guarded on its own so a container that cannot be composed
    // never costs the pieces that resolved perfectly well without it.
    try {
      this.#composeContainers(pieces);
    } catch {
      // Containers keep whatever their own resolution produced.
    }

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
      // Pieces whose rail spans more than one media item. Zero of these and the
      // whole composition pass is inert, which is worth being able to see.
      containers: pieces.filter((p) => (p.payload.timeline?.parts?.length ?? 0) > 1).length,
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
      // author's only symptom is a movement map that renders empty. Warn and
      // keep going: a work with one bad list is still worth indexing.
      const reasons = [];
      for (const key of ['movements', 'facts']) {
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
   * Flatten a work's chapters, following `work:` references into their targets.
   *
   * A reference resolves to a SUBTREE, not a leaf: naming `chopin/etudes-op-10`
   * brings its twelve études with it. `group` records which work a chapter came
   * from, because the rail is flat but the labels above it are not.
   *
   * `chapters:` and `movements:` are one key under two names — the corpus has
   * 1,492 files authored with `movements:` and nothing is being renamed, so a
   * work that authors neither, or authors `chapters:` empty, resolves to nothing
   * and the caller falls back to the movements list it always read.
   *
   * `group.index` numbers PARTS, not chapters, so it is carried by a counter
   * threaded through the recursion rather than derived from whatever the last
   * chapter happened to hold. Deriving it is wrong in two ways at once: an
   * inline chapter between two references carries no group to read, and a
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
  #resolveChapters(work, library, seen, group = null, counter = { parts: 0 }) {
    const own = asArray(work.chapters).length ? asArray(work.chapters) : asArray(work.movements);
    const out = [];
    for (const entry of own) {
      if (!isPlainObject(entry)) continue;
      const ref = typeof entry.work === 'string' ? entry.work.trim() : '';
      if (!ref) { out.push(group ? { ...entry, group } : entry); continue; }

      if (seen.has(ref)) {
        this.logger?.warn?.('surround.chapter.cycle', { work: ref });
        continue;
      }
      const target = library.works.get(ref);
      if (!target) {
        this.logger?.warn?.('surround.chapter.missing', { work: ref });
        continue;
      }
      // Added before the descent and removed after it, exactly as #loadLibraryDir
      // guards the corpus walk: the set records the path currently being
      // expanded, not everything ever expanded. A container that names the same
      // work twice is a repeat, and a repeat is not a cycle.
      seen.add(ref);
      const childGroup = { work: ref, title: target.title ?? ref, index: counter.parts };
      counter.parts += 1;
      out.push(...this.#resolveChapters(target, library, seen, childGroup, counter));
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
   * Give every container the chapters of the sidecars it names.
   *
   * A part is a contentId, never a timing. The three étude episodes are already
   * authored as ordinary sidecars that resolve and play standalone; the
   * container concatenates what they resolved, and restates nothing. So this
   * takes each part's chapters verbatim — their `start`/`end` stay in their own
   * media item's clock — stamps them with the part they came from, and lays the
   * concatenation back onto ONE sounding rail with `withOffsets`. The rail is
   * global; the timings on it are local; that pairing is what lets one frame
   * span seven polonaises.
   *
   * A part naming a contentId with no sidecar is warned and skipped rather than
   * faulting the container: six polonaises with a rail is worth more than seven
   * with nothing. Surviving parts are numbered densely, so `timeline.parts[n]`
   * is always the part that `chapter.part === n` belongs to — a gap there would
   * make every later part's sounding total accrue to the wrong slot.
   *
   * @param {Array<Object>} pieces - Every sidecar that resolved, in walk order
   * @private
   */
  #composeContainers(pieces) {
    const byContentId = new Map();
    for (const piece of pieces) byContentId.set(piece.contentId, piece);

    for (const container of pieces) {
      if (!container.partRefs) continue;

      const chapters = [];
      const timelineParts = [];
      container.partRefs.forEach((contentId, authored) => {
        const part = byContentId.get(contentId);
        // A container listing itself would otherwise compose its own empty
        // provisional chapters into itself, which is a cycle wearing a
        // different hat. `authored` is the position in the YAML, because that
        // is the line the author has to go and fix.
        if (!part || part === container) {
          this.logger?.warn?.('surround.part.missing', { file: container.file, contentId, index: authored });
          return;
        }

        const index = timelineParts.length;
        // The heading above these chapters names the work the part PLAYS, which
        // is the part's own `work:` — not the container's. A part that is itself
        // a container brought its own inner groups along, and those are more
        // specific than anything nameable from out here, so they stand.
        const group = { work: part.work, title: part.payload.piece?.title ?? part.work, index };
        for (const chapter of part.payload.chapters) {
          chapters.push({ ...chapter, contentId, part: index, ...(chapter.group ? {} : { group }) });
        }
        timelineParts.push({ contentId, index, sounding: 0 });
      });

      const placed = withOffsets(chapters);
      for (const chapter of placed) {
        const slot = timelineParts[chapter.part];
        if (slot) slot.sounding += chapter.duration;
      }
      container.payload.chapters = placed;
      container.payload.timeline = {
        totalSounding: placed.reduce((n, c) => n + c.duration, 0),
        parts: timelineParts
      };
    }
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
   * @param {Array<Object>} pieces
   * @returns {Map<string, {payload: Object, part: number}>}
   * @private
   */
  #indexParts(pieces) {
    const byPart = new Map();
    const claim = (piece, wantSelf) => {
      for (const slot of asArray(piece.payload.timeline?.parts)) {
        if ((slot.contentId === piece.contentId) !== wantSelf) continue;
        byPart.set(String(slot.contentId), { payload: piece.payload, part: slot.index });
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
    // pairs with movements positionally, so dropping an entry outright would
    // silently shift every later movement's timing by one.
    const rawStarts = Array.isArray(doc.starts) ? doc.starts : [];
    const starts = rawStarts.map(num);
    if (starts.some((v) => v === undefined)) soft.push('starts-entry-invalid');
    if (soft.length) this.#invalid(file, soft);

    // Seeded with the sidecar's own work so a container that lists itself is a
    // cycle on the first hop rather than the second. An empty resolution falls
    // back to the raw movements list: that is the path every corpus file
    // authored before chapter references existed still takes, and `starts`
    // pairs positionally with whichever list wins here.
    const seenRefs = new Set([doc.work]);
    const resolved = this.#resolveChapters(work, library, seenRefs);
    const movements = resolved.length ? resolved : asArray(work.movements);
    // Length, not content: an author who timed the wrong number of movements has
    // a different problem from one who mistyped a single value, and a dropped
    // entry above still counts toward the length it was authored at.
    if (starts.length && starts.length !== movements.length) {
      this.logger?.warn?.('surround.starts.mismatch', { file, starts: starts.length, movements: movements.length });
    }

    const resolvedMovements = movements.map((m, i) => ({ ...m, start: starts[i] }));

    // Three ways a rail gets its timing, and a sidecar picks exactly one.
    //
    // `partRefs` is the authored case: the parts are contentIds and every timing
    // lives in the part's own sidecar, so nothing can be computed here — it is
    // resolved in #composeContainers once the whole tree has been read.
    //
    // Inline parts are the fallback for a one-off container with no per-part
    // sidecars to compose: it times its OWN resolved chapters, part by part.
    //
    // Everything else — every sidecar authored before any of this existed — is
    // one media item, which is part 0 of a one-part rail.
    const parts = asArray(doc.parts);
    const partRefs = parts.length && parts.every((p) => partRef(p) !== null) ? parts.map(partRef) : null;
    const selfId = String(doc.match.contentId);
    let chapters = [];
    let timelineParts = [];

    if (partRefs) {
      // Left empty on purpose: composition replaces both. A container that
      // resolves alone shows an empty rail rather than twenty-seven untimed
      // chapters stamped with the season's own id, which would read as real.
    } else if (parts.length) {
      // Group the resolved chapters by the part that performs them, so a part's
      // spans pair with its OWN chapters. Pairing against the flat list would
      // make one miscounted part shift every later part's timings.
      const byWork = new Map();
      for (const c of resolved) {
        const key = c.group?.work ?? null;
        if (!byWork.has(key)) byWork.set(key, []);
        byWork.get(key).push(c);
      }
      parts.forEach((part, index) => {
        const key = typeof part?.work === 'string' ? part.work.trim() : null;
        const mine = byWork.get(key) ?? [];
        const contentId = part?.contentId ? String(part.contentId) : selfId;
        if (Array.isArray(part?.spans) && part.spans.length !== mine.length) {
          this.logger?.warn?.('surround.spans.mismatch', { file, work: key, spans: part.spans.length, chapters: mine.length });
        }
        const partSpans = toSpans({ spans: part?.spans, count: mine.length });
        mine.forEach((c, i) => chapters.push({
          ...c, ...partSpans[i], contentId, part: index,
          ...(part?.performance ? { performance: part.performance } : {})
        }));
        timelineParts.push({ contentId, index, sounding: 0 });
      });
      chapters = withOffsets(chapters);
      for (const c of chapters) {
        const slot = timelineParts[c.part];
        if (slot) slot.sounding += c.duration;
      }
    } else {
      const spans = toSpans({
        starts: rawStarts, musicEndsAt: doc.musicEndsAt, spans: doc.spans, count: movements.length
      });
      chapters = withOffsets(movements.map((m, i) => ({ ...m, ...spans[i], contentId: selfId, part: 0 })));
      timelineParts = [{ contentId: selfId, index: 0, sounding: chapters.reduce((n, c) => n + c.duration, 0) }];
    }

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
      contentId: selfId,
      title: typeof doc.match.title === 'string' ? doc.match.title : '',
      normalized: normalizeTitle(doc.match.title),
      // Carried for the second pass and the warnings it emits: which file to
      // name, which work this piece plays, and which parts it is still owed.
      file,
      work: doc.work,
      partRefs,
      payload: {
        id: doc.surround,
        // `band` joins `regions`/`collapse` as the third thing a definition
        // says about a frame: which side the NOW register sits on, whether it
        // prints a movement heading, and what density the rail is in (see
        // frontend `modules/Surround/band.js`, which resolves and defaults
        // every one of them, so an unauthored `band` is the normal case).
        definition: {
          regions: definition.regions,
          collapse: definition.collapse,
          band: definition.band
        },
        piece,
        movements: resolvedMovements,
        chapters,
        timeline: { totalSounding: chapters.reduce((n, c) => n + c.duration, 0), parts: timelineParts },
        cues,
        facts: asArray(work.facts),
        composer,
        assetBase: `library/${domain}`
      }
    };
  }
}

export default YamlSurroundStore;
