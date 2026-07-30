/**
 * HaApprovalNotifier — sends a DoNow pending-approval request to a parent's
 * phone as a Home Assistant actionable notification (spec §4).
 *
 * A thin adapter over the existing `CallHomeAssistantService` passthrough
 * (`{ execute({ domain, service, data }) }`) — no new HA client, no new
 * auth scheme. The `notifyService` (e.g. `notify.mobile_app_parent_phones`,
 * from `donow.yml` config) is split at the dot because HA's `execute`
 * signature wants `domain: 'notify'` and `service: '<target>'` separately,
 * not the dotted form the config author writes.
 *
 * The two action ids (`DONOW_APPROVE_<id>` / `DONOW_DENY_<id>`) are the
 * ENTIRE callback contract: a companion HA automation (deployment config,
 * documented like the NFC-card setup) matches on these ids and posts the
 * tap back to `POST /api/v1/donow/approvals/:id/approve|deny` with the
 * location token. This adapter does not know or need to know that URL.
 */
export class HaApprovalNotifier {
  #callHomeAssistant;
  #notifyService;
  #callbackBase;
  #logger;

  /**
   * @param {Object} config
   * @param {{execute: Function}} config.callHomeAssistant - `execute({domain, service, data})`.
   * @param {string} config.notifyService - Dotted HA notify target, e.g. `notify.mobile_app_parent_phones`.
   * @param {string} [config.callbackBase] - Reserved for documentation/future use (the HA
   *   automation, not this adapter, owns the callback URL — see module doc above).
   * @param {Object} [config.logger]
   */
  constructor({
    callHomeAssistant, notifyService, callbackBase = null, logger,
  } = {}) {
    if (!callHomeAssistant) {
      throw new Error('HaApprovalNotifier requires callHomeAssistant');
    }
    if (!notifyService) {
      throw new Error('HaApprovalNotifier requires notifyService');
    }
    this.#callHomeAssistant = callHomeAssistant;
    this.#notifyService = notifyService;
    this.#callbackBase = callbackBase;
    this.#logger = logger || console;
  }

  /**
   * @param {Object} record - A pending record (`{id, label, ...}`).
   * @returns {Promise<void>}
   */
  async notify(record) {
    const dot = this.#notifyService.indexOf('.');
    const service = dot >= 0 ? this.#notifyService.slice(dot + 1) : this.#notifyService;

    const payload = {
      domain: 'notify',
      service,
      data: {
        title: 'Approval needed',
        message: `${record.label} — a grown-up's OK is needed to start.`,
        data: {
          actions: [
            { action: `DONOW_APPROVE_${record.id}`, title: 'Approve' },
            { action: `DONOW_DENY_${record.id}`, title: 'Deny' },
          ],
        },
      },
    };

    this.#logger.debug?.('donow.notifier.sending', { id: record.id, surface: record.surface, service });
    await this.#callHomeAssistant.execute(payload);
  }
}

export default HaApprovalNotifier;
