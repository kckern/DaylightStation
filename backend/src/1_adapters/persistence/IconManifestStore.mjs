/**
 * IconManifestStore - resolves a food-icon slug to a file on the media mount.
 * @module adapters/persistence/IconManifestStore
 *
 * The manifest is the SINGLE icon vocabulary (PRD F5.1). It is hand-reviewed,
 * drafted by `cli/curate-nutrition-icons.mjs`, and lives in the data mount at
 * `data/household/apps/health/icon-manifest.yml`:
 *
 *   icons:                       # the OFFERED vocabulary
 *     carrot: { path: img/nutrition/icons/vegetables/carrot.png }
 *   aliases:                     # resolvable, never offered
 *     apple_sauce: { path: img/icons/food/apple_sauce.png }
 *
 * `icons` is what the parse agent chooses from and what the picker lists.
 * `aliases` keep reviewed alternate names requestable without offering them in
 * the picker. They may preserve a legacy nutribot slug when the new vocabulary
 * has an honest equivalent; an unmapped legacy slug deliberately renders the
 * neutral fallback rather than being pointed at a misleading image. Renames
 * happen by editing a path here, never by moving files and hoping the code follows.
 *
 * Filenames live in the manifest, never in code (household rule: no hardcoded
 * asset paths). An unmapped id resolves to null and the caller renders the
 * neutral fallback.
 *
 * Security: `slug` arrives from a URL path segment and is joined against a
 * filesystem root, so it is gated the way PhotoStore gates `photoRef` —
 * a strict allowlist BEFORE the slug takes part in any lookup, then a
 * containment check AFTER the join. Critically, the slug is NEVER concatenated
 * onto a path: it can only select a manifest ENTRY, and the entry's own path is
 * validated independently (no absolute paths, no `..` segments, a closed
 * extension allowlist) before the same containment check applies to it. A `..`
 * cannot reach the filesystem through any of those doors.
 *
 * Containment is checked on the REAL path, not the lexical one. `path.resolve`
 * is purely textual — it collapses `..` and `.` and knows nothing about
 * symlinks — so a link planted inside the media root pointing outside it used
 * to pass, and content from outside the root was served (found in review,
 * reproduced through both a symlinked file and a symlinked directory). Both
 * ends are now realpath'd before comparison. A symlink that stays inside the
 * root is still served; the rule is containment, not a ban on links.
 *
 * The honest limit: reaching that hole needed WRITE ACCESS TO THE MEDIA MOUNT,
 * which is not something a request can obtain. This layer defends against a
 * hostile manifest entry and a hostile slug. It does not, and cannot, defend
 * against an attacker who can already write files into the media tree.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { Jimp } from 'jimp';
import { ensureDir, fileExists, getFileStats, resolveRealPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

/** The ONLY shape a requestable icon slug may take. Never loosened. */
export const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** The only extensions this store will hand to a serving route, and their types. */
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const MANIFEST_ADDRESS = 'apps/health/icon-manifest';

/**
 * The hi-res source art averages ~3 MB per file (median 3.0 MB; 528 of 534
 * offered icons exceed 1 MB). A row renders one at 24 CSS px and the edit
 * sheet's picker shows up to 60 at once, so serving the sources verbatim would
 * cost tens of megabytes for a day's log and well over a hundred for one open
 * picker. Every request therefore serves a downscaled derivative, cached on
 * disk under the DATA mount — never written back into `media/`, which is
 * Dropbox-synced and is read-only as far as this app is concerned.
 *
 * 96px covers both consumers at 2x device pixel ratio (24 CSS px row icon,
 * 40 CSS px picker cell).
 */
const RENDER_WIDTH_PX = 96;
const RENDER_CACHE_DIR = 'apps/health/icon-cache';

/**
 * How many renders may be in flight at once.
 *
 * ONE, deliberately. `jimp` is pure JavaScript: decoding and resizing a 3 MB
 * PNG is ~250-500 ms of SYNCHRONOUS work on the event loop, so raising this
 * buys no parallelism at all — there is one loop — and only lets more of that
 * work queue back-to-back with no gap for anything else.
 *
 * Measured before this gate, on a real backend against the installed manifest:
 * the edit sheet's picker asks for 60 icons at once (`limit=60`), 60 cold
 * renders took 16.3 s wall, and an unrelated lightweight endpoint went from
 * 2.1 ms to 453 ms median and 3.35 s at worst. That is the WHOLE backend
 * stalling — school, media and fitness sit behind the same loop — not just
 * health.
 */
const RENDER_CONCURRENCY = 1;

/** Hand the loop back so queued I/O and other requests get a turn. */
const yieldToLoop = () => new Promise((resolve) => { setImmediate(resolve); });

/**
 * Pre-warm pacing. A render is ~250-500 ms of loop-bound work, so the warm pass
 * sleeps at least as long as it worked before starting the next one — roughly a
 * 50 % duty cycle. It is repairing a cache nobody is waiting on; it must never
 * be the reason a request is slow.
 */
const WARM_PAUSE_MS = 400;
/** A warm pass gives up after this long rather than running unbounded. */
const WARM_BUDGET_MS = 10 * 60 * 1000;

/**
 * The largest source this store will serve UNRENDERED.
 *
 * When the cache is unavailable or a decode fails, falling back to the source
 * looked like the safe choice — an icon is decoration, so serve something. It
 * is not: the sources average ~3 MB, so a broken cache silently re-creates the
 * very defect the renderer exists to fix, and says so only in a warn nobody
 * reads. Observed for real during review: 124 consecutive EACCES failures, each
 * quietly shipping a multi-megabyte PNG, one of them 6.7 MB.
 *
 * So the fallback is now bounded. The legacy flat icons are ~4 KB and stay
 * servable; anything that only makes sense downscaled is REFUSED, which the row
 * renders as its neutral dot. A missing picture is a far smaller harm than a
 * 3 MB one, and the refusal is loud.
 */
const UNRENDERED_SOURCE_MAX_BYTES = 64 * 1024;

export function isValidIconSlug(slug) {
  return typeof slug === 'string' && ICON_SLUG_PATTERN.test(slug);
}

export class IconManifestStore {
  #dataService;
  #mediaRoot;
  #logger;
  #loaded = false;
  #icons = {};
  #aliases = {};
  #foodNames = {};
  #cacheDir = null;
  #cacheDirResolved = false;
  #realRoot = null;
  #inFlight = new Map();
  #active = 0;
  #waiting = [];

  /**
   * @param {Object} options
   * @param {Object} options.dataService - DataService (uses .household.read)
   * @param {string} options.mediaRoot - absolute media directory (ConfigService.getMediaDir())
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    if (!options.dataService) throw new Error('IconManifestStore requires dataService');
    if (!options.mediaRoot) throw new Error('IconManifestStore requires mediaRoot');
    this.#dataService = options.dataService;
    this.#mediaRoot = path.resolve(options.mediaRoot);
    this.#logger = options.logger || console;
  }

  /**
   * Read the manifest once. A missing or malformed manifest yields an EMPTY
   * vocabulary rather than a throw: icons are decoration, and a household that
   * has not installed one must still be able to log food. It is logged at warn
   * so the absence is visible rather than silent.
   */
  #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    let raw = null;
    try {
      raw = this.#dataService.household?.read?.(MANIFEST_ADDRESS) ?? null;
    } catch (e) {
      this.#logger.warn?.('health.icons.manifest.read_failed', { error: e.message });
      return;
    }
    if (!raw || typeof raw !== 'object') {
      this.#logger.warn?.('health.icons.manifest.missing', { address: MANIFEST_ADDRESS });
      return;
    }
    this.#icons = raw.icons && typeof raw.icons === 'object' ? raw.icons : {};
    this.#aliases = raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : {};
    this.#foodNames = raw.foodNames && typeof raw.foodNames === 'object' ? raw.foodNames : {};
    this.#logger.info?.('health.icons.manifest.loaded', {
      icons: Object.keys(this.#icons).length,
      aliases: Object.keys(this.#aliases).length,
    });
  }

  /** Re-read the manifest on the next access (after an operator edits it). */
  reload() {
    this.#loaded = false;
    this.#icons = {};
    this.#aliases = {};
    this.#foodNames = {};
  }

  /** The OFFERED vocabulary, sorted. Aliases are deliberately excluded. */
  list() {
    this.#load();
    return Object.keys(this.#icons).sort();
  }

  /** Reviewed semantic aliases: a null value explicitly means no suitable art. */
  foodNames() {
    this.#load();
    return Object.fromEntries(Object.entries(this.#foodNames)
      .filter(([, slug]) => slug === null || Object.hasOwn(this.#icons, slug)));
  }

  /** True when the slug resolves at all (primary or alias). */
  has(slug) {
    this.#load();
    if (!isValidIconSlug(slug)) return false;
    return Boolean(this.#icons[slug] || this.#aliases[slug]);
  }

  /**
   * Substring search over the offered vocabulary, for the picker.
   * @param {string} query
   * @param {number} [limit=60]
   * @returns {string[]}
   */
  search(query, limit = 60) {
    const q = typeof query === 'string' ? query.toLowerCase().trim() : '';
    const all = this.list();
    return (q ? all.filter((slug) => slug.includes(q)) : all).slice(0, Math.max(0, limit));
  }

  /**
   * Resolve a slug to a file on disk.
   *
   * Returns null (never throws) when the slug fails the allowlist, is absent
   * from the manifest, names a path that escapes the media root or has a
   * disallowed extension, or names a file that is not there — the last case
   * being what a Dropbox conflicted copy that emptied a folder looks like.
   *
   * @param {string} slug
   * @returns {{ slug: string, absolutePath: string, contentType: string }|null}
   */
  resolve(slug) {
    // 1) Strict allowlist BEFORE the slug is used for anything at all.
    if (!isValidIconSlug(slug)) return null;

    this.#load();
    const entry = this.#icons[slug] || this.#aliases[slug] || null;
    if (!entry || typeof entry.path !== 'string' || !entry.path) return null;

    // 2) The manifest's own path is validated independently of the slug. A
    //    reviewed file should never contain these, so a hit is a manifest bug
    //    worth logging rather than a silent skip.
    const relative = entry.path;
    if (path.isAbsolute(relative) || relative.split(/[/\\]/).includes('..')) {
      this.#logger.warn?.('health.icons.manifest.unsafe_path', { slug, path: relative });
      return null;
    }
    const contentType = CONTENT_TYPES[path.extname(relative).toLowerCase()];
    if (!contentType) {
      this.#logger.warn?.('health.icons.manifest.unsupported_type', { slug, path: relative });
      return null;
    }

    // 3) Containment AFTER the join, independent of (2) — LEXICALLY first,
    //    which is cheap and rejects the ordinary cases without touching disk.
    const candidate = path.resolve(this.#mediaRoot, relative);
    if (!this.#isInsideRoot(candidate, this.#mediaRoot)) {
      this.#logger.warn?.('health.icons.manifest.escapes_root', { slug, path: relative });
      return null;
    }

    // 4) Then again on the REAL path. A lexical check cannot see a symlink, and
    //    a link inside the root pointing outside it would otherwise serve
    //    content from outside the root. realpath also proves existence, so it
    //    subsumes the file-exists check: a dangling link resolves to null and
    //    reads as a miss rather than throwing.
    const realCandidate = resolveRealPath(candidate);
    if (!realCandidate) return null;
    if (!this.#isInsideRoot(realCandidate, this.#realMediaRoot())) {
      this.#logger.warn?.('health.icons.manifest.escapes_root_via_symlink', {
        slug, path: relative, real: realCandidate,
      });
      return null;
    }

    if (!fileExists(realCandidate)) return null;
    return { slug, absolutePath: realCandidate, contentType };
  }

  /** Containment: `p` is the root itself, or lives beneath it. */
  #isInsideRoot(p, root) {
    return p === root || p.startsWith(root + path.sep);
  }

  /**
   * The media root with its own symlinks resolved, computed once. Both ends of
   * the comparison must be real paths or a root that is ITSELF reached through
   * a link (a perfectly ordinary mount layout) would reject everything under it.
   */
  #realMediaRoot() {
    if (this.#realRoot === null) this.#realRoot = resolveRealPath(this.#mediaRoot) ?? this.#mediaRoot;
    return this.#realRoot;
  }

  /** Where derivatives live, under the DATA mount. Never inside `media/`. */
  #renderCacheDir() {
    if (this.#cacheDirResolved) return this.#cacheDir;
    this.#cacheDirResolved = true;
    try {
      this.#cacheDir = this.#dataService.household?.resolveDir?.(RENDER_CACHE_DIR) ?? null;
    } catch (e) {
      this.#logger.warn?.('health.icons.cache.unresolvable', { error: e.message });
      this.#cacheDir = null;
    }
    return this.#cacheDir;
  }

  /**
   * Serve a source file unrendered, or refuse.
   *
   * Every route back to the source runs through here: no cache directory, an
   * unreadable stat, a decode failure, an unwritable cache. See
   * UNRENDERED_SOURCE_MAX_BYTES for why "just serve the original" is not the
   * safe default it looks like.
   */
  #sourceOrRefuse(hit, stats, reason) {
    const size = stats?.size ?? null;
    if (size !== null && size > UNRENDERED_SOURCE_MAX_BYTES) {
      // ERROR, not warn: this is a configuration fault that silently degrades
      // every icon in the app, and it is invisible from the outside except as
      // a row that lost its picture.
      this.#logger.error?.('health.icons.render.unavailable', {
        slug: hit.slug, reason, sourceBytes: size, limitBytes: UNRENDERED_SOURCE_MAX_BYTES,
      });
      return null;
    }
    this.#logger.debug?.('health.icons.render.servedSource', { slug: hit.slug, reason, sourceBytes: size });
    return hit;
  }

  /**
   * Resolve a slug to a SERVABLE file: the downscaled derivative, generated once
   * and cached on disk.
   *
   * The cache key carries the source's resolved path, its size and its mtime, so
   * repointing a slug in the manifest — or editing the file under it — produces a
   * new key rather than serving a stale picture. Old entries are simply orphaned;
   * nothing sweeps them, and at ~4 KB each that is not worth a reaper.
   *
   * Fails SOFT in every direction: no cache directory, an unreadable source, a
   * jimp decode failure, or an unwritable cache all fall back to serving the
   * original file. An icon is decoration — it must never be the reason a row
   * cannot render — and the caller still gets a real image.
   *
   * @param {string} slug
   * @returns {Promise<{ slug: string, absolutePath: string, contentType: string }|null>}
   */
  async resolveRendered(slug) {
    const hit = this.resolve(slug);
    if (!hit) return null;

    let stats = null;
    try {
      stats = getFileStats(hit.absolutePath);
    } catch {
      stats = null;
    }

    const dir = this.#renderCacheDir();
    if (!dir) return this.#sourceOrRefuse(hit, stats, 'NO_CACHE_DIR');
    if (!stats) return this.#sourceOrRefuse(hit, stats, 'NO_SOURCE_STATS');

    const fingerprint = this.#fingerprint(hit.absolutePath, stats);
    // The slug is already through the allowlist by this point (`resolve` returned),
    // so it cannot contain a separator; the fingerprint is hex. The join is
    // therefore over two known-safe segments.
    const cached = path.join(dir, `${slug}.${fingerprint}.png`);
    if (fileExists(cached)) return { slug, absolutePath: cached, contentType: 'image/png' };

    // Collapse duplicate work: N simultaneous requests for the SAME icon share
    // one decode instead of doing N of them. Keyed by the cache path, so two
    // slugs that happen to point at the same file share too.
    const existing = this.#inFlight.get(cached);
    if (existing) return existing;

    const job = this.#renderInto(cached, hit, stats, dir, slug)
      .finally(() => { this.#inFlight.delete(cached); });
    this.#inFlight.set(cached, job);
    return job;
  }

  /**
   * Acquire a render slot. Bounded by RENDER_CONCURRENCY — see its comment for
   * the measurement that motivated it.
   */
  async #acquireRenderSlot() {
    if (this.#active >= RENDER_CONCURRENCY) {
      await new Promise((resolve) => { this.#waiting.push(resolve); });
    }
    this.#active += 1;
  }

  #releaseRenderSlot() {
    this.#active -= 1;
    const next = this.#waiting.shift();
    if (next) next();
  }

  /**
   * Render every offered icon that is not already cached, slowly, in the
   * background.
   *
   * Why this exists: the render gate bounds how much of the loop ONE burst can
   * take, but it cannot make the work smaller — 60 cold renders still cost
   * ~17 s of CPU however they are spread. A warm cache makes them ~2 ms each,
   * so the honest fix for the picker's herd is for the cache to already be
   * warm. The cache key includes source mtime, so a Dropbox re-sync that only
   * touches timestamps invalidates all of them at once and re-arms exactly that
   * herd (this media tree had such an event within the week — see the health
   * README) — this is what repairs it without anyone waiting.
   *
   * Deliberately unhurried and deliberately unreliable: it paces itself, gives
   * up on a budget, and swallows every error. Nothing depends on it having
   * finished; it only makes the on-demand path rare.
   *
   * @param {{ budgetMs?: number, pauseMs?: number }} [opts]
   * @returns {Promise<{ warmed: number, alreadyCached: number, unrenderable: number, failed: number, gaveUp: boolean }>}
   */
  async warmCache({ budgetMs = WARM_BUDGET_MS, pauseMs = WARM_PAUSE_MS } = {}) {
    const started = Date.now();
    const summary = { warmed: 0, alreadyCached: 0, unrenderable: 0, failed: 0, gaveUp: false };
    const slugs = this.list();
    if (slugs.length === 0 || !this.#renderCacheDir()) return summary;

    for (const slug of slugs) {
      if (Date.now() - started > budgetMs) { summary.gaveUp = true; break; }
      // `resolveRendered` is idempotent and already deduplicates against any
      // in-flight on-demand render, so a warm pass never doubles work a real
      // request is doing.
      const before = this.#wasCached(slug);
      try {
        // eslint-disable-next-line no-await-in-loop
        const hit = await this.resolveRendered(slug);
        // "warmed" means a DERIVATIVE now exists. A render that failed and fell
        // back to the source still returns a hit, and counting that as warmed
        // would report a warm cache that is not there — the same shape of
        // dishonesty the micro-coverage caption exists to prevent.
        const rendered = Boolean(hit) && hit.absolutePath.startsWith(this.#renderCacheDir() + path.sep);
        if (!hit) summary.failed += 1;
        else if (!rendered) summary.unrenderable += 1;
        else if (before) summary.alreadyCached += 1;
        else summary.warmed += 1;
      } catch {
        summary.failed += 1;
      }
      // eslint-disable-next-line no-await-in-loop
      if (!before) await new Promise((resolve) => { setTimeout(resolve, pauseMs); });
    }

    this.#logger.info?.('health.icons.warm.complete', {
      ...summary, total: slugs.length, elapsedMs: Date.now() - started,
    });
    return summary;
  }

  /** Cheap "is this already rendered" probe, for warm-pass accounting only. */
  #wasCached(slug) {
    const hit = this.resolve(slug);
    const dir = this.#renderCacheDir();
    if (!hit || !dir) return false;
    let stats;
    try { stats = getFileStats(hit.absolutePath); } catch { return false; }
    if (!stats) return false;
    return fileExists(path.join(dir, `${slug}.${this.#fingerprint(hit.absolutePath, stats)}.png`));
  }

  #fingerprint(absolutePath, stats) {
    return createHash('sha256')
      .update(`${absolutePath}:${stats.size}:${Math.round(stats.mtimeMs)}:${RENDER_WIDTH_PX}`)
      .digest('hex')
      .slice(0, 12);
  }

  async #renderInto(cached, hit, stats, dir, slug) {
    await this.#acquireRenderSlot();
    try {
      // Between waiting and working: everything queued behind the previous
      // render gets a turn before this one seizes the loop for its own
      // ~250-500 ms. Without this the gate merely reorders one long stall.
      await yieldToLoop();

      // Another waiter may have produced it while this one queued.
      if (fileExists(cached)) return { slug, absolutePath: cached, contentType: 'image/png' };

      ensureDir(dir);
      const image = await Jimp.read(hit.absolutePath);
      if (image.bitmap.width > RENDER_WIDTH_PX) image.resize({ w: RENDER_WIDTH_PX });
      const buffer = await image.getBuffer('image/png');
      // Atomic: two concurrent requests for the same icon race here, and both
      // write byte-identical output, so last-writer-wins is correct — but a
      // half-written file being served is not.
      writeFileAtomic(cached, buffer);
      this.#logger.debug?.('health.icons.render.cached', {
        slug, sourceBytes: stats.size, renderedBytes: buffer.length,
      });
      return { slug, absolutePath: cached, contentType: 'image/png' };
    } catch (e) {
      this.#logger.warn?.('health.icons.render.failed', { slug, error: e.message });
      return this.#sourceOrRefuse(hit, stats, 'RENDER_FAILED');
    } finally {
      this.#releaseRenderSlot();
    }
  }
}

export default IconManifestStore;
