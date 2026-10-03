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
import { extractRoutines, matchRoutines, routinesTargeting, validateRoutineImport } from '#domains/media/routineCatalog.mjs';

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
  /** @type {Map<string, Promise<Object>>} */
  #refreshing = new Map();

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
  async list({ householdId, force = false } = {}) {
    const key = householdId ?? '';
    const cached = this.#cache.get(key);
    if (!force && cached && this.#clock.now() - cached.at < this.#ttl) return cached.value;
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

  /**
   * The last catalog read, without reading anything now (stale is fine); a
   * missing or stale one is refreshed in the background. For the load path,
   * which must not wait on files before the TV is woken.
   * @returns {Object|null} `{routines, sources}` or null when never read
   */
  peek(householdId) {
    const key = householdId ?? '';
    const cached = this.#cache.get(key);
    if ((!cached || this.#clock.now() - cached.at >= this.#ttl) && !this.#refreshing.has(key)) {
      const run = this.list({ householdId, force: true })
        .catch((error) => { this.#logger.warn?.('media.routines.refresh_failed', { error: error.message }); })
        .finally(() => this.#refreshing.delete(key));
      this.#refreshing.set(key, run);
    }
    return cached?.value ?? null;
  }

  /** match() from the last catalog read only (see peek). */
  peekMatch(deviceId, params, householdId) {
    const value = this.peek(householdId);
    if (!value) return null;
    const [best] = matchRoutines(value.routines.filter((r) => r.kind !== 'observed'), deviceId, params);
    return best ? summary(best) : null;
  }

  /** Whether the last catalog read lists this routine id (observed ones included). */
  knows(routineId, householdId) {
    const value = this.#cache.get(householdId ?? '')?.value;
    return Boolean(routineId && value?.routines?.some((r) => r.id === routineId));
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
   * Replace the stored snapshot with routines extracted elsewhere (where the
   * HA config is readable — cli/media-routines.cli.mjs). Validated strictly:
   * a malformed import is refused whole, nothing stored.
   */
  async importSnapshot({ householdId, routines, source = 'import' } = {}) {
    if (!this.#snapshots) throw new Error('Routine snapshots are not configured');
    const errors = validateRoutineImport(routines);
    if (errors.length) {
      const error = new Error(`Invalid routines: ${errors[0]}`);
      error.code = 'INVALID_ROUTINES';
      error.details = { errors: errors.slice(0, 20) };
      throw error;
    }
    const importedAt = new Date(this.#clock.now()).toISOString();
    const clean = routines.map(({ id, name, kind, source: from, targets, via }) => ({
      id, name, kind: kind ?? 'automation', source: from ?? 'home-assistant',
      targets: targets.map(({ deviceId, query }) => ({ deviceId, screenId: deviceId.startsWith('fleet:') ? deviceId.slice(6) : null, query })),
      via: via ?? [],
    }));
    await this.#snapshots.save({ routines: clean, importedAt, source: String(source).slice(0, 64) }, householdId);
    this.#cache.delete(householdId ?? '');
    this.#logger.info?.('media.routines.snapshot_imported', { householdId: householdId ?? null, count: clean.length, source });
    return { count: clean.length, importedAt };
  }

  /** Forget cached reads (after the history gains a run, say). */
  invalidate(householdId) {
    this.#cache.delete(householdId ?? '');
  }
}

export default RoutineCatalogService;
