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
import { AndroidAppPushAdapter } from '#adapters/notification/AndroidAppPushAdapter.mjs';
import { InMemoryPushDeviceRegistry } from '#adapters/notification/InMemoryPushDeviceRegistry.mjs';
import { attachAndroidPushBusListener } from '#adapters/notification/AndroidPushBusListener.mjs';
import { CompositePushChannel } from '#apps/notification/CompositePushChannel.mjs';
import { RespondToNotificationAction } from '#apps/notification/usecases/RespondToNotificationAction.mjs';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { YamlNotificationLedgerStore } from '#adapters/persistence/yaml/YamlNotificationLedgerStore.mjs';
import { NotificationGovernanceConfigSource } from '#adapters/notification/NotificationGovernanceConfigSource.mjs';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '#apps/notification/DefaultNotificationPreferences.mjs';

// Category -> channels routing when no explicit preferences are configured.
// Ceremony and drift nudges reach the user directly; the rest stay in-app.
export const DEFAULT_PREFERENCES = DEFAULT_NOTIFICATION_PREFERENCES;

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
 * @param {Function} [deps.resolveDefaultRecipient] - () => username; the fallback
 *   addressee for system-category intents, which are about the house rather than
 *   a person and so arrive with no `metadata.username`. Without it they route to
 *   a channel that cannot resolve a destination and return `delivered: false`.
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
    haGateway, resolveNotifyService, resolveDefaultRecipient,
    preferences, logger,
    configService, dataPath, clock,
  } = deps;

  // Push: the DaylightStation Android app when the recipient's phone is
  // connected (push.hello on the bus) and acks, else the HA companion app.
  const base = typeof publicBaseUrl === 'string' ? publicBaseUrl.replace(/\/+$/, '') : '';
  const publicUrl = base ? (path) => `${base}${path}` : null;
  const pushClock = clock || { now: () => new Date() };
  const pushDevices = new InMemoryPushDeviceRegistry();
  if (eventBus?.onClientMessage && eventBus?.onClientDisconnection) {
    attachAndroidPushBusListener({ eventBus, registry: pushDevices, clock: pushClock, logger });
  }
  const haPush = new PushNotificationAdapter({ haGateway, resolveNotifyService, publicUrl, logger });
  const androidPush = eventBus?.sendToClient ? new AndroidAppPushAdapter({ eventBus, registry: pushDevices, logger }) : null;

  const adapters = [
    new AppNotificationAdapter({ eventBus }),
    new TelegramNotificationAdapter({ telegramAdapter, resolveChatId, publicBaseUrl, logger }),
    new CompositePushChannel({ android: androidPush, ha: haPush, registry: pushDevices, clock: pushClock, logger }),
  ];

  const preference = new NotificationPreference(preferences || DEFAULT_PREFERENCES);

  // Governance (dedupe + quiet hours). The ledger persists under
  // <dataPath>/household/notifications; the config loader re-reads notifications.yml
  // on every send so household edits take effect without a restart.
  const ledgerStore = new YamlNotificationLedgerStore({ dataPath });
  const policy = new NotificationPolicy();
  const governanceConfig = new NotificationGovernanceConfigSource({ configService });

  const container = new NotificationContainer({
    adapters,
    preferenceLoader: () => preference,
    resolveDefaultRecipient,
    policy,
    ledgerStore,
    configLoader: () => governanceConfig.read(),
    clock,
    logger,
  });

  const notificationService = container.getNotificationService();
  logger?.info?.('notifications.bootstrap.complete', {
    channels: adapters.map(a => a.channel),
  });

  // Action presses; apps that own actions register a handler (notificationActions.register).
  const notificationActions = new RespondToNotificationAction({ logger });

  return { container, notificationService, ledgerStore, pushDevices, notificationActions };
}

/**
 * For producers whose own config names an HA notify target (`notify.<x>` or
 * `<x>`): the user that target belongs to, from profiles
 * (`identities.homeassistant.notify_service`), else the head of household.
 * Gives the push a recipient the Android route can address.
 */
export function createNotifyServiceRecipientResolver({ listUsernames, profileNotifyService, headOfHousehold }) {
  return (notifyService) => {
    if (!notifyService) return null;
    const target = String(notifyService).replace(/^notify\./, '');
    for (const username of listUsernames?.() || []) {
      if (profileNotifyService?.(username) === target) return username;
    }
    return headOfHousehold?.() || null;
  };
}
