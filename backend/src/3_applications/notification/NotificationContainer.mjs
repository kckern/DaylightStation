import { NotificationService } from './NotificationService.mjs';
import { AppNotificationAdapter } from '#adapters/notification/AppNotificationAdapter.mjs';
import { TelegramNotificationAdapter } from '#adapters/notification/TelegramNotificationAdapter.mjs';
import { EmailNotificationAdapter } from '#adapters/notification/EmailNotificationAdapter.mjs';
import { PushNotificationAdapter } from '#adapters/notification/PushNotificationAdapter.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

/**
 * DI container for the notification domain.
 */
export class NotificationContainer {
  #notificationService;
  #options;

  constructor(options = {}) {
    this.#options = options;
  }

  getNotificationService() {
    if (!this.#notificationService) {
      const adapters = [
        new AppNotificationAdapter({ eventBus: this.#options.eventBus }),
        new TelegramNotificationAdapter({ telegramAdapter: this.#options.telegramAdapter }),
        new EmailNotificationAdapter(),
        new PushNotificationAdapter(),
      ];

      this.#notificationService = new NotificationService({
        adapters,
        preferenceLoader: this.#options.preferenceLoader
          || (() => new NotificationPreference({})),
        logger: this.#options.logger,
      });
    }
    return this.#notificationService;
  }
}
