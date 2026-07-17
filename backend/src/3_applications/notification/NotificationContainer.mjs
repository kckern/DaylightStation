import { NotificationService } from './NotificationService.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

/**
 * DI container for the notification domain.
 *
 * Receives channel adapter INSTANCES via options (Decision D1: containers
 * never import or construct concrete adapter classes — the composition
 * root builds them and injects here).
 */
export class NotificationContainer {
  #notificationService;
  #options;

  /**
   * @param {Object} options
   * @param {Array<Object>} options.adapters - Channel notification adapter
   *   instances (e.g. app/telegram/email/push), constructed at the
   *   composition root.
   * @param {Function} [options.preferenceLoader] - username -> NotificationPreference
   * @param {Object} [options.policy] - NotificationPolicy; enables governance when
   *   paired with options.ledgerStore.
   * @param {Object} [options.ledgerStore] - dedupe/quiet-hours ledger; enables
   *   governance when paired with options.policy.
   * @param {Function} [options.configLoader] - () => ({ quietHours, cooldowns })
   * @param {Object} [options.clock] - { now: () => Date }
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.#options = options;
  }

  getNotificationService() {
    if (!this.#notificationService) {
      this.#notificationService = new NotificationService({
        adapters: this.#options.adapters || [],
        preferenceLoader: this.#options.preferenceLoader
          || (() => new NotificationPreference({})),
        policy: this.#options.policy,
        ledgerStore: this.#options.ledgerStore,
        configLoader: this.#options.configLoader,
        clock: this.#options.clock,
        logger: this.#options.logger,
      });
    }
    return this.#notificationService;
  }
}
