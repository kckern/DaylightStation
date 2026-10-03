/**
 * HouseholdMediaMemoryService — the household's shared memory of what has
 * played, across every screen.
 *
 *   recent      RQ-FIND-11  items played anywhere, newest first, labelled
 *                           with the screen they last played on
 *   carry on    RQ-FIND-12  unfinished items with every screen's open spot
 *               RQ-PLAY-09  (an item stays while ANY screen holds one), plus
 *                           the next episode of a series; anything playing on
 *                           a screen right now is returned as `nowOn` instead
 *   favourites  RQ-FIND-14  household items and collections
 *   removal     RQ-FIND-15  hide from recent / carry on / suggestions, undoable
 *   marks       RQ-FIND-13  watched / unwatched (MarkContentWatched)
 *
 * Pure list rules live in #domains/media/householdMediaList.mjs; this service
 * gathers progress records, the household lists, live screen state and item
 * display fields.
 *
 * Display fields come from the content catalog per item, cached for a few
 * minutes and bounded by a per-lookup timeout: a slow Plex must degrade an
 * entry to its bare id, never hang the start page.
 */
import {
  addFavourite,
  removeFavourite,
  markRemoved,
  restoreRemoved,
  isHiddenByRemoval,
  buildHouseholdRecent,
  buildCarryOn,
  finishedEpisodeCandidates,
} from '#domains/media/householdMediaList.mjs';
import { openSpotsOf, isSpotFinished, compareTimestamps } from '#domains/content/services/mediaSpots.mjs';

const DEFAULT_DESCRIBE_TIMEOUT_MS = 4000;
const DEFAULT_DESCRIBE_TTL_MS = 5 * 60 * 1000;
const NEXT_EPISODE_CANDIDATES = 8;
// Songs are replayed, not resumed: a half-played track is not "carry on".
const NOT_RESUMABLE_TYPES = new Set(['track']);

function clampLimit(value, fallback, max = 200) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function listItemsOf(list) {
  if (Array.isArray(list)) return list;
  if (Array.isArray(list?.children)) return list.children;
  if (Array.isArray(list?.items)) return list.items;
  return [];
}

function localIdOf(id) {
  const value = String(id ?? '');
  const colon = value.indexOf(':');
  return colon >= 0 ? value.slice(colon + 1) : value;
}

export class HouseholdMediaMemoryService {
  #progressMemory;
  #listsStore;
  #catalog;
  #mark;
  #nowPlaying;
  #nowTimestamp;
  #clock;
  #logger;
  #describeTimeoutMs;
  #runtime;
  #playLedger;
  #describeTtlMs;
  /** @type {Map<string, {at:number, value:Object|null}>} */
  #describeCache = new Map();

  /**
   * @param {Object} deps
   * @param {{listAllProgress: Function}} deps.progressMemory
   * @param {import('./ports/IHouseholdMediaListsDatastore.mjs').IHouseholdMediaListsDatastore} deps.listsStore
   * @param {Object} deps.contentCatalog - resolveSource / getItem / getList
   * @param {{execute: Function}} deps.markContentWatched
   * @param {{list: Function}|null} [deps.nowPlaying] - live screen state; null = unknown
   * @param {Function} deps.nowTimestamp - same stamp format progress records use
   * @param {{now: Function}} [deps.clock]
 * @param {{withDeadline: Function}} [deps.runtime]
   */
  constructor({
    progressMemory,
    listsStore,
    contentCatalog,
    markContentWatched,
    nowPlaying = null,
    nowTimestamp,
    clock = Date,
    logger = console,
    describeTimeoutMs = DEFAULT_DESCRIBE_TIMEOUT_MS,
    describeTtlMs = DEFAULT_DESCRIBE_TTL_MS,
    // { withDeadline(promise, ms, message) } — bounds each catalog lookup.
    // Injected (timers live in adapters); absent = unbounded.
    runtime = null,
    // PlayLedgerRecorder — per-screen start history; null = progress only.
    playLedger = null,
  }) {
    if (typeof progressMemory?.listAllProgress !== 'function') throw new TypeError('HouseholdMediaMemoryService requires progressMemory.listAllProgress');
    if (!listsStore) throw new TypeError('HouseholdMediaMemoryService requires listsStore');
    if (typeof nowTimestamp !== 'function') throw new TypeError('HouseholdMediaMemoryService requires nowTimestamp');
    this.#progressMemory = progressMemory;
    this.#listsStore = listsStore;
    this.#catalog = contentCatalog;
    this.#mark = markContentWatched;
    this.#nowPlaying = nowPlaying;
    this.#nowTimestamp = nowTimestamp;
    this.#clock = clock;
    this.#logger = logger;
    this.#describeTimeoutMs = describeTimeoutMs;
    this.#describeTtlMs = describeTtlMs;
    this.#runtime = runtime;
    this.#playLedger = playLedger;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async recent({ householdId, limit } = {}) {
    const [records, removed, plays] = await Promise.all([
      this.#records(),
      this.#listsStore.loadRemoved(householdId),
      this.#ledgerPlays({}),
    ]);
    const entries = buildHouseholdRecent(records, { removed, plays, limit: clampLimit(limit, 24) });
    return { items: await this.#withDisplay(entries) };
  }

  async carryOn({ householdId, limit } = {}) {
    const max = clampLimit(limit, 20);
    const [records, removed, live] = await Promise.all([
      this.#records(),
      this.#listsStore.loadRemoved(householdId),
      this.#readNowPlaying(),
    ]);
    // Unfinished items and next episodes compete on recency (the time the
    // spot was left / the previous episode was finished), so a series the
    // household is in the middle of is never crowded out by old leftovers.
    // Display lookups hit the media server (whose requests serialize), so only
    // the newest few times the limit are described; songs filtered out of
    // those leave room without a second pass.
    const { items, nowOn } = buildCarryOn(records, { removed, nowPlaying: live.list, limit: max * 3 });
    const unfinished = (await this.#withDisplay(items))
      .filter((item) => !NOT_RESUMABLE_TYPES.has(item.type))
      .map((item) => ({ item, at: item.spots?.[0]?.lastPlayed ?? item.lastPlayed }));
    const nextEpisodes = (await this.#nextEpisodes(records, removed, live.list, Math.min(max, NEXT_EPISODE_CANDIDATES)))
      .map((item) => ({ item, at: item.afterPlayedAt }));
    const merged = [...unfinished, ...nextEpisodes]
      .sort((a, b) => compareTimestamps(b.at, a.at))
      .slice(0, max)
      .map(({ item }) => item);
    return {
      items: merged,
      nowOn: await this.#withDisplay(nowOn),
      nowPlayingKnown: live.known,
    };
  }

  /**
   * Play-ledger query: starts by screen and/or time window, newest first.
   * @param {{deviceId?:string, from?:string, to?:string, limit?:number}} q
   */
  async plays({ deviceId = null, from = null, to = null, limit } = {}) {
    if (!this.#playLedger) return { items: [], ledger: false };
    const rows = await this.#playLedger.plays({ deviceId, from, to, limit: clampLimit(limit, 100, 1000), nowEpoch: this.#clock.now() });
    return { items: rows, ledger: true };
  }

  async listFavourites(householdId) {
    return { items: await this.#listsStore.loadFavourites(householdId) };
  }

  async listRemoved(householdId) {
    const removed = await this.#listsStore.loadRemoved(householdId);
    return { items: Object.entries(removed).map(([id, entry]) => ({ id, removedAt: entry?.removedAt ?? null })) };
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async addFavourite(householdId, entry) {
    let enriched = { ...(entry || {}) };
    if (!enriched.title || !enriched.thumbnail) {
      const display = enriched.id ? await this.#describe(String(enriched.id)) : null;
      enriched = {
        ...enriched,
        title: enriched.title ?? display?.title ?? null,
        thumbnail: enriched.thumbnail ?? display?.thumbnail ?? null,
        type: enriched.type ?? display?.type ?? null,
      };
    }
    const next = addFavourite(await this.#listsStore.loadFavourites(householdId), enriched, this.#nowTimestamp());
    await this.#listsStore.saveFavourites(next, householdId);
    this.#logger.info?.('media.favourite.added', { householdId: householdId ?? null, id: next[0].id, kind: next[0].kind });
    return { item: next[0], items: next };
  }

  async removeFavourite(householdId, id) {
    const before = await this.#listsStore.loadFavourites(householdId);
    const next = removeFavourite(before, id);
    if (next.length !== before.length) await this.#listsStore.saveFavourites(next, householdId);
    this.#logger.info?.('media.favourite.removed', { householdId: householdId ?? null, id, existed: next.length !== before.length });
    return { removed: next.length !== before.length, items: next };
  }

  async removeFromList(householdId, id) {
    const at = this.#nowTimestamp();
    const next = markRemoved(await this.#listsStore.loadRemoved(householdId), id, at);
    await this.#listsStore.saveRemoved(next, householdId);
    this.#logger.info?.('media.household-list.removed', { householdId: householdId ?? null, id });
    return { id, removedAt: at };
  }

  async restoreToList(householdId, id) {
    const before = await this.#listsStore.loadRemoved(householdId);
    const existed = Object.prototype.hasOwnProperty.call(before, id);
    if (existed) await this.#listsStore.saveRemoved(restoreRemoved(before, id), householdId);
    this.#logger.info?.('media.household-list.restored', { householdId: householdId ?? null, id, existed });
    return { id, restored: existed };
  }

  async markWatched(contentId, watched) {
    if (!this.#mark) throw new Error('markContentWatched is not configured');
    return this.#mark.execute({ contentId, watched: !!watched });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  async #records() {
    const all = await this.#progressMemory.listAllProgress();
    return all.map(({ namespaceId, progress }) => ({
      contentId: progress.contentId,
      namespaceId,
      playhead: progress.playhead,
      duration: progress.duration,
      percent: progress.duration ? undefined : progress.percent,
      lastPlayed: progress.lastPlayed,
      completedAt: progress.completedAt,
      spots: progress.spots,
      lastDevice: progress.lastDevice,
    }));
  }

  async #ledgerPlays(query) {
    if (!this.#playLedger) return [];
    try {
      return await this.#playLedger.plays({ ...query, limit: 5000, nowEpoch: this.#clock.now() });
    } catch (error) {
      this.#logger.warn?.('media.household-list.ledger_read_failed', { error: error.message });
      return [];
    }
  }

  async #readNowPlaying() {
    if (!this.#nowPlaying?.list) return { known: false, list: [] };
    try {
      return { known: true, list: (await this.#nowPlaying.list()) || [] };
    } catch (error) {
      this.#logger.warn?.('media.household-list.now_playing_failed', { error: error.message });
      return { known: false, list: [] };
    }
  }

  async #nextEpisodes(records, removed, nowPlaying, room) {
    const byId = new Map();
    for (const record of records) {
      const prev = byId.get(record.contentId);
      if (!prev || compareTimestamps(record.lastPlayed, prev.lastPlayed) > 0) byId.set(record.contentId, record);
    }
    const playing = new Set((nowPlaying || []).map((np) => np.contentId));
    const seenShows = new Set();
    const out = [];
    for (const candidate of finishedEpisodeCandidates(records, { removed, limit: NEXT_EPISODE_CANDIDATES })) {
      if (out.length >= room) break;
      const current = await this.#describe(candidate.contentId);
      if (!current || current.type !== 'episode' || !current.parentId) continue;
      const showKey = current.grandparentId || current.parentId;
      if (seenShows.has(showKey)) continue;
      seenShows.add(showKey);

      const next = await this.#findNextEpisode(candidate.contentId, current);
      if (!next?.id) continue;
      const nextRecord = byId.get(next.id);
      // Already started (it is carry-on in its own right) or finished: no offer.
      if (nextRecord && (isSpotFinished(nextRecord) || openSpotsOf(nextRecord).length)) continue;
      if (playing.has(next.id)) continue;
      if (nextRecord && isHiddenByRemoval(removed, next.id, nextRecord.lastPlayed)) continue;
      if (!nextRecord && removed?.[next.id]) continue;

      const display = (await this.#describe(next.id)) || this.#displayOf(next);
      out.push({
        contentId: next.id,
        reason: 'next-episode',
        after: candidate.contentId,
        afterPlayedAt: candidate.lastPlayed ?? null,
        namespaceId: null,
        lastPlayed: null,
        playhead: 0,
        duration: 0,
        percent: 0,
        finished: false,
        completedAt: null,
        playedOn: null,
        spots: [],
        ...display,
      });
    }
    return out;
  }

  async #findNextEpisode(contentId, current) {
    const source = contentId.split(':')[0];
    const resolution = this.#catalog?.resolveSource?.(source, contentId);
    if (!resolution || typeof this.#catalog.getList !== 'function') return null;
    try {
      const season = listItemsOf(await this.#withTimeout(this.#catalog.getList(resolution, String(current.parentId))));
      const index = season.findIndex((item) => item?.id === contentId);
      if (index >= 0 && index + 1 < season.length) return season[index + 1];
      if (index < 0 || !current.grandparentId) return null;
      // Season finished — first episode of the next season.
      const seasons = listItemsOf(await this.#withTimeout(this.#catalog.getList(resolution, String(current.grandparentId))));
      const seasonIndex = seasons.findIndex((s) => localIdOf(s?.id) === String(current.parentId));
      const nextSeason = seasonIndex >= 0 ? seasons[seasonIndex + 1] : null;
      if (!nextSeason?.id) return null;
      const episodes = listItemsOf(await this.#withTimeout(this.#catalog.getList(resolution, localIdOf(nextSeason.id))));
      return episodes[0] || null;
    } catch (error) {
      this.#logger.warn?.('media.household-list.next_episode_failed', { contentId, error: error.message });
      return null;
    }
  }

  async #withDisplay(entries) {
    return Promise.all(entries.map(async (entry) => ({
      ...entry,
      ...((await this.#describe(entry.contentId)) || this.#displayOf(null)),
    })));
  }

  #displayOf(item) {
    const meta = item?.metadata || {};
    return {
      title: item?.title ?? null,
      thumbnail: item?.thumbnail ?? item?.imageUrl ?? item?.image ?? null,
      type: meta.type ?? item?.type ?? null,
      parentTitle: meta.parentTitle ?? item?.parentTitle ?? null,
      grandparentTitle: meta.grandparentTitle ?? item?.grandparentTitle ?? null,
      parentId: meta.parentId ?? null,
      grandparentId: meta.grandparentId ?? null,
      itemIndex: meta.itemIndex ?? null,
    };
  }

  async #describe(contentId) {
    const now = this.#clock.now();
    const cached = this.#describeCache.get(contentId);
    if (cached && now - cached.at < this.#describeTtlMs) return cached.value;
    let value = null;
    try {
      const source = contentId.split(':')[0];
      const resolution = this.#catalog?.resolveSource?.(source, contentId);
      const item = resolution ? await this.#withTimeout(this.#catalog.getItem(resolution, contentId)) : null;
      value = item ? this.#displayOf(item) : null;
    } catch (error) {
      this.#logger.debug?.('media.household-list.describe_failed', { contentId, error: error.message });
    }
    this.#describeCache.set(contentId, { at: now, value });
    return value;
  }

  #withTimeout(promise) {
    if (!this.#runtime?.withDeadline) return Promise.resolve(promise);
    return this.#runtime.withDeadline(Promise.resolve(promise), this.#describeTimeoutMs, 'catalog lookup timeout');
  }
}

export default HouseholdMediaMemoryService;
