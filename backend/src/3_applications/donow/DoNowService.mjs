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
 *        row and ONLY THEN publish `donow.dispatched` through the realtime gateway (log
 *        before broadcast, so nothing downstream can observe the event
 *        before the audit trail exists). The broadcast carries `approved:
 *        true` + `approvalId` ONLY when this dispatch came from
 *        `dispatchApproved` (an out-of-band approval, nobody waiting
 *        synchronously on this exact call) — the immediate `dispatch()` path
 *        never sets them, since ITS caller already has the result in hand
 *        and needs no notification. A subscriber that acted on both shapes
 *        the same way would double-fire against its own caller's inline
 *        handling — see `DoNowSchoolBridge`.
 *      - `pending_approval` -> persist a pending record (label from
 *        `adapter.label(action)`, occupant from the probe, `expiresAt` =
 *        now + `approvalTtlSeconds`) and best-effort notify; a notifier
 *        failure is caught, logged loudly, and does NOT change the outcome
 *        — the request still pends and can be approved later from the
 *        queue. The message ITSELF is honest about whether anyone was
 *        actually notified: "...we asked a grown-up" only when a notifier
 *        is configured AND its call succeeded; absent a notifier, or on a
 *        failed notify, the slip reads "...ask a grown-up" instead — the
 *        household still has to be told by some other means, since nobody
 *        was paged.
 *      - `denied` -> a message naming the busy surface by its label.
 */
import { decideDispatch } from '#domains/donow/policy.mjs';
import { shortId } from '#system/utils/id.mjs';

export class DoNowService {
  #surfaces;
  #datastore;
  #notifier;
  #realtimeGateway;
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
   * @param {Object} [config.realtimeGateway] - DoNow completion publication capability.
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
    realtimeGateway = null,
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
    this.#realtimeGateway = realtimeGateway;
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
   * @param {string} [params.force] - undefined | 'never_ask' | 'interrupt'.
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

    const occupancy = await this.#probeOccupancy(adapter, surface, action);
    const decision = decideDispatch({ occupancy, learnerId, force });

    if (decision === 'dispatch') {
      return this.#actDispatch({ adapter, surface, action, learnerId, requestedBy, ref, programId, nowIso });
    }

    if (decision === 'denied') {
      const label = this.#safeLabel(adapter, action, surface);
      return { decision: 'denied', message: `The ${label} is busy right now.` };
    }

    return this.#actPend({ adapter, surface, action, learnerId, requestedBy, ref, programId, occupancy, nowIso });
  }

  /**
   * List the closed surface registry as ids + human labels only — no
   * schemas, no actions (spec §7: `GET /api/v1/donow/surfaces`). A missing
   * or throwing `label()` yields a bare `{ id }` row rather than failing
   * the whole listing for one badly-behaved adapter.
   * @returns {Array<{id: string, label?: string}>}
   */
  listSurfaces() {
    return Array.from(this.#surfaces.keys()).map((id) => {
      const adapter = this.#surfaces.get(id);
      let label;
      try {
        label = typeof adapter.label === 'function' ? adapter.label() : undefined;
      } catch {
        label = undefined;
      }
      return label ? { id, label } : { id };
    });
  }

  /**
   * Re-probe occupancy for one surface — the approvals lifecycle's hook
   * into the same fail-closed probe `dispatch()` uses, so approve-time
   * re-checks (spec §4) share one code path with the initial decision. An
   * unregistered surface probes as `unknown` (fail closed), matching the
   * probe-failure posture rather than throwing on a since-removed surface.
   * `action` (the pending record's original action) is threaded through so
   * a target-scoped adapter (e.g. `playback-hub`) re-checks the SAME target
   * the parent was asked about, not the whole surface.
   * @param {string} surface
   * @param {*} [action]
   * @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: string|null}>}
   */
  async occupancyFor(surface, action) {
    const adapter = this.#surfaces.get(surface);
    if (!adapter) return { state: 'unknown', occupantId: null };
    return this.#probeOccupancy(adapter, surface, action);
  }

  /**
   * Dispatch an already-approved pending record. Shares `#actDispatch` with
   * the initial `dispatch()` path so the log-append + broadcast + message
   * semantics live in exactly one place (the approvals lifecycle must not
   * duplicate them). The dispatch-log row carries `approvalId` (present
   * only when non-null, mirroring `programId`) so the audit trail shows
   * which approval produced the dispatch.
   * @param {Object} record - A pending record (`{id, surface, action, learnerId, requestedBy, ref}`).
   * @returns {Promise<{decision: 'dispatched'|'failed', message: string}>}
   */
  async dispatchApproved(record) {
    const {
      surface, action, learnerId, requestedBy, ref, programId = null, id: approvalId,
    } = record || {};
    const adapter = this.#surfaces.get(surface);
    if (!adapter) {
      return { decision: 'failed', message: `Unknown surface "${surface}".` };
    }
    const nowIso = this.#nowIso();
    return this.#actDispatch({
      adapter, surface, action, learnerId, requestedBy, ref, programId: programId ?? null, nowIso, approvalId,
    });
  }

  #validate(adapter, action) {
    try {
      return adapter.validateAction(action) || [];
    } catch (err) {
      return [err?.message || String(err)];
    }
  }

  async #probeOccupancy(adapter, surface, action) {
    try {
      return await adapter.occupancy({ action });
    } catch (err) {
      this.#logger.warn?.('donow.occupancy.probe-failed', { surface, error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
  }

  async #actDispatch({
    adapter, surface, action, learnerId, requestedBy, ref, programId, nowIso, approvalId = null,
  }) {
    const label = this.#safeLabel(adapter, action, surface);
    let result;
    try {
      result = await adapter.dispatch({ action, learnerId, requestedBy });
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
    if (approvalId != null) row.approvalId = approvalId;
    await this.#datastore.appendDispatch(row);

    // `approved`/`approvalId` are present ONLY on the dispatchApproved path
    // (approvalId is non-null there, always null on the immediate `dispatch()`
    // path). This is the ONLY discriminator between "this just dispatched
    // inline, the caller already has the result in hand" and "this dispatched
    // out of band, from a pending approval, and nobody is waiting on this
    // exact call to find out" — a subscriber (`DoNowSchoolBridge`) that acted
    // on the immediate case too would double-fire, racing its own caller.
    this.#realtimeGateway?.publishDispatchCompleted({ ref, surface, requestedBy, approvalId });

    return { decision: 'dispatched', message: `Starting the ${label} now.` };
  }

  async #actPend({
    adapter, surface, action, learnerId, requestedBy, ref, programId, occupancy, nowIso,
  }) {
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
    // Absent key, not present-with-null — mirrors the dispatch-log row's
    // own programId convention (Task 12's evidence query filters on
    // presence). Without this, a school-program request that PENDS and is
    // approved later would dispatch with no programId at all, and could
    // never count as done for that program.
    if (programId != null) record.programId = programId;

    await this.#datastore.putPending(record);

    // Whether a grown-up was ACTUALLY asked — no notifier configured, or the
    // one call that was made failed, both mean nobody was really notified.
    // The pending record still gets written either way (approval via the
    // API/queue remains possible), but the printed slip must not claim a
    // notification that never reached anyone (spec review finding: "we
    // asked a grown-up" was said even with `notifier: null`).
    let notified = false;
    if (this.#notifier) {
      try {
        await this.#notifier.notify(record);
        notified = true;
      } catch (err) {
        this.#logger.error?.('donow.notify.failed', { surface, approvalId: id, error: err?.message || String(err) });
      }
    }

    return {
      decision: 'pending_approval',
      approvalId: id,
      message: notified
        ? `The ${label} is busy — we asked a grown-up.`
        : `The ${label} is busy — ask a grown-up.`,
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
