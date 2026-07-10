/**
 * Notification Stack Bootstrap
 *
 * Composes the notification application service with its channel adapters
 * (app/websocket, telegram, HA push). Adapter instances are constructed here
 * at the composition root and injected (Decision D1).
 */

import { NotificationContainer } from '#apps/notification/NotificationContainer.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';
import { AppNotificationAdapter } from '#adapters/notification/AppNotificationAdapter.mjs';
import { TelegramNotificationAdapter } from '#adapters/notification/TelegramNotificationAdapter.mjs';
import { PushNotificationAdapter } from '#adapters/notification/PushNotificationAdapter.mjs';

// Category -> channels routing when no explicit preferences are configured.
// Ceremony and drift nudges reach the user directly; the rest stay in-app.
const DEFAULT_PREFERENCES = {
  ceremony: { normal: ['telegram', 'push', 'app'], high: ['telegram', 'push', 'app'] },
  drift_alert: { normal: ['telegram', 'app'] },
  goal_update: { normal: ['app'] },
  system: { normal: ['app'] },
};

/**
 * Bootstrap the notification stack.
 *
 * @param {Object} deps
 * @param {Object} [deps.eventBus] - WebSocketEventBus for in-app delivery
 * @param {Object|Function} [deps.telegramAdapter] - TelegramAdapter instance or
 *   thunk (constructed later in startup)
 * @param {Function} [deps.resolveChatId] - username -> telegram chat id
 * @param {string} [deps.publicBaseUrl] - Absolute base URL for turning an intent
 *   action's relative deep-link into a tappable Telegram inline button. When unset,
 *   ceremony nudges are text-only (no "Begin" button).
 * @param {Object} [deps.haGateway] - Home Assistant gateway (callService)
 * @param {Function} [deps.resolveNotifyService] - username -> HA notify service
 * @param {Object} [deps.preferences] - Category->urgency->channels overrides
 * @param {Object} [deps.logger]
 * @returns {Object} { container, notificationService }
 */
export function bootstrapNotifications(deps = {}) {
  const {
    eventBus, telegramAdapter, resolveChatId, publicBaseUrl,
    haGateway, resolveNotifyService,
    preferences, logger,
  } = deps;

  const adapters = [
    new AppNotificationAdapter({ eventBus }),
    new TelegramNotificationAdapter({ telegramAdapter, resolveChatId, publicBaseUrl, logger }),
    new PushNotificationAdapter({ haGateway, resolveNotifyService, logger }),
  ];

  const preference = new NotificationPreference(preferences || DEFAULT_PREFERENCES);
  const container = new NotificationContainer({
    adapters,
    preferenceLoader: () => preference,
    logger,
  });

  const notificationService = container.getNotificationService();
  logger?.info?.('notifications.bootstrap.complete', {
    channels: adapters.map(a => a.channel),
  });

  return { container, notificationService };
}
