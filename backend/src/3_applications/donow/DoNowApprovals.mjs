/**
 * DoNowApprovals — the parental-override lifecycle (spec §4/§8).
 *
 * Sits beside `DoNowService`, not inside it: the service owns the initial
 * dispatch decision (dedup, occupancy probe, policy, act); this class owns
 * what happens to a PENDING record once a parent taps Approve or Deny in
 * the HA notification. It re-uses two service hooks so the log-append +
 * broadcast + message semantics for an actual dispatch live in exactly one
 * place (`DoNowService#actDispatch`, reached here via `dispatchApproved`):
 *
 *   - `service.occupancyFor(surface)` — the same fail-closed occupancy
 *     probe `dispatch()` uses, re-run against the surface named on the
 *     pending record (the world may have changed since the parent was
 *     asked).
 *   - `service.dispatchApproved(record)` — call the surface adapter, log
 *     the dispatch row (carrying `approvalId`), and broadcast
 *     `donow.dispatched`, exactly like an immediate dispatch would.
 *
 * Terminal outcomes (`dispatch`, `denied`) remove the pending record —
 * there is nothing left to decide about it. A second call against a now-
 * missing id (already settled, OR genuinely timed out and pruned by the
 * datastore's read-side TTL prune) reads as `expired` either way: spec §8
 * calls this out explicitly ("first wins, second reads the outcome") and
 * the simplest implementation that satisfies it is "missing id means
 * settled" — no separate outcome ledger is needed.
 *
 * A `repend` (spec §4 approve-time table: a DIFFERENT occupant than either
 * the learner or the one named when the parent was first asked) updates
 * the record in place — `repended: true`, a fresh `expiresAt` (same TTL
 * duration as the original request), the new `occupant` — and notifies
 * ONCE more. `decideOnApprove` itself refuses a second re-pend (the
 * `repended` flag flows back in on the next call), so the caller does not
 * need to re-derive that rule here.
 */
import { decideOnApprove } from '#domains/donow/policy.mjs';

const DEFAULT_TTL_MS = 120_000;
const ALREADY_SETTLED_MESSAGE = 'That request already expired or was already handled.';

export class DoNowApprovals {
  #service;
  #datastore;
  #notifier;
  #clock;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.service - DoNowService-shaped: `occupancyFor(surface)`, `dispatchApproved(record)`.
   * @param {Object} config.datastore - YamlDoNowDatastore-shaped: `listPending/putPending/removePending`.
   * @param {Object} [config.notifier] - `{ notify(record) }`; best-effort, failures are swallowed.
   * @param {Function} [config.clock] - `() => Date`, overridable for tests.
   * @param {Object} [config.logger]
   */
  constructor({
    service, datastore, notifier = null, clock = () => new Date(), logger,
  } = {}) {
    if (!service) {
      throw new Error('DoNowApprovals requires service');
    }
    if (!datastore) {
      throw new Error('DoNowApprovals requires datastore');
    }
    this.#service = service;
    this.#datastore = datastore;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#logger = logger || console;
  }

  /** @returns {Promise<Array>} every unexpired pending record. */
  async listPending() {
    return this.#datastore.listPending();
  }

  /**
   * @param {Object} param
   * @param {string} param.id - Pending record id (`DONOW_APPROVE_<id>` sans prefix).
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'expired', message: string}>}
   */
  async approve({ id }) {
    const record = await this.#findPendingById(id);
    if (!record) return this.#alreadySettled();

    const occupancy = await this.#service.occupancyFor(record.surface);
    const decision = decideOnApprove({
      occupancy,
      learnerId: record.learnerId,
      pendingOccupant: record.occupant,
      repended: !!record.repended,
    });

    if (decision === 'dispatch') return this.#dispatchAndSettle(record);
    if (decision === 'repend') return this.#repend(record, occupancy);
    return this.#denyRecord(record);
  }

  /**
   * @param {Object} param
   * @param {string} param.id - Pending record id.
   * @returns {Promise<{decision: 'denied'|'expired', message: string}>}
   */
  async deny({ id }) {
    const record = await this.#findPendingById(id);
    if (!record) return this.#alreadySettled();
    return this.#denyRecord(record);
  }

  async #dispatchAndSettle(record) {
    const result = await this.#service.dispatchApproved(record);
    // Terminal either way — a failed adapter at approve-time is not
    // retried automatically (the parent already said yes; the surface
    // itself is unreachable), so the pending record is cleared and the
    // caller sees a denial rather than a silently stuck request.
    await this.#datastore.removePending(record.id);
    if (result.decision !== 'dispatched') {
      return { decision: 'denied', message: result.message };
    }
    return { decision: 'dispatched', message: result.message };
  }

  async #repend(record, occupancy) {
    const nowIso = this.#nowIso();
    const updated = {
      ...record,
      repended: true,
      occupant: occupancy.occupantId,
      expiresAt: new Date(Date.parse(nowIso) + this.#ttlMsFor(record)).toISOString(),
    };
    await this.#datastore.putPending(updated);

    if (this.#notifier) {
      try {
        await this.#notifier.notify(updated);
      } catch (err) {
        this.#logger.error?.('donow.approvals.notify-failed', {
          id: record.id, error: err?.message || String(err),
        });
      }
    }

    return {
      decision: 'pending_approval',
      message: `Someone else is using the ${record.label} now — we asked a grown-up again.`,
    };
  }

  async #denyRecord(record) {
    await this.#datastore.removePending(record.id);
    return { decision: 'denied', message: `The ${record.label} request was denied.` };
  }

  async #findPendingById(id) {
    const rows = await this.#datastore.listPending();
    return rows.find((row) => row && row.id === id) || null;
  }

  #alreadySettled() {
    return { decision: 'expired', message: ALREADY_SETTLED_MESSAGE };
  }

  /** Reuse the ORIGINAL request's TTL duration for a re-pend's fresh expiry. */
  #ttlMsFor(record) {
    const created = Date.parse(record.createdAt);
    const expires = Date.parse(record.expiresAt);
    if (Number.isFinite(created) && Number.isFinite(expires) && expires > created) {
      return expires - created;
    }
    return DEFAULT_TTL_MS;
  }

  #nowIso() {
    const now = this.#clock();
    return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  }
}

export default DoNowApprovals;
