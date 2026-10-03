/**
 * RoutineCatalogService — the household's routines that start playback, and
 * the screens they target (RQ-AUTO-02, RQ-AUTO-05, RQ-HOUSE-06/08).
 *
 * Three sources, merged:
 *
 *   live      Home Assistant config read in place (HomeAssistantRoutineFileSource),
 *             when the app can see it; cached for `cacheTtlMs`
 *   snapshot  the last catalog imported through PUT /routines/catalog — the
 *             fallback where the app cannot see the HA config (the container)
 *   observed  routines seen in the routine history, or as a routine origin
 *             on play-ledger starts (last 30 days — e.g. a routine that drives
 *             a browser left open on the wall), that neither of the above
 *             knows (e.g. a new HA automation since the last import)
 *
 * Routine → screen links come from #domains/media/routineCatalog.mjs and are
 * by stable screen id, so renames never break them.
 */
import { extractRoutines, matchRoutines, routinesTargeting } from '#domains/media/routineCatalog.mjs';

const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const LEDGER_OBSERVED_DAYS = 30;

const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
const summary = ({ id, name, kind, source }) => ({ id, name, kind, source });

function validRoutine(r) {
  return r && typeof r === 'object' && typeof r.id === 'string' && Array.isArray(r.targets)
    && r.targets.every((t) => t && typeof t.deviceId === 'string');
}

export class RoutineCatalogService {
  #live;
  #snapshots;
  #history;
  #ledger;
  #clock;
  #ttl;
  #logger;
  /** @type {Map<string, {at:number, value:Object}>} */
  #cache = new Map();

  /**
   * @param {Object} deps
   * @param {Array<{name:string, available:Function, read:Function}>} [deps.liveSources]
   * @param {import('./ports/IRoutineSnapshotDatastore.mjs').IRoutineSnapshotDatastore} [deps.snapshots]
   * @param {{load: Function}} [deps.history] - routine history runs (observed routines)
   * @param {{plays: Function}} [deps.playLedger] - ledger starts with routine origins (observed routines)
   */
  constructor({ liveSources = [], snapshots = null, history = null, playLedger = null, clock = Date, cacheTtlMs = DEFAULT_CACHE_TTL_MS, logger = console } = {}) {
    this.#live = liveSources;
    this.#snapshots = snapshots;
    this.#history = history;
    this.#ledger = playLedger;
    this.#clock = clock;
    this.#ttl = cacheTtlMs;
    this.#logger = logger;
  }

  async #readLive() {
    const routines = [];
    const sources = [];
    for (const source of this.#live) {
      let available = false;
      try { available = Boolean(source.available?.()); } catch { available = false; }
      if (!available) { sources.push({ name: source.name, kind: 'live', available: false, count: 0, readAt: null }); continue; }
      try {
        const config = await source.read();
        const found = config ? extractRoutines(config) : [];
        routines.push(...found);
        sources.push({ name: source.name, kind: 'live', available: true, count: found.length, readAt: new Date(this.#clock.now()).toISOString() });
      } catch (error) {
        this.#logger.warn?.('media.routines.live_read_failed', { source: source.name, error: error.message });
        sources.push({ name: source.name, kind: 'live', available: false, count: 0, readAt: null, error: error.message });
      }
    }
    return { routines, sources, any: sources.some((s) => s.available) };
  }

  async #observedRuns(householdId) {
    const runs = [];
    if (this.#history?.load) {
      try {
        runs.push(...((await this.#history.load(householdId)) || []));
      } catch (error) {
        this.#logger.warn?.('media.routines.history_read_failed', { error: error.message });
      }
    }
    if (this.#ledger?.plays) {
      try {
        const from = new Date(this.#clock.now() - LEDGER_OBSERVED_DAYS * 24 * 60 * 60 * 1000).toISOString();
        for (const row of (await this.#ledger.plays({ from, limit: 100000, nowEpoch: this.#clock.now() })) || []) {
          const origin = row?.origin;
          if (origin && typeof origin === 'object' && origin.kind === 'routine') {
            runs.push({ routine: { id: origin.id ?? null, name: origin.name ?? null }, deviceId: row.deviceId, what: {} });
          }
        }
      } catch (error) {
        this.#logger.warn?.('media.routines.ledger_read_failed', { error: error.message });
      }
    }
    return runs;
  }

  async #observed(householdId, known) {
    if (!this.#history?.load && !this.#ledger?.plays) return [];
    const runs = await this.#observedRuns(householdId);
    const byKey = new Map();
    for (const run of runs) {
      const id = run?.routine?.id;
      if (id && known.has(id)) continue;
      const key = id || `observed:${slug(run?.routine?.name)}`;
      if (known.has(key)) continue;
      const entry = byKey.get(key) || { id: key, name: run?.routine?.name || 'Unnamed routine', kind: 'observed', source: 'history', targets: [], via: [] };
      const query = run?.what?.key ? `${run.what.key}=${run.what.value}` : '';
      if (run?.deviceId && !entry.targets.some((t) => t.deviceId === run.deviceId && t.query === query)) {
        entry.targets.push({ deviceId: run.deviceId, screenId: run.deviceId.startsWith('fleet:') ? run.deviceId.slice(6) : null, query });
      }
      byKey.set(key, entry);
    }
    return [...byKey.values()];
  }

  /**
   * @returns {Promise<{routines: Object[], sources: Object[]}>}
   */
  async list({ householdId } = {}) {
    const key = householdId ?? '';
    const cached = this.#cache.get(key);
    if (cached && this.#clock.now() - cached.at < this.#ttl) return cached.value;
    const live = await this.#readLive();
    let routines = live.routines;
    const sources = [...live.sources];
    let snapshot = null;
    if (this.#snapshots) {
      try {
        snapshot = await this.#snapshots.load(householdId);
      } catch (error) {
        this.#logger.warn?.('media.routines.snapshot_read_failed', { error: error.message });
      }
      sources.push({
        name: 'snapshot', kind: 'snapshot', available: Boolean(snapshot), used: !live.any && Boolean(snapshot),
        count: snapshot?.routines?.length ?? 0, importedAt: snapshot?.importedAt ?? null, from: snapshot?.source ?? null,
      });
    }
    if (!live.any && snapshot) routines = snapshot.routines.filter(validRoutine);
    const observed = await this.#observed(householdId, new Set(routines.map((r) => r.id)));
    sources.push({ name: 'history', kind: 'observed', available: Boolean(this.#history || this.#ledger), count: observed.length });
    const value = { routines: [...routines, ...observed], sources };
    this.#cache.set(key, { at: this.#clock.now(), value });
    return value;
  }

  /** Routines with a target on this screen id. */
  async targeting(id, householdId) {
    const { routines } = await this.list({ householdId });
    return routinesTargeting(routines, id).map(summary);
  }

  /**
   * The routine most likely to have sent this load (screen + params), from
   * the configured catalog (not observed history). Null when none fits.
   */
  async match(deviceId, params, householdId) {
    const { routines } = await this.list({ householdId });
    const [best] = matchRoutines(routines.filter((r) => r.kind !== 'observed'), deviceId, params);
    return best ? summary(best) : null;
  }

  /**
   * Replace the stored snapshot: either parsed routine config
   * (`{ restCommands, scripts, automations }`) or already-extracted routines.
   */
  async importSnapshot({ householdId, config = null, routines = null, source = 'import' } = {}) {
    if (!this.#snapshots) throw new Error('Routine snapshots are not configured');
    const list = config ? extractRoutines(config) : (Array.isArray(routines) ? routines : null);
    if (!list) {
      const error = new Error('config or routines is required');
      error.code = 'INVALID_ROUTINES';
      throw error;
    }
    const valid = list.filter(validRoutine);
    const importedAt = new Date(this.#clock.now()).toISOString();
    await this.#snapshots.save({ routines: valid, importedAt, source }, householdId);
    this.#cache.delete(householdId ?? '');
    this.#logger.info?.('media.routines.snapshot_imported', { householdId: householdId ?? null, count: valid.length, dropped: list.length - valid.length, source });
    return { count: valid.length, dropped: list.length - valid.length, importedAt };
  }

  /** Forget cached reads (after the history gains a run, say). */
  invalidate(householdId) {
    this.#cache.delete(householdId ?? '');
  }
}

export default RoutineCatalogService;
