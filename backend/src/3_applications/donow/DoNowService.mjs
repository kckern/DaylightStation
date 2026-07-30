/**
 * DoNowService — the household "do this now" dispatch path (spec §3/§4/§6).
 *
 * A single façade over eight surfaces (TVs, the garage fitness kiosk, the
 * piano, printers, ...) that all answer the same question — "send this
 * learner here right now" — without a caller ever needing to know how any
 * individual surface actually works. Every call resolves to exactly one of
 * four outcomes (`dispatched`, `pending_approval`, `denied`, `failed`), each
 * carrying a human sentence a caller's own surface (a printed slip, a UI
 * toast) can show verbatim.
 *
 * Behavior order matters and is NOT reorderable (spec §3/§4/§6):
 *
 *   1. Resolve the surface adapter; unknown surface -> `failed`.
 *   2. `adapter.validateAction(action)`; any errors -> `failed`.
 *   3. **Pending dedup FIRST**, before any occupancy probe or policy call —
 *      an unexpired pending request for the same surface+ref returns its
 *      existing `approvalId` as `pending_approval` and calls NEITHER the
 *      occupancy probe NOR the notifier. This is what stops an impatient
 *      re-scan from paging a parent twice.
 *   4. Probe occupancy. A throwing adapter is treated as `unknown` (fail
 *      closed — an unknown surface is possibly-occupied, never clobbered).
 *   5. Run the pure policy engine (`decideDispatch`) against that occupancy.
 *   6. Act on the decision:
 *      - `dispatch` -> call `adapter.dispatch`; a throw or `{dispatched:
 *        false}` becomes `failed`. On real success, append ONE dispatch-log
 *        row and ONLY THEN emit `donow.dispatched` on the event bus (log
 *        before broadcast, so nothing downstream can observe the event
 *        before the audit trail exists).
 *      - `pending_approval` -> persist a pending record (label from
 *        `adapter.label(action)`, occupant from the probe, `expiresAt` =
 *        now + `approvalTtlSeconds`) and best-effort notify; a notifier
 *        failure is caught, logged loudly, and does NOT change the outcome
 *        — the request still pends and can be approved later from the
 *        queue.
 *      - `denied` -> a message naming the busy surface by its label.
 */
import { decideDispatch } from '#domains/donow/policy.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

export class DoNowService {
  #surfaces;
  #datastore;
  #notifier;
  #eventBus;
  #clock;
  #timezone;
  #approvalTtlSeconds;
  #newId;
  #logger;

  /**
   * @param {Object} config
   * @param {Map<string, Object>} config.surfaces - surface id -> IDoNowSurface adapter.
   * @param {Object} config.datastore - YamlDoNowDatastore-shaped store (findPending/putPending/appendDispatch).
   * @param {Object} [config.notifier] - `{ notify(record) }`; best-effort, failures are swallowed.
   * @param {Object} [config.eventBus] - `{ broadcast(topic, payload) }`.
   * @param {Function} [config.clock] - `() => Date`, overridable for tests.
   * @param {string} [config.timezone] - Household timezone, carried for future callers.
   * @param {number} [config.approvalTtlSeconds=120] - Pending-request TTL.
   * @param {Function} [config.newId] - Approval id generator.
   * @param {Object} [config.logger]
   */
  constructor({
    surfaces,
    datastore,
    notifier = null,
    eventBus = null,
    clock = () => new Date(),
    timezone = null,
    approvalTtlSeconds = 120,
    newId = () => `dnr_${shortId(8)}`,
    logger,
  } = {}) {
    if (!surfaces) {
      throw new Error('DoNowService requires surfaces (a Map of id -> adapter)');
    }
    if (!datastore) {
      throw new Error('DoNowService requires datastore');
    }
    this.#surfaces = surfaces;
    this.#datastore = datastore;
    this.#notifier = notifier;
    this.#eventBus = eventBus;
    this.#clock = clock;
    this.#timezone = timezone;
    this.#approvalTtlSeconds = approvalTtlSeconds;
    this.#newId = newId;
    this.#logger = logger || console;
  }

  /**
   * @param {Object} params
   * @param {string} params.surface - Closed registry surface id.
   * @param {*} params.action - Surface-specific dispatch payload.
   * @param {string|null} [params.learnerId] - Who this dispatch is FOR.
   * @param {string} params.requestedBy - Provenance: 'school-scan' | 'school-program' | 'api' | 'trigger' | ...
   * @param {*} [params.ref] - Caller's correlation id (dedup + log key).
   * @param {string} [params.programId] - Threaded through to the dispatch log when supplied.
   * @param {string} [params.force] - undefined | 'never_ask' (deny instead of pending).
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'failed', approvalId?: string, message: string}>}
   */
  async dispatch({
    surface, action, learnerId = null, requestedBy, ref = null, programId = null, force = undefined,
  }) {
    const adapter = this.#surfaces.get(surface);
    if (!adapter) {
      return { decision: 'failed', message: `Unknown surface "${surface}".` };
    }

    const errors = this.#validate(adapter, action);
    if (errors.length > 0) {
      return { decision: 'failed', message: errors.join('; ') };
    }

    const nowIso = this.#nowIso();

    // Pending dedup FIRST — before any occupancy probe or notifier call.
    const existing = await this.#datastore.findPending({ surface, ref, nowIso });
    if (existing) {
      const label = this.#safeLabel(adapter, action, surface);
      return {
        decision: 'pending_approval',
        approvalId: existing.id,
        message: `Still waiting on a grown-up to approve the ${label} — we haven't asked again.`,
      };
    }

    const occupancy = await this.#probeOccupancy(adapter, surface);
    const decision = decideDispatch({ occupancy, learnerId, force });

    if (decision === 'dispatch') {
      return this.#actDispatch({ adapter, surface, action, learnerId, requestedBy, ref, programId, nowIso });
    }

    if (decision === 'denied') {
      const label = this.#safeLabel(adapter, action, surface);
      return { decision: 'denied', message: `The ${label} is busy right now.` };
    }

    return this.#actPend({ adapter, surface, action, learnerId, requestedBy, ref, occupancy, nowIso });
  }

  #validate(adapter, action) {
    try {
      return adapter.validateAction(action) || [];
    } catch (err) {
      return [err?.message || String(err)];
    }
  }

  async #probeOccupancy(adapter, surface) {
    try {
      return await adapter.occupancy();
    } catch (err) {
      this.#logger.warn?.('donow.occupancy.probe-failed', { surface, error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
  }

  async #actDispatch({ adapter, surface, action, learnerId, requestedBy, ref, programId, nowIso }) {
    const label = this.#safeLabel(adapter, action, surface);
    let result;
    try {
      result = await adapter.dispatch({ action, learnerId });
    } catch (err) {
      this.#logger.error?.('donow.dispatch.adapter-threw', { surface, error: err?.message || String(err) });
      return { decision: 'failed', message: `Could not start the ${label}.` };
    }

    if (!result || result.dispatched !== true) {
      this.#logger.warn?.('donow.dispatch.adapter-declined', { surface, detail: result?.detail });
      return { decision: 'failed', message: `Could not start the ${label}.` };
    }

    // Log before broadcast — nothing downstream should observe the event
    // before the audit trail for it exists. `programId` is included only
    // when non-null (absent key, not present-with-null), mirroring the
    // datastore's own presence-filtered evidence query (Task 12).
    const row = { at: nowIso, surface, decision: 'dispatch', learnerId, requestedBy, ref };
    if (programId != null) row.programId = programId;
    await this.#datastore.appendDispatch(row);
    this.#eventBus?.broadcast('donow', { type: 'donow.dispatched', ref, surface, requestedBy });

    return { decision: 'dispatched', message: `Starting the ${label} now.` };
  }

  async #actPend({ adapter, surface, action, learnerId, requestedBy, ref, occupancy, nowIso }) {
    const label = this.#safeLabel(adapter, action, surface);
    const id = this.#newId();
    const expiresAt = new Date(Date.parse(nowIso) + this.#approvalTtlSeconds * 1000).toISOString();
    const record = {
      id,
      surface,
      action,
      label,
      learnerId,
      requestedBy,
      ref,
      occupant: occupancy.occupantId,
      createdAt: nowIso,
      expiresAt,
    };

    await this.#datastore.putPending(record);

    if (this.#notifier) {
      try {
        await this.#notifier.notify(record);
      } catch (err) {
        this.#logger.error?.('donow.notify.failed', { surface, approvalId: id, error: err?.message || String(err) });
      }
    }

    return {
      decision: 'pending_approval',
      approvalId: id,
      message: `The ${label} is busy — we asked a grown-up.`,
    };
  }

  #safeLabel(adapter, action, surface) {
    try {
      return adapter.label(action) || surface;
    } catch {
      return surface;
    }
  }

  #nowIso() {
    const now = this.#clock();
    return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  }
}

export default DoNowService;
