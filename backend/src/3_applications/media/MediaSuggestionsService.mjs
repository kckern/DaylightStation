/**
 * MediaSuggestionsService — the start page's suggestions, built server-side
 * (RQ-FIND-16, FIND.7a): Favourites → Carry on → Usually here at this time →
 * New. Rules: #domains/media/mediaSuggestions.mjs.
 *
 * The expensive part (carry on, ledger scan, catalog lookups, Plex recently
 * added) is cached per household + screen for `ttlMs` (5 min). What changes
 * on a tap is read on every request: favourites, anything playing anywhere
 * right now and anything removed from the household list (left out); then
 * rows are cut to 6 each / 20 in all.
 *
 * A screen with no time-of-day history of its own (new, or quiet) falls back
 * to the household's, labelled "Usually at this time".
 */
import { timeOfDayGroups, assembleSuggestions } from '#domains/media/mediaSuggestions.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
// A build whose catalog lookups ran out of time is kept only this long, so
// the next request retries rather than serving missing titles for 5 min.
const DEGRADED_TTL_MS = 10_000;
const DEFAULT_MAX_SCREENS = 200;
const SCREEN_ID = /^(fleet|browser|screen):[A-Za-z0-9._-]{1,96}$/;
const NEW_WITHIN_DAYS = 14;
const LEDGER_DAYS = 31;
const CANDIDATES_PER_ROW = 12;
const COLLECTION_TYPES = new Set(['show', 'season', 'album', 'artist', 'collection', 'playlist']);

/** Catalog parent ids arrive bare (`123`); suggestions compare qualified ids (`plex:123`). */
function qualify(id, contentId) {
  if (id === undefined || id === null || id === '') return null;
  const value = String(id);
  return value.includes(':') ? value : `${String(contentId).split(':')[0]}:${value}`;
}

export const TIME_OF_DAY_LABELS = Object.freeze({ screen: 'Usually here at this time', household: 'Usually at this time' });

export class MediaSuggestionsService {
  #memory;
  #ledger;
  #recent;
  #screens;
  #nowLocal;
  #clock;
  #ttl;
  #logger;
  #maxScreens;
  /** household → {at, value} (carry on, new, ledger rows, parents) */
  #households = new Map();
  /** `${household}|${screen}` → {at, value} (time of day only); capped */
  #screenCache = new Map();
  /** @type {Map<string, Promise<Object>>} */
  #building = new Map();

  /**
   * @param {Object} deps
   * @param {Object} deps.memory - HouseholdMediaMemoryService (favourites, carry on, removed, describeMany, nowPlaying)
   * @param {Object} [deps.playLedger] - PlayLedgerRecorder
   * @param {{list: Function}} [deps.recentAdditions] - catalog additions ({since, limit} → entries with addedAt)
   * @param {Object} [deps.screens] - ScreenRegistryService (aliasesOf)
   * @param {Function} deps.nowLocal - local `YYYY-MM-DD HH:mm:ss`
   * @param {number} [deps.maxScreens] - per-screen cache entries kept (oldest dropped)
   */
  constructor({ memory, playLedger = null, recentAdditions = null, screens = null, nowLocal, clock = Date,
    ttlMs = DEFAULT_TTL_MS, maxScreens = DEFAULT_MAX_SCREENS, logger = console }) {
    if (!memory) throw new TypeError('MediaSuggestionsService requires memory');
    if (typeof nowLocal !== 'function') throw new TypeError('MediaSuggestionsService requires nowLocal');
    this.#memory = memory;
    this.#ledger = playLedger;
    this.#recent = recentAdditions;
    this.#screens = screens;
    this.#nowLocal = nowLocal;
    this.#clock = clock;
    this.#ttl = ttlMs;
    this.#maxScreens = maxScreens;
    this.#logger = logger;
  }

  /** Per-screen cache entries held (diagnostics/tests). */
  get cachedScreens() { return this.#screenCache.size; }

  /**
   * @param {{householdId?: string, deviceId?: string|null}} q
   * @returns {Promise<{deviceId, generatedAt, rows, empty}>}
   */
  async suggest({ householdId, deviceId = null } = {}) {
    if (deviceId !== null && !SCREEN_ID.test(String(deviceId))) {
      const error = new Error(`Not a screen id: ${deviceId}`);
      error.code = 'INVALID_SCREEN_ID';
      throw error;
    }
    const house = await this.#cached(this.#households, householdId ?? '', () => this.#buildHousehold(householdId));
    const tod = await this.#cached(this.#screenCache, `${householdId ?? ''}|${deviceId ?? ''}`,
      () => this.#section('time-of-day', () => this.#timeOfDay(householdId, deviceId, house.ledgerRows)), true);
    // Favourites and exclusions are cheap and change on a tap: read every time.
    const [favourites, exclude] = await Promise.all([
      this.#section('favourites', () => this.#favourites(householdId)),
      this.#excluded(householdId, house.parentsOf),
    ]);
    const { rows, empty } = assembleSuggestions({
      favourites, carryOn: house.carryOn, fresh: house.fresh, timeOfDay: tod.items ?? [],
      timeOfDayLabel: tod.label ?? TIME_OF_DAY_LABELS.household, exclude,
    });
    return { deviceId, generatedAt: house.generatedAt, rows, empty, degraded: house.degraded === true };
  }

  /** Drop every cached candidate (a change that is not per household, e.g. a watched mark). */
  invalidateAll() {
    this.#households.clear();
    this.#screenCache.clear();
  }

  /** Drop cached candidates for a household. */
  invalidate(householdId) {
    this.#households.delete(householdId ?? '');
    for (const key of this.#screenCache.keys()) if (key.startsWith(`${householdId ?? ''}|`)) this.#screenCache.delete(key);
  }

  async #cached(map, key, build, capped = false) {
    const hit = map.get(key);
    if (hit && this.#clock.now() - hit.at < (hit.ttl ?? this.#ttl)) return hit.value;
    const flight = `${capped ? 's' : 'h'}|${key}`;
    if (!this.#building.has(flight)) {
      const run = Promise.resolve().then(build)
        .then((value) => {
          map.delete(key);
          map.set(key, { at: this.#clock.now(), value, ttl: value?.degraded ? Math.min(DEGRADED_TTL_MS, this.#ttl) : this.#ttl });
          if (capped) while (map.size > this.#maxScreens) map.delete(map.keys().next().value);
          return value;
        })
        .finally(() => this.#building.delete(flight));
      this.#building.set(flight, run);
    }
    return this.#building.get(flight);
  }

  async #section(name, fn) {
    try {
      return await fn();
    } catch (error) {
      this.#logger.warn?.('media.suggestions.section_failed', { section: name, error: error.message });
      return [];
    }
  }

  async #buildHousehold(householdId) {
    const started = this.#clock.now();
    const ledgerRows = await this.#ledgerRows();
    const [carry, fresh] = await Promise.all([
      this.#section('carry-on', () => this.#carryOn(householdId)),
      this.#section('new', () => this.#fresh()),
    ]);
    const carryOn = Array.isArray(carry) ? carry : carry.items;
    const degraded = !Array.isArray(carry) && carry.degraded === true;
    const parentsOf = {};
    for (const row of ledgerRows) {
      if (!parentsOf[row.contentId]) parentsOf[row.contentId] = [row.parentId, row.grandparentId].filter(Boolean);
    }
    this.#logger.info?.('media.suggestions.built', {
      householdId: householdId ?? null, ms: this.#clock.now() - started, carryOn: carryOn.length, fresh: fresh.length, ledgerRows: ledgerRows.length,
    });
    return { generatedAt: new Date(this.#clock.now()).toISOString(), ledgerRows, carryOn, fresh, parentsOf, degraded };
  }

  async #ledgerRows() {
    if (!this.#ledger?.plays) return [];
    try {
      return await this.#ledger.plays({
        from: new Date(this.#clock.now() - LEDGER_DAYS * DAY_MS).toISOString(), limit: 100000, nowEpoch: this.#clock.now(),
      });
    } catch (error) {
      this.#logger.warn?.('media.suggestions.ledger_read_failed', { error: error.message });
      return [];
    }
  }

  async #favourites(householdId) {
    const { items } = await this.#memory.listFavourites(householdId);
    return (items || []).slice(0, CANDIDATES_PER_ROW).map((f) => ({
      id: f.id, kind: f.kind ?? 'item', type: f.type ?? null, title: f.title ?? null, thumbnail: f.thumbnail ?? null,
    }));
  }

  async #carryOn(householdId) {
    const { items, degraded } = await this.#memory.carryOn({ householdId, limit: CANDIDATES_PER_ROW });
    return { degraded: degraded === true, items: (items || []).map((e) => ({
      id: e.contentId, kind: 'item', type: e.type ?? null, title: e.title ?? null, thumbnail: e.thumbnail ?? null,
      reason: e.reason ?? null, percent: e.percent ?? null, playhead: e.playhead ?? null, duration: e.duration ?? null,
      playedOn: e.playedOn?.deviceId ?? null,
      parentId: qualify(e.parentId, e.contentId),
      grandparentId: qualify(e.grandparentId, e.contentId),
      parentTitle: e.parentTitle ?? null, grandparentTitle: e.grandparentTitle ?? null,
    })) };
  }

  async #timeOfDay(householdId, deviceId, rows) {
    const now = this.#nowLocal();
    let groups = [];
    let scope = 'household';
    if (deviceId) {
      let ids = [deviceId];
      try { ids = (await this.#screens?.aliasesOf?.(deviceId, householdId)) ?? ids; } catch { /* own id only */ }
      const mine = new Set(ids);
      groups = timeOfDayGroups(rows.filter((r) => mine.has(r.deviceId)), { now });
      scope = 'screen';
    }
    if (!groups.length) {
      groups = timeOfDayGroups(rows, { now });
      scope = 'household';
    }
    const top = groups.slice(0, CANDIDATES_PER_ROW);
    const display = top.length && this.#memory.describeMany ? await this.#memory.describeMany(top.map((g) => g.id)) : new Map();
    return {
      scope,
      label: scope === 'screen' ? TIME_OF_DAY_LABELS.screen : TIME_OF_DAY_LABELS.household,
      items: top.map((g) => {
        const d = display.get(g.id) || {};
        return {
          id: g.id, kind: g.kind, type: d.type ?? g.type ?? null, title: d.title ?? g.continue?.title ?? null,
          thumbnail: d.thumbnail ?? null, days: g.days, lastPlayedAt: g.lastPlayedAt,
          continue: g.kind === 'collection' ? g.continue : null,
        };
      }),
    };
  }

  async #fresh() {
    if (!this.#recent?.list) return [];
    const since = new Date(this.#clock.now() - NEW_WITHIN_DAYS * DAY_MS).toISOString();
    const items = (await this.#recent.list({ since, limit: CANDIDATES_PER_ROW })) || [];
    return items.filter((i) => i?.id && Date.parse(i.addedAt) >= Date.parse(since)).map((i) => ({
      id: i.id, kind: COLLECTION_TYPES.has(i.type) ? 'collection' : 'item', type: i.type ?? null,
      title: i.title ?? null, thumbnail: i.thumbnail ?? null, addedAt: i.addedAt,
      latest: i.latestId && i.latestId !== i.id ? { contentId: i.latestId, title: i.latestTitle ?? null } : null,
    }));
  }

  async #excluded(householdId, parentsOf = {}) {
    const out = new Set();
    try {
      const live = await this.#memory.nowPlaying?.();
      for (const np of live?.list || []) {
        if (!np?.contentId) continue;
        out.add(np.contentId);
        for (const parent of parentsOf[np.contentId] || []) out.add(parent);
      }
    } catch (error) {
      this.#logger.warn?.('media.suggestions.now_playing_failed', { error: error.message });
    }
    try {
      const { items } = await this.#memory.listRemoved(householdId);
      for (const r of items || []) if (r?.id) out.add(r.id);
    } catch (error) {
      this.#logger.warn?.('media.suggestions.removed_read_failed', { error: error.message });
    }
    return out;
  }
}

export default MediaSuggestionsService;
