/**
 * ScreenPlaybackService — per-screen playback history views.
 *
 *   started by     RQ-HOUSE-07  how the screen's current playback started:
 *                               from which device, or by which routine, and when
 *   played earlier RQ-FIND-17   the screen's starts, newest first, with picture,
 *                               title and time played
 *
 * Both read the play ledger (one row per start per screen; merged duplicate
 * screens included via the registry's aliases). "Started by" prefers the
 * screen's live session snapshot (`meta.origin`, set by whoever last drove
 * it), else walks back the ledger through the current run of plays — starts
 * no more than `runGapMs` (30 min) apart — to the first one that carries an
 * origin. A queue a routine started is "started by" that routine for every
 * item of the run.
 *
 * Display fields come from HouseholdMediaMemoryService.describeMany (shared
 * catalog cache, concurrency 4, per-lookup and per-request deadlines).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RUN_GAP_MS = 30 * 60 * 1000;
const STARTED_BY_LOOKBACK_MS = DAY_MS;

function clampLimit(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Ledger origins: structured, or legacy text ('routine:<name>'). */
export function readOrigin(origin) {
  if (!origin) return null;
  if (typeof origin === 'object') {
    if (origin.kind === 'device' || origin.kind === 'routine') {
      return { kind: origin.kind, id: origin.id ?? null, name: origin.name ?? null };
    }
    return null;
  }
  const text = String(origin);
  if (text.startsWith('routine:')) return { kind: 'routine', id: null, name: text.slice(8) || null };
  if (/^(fleet|browser):/.test(text)) return { kind: 'device', id: text, name: null };
  return { kind: 'unknown', id: null, name: text };
}

const bareScreen = (id) => (typeof id === 'string' && id.startsWith('fleet:') ? id.slice(6) : null);

export class ScreenPlaybackService {
  #ledger;
  #liveness;
  #memory;
  #screens;
  #browserPlayback;
  #clock;
  #logger;
  #runGapMs;

  /**
   * @param {Object} deps
   * @param {Object} deps.playLedger - PlayLedgerRecorder (plays, nowPlaying)
   * @param {Object} [deps.livenessService] - DeviceLivenessService (getLastSnapshot)
   * @param {Object} [deps.memory] - HouseholdMediaMemoryService (describeMany, nowPlaying)
   * @param {Object} [deps.screens] - ScreenRegistryService (aliasesOf, nameOf, resolve)
   */
  constructor({ playLedger, livenessService = null, memory = null, screens = null, browserPlayback = null, clock = Date, logger = console, runGapMs = DEFAULT_RUN_GAP_MS }) {
    if (typeof playLedger?.plays !== 'function') throw new TypeError('ScreenPlaybackService requires playLedger.plays');
    this.#ledger = playLedger;
    this.#liveness = livenessService;
    this.#memory = memory;
    this.#screens = screens;
    this.#browserPlayback = browserPlayback;
    this.#clock = clock;
    this.#logger = logger;
    this.#runGapMs = runGapMs;
  }

  async #ids(deviceId, householdId) {
    const qualified = deviceId.includes(':') ? deviceId : `fleet:${deviceId}`;
    try {
      const screenId = (await this.#screens?.resolve?.(qualified, householdId)) ?? qualified;
      const aliases = (await this.#screens?.aliasesOf?.(screenId, householdId)) ?? [screenId];
      return { screenId, aliases };
    } catch {
      return { screenId: qualified, aliases: [qualified] };
    }
  }

  async #rows(aliases, fromMs, limit) {
    try {
      return await this.#ledger.plays({
        deviceId: aliases, from: new Date(fromMs).toISOString(), limit, nowEpoch: this.#clock.now(),
      });
    } catch (error) {
      this.#logger.warn?.('media.screen-playback.ledger_read_failed', { error: error.message });
      return [];
    }
  }

  #browserState(aliases) {
    if (!this.#browserPlayback) return null;
    for (const id of aliases) {
      const entry = this.#browserPlayback.get?.(id);
      if (entry) return entry;
    }
    return null;
  }

  #snapshot(aliases) {
    if (!this.#liveness?.getLastSnapshot) return null;
    for (const id of aliases) {
      const bare = bareScreen(id);
      if (!bare) continue;
      const entry = this.#liveness.getLastSnapshot(bare);
      if (entry?.online && entry.snapshot) return entry.snapshot;
    }
    return null;
  }

  async #nowPlaying(aliases) {
    try {
      const live = (await this.#memory?.nowPlaying?.()) ?? { list: [] };
      return (live.list || []).find((np) => aliases.includes(np.deviceId)) ?? null;
    } catch {
      return null;
    }
  }

  async #named(origin, householdId) {
    if (!origin) return null;
    if (origin.kind === 'device' && origin.id && !origin.name) {
      try {
        return { ...origin, name: (await this.#screens?.nameOf?.(origin.id, householdId)) ?? null };
      } catch {
        return origin;
      }
    }
    return origin;
  }

  /**
   * How the screen's current playback started.
   * @returns {Promise<{deviceId, playing:{contentId,title}|null, startedBy:{kind,id,name}|null, at:string|null,
   *   source:'snapshot'|'ledger'|null, runStartedAt:string|null}>}
   */
  async startedBy({ householdId, deviceId } = {}) {
    const { screenId, aliases } = await this.#ids(deviceId, householdId);
    const now = this.#clock.now();
    const snapshot = this.#snapshot(aliases);
    const live = await this.#nowPlaying(aliases);
    const browser = this.#browserState(aliases);
    const currentId = snapshot?.currentItem?.contentId ?? live?.contentId ?? browser?.contentId ?? null;
    const rows = await this.#rows(aliases, now - STARTED_BY_LOOKBACK_MS, 500);

    // The current run: newest start back through starts ≤ runGapMs apart.
    const run = [];
    for (const row of rows) {
      const prev = run[run.length - 1];
      if (prev && Date.parse(prev.startedAt) - Date.parse(row.startedAt) > this.#runGapMs) break;
      run.push(row);
    }
    const currentRow = currentId ? run.find((r) => r.contentId === currentId) ?? null : (run[0] ?? null);
    const originRow = run.find((r) => readOrigin(r.origin)) ?? null;

    let startedBy = null;
    let at = null;
    let source = null;
    // A browser has no device snapshot: its own state frame says how the item it
    // is playing now started (the routine that drove the tab, the device that sent it).
    const browserOrigin = browser && browser.contentId === currentId ? readOrigin(browser.origin) : null;
    const snapshotOrigin = readOrigin(snapshot?.meta?.origin) ?? browserOrigin;
    if (snapshotOrigin && snapshotOrigin.kind !== 'unknown') {
      startedBy = snapshotOrigin;
      at = currentRow?.startedAt ?? originRow?.startedAt ?? snapshot?.meta?.updatedAt
        ?? (browserOrigin ? new Date(browser.at).toISOString() : null);
      source = 'snapshot';
    } else if (originRow) {
      startedBy = readOrigin(originRow.origin);
      at = originRow.startedAt;
      source = 'ledger';
    }
    const playingTitle = currentRow?.title ?? snapshot?.currentItem?.title ?? null;
    return {
      deviceId: screenId,
      playing: currentId ? { contentId: currentId, title: playingTitle } : null,
      startedBy: await this.#named(startedBy, householdId),
      at,
      source,
      runStartedAt: run.length ? run[run.length - 1].startedAt : null,
    };
  }

  /** Started-by for every screen playing right now. */
  async startedByAll({ householdId } = {}) {
    let live = [];
    try {
      live = ((await this.#memory?.nowPlaying?.()) ?? { list: [] }).list || [];
    } catch {
      live = [];
    }
    const browsers = this.#browserPlayback?.list?.() ?? [];
    const ids = [...new Set([...live.map((np) => np.deviceId), ...browsers.map((b) => b.deviceId)].filter(Boolean))];
    const items = await Promise.all(ids.map((deviceId) => this.startedBy({ householdId, deviceId })));
    return { items };
  }

  /**
   * The screen's plays, newest first — every start, shuffled runs included.
   * The item playing now is left out (it is not "earlier").
   * @param {{householdId?, deviceId:string, limit?:number, before?:string}} q
   */
  async playedEarlier({ householdId, deviceId, limit, before = null } = {}) {
    const { screenId, aliases } = await this.#ids(deviceId, householdId);
    const max = clampLimit(limit, 50, 200);
    const now = this.#clock.now();
    let rows = await this.#rows(aliases, now - 90 * DAY_MS, 1000);
    if (before && Number.isFinite(Date.parse(before))) rows = rows.filter((r) => Date.parse(r.startedAt) < Date.parse(before));
    const snapshot = this.#snapshot(aliases);
    const live = await this.#nowPlaying(aliases);
    const currentId = snapshot?.currentItem?.contentId ?? live?.contentId ?? null;
    if (!before && currentId && rows[0]?.contentId === currentId) rows = rows.slice(1);
    rows = rows.slice(0, max);
    const display = this.#memory?.describeMany ? await this.#memory.describeMany(rows.map((r) => r.contentId)) : new Map();
    return {
      deviceId: screenId,
      items: rows.map((row) => {
        const d = display.get(row.contentId) || {};
        return {
          contentId: row.contentId,
          startedAt: row.startedAt,
          localTime: row.localTime ?? null,
          title: d.title ?? row.title ?? null,
          thumbnail: d.thumbnail ?? null,
          type: d.type ?? row.kind ?? null,
          parentTitle: d.parentTitle ?? null,
          grandparentTitle: d.grandparentTitle ?? null,
          parentId: row.parentId ?? null,
          grandparentId: row.grandparentId ?? null,
          playedOn: row.deviceId,
          origin: readOrigin(row.origin),
        };
      }),
    };
  }
}

export default ScreenPlaybackService;
