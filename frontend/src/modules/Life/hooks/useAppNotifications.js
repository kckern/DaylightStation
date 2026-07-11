import React, { useCallback, useRef } from 'react';
import { Anchor, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useAppNotifications' });
  return _logger;
}

/** Mantine notification color per notification urgency. */
function colorForUrgency(urgency) {
  switch (urgency) {
    case 'critical': return 'red';
    case 'high': return 'orange';
    case 'low': return 'gray';
    default: return 'blue';
  }
}

/**
 * Decide whether an in-app notification is addressed to the current user.
 * Unaddressed notifications (no metadata.username) go to everyone.
 */
function isForUser(intent, username) {
  const target = intent?.metadata?.username;
  if (!target) return true; // broadcast to everyone
  return target === username;
}

/**
 * Stable dedupe key so a socket redelivery doesn't render the same intent
 * twice. Falls back to null (i.e. don't dedupe) when nothing keyable exists.
 */
function dedupeKey(intent) {
  const id = intent?.metadata?.id;
  if (id) return `id:${id}`;
  if (intent?.createdAt) return `ca:${intent.createdAt}:${intent.title || ''}`;
  return null;
}

/**
 * Resolve the first action's url into a safe click handler, or null when there
 * is no url or the url is malformed. Guarded so a bad url can never throw at
 * render time — the worst case is a non-clickable toast (resilience rider B4).
 *
 * Relative paths (starting with `/`) navigate in-app via react-router and are
 * inherently safe; absolute urls are validated with `new URL(...)` inside a
 * try/catch AND restricted to the http(s) schemes before we hand them to
 * window.location — `javascript:`, `mailto:`, `data:` etc. parse fine via
 * `new URL` but must never reach `window.location.assign` (XSS vector), so any
 * non-http(s) scheme falls back to a plain, non-clickable toast.
 */
function resolveAction(intent, navigate) {
  const rawUrl = intent?.actions?.[0]?.data?.url;
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const isRelative = rawUrl.startsWith('/');
  if (!isRelative) {
    // Validate absolute urls up front; bail to a plain toast if unparseable
    // or if the scheme isn't http(s).
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        logger().warn('notification.action.blocked_scheme', {
          url: rawUrl,
          protocol: parsed.protocol,
        });
        return null;
      }
    } catch (err) {
      logger().warn('notification.action.invalid_url', { url: rawUrl, error: err.message });
      return null;
    }
  }

  return () => {
    try {
      if (isRelative) {
        navigate?.(rawUrl); // in-app path — safe
      } else {
        const parsed = new URL(rawUrl);
        window.location.assign(parsed.href);
      }
      logger().info('notification.action.followed', { url: rawUrl });
    } catch (err) {
      logger().warn('notification.action.failed', { url: rawUrl, error: err.message });
    }
  };
}

/**
 * Render the in-app fallback channel for the notification service.
 *
 * The backend's AppNotificationAdapter broadcasts every notification intent on
 * the eventBus `notification` topic ({ topic:'notification', ...intentJSON }).
 * Most household members have neither Telegram nor HA push, so this shared-WS
 * toast is the only channel they can actually receive. We reuse the singleton
 * `wsService` via `useWebSocketSubscription` (same client fitness/piano use) —
 * no second socket.
 *
 * @param {Object}   params
 * @param {string?}  params.username - current life user; intents addressed to a
 *   different user are dropped, unaddressed intents shown to everyone.
 * @param {Function} params.navigate - react-router navigate, for actionable toasts.
 */
export function useAppNotifications({ username, navigate } = {}) {
  const seenRef = useRef(new Set());

  const handleNotification = useCallback((intent) => {
    if (!intent || intent.topic !== 'notification') return;

    logger().debug('notification.received', {
      category: intent.category,
      urgency: intent.urgency,
      addressed: !!intent.metadata?.username,
    });

    if (!isForUser(intent, username)) {
      logger().debug('notification.skipped.not_for_user', {
        target: intent.metadata?.username,
        current: username,
      });
      return;
    }

    // Dedupe redeliveries by a stable key when one is available.
    const key = dedupeKey(intent);
    if (key) {
      if (seenRef.current.has(key)) {
        logger().debug('notification.skipped.duplicate', { key });
        return;
      }
      seenRef.current.add(key);
    }

    const onAction = resolveAction(intent, navigate);
    const actionLabel = intent.actions?.[0]?.label || 'Open';
    const body = intent.body || '';

    const message = onAction
      ? React.createElement(
          React.Fragment,
          null,
          body ? React.createElement(Text, { size: 'sm', span: true }, body) : null,
          React.createElement(
            Anchor,
            {
              component: 'button',
              type: 'button',
              onClick: onAction,
              display: 'block',
              mt: body ? 4 : 0,
              'data-testid': 'notification-action',
            },
            actionLabel,
          ),
        )
      : body;

    notifications.show({
      title: intent.title || 'Notification',
      message,
      color: colorForUrgency(intent.urgency),
      autoClose: intent.urgency === 'critical' ? false : 8000,
    });

    logger().info('notification.shown', {
      category: intent.category,
      urgency: intent.urgency,
      actionable: !!onAction,
    });
  }, [username, navigate]);

  useWebSocketSubscription('notification', handleNotification, [handleNotification]);
}

export default useAppNotifications;
