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
        logger: this.#options.logger,
      });
    }
    return this.#notificationService;
  }
}
