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
// "The catalog has no such item" is remembered briefly; a FAILED lookup
// (timeout, server down) is not remembered at all.
const NOT_FOUND_TTL_MS = 10 * 1000;
// Whole-request budget for display/next-episode lookups. Past it, entries
// are returned with null display fields rather than waiting on the server.
const DEFAULT_REQUEST_DEADLINE_MS = 8000;
// Media-server requests serialize; more in flight only queues them there.
const DESCRIBE_CONCURRENCY = 4;
const NEXT_EPISODE_OFFERS = 8;
// Finished items scanned for episodes. Type is only known after a lookup, so
// the scan is capped in lookups, not in candidates: a run of finished songs
// cannot hide the episode behind them.
const NEXT_EPISODE_SCAN = 40;
const NEXT_EPISODE_LOOKUPS = 24;
const RECENT_LEDGER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
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
  #requestDeadlineMs;
  /** @type {Map<string, {at:number, ttl:number, value:Object|null}>} */
  #describeCache = new Map();
  // Who wants to hear that the household list changed (suggestions cache).
  #listChanged = new Set();
  #active = 0;
  /** @type {Function[]} */
  #waiters = [];

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
    // Overall budget for one recent()/carryOn() call's catalog lookups.
    carryOnDeadlineMs = DEFAULT_REQUEST_DEADLINE_MS,
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
    this.#requestDeadlineMs = carryOnDeadlineMs;
  }

  /** Whether watched/unwatched marks are wired (the router answers 501 if not). */
  get canMarkWatched() {
    return Boolean(this.#mark);
  }

  #budget() {
    // `degraded` turns true when a lookup ran out of time or failed, so a
    // caller can say its display fields are incomplete (not "not found").
    return { deadlineAt: this.#clock.now() + this.#requestDeadlineMs, degraded: false };
  }

  /**
   * Listen for household-list changes (removal, restore, watched marks).
   * @param {(change: {householdId: string|null, reason: string, id: string}) => void} listener
   * @returns {() => void} unsubscribe
   */
  onListChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    this.#listChanged.add(listener);
    return () => this.#listChanged.delete(listener);
  }

  #emitListChanged(change) {
    for (const listener of [...this.#listChanged]) {
      try { listener(change); } catch (error) {
        this.#logger.warn?.('media.household-list.listener_failed', { reason: change.reason, error: error.message });
      }
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async recent({ householdId, limit } = {}) {
    const [records, removed, plays] = await Promise.all([
      this.#records(),
      this.#listsStore.loadRemoved(householdId),
      this.#ledgerPlays({ from: new Date(this.#clock.now() - RECENT_LEDGER_DAYS * DAY_MS).toISOString() }),
    ]);
    const entries = buildHouseholdRecent(records, { removed, plays, limit: clampLimit(limit, 24) });
    const budget = this.#budget();
    const items = await this.#withDisplay(entries, budget);
    return { items, degraded: budget.degraded };
  }

  async carryOn({ householdId, limit } = {}) {
    const max = clampLimit(limit, 20);
    const budget = this.#budget();
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
    const unfinished = (await this.#withDisplay(items, budget))
      .filter((item) => !NOT_RESUMABLE_TYPES.has(item.type))
      .map((item) => ({ item, at: item.spots?.[0]?.lastPlayed ?? item.lastPlayed }));
    const nextEpisodes = (await this.#nextEpisodes(records, removed, live.list, Math.min(max, NEXT_EPISODE_OFFERS), budget))
      .map((item) => ({ item, at: item.afterPlayedAt }));
    const merged = [...unfinished, ...nextEpisodes]
      .sort((a, b) => compareTimestamps(b.at, a.at))
      .slice(0, max)
      .map(({ item }) => item);
    return {
      items: merged,
      nowOn: await this.#withDisplay(nowOn, budget),
      nowPlayingKnown: live.known,
      degraded: budget.degraded,
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

  /**
   * Display fields for several content ids under one request budget — the
   * same cache, concurrency limit and deadlines as recent / carry on. A miss
   * maps to null. For other household views (played earlier, suggestions).
   * @param {string[]} contentIds
   * @returns {Promise<Map<string, Object|null>>}
   */
  async describeMany(contentIds) {
    const budget = this.#budget();
    const unique = [...new Set((contentIds || []).filter((id) => typeof id === 'string' && id))];
    const out = new Map();
    await Promise.all(unique.map(async (id) => { out.set(id, await this.#describe(id, budget)); }));
    return out;
  }

  /**
   * What is on a screen right now (same sources as carry on's `nowOn`).
   * @returns {Promise<{known: boolean, list: Array<{deviceId, screenId, contentId, state, position}>}>}
   */
  async nowPlaying() {
    return this.#readNowPlaying();
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
      const display = enriched.id ? await this.#describe(String(enriched.id), this.#budget()) : null;
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
    this.#emitListChanged({ householdId: householdId ?? null, reason: 'removed', id });
    return { id, removedAt: at };
  }

  async restoreToList(householdId, id) {
    const before = await this.#listsStore.loadRemoved(householdId);
    const existed = Object.prototype.hasOwnProperty.call(before, id);
    if (existed) await this.#listsStore.saveRemoved(restoreRemoved(before, id), householdId);
    this.#logger.info?.('media.household-list.restored', { householdId: householdId ?? null, id, existed });
    this.#emitListChanged({ householdId: householdId ?? null, reason: 'restored', id });
    return { id, restored: existed };
  }

  async markWatched(contentId, watched) {
    if (!this.#mark) throw new Error('markContentWatched is not configured');
    const result = await this.#mark.execute({ contentId, watched: !!watched });
    // Marks are household-wide progress: every household's lists may change.
    this.#emitListChanged({ householdId: null, reason: 'watched', id: contentId });
    return result;
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

  async #nextEpisodes(records, removed, nowPlaying, room, budget) {
    const byId = new Map();
    for (const record of records) {
      const prev = byId.get(record.contentId);
      if (!prev || compareTimestamps(record.lastPlayed, prev.lastPlayed) > 0) byId.set(record.contentId, record);
    }
    const playing = new Set((nowPlaying || []).map((np) => np.contentId));
    const seenShows = new Set();
    const out = [];
    let lookups = 0;
    for (const candidate of finishedEpisodeCandidates(records, { removed, limit: NEXT_EPISODE_SCAN })) {
      if (out.length >= room || lookups >= NEXT_EPISODE_LOOKUPS || this.#expired(budget)) break;
      lookups += 1;
      const current = await this.#describe(candidate.contentId, budget);
      if (!current || current.type !== 'episode' || !current.parentId) continue;
      const showKey = current.grandparentId || current.parentId;
      if (seenShows.has(showKey)) continue;
      seenShows.add(showKey);

      const next = await this.#findNextEpisode(candidate.contentId, current, budget);
      if (!next?.id) continue;
      const nextRecord = byId.get(next.id);
      // Already started (it is carry-on in its own right) or finished: no offer.
      if (nextRecord && (isSpotFinished(nextRecord) || openSpotsOf(nextRecord).length)) continue;
      if (playing.has(next.id)) continue;
      if (nextRecord && isHiddenByRemoval(removed, next.id, nextRecord.lastPlayed)) continue;
      if (!nextRecord && removed?.[next.id]) continue;

      const display = (await this.#describe(next.id, budget)) || this.#displayOf(next);
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

  async #findNextEpisode(contentId, current, budget) {
    const source = contentId.split(':')[0];
    const resolution = this.#catalog?.resolveSource?.(source, contentId);
    if (!resolution || typeof this.#catalog.getList !== 'function') return null;
    try {
      const season = listItemsOf(await this.#withTimeout(this.#catalog.getList(resolution, String(current.parentId)), budget));
      const index = season.findIndex((item) => item?.id === contentId);
      if (index >= 0 && index + 1 < season.length) return season[index + 1];
      if (index < 0 || !current.grandparentId) return null;
      // Season finished — first episode of the next season.
      const seasons = listItemsOf(await this.#withTimeout(this.#catalog.getList(resolution, String(current.grandparentId)), budget));
      const seasonIndex = seasons.findIndex((s) => localIdOf(s?.id) === String(current.parentId));
      const nextSeason = seasonIndex >= 0 ? seasons[seasonIndex + 1] : null;
      if (!nextSeason?.id) return null;
      const episodes = listItemsOf(await this.#withTimeout(this.#catalog.getList(resolution, localIdOf(nextSeason.id)), budget));
      return episodes[0] || null;
    } catch (error) {
      // A swallowed timeout means a next episode may be missing from this answer.
      if (budget) budget.degraded = true;
      this.#logger.warn?.('media.household-list.next_episode_failed', { contentId, error: error.message });
      return null;
    }
  }

  async #withDisplay(entries, budget) {
    return Promise.all(entries.map(async (entry) => ({
      ...entry,
      ...((await this.#describe(entry.contentId, budget)) || this.#displayOf(null)),
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

  #expired(budget) {
    return Boolean(budget) && this.#clock.now() >= budget.deadlineAt;
  }

  async #acquire() {
    if (this.#active < DESCRIBE_CONCURRENCY) { this.#active += 1; return; }
    await new Promise((resolve) => this.#waiters.push(resolve));
  }

  #release() {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#active -= 1;
  }

  async #describe(contentId, budget) {
    const cached = this.#describeCache.get(contentId);
    if (cached && this.#clock.now() - cached.at < cached.ttl) return cached.value;
    if (this.#expired(budget)) { budget.degraded = true; return null; }
    await this.#acquire();
    try {
      if (this.#expired(budget)) { budget.degraded = true; return null; }
      const source = contentId.split(':')[0];
      const resolution = this.#catalog?.resolveSource?.(source, contentId);
      const item = resolution ? await this.#withTimeout(this.#catalog.getItem(resolution, contentId), budget) : null;
      const value = item ? this.#displayOf(item) : null;
      this.#describeCache.set(contentId, { at: this.#clock.now(), ttl: value ? this.#describeTtlMs : NOT_FOUND_TTL_MS, value });
      return value;
    } catch (error) {
      // Not cached: a timeout or an unreachable server says nothing about the item.
      if (budget) budget.degraded = true;
      const data = { contentId, error: error.message };
      if (typeof this.#logger.sampled === 'function') {
        this.#logger.sampled('media.household-list.describe_failed', data, { maxPerMinute: 10, aggregate: true });
      } else {
        this.#logger.warn?.('media.household-list.describe_failed', data);
      }
      return null;
    } finally {
      this.#release();
    }
  }

  #withTimeout(promise, budget) {
    const remaining = budget ? budget.deadlineAt - this.#clock.now() : Infinity;
    if (remaining <= 0) return Promise.reject(new Error('request deadline passed'));
    if (!this.#runtime?.withDeadline) return Promise.resolve(promise);
    return this.#runtime.withDeadline(
      Promise.resolve(promise),
      Math.min(this.#describeTimeoutMs, remaining),
      'catalog lookup timeout',
    );
  }
}

export default HouseholdMediaMemoryService;
