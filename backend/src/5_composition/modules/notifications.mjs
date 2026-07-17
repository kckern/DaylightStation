/**
 * Notification Stack Bootstrap
 *
 * Composes the notification application service with its channel adapters
 * (app/websocket, telegram, HA push). Adapter instances are constructed here
 * at the composition root and injected (Decision D1).
 */

import path from 'path';
import { NotificationContainer } from '#apps/notification/NotificationContainer.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';
import { AppNotificationAdapter } from '#adapters/notification/AppNotificationAdapter.mjs';
import { TelegramNotificationAdapter } from '#adapters/notification/TelegramNotificationAdapter.mjs';
import { PushNotificationAdapter } from '#adapters/notification/PushNotificationAdapter.mjs';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';
import { YamlNotificationLedgerStore } from '#adapters/persistence/yaml/YamlNotificationLedgerStore.mjs';

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
 * @param {Object} [deps.configService] - ConfigService; used to read household
 *   notifications.yml (quiet hours + cooldowns) fresh on every send.
 * @param {string} [deps.dataPath] - Root data dir; ledger persists under
 *   `<dataPath>/household/state`.
 * @param {Object} [deps.clock] - { now: () => Date }; defaults to real time.
 * @param {Object} [deps.logger]
 * @returns {Object} { container, notificationService, ledgerStore }
 */
export function bootstrapNotifications(deps = {}) {
  const {
    eventBus, telegramAdapter, resolveChatId, publicBaseUrl,
    haGateway, resolveNotifyService,
    preferences, logger,
    configService, dataPath, clock,
  } = deps;

  const adapters = [
    new AppNotificationAdapter({ eventBus }),
    new TelegramNotificationAdapter({ telegramAdapter, resolveChatId, publicBaseUrl, logger }),
    new PushNotificationAdapter({ haGateway, resolveNotifyService, logger }),
  ];

  const preference = new NotificationPreference(preferences || DEFAULT_PREFERENCES);

  // Governance (dedupe + quiet hours). The ledger persists under
  // <dataPath>/household/state; the config loader re-reads notifications.yml
  // on every send so household edits take effect without a restart.
  const ledgerStore = new YamlNotificationLedgerStore({ basePath: path.join(dataPath, 'household', 'state') });
  const policy = new NotificationPolicy();
  const configLoader = () => {
    const c = configService?.getHouseholdAppConfig?.(null, 'notifications') || {};
    return {
      quietHours: new QuietHours(c.quiet_hours || { enabled: false }),
      cooldowns: c.cooldowns || { default: 60 },
    };
  };

  const container = new NotificationContainer({
    adapters,
    preferenceLoader: () => preference,
    policy,
    ledgerStore,
    configLoader,
    clock,
    logger,
  });

  const notificationService = container.getNotificationService();
  logger?.info?.('notifications.bootstrap.complete', {
    channels: adapters.map(a => a.channel),
  });

  return { container, notificationService, ledgerStore };
}
