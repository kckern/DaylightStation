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
// Works live one level below the composer, in a folder of their own. A work file
// describes the music; a sidecar beside it describes one recording of that music
// and points at the work by name. Nothing under here is ever a sidecar.
const WORKS_DIR = 'works';
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

/**
 * Index of authored surround sidecars.
 *
 * Tree shape: <rootDir>/<domain>/<composer>/<piece>.yml, with shared composer
 * identity in <composer>/_composer.yml and region layouts in _surrounds/.
 * A surround is enrichment attached to playback responses, not playable
 * content, so this is a plain store — it is not registered as a content source.
 *
 * A sidecar is a *recording*. One piece of music can be recorded many times, so
 * everything recording-independent — title, movement names, teaching text, cues,
 * facts — may live once in <composer>/works/<work>.yml and be named by a sidecar's
 * `work:` key. The sidecar then carries only what is true of that performance:
 * the match, the measured `starts`, `musicEndsAt`, the players. The merged result
 * is byte-for-byte the payload a single flat sidecar produces, so both shapes
 * coexist and the frontend never learns which one an author used.
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
   * @param {string} options.rootDir - Root of the sidecar tree (data/content/surround)
   * @param {Object} options.logger - Structured logger
   */
  constructor({ rootDir, logger }) {
    super();
    this.rootDir = rootDir;
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
   * `works/` is stat-ed too. A work file is an input to every recording that
   * names it, so an edit there changes several payloads at once — the case where
   * an author would most notice a store that only watched the file they had open.
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

    for (const domain of listDirs(this.rootDir).filter((d) => !isReserved(d))) {
      const domainDir = path.join(this.rootDir, domain);
      consider(domainDir);

      for (const composer of this.#composerDirs(domainDir)) {
        const composerDir = path.join(domainDir, composer);
        consider(composerDir);
        // Unfiltered: _composer.yml is shared identity, and editing it changes
        // every piece under the folder.
        for (const file of listYamlFiles(composerDir, { stripExtension: false })) {
          consider(path.join(composerDir, file));
        }

        const worksDir = path.join(composerDir, WORKS_DIR);
        consider(worksDir);
        for (const file of listYamlFiles(worksDir, { stripExtension: false })) {
          consider(path.join(worksDir, file));
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
    let composers = 0;
    // Piece candidates read but rejected. A malformed definition shows up here too,
    // as every piece naming it is rejected in turn.
    let skipped = 0;
    let definitions = new Map();
    // Work files read this build, by path relative to rootDir. Sharing one work
    // across many recordings is the whole point of the split, so it is read once
    // however many sidecars name it — and a missing one is remembered as null.
    const works = new Map();

    try {
      definitions = this.#loadDefinitions();

      for (const domain of listDirs(this.rootDir).filter((d) => !isReserved(d))) {
        const domainDir = path.join(this.rootDir, domain);

        for (const composer of this.#composerDirs(domainDir)) {
          const composerDir = path.join(domainDir, composer);
          const composerBase = loadYamlFromPath(path.join(composerDir, `${COMPOSER_FILE}.yml`));
          if (isPlainObject(composerBase)) composers += 1;

          // Only the composer folder itself is listed, never `works/` below it:
          // a work file has no `match`, so walking it would mean a
          // `missing-match` warning per work file on every build.
          const files = listYamlFiles(composerDir, { stripExtension: false })
            .filter((f) => !isReserved(f));

          for (const file of files) {
            // Relative to rootDir, because that is how the author knows the file.
            // Every warning below is addressed to whoever wrote the sidecar.
            const relFile = path.join(domain, composer, file);
            const resolved = this.#resolvePiece(path.join(composerDir, file), relFile,
              { domain, composer, composerBase, definitions, works });
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
      composers,
      definitions: definitions.size,
      works: [...works.values()].filter(Boolean).length,
      ms: Date.now() - startedAt
    });
  }

  /**
   * Composer folders under a domain.
   *
   * `works/` is excluded here as well as under each composer: a folder by that
   * name holds works, at any depth, and is never itself a composer.
   *
   * @param {string} domainDir
   * @returns {string[]}
   * @private
   */
  #composerDirs(domainDir) {
    return listDirs(domainDir).filter((d) => !isReserved(d) && d !== WORKS_DIR);
  }

  /**
   * Turn a sidecar's `work:` reference into a path relative to rootDir.
   *
   * `beethoven/symphony-3-eroica` resolves to
   * `<domain>/beethoven/works/symphony-3-eroica.yml`; a bare `symphony-3-eroica`
   * resolves under the sidecar's own composer, which is the common case. The
   * containment check is what stops `../../../etc/passwd` from being a work.
   *
   * @returns {string|null} null when the reference cannot name a file in the tree
   * @private
   */
  #workPath(ref, domain, composer) {
    try {
      const clean = String(ref).trim().replace(/\.(yml|yaml)$/, '');
      const dir = path.posix.dirname(clean);
      const base = path.posix.basename(clean);
      if (!base || base === '.' || base === '..') return null;

      const rel = path.join(domain, dir === '.' ? composer : dir, WORKS_DIR, `${base}.yml`);
      const root = path.resolve(this.rootDir);
      if (!path.resolve(this.rootDir, rel).startsWith(root + path.sep)) return null;
      return rel;
    } catch {
      return null;
    }
  }

  /**
   * Read a work file once per build, remembering misses as null.
   * @private
   */
  #loadWork(relPath, works) {
    if (works.has(relPath)) return works.get(relPath);
    const doc = loadYamlFromPath(path.join(this.rootDir, relPath));
    const value = isPlainObject(doc) ? doc : null;
    works.set(relPath, value);
    return value;
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
   * @param {Object} [extra] - Context the reason alone cannot carry, e.g. the
   *   resolved `work` path, so a `work-not-found` says which file it looked for
   * @private
   */
  #invalid(file, reasons, extra) {
    this.logger?.warn?.('surround.sidecar.invalid', { file, reason: reasons[0], reasons, ...(extra ?? {}) });
  }

  /**
   * Read one piece sidecar and resolve it into the payload the API attaches verbatim.
   *
   * Validation is warning-only: what is rejected here is exactly what was
   * rejected before, and every coercion still coerces. The difference is that
   * a dropped or flattened sidecar now says so, since failing soft otherwise
   * makes an authoring typo indistinguishable from an unauthored item.
   *
   * A sidecar naming a `work:` is resolved against that file here, and the merge
   * is the whole contract: movement names come from the work and their `start`s
   * from this recording's `starts`, index by index. That zip is the one place the
   * split can go quietly wrong — a work that gained a movement while a recording
   * kept its old timings would put every later movement's text against the wrong
   * music — so unequal lengths reject the piece rather than mis-time it.
   *
   * @returns {{ contentId: string, title: string, normalized: string, payload: Object }|null}
   * @private
   */
  #resolvePiece(filePath, file, { domain, composer, composerBase, definitions, works }) {
    const doc = loadYamlFromPath(filePath);
    if (!isPlainObject(doc)) {
      // The file came from a directory listing, so it exists. FileIO folds a
      // syntax error into the same null it returns for an absent file — here,
      // only the former is possible.
      this.#invalid(file, [isPresent(doc) ? 'not-a-mapping' : 'yaml-unparseable']);
      return null;
    }

    // Blocking problems short-circuit: there is nothing useful to say about
    // `match.title` in a file that has no `match` block.
    const blocking = [];
    if (!doc.surround) blocking.push('missing-surround');
    if (!isPlainObject(doc.match)) blocking.push(isPresent(doc.match) ? 'match-not-a-mapping' : 'missing-match');
    else if (!doc.match.contentId) blocking.push('missing-match-contentId');
    const namesWork = isPresent(doc.work);
    if (namesWork && (typeof doc.work !== 'string' || !doc.work.trim())) blocking.push('work-not-a-string');
    if (blocking.length) { this.#invalid(file, blocking); return null; }

    const definition = definitions.get(doc.surround);
    if (!definition) {
      // Its own event, not a sidecar problem: the sidecar may be perfect and the
      // definition file the thing that was renamed or never written.
      this.logger?.warn?.('surround.definition.missing', { id: doc.surround, file });
      return null;
    }

    // The work is what this recording is a recording of. Failing to find it means
    // there is no title, no movement names, no cues — nothing to shrink the
    // player for — so the piece is excluded, and the warning names the path that
    // was looked for rather than the reference that was written.
    const workFile = namesWork ? this.#workPath(doc.work, domain, composer) : null;
    const work = workFile ? this.#loadWork(workFile, works) : null;
    if (namesWork && !work) {
      this.#invalid(file, ['work-not-found'], { work: workFile ?? doc.work });
      return null;
    }

    // Non-blocking, so the piece still indexes exactly as it did before. Each of
    // these is a silent loss the author would otherwise only notice as a region
    // that renders empty: no title means no rebind when the ratingKeys churn,
    // and a wrong-typed list is flattened to nothing by the guards below.
    const soft = [];
    if (typeof doc.match.title !== 'string' || !doc.match.title.trim()) soft.push('missing-match-title');

    const source = work ?? doc;
    // Reasons are prefixed when the fault is in the work file, because the
    // warning names the sidecar and the two files are edited separately.
    const at = work ? 'work-' : '';
    if (!work && !isPresent(doc.piece)) soft.push('missing-piece');
    else if (isPresent(source.piece) && !isPlainObject(source.piece)) soft.push(`${at}piece-not-a-mapping`);
    for (const key of ['movements', 'cues', 'facts']) {
      if (isPresent(source[key]) && !Array.isArray(source[key])) soft.push(`${at}${key}-not-a-list`);
    }
    if (work && isPresent(doc.starts) && !Array.isArray(doc.starts)) soft.push('starts-not-a-list');
    // Inline blocks beside a `work:` are a half-finished migration: the work wins,
    // and without this the author's edits to the sidecar copy would vanish silently.
    if (work && ['piece', 'movements', 'cues', 'facts'].some((k) => isPresent(doc[k]))) {
      soft.push('inline-blocks-ignored');
    }
    if (isPresent(doc.composer) && !isPlainObject(doc.composer)) soft.push('composer-not-a-mapping');

    // Shapes are guarded, not trusted: an indentation slip that turns `movements`
    // into a string would otherwise reach a module's .map() and throw in render,
    // taking the player subtree down with it.
    const starts = asArray(doc.starts);
    let movements = asArray(source.movements);
    if (work) {
      if (movements.length !== starts.length) {
        this.#invalid(file, ['starts-length-mismatch', ...soft],
          { work: workFile, movements: movements.length, starts: starts.length });
        return null;
      }
      movements = movements.map((m, i) => ({ ...(isPlainObject(m) ? m : {}), start: starts[i] }));
    }
    if (soft.length) this.#invalid(file, soft, work ? { work: workFile } : undefined);

    // The recording measures where the music stops; the work cannot know it.
    let piece = isPlainObject(source.piece) ? source.piece : {};
    if (isPresent(doc.musicEndsAt)) piece = { ...piece, musicEndsAt: doc.musicEndsAt };

    return {
      // YAML parses a bare `contentId: 663134` as a number; keys are always strings.
      contentId: String(doc.match.contentId),
      title: typeof doc.match.title === 'string' ? doc.match.title : '',
      normalized: normalizeTitle(doc.match.title),
      payload: {
        id: doc.surround,
        definition: { regions: definition.regions, collapse: definition.collapse },
        piece,
        movements,
        cues: asArray(source.cues),
        facts: asArray(source.facts),
        // Piece-level `composer:` overrides the shared _composer.yml, key by key;
        // a recording may override the work in turn, for the rare case where the
        // performance itself changes what should be said about the composer.
        composer: deepMerge(
          deepMerge(
            isPlainObject(composerBase) ? composerBase : {},
            isPlainObject(work?.composer) ? work.composer : {}
          ),
          isPlainObject(doc.composer) ? doc.composer : {}
        ),
        // Who played it, on this recording only. Absent on the flat shape and on
        // works that were never performed by anyone in particular.
        ...(isPresent(doc.performance) ? { performance: doc.performance } : {}),
        assetBase: `surround/${domain}`
      }
    };
  }
}

export default YamlSurroundStore;
