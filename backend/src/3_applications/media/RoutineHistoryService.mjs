/**
 * RoutineHistoryService — recent routine starts and how they went
 * (RQ-AUTO-05): when, which routine, which screen, what, and the outcome
 * with a plain reason; plus flags for routines pointed at screens that are
 * off, unreachable, retired or unknown.
 *
 * Runs are recorded by RoutineLoadRecorder around each routine-started load
 * (the wake-and-load outcome) and kept in a small rolling household file
 * (30 days, 500 runs). Listing joins each run with the first play-ledger
 * start on that screen right after it, so "what" reads as the item that
 * actually played.
 */
import { buildRoutineRun, appendRun, flagRoutines } from '#domains/media/routineHistory.mjs';

const PLAYED_WITHIN_MS = 5 * 60 * 1000;

function clampLimit(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

export class RoutineHistoryService {
  #store;
  #catalog;
  #screens;
  #ledger;
  #clock;
  #logger;
  #queue = Promise.resolve();

  /**
   * @param {Object} deps
   * @param {import('./ports/IRoutineHistoryDatastore.mjs').IRoutineHistoryDatastore} deps.store
   * @param {Object} [deps.catalog] - RoutineCatalogService
   * @param {Object} [deps.screens] - ScreenRegistryService
   * @param {Object} [deps.playLedger] - PlayLedgerRecorder
   */
  constructor({ store, catalog = null, screens = null, playLedger = null, clock = Date, logger = console }) {
    if (!store) throw new TypeError('RoutineHistoryService requires store');
    this.#store = store;
    this.#catalog = catalog;
    this.#screens = screens;
    this.#ledger = playLedger;
    this.#clock = clock;
    this.#logger = logger;
  }

  async #screenName(deviceId, householdId) {
    try {
      return (await this.#screens?.nameOf?.(deviceId, householdId)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Record one routine-started load. Never throws (history is advisory).
   * @param {{householdId?, routine:{id,name}, deviceId:string, query?:Object, result?:Object, error?:Error}} input
   */
  async record({ householdId, routine, deviceId, query = {}, result = null, error = null }) {
    const run = buildRoutineRun({
      at: new Date(this.#clock.now()).toISOString(),
      routine, deviceId, query, result, error,
      screenName: await this.#screenName(deviceId, householdId),
    });
    const write = this.#queue.catch(() => {}).then(async () => {
      const runs = appendRun(await this.#store.load(householdId), run, { now: this.#clock.now() });
      await this.#store.save(runs, householdId);
    });
    this.#queue = write.catch(() => {});
    try {
      await write;
      this.#catalog?.invalidate?.(householdId);
    } catch (writeError) {
      this.#logger.warn?.('media.routines.history_write_failed', { deviceId, error: writeError.message });
    }
    const log = run.outcome === 'failed' ? 'warn' : 'info';
    this.#logger[log]?.('media.routines.run', {
      routine: run.routine.name, routineId: run.routine.id, deviceId, outcome: run.outcome, reason: run.reason, what: run.what.value,
    });
    return run;
  }

  /**
   * Recent routine starts, newest first.
   * @param {{householdId?, limit?, deviceId?, routineId?}} q
   */
  async list({ householdId, limit, deviceId = null, routineId = null } = {}) {
    let runs = [...(await this.#store.load(householdId))].reverse();
    if (deviceId) {
      const ids = new Set(await this.#aliases(deviceId, householdId));
      runs = runs.filter((r) => ids.has(r.deviceId));
    }
    if (routineId) runs = runs.filter((r) => r.routine?.id === routineId);
    runs = runs.slice(0, clampLimit(limit, 50, 500));
    const names = await this.#names(householdId);
    const plays = await this.#plays(runs);
    return {
      items: runs.map((run) => ({
        ...run,
        screenName: names[run.deviceId] ?? null,
        played: this.#playedAfter(run, plays),
      })),
    };
  }

  /** Routines that will not (or did not) work as things stand. */
  async flags({ householdId } = {}) {
    if (!this.#catalog || !this.#screens) return { items: [] };
    const [{ routines }, view, runs] = await Promise.all([
      this.#catalog.list({ householdId }),
      this.#screens.list({ householdId }),
      this.#store.load(householdId),
    ]);
    return {
      items: flagRoutines({
        routines,
        screens: [...view.screens, ...view.notSeenLately],
        retired: view.retired,
        runs,
        now: this.#clock.now(),
      }),
    };
  }

  async #aliases(deviceId, householdId) {
    try {
      return (await this.#screens?.aliasesOf?.(deviceId, householdId)) ?? [deviceId];
    } catch {
      return [deviceId];
    }
  }

  async #names(householdId) {
    try {
      return (await this.#screens?.names?.(householdId)) ?? {};
    } catch {
      return {};
    }
  }

  async #plays(runs) {
    if (!this.#ledger?.plays || !runs.length) return [];
    const times = runs.map((r) => Date.parse(r.at)).filter(Number.isFinite);
    if (!times.length) return [];
    try {
      return await this.#ledger.plays({
        from: new Date(Math.min(...times)).toISOString(),
        to: new Date(Math.max(...times) + PLAYED_WITHIN_MS).toISOString(),
        limit: 5000,
        nowEpoch: this.#clock.now(),
      });
    } catch (error) {
      this.#logger.warn?.('media.routines.ledger_read_failed', { error: error.message });
      return [];
    }
  }

  #playedAfter(run, plays) {
    if (run.outcome !== 'started') return null;
    const at = Date.parse(run.at);
    const match = plays
      .filter((p) => p.deviceId === run.deviceId)
      .map((p) => ({ p, t: Date.parse(p.startedAt) }))
      .filter(({ t }) => t >= at && t - at <= PLAYED_WITHIN_MS)
      .sort((a, b) => a.t - b.t)[0];
    return match ? { contentId: match.p.contentId, title: match.p.title ?? null, startedAt: match.p.startedAt } : null;
  }
}

export default RoutineHistoryService;
