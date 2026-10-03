/**
 * RoutineLoadRecorder — wraps the wake-and-load service behind
 * `GET|POST /api/v1/device/:id/load` to learn who asked for each load
 * (RQ-HOUSE-07, RQ-AUTO-05, AUTO.2a).
 *
 * Who asked, in order:
 *   1. `routine=<name>` in the load query (optional `routineId`) — a routine
 *      that names itself. Both params are stripped before the screen sees
 *      the query.
 *   2. a Home Assistant caller (User-Agent `HomeAssistant/...`): a routine,
 *      named by matching screen + query against the routine catalog
 *      ("Kitchen Button 4: Slow TV"), else "Home Assistant".
 *   3. an `X-Daylight-Device` header (`browser:` / `fleet:`): a person sending
 *      from that screen.
 *   Otherwise unknown — recorded as nothing.
 *
 * Then: the origin is noted for the target screen's next play-ledger start
 * (LoadOriginHints); a routine's load goes through the routine dedupe (the
 * same trigger twice within 10 s starts once) and its outcome is written to
 * the routine history. The load itself is never changed or failed by this.
 */
const HOME_ASSISTANT_UA = /\bHomeAssistant\//i;
const DEVICE_ID = /^(fleet|browser):[A-Za-z0-9._-]{1,96}$/;
const ORIGIN_PARAMS = ['routine', 'routineId'];

export class RoutineLoadRecorder {
  #inner;
  #context;
  #catalog;
  #history;
  #hints;
  #dedupe;
  #clock;
  #logger;

  /**
   * @param {Object} deps
   * @param {{execute: Function}} deps.wakeAndLoad
   * @param {() => ({userAgent?:string, device?:string}|null)} [deps.context] - current request context
   * @param {{match: Function}} [deps.catalog] - RoutineCatalogService
   * @param {{record: Function}} [deps.history] - RoutineHistoryService
   * @param {{note: Function}} [deps.hints] - LoadOriginHints
   * @param {{run: Function}} [deps.dedupe] - RoutineTriggerDedupeService
   */
  constructor({ wakeAndLoad, context = () => null, catalog = null, history = null, hints = null, dedupe = null, clock = Date, logger = console }) {
    if (typeof wakeAndLoad?.execute !== 'function') throw new TypeError('RoutineLoadRecorder requires wakeAndLoad.execute');
    this.#inner = wakeAndLoad;
    this.#context = context;
    this.#catalog = catalog;
    this.#history = history;
    this.#hints = hints;
    this.#dedupe = dedupe;
    this.#clock = clock;
    this.#logger = logger;
  }

  async #classify(deviceId, query) {
    const forwarded = { ...(query || {}) };
    const named = typeof forwarded.routine === 'string' && forwarded.routine.trim() ? forwarded.routine.trim().slice(0, 64) : null;
    const namedId = typeof forwarded.routineId === 'string' && forwarded.routineId.trim() ? forwarded.routineId.trim().slice(0, 96) : null;
    for (const key of ORIGIN_PARAMS) delete forwarded[key];
    let ctx = null;
    try { ctx = this.#context?.() ?? null; } catch { ctx = null; }

    if (named || namedId || HOME_ASSISTANT_UA.test(ctx?.userAgent ?? '')) {
      let matched = null;
      if (!named || !namedId) {
        try {
          matched = await this.#catalog?.match?.(deviceId, forwarded);
        } catch (error) {
          this.#logger.warn?.('media.routines.match_failed', { deviceId, error: error.message });
        }
      }
      const origin = {
        kind: 'routine',
        id: namedId ?? matched?.id ?? null,
        name: named ?? matched?.name ?? 'Home Assistant',
      };
      return { origin, query: forwarded };
    }
    if (typeof ctx?.device === 'string' && DEVICE_ID.test(ctx.device) && ctx.device !== `fleet:${deviceId}`) {
      return { origin: { kind: 'device', id: ctx.device, name: null }, query: forwarded };
    }
    return { origin: null, query: forwarded };
  }

  /**
   * Same contract as WakeAndLoadService.execute.
   */
  async execute(deviceId, query, opts = {}) {
    let classified;
    try {
      classified = await this.#classify(deviceId, query);
    } catch (error) {
      this.#logger.warn?.('media.routines.classify_failed', { deviceId, error: error.message });
      classified = { origin: null, query };
    }
    const { origin, query: forwarded } = classified;
    const ledgerId = `fleet:${deviceId}`;
    if (origin) this.#hints?.note?.(ledgerId, origin, this.#clock.now());
    const run = () => this.#inner.execute(deviceId, forwarded, opts);

    if (origin?.kind !== 'routine') {
      const result = await run();
      if (origin && result?.ok === false) this.#hints?.note?.(ledgerId, null, this.#clock.now());
      return result;
    }

    this.#logger.info?.('media.routines.load', { deviceId, routine: origin.name, routineId: origin.id });
    let result = null;
    let failure = null;
    try {
      result = this.#dedupe?.run
        ? await this.#dedupe.run({
          origin: { ...origin, triggerId: origin.id ?? origin.name },
          triggerId: `${origin.id ?? origin.name}|${JSON.stringify(forwarded)}`,
          targetId: deviceId,
        }, run)
        : await run();
    } catch (error) {
      failure = error;
    }
    if (result?.ok === false || failure) this.#hints?.note?.(ledgerId, null, this.#clock.now());
    if (this.#history?.record) {
      await this.#history.record({ routine: origin, deviceId: ledgerId, query: forwarded, result, error: failure });
    }
    if (failure) throw failure;
    return result;
  }
}

export default RoutineLoadRecorder;
