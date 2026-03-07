import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenSubscriptions' });
  return _logger;
}

/**
 * useScreenSubscriptions - Processes YAML subscription config into live WS listeners.
 *
 * Iterates subscription entries from the screen config, subscribes to the declared
 * WS topics via useWebSocketSubscription, checks event filters, resolves overlay
 * components from the widget registry, and calls showOverlay/dismissOverlay.
 *
 * YAML config format:
 *   subscriptions:
 *     midi:                       # WS topic name
 *       on:
 *         event: session_start    # Optional filter (omit to trigger on any message)
 *       response:
 *         overlay: piano          # Widget registry key
 *         mode: fullscreen        # Overlay mode (fullscreen|pip|toast)
 *         priority: high          # Optional overlay priority
 *         timeout: 3000           # Optional timeout (ms) for toast mode
 *       dismiss:
 *         event: session_end      # WS event that dismisses the overlay
 *         inactivity: 30          # Seconds of inactivity before auto-dismiss
 *
 * @param {object} subscriptions - The subscriptions block from screen YAML config
 * @param {function} showOverlay - From useScreenOverlay()
 * @param {function} dismissOverlay - From useScreenOverlay()
 * @param {object} widgetRegistry - From getWidgetRegistry()
 * @param {object} options - Optional config
 * @param {boolean} options.hasOverlay - Whether an overlay is currently active (for guard checks)
 */
export function useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry, { hasOverlay = false } = {}) {
  const hasOverlayRef = useRef(hasOverlay);
  hasOverlayRef.current = hasOverlay;
  // Normalize entries once; stable across renders unless config changes
  const entries = useMemo(() => {
    if (!subscriptions || typeof subscriptions !== 'object') return [];
    return Object.entries(subscriptions).map(([topic, cfg]) => ({
      topic,
      onEvent: cfg?.on?.event ?? null,
      overlay: cfg?.response?.overlay ?? null,
      mode: cfg?.response?.mode ?? 'fullscreen',
      priority: cfg?.response?.priority ?? undefined,
      timeout: cfg?.response?.timeout ?? undefined,
      dismissEvent: cfg?.dismiss?.event ?? null,
      dismissInactivity: cfg?.dismiss?.inactivity ?? null,
      guard: cfg?.guard ?? null,
      alsoOnEvent: cfg?.also_on?.event ?? null,
      alsoOnCondition: cfg?.also_on?.condition ?? null,
    }));
  }, [subscriptions]);

  // Collect all unique topics for a single WS subscription
  const topics = useMemo(() => entries.map((e) => e.topic), [entries]);

  // Ref to hold current entries so the callback doesn't go stale
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Inactivity timers keyed by topic
  const inactivityTimers = useRef({});

  // Clean up inactivity timers on unmount
  useEffect(() => {
    return () => {
      Object.values(inactivityTimers.current).forEach(clearTimeout);
    };
  }, []);

  const handleMessage = useCallback((data) => {
    const eventName = data?.event ?? data?.type ?? null;
    const messageTopic = data?.topic ?? null;

    let matched = false;

    for (const entry of entriesRef.current) {
      // Match by topic
      if (messageTopic !== entry.topic) continue;

      matched = true;

      // Check dismiss event first
      if (entry.dismissEvent && eventName === entry.dismissEvent) {
        logger().debug('subscription.dismiss', { topic: entry.topic, dismissEvent: eventName });
        dismissOverlay(entry.mode);
        // Clear any running inactivity timer for this topic
        if (inactivityTimers.current[entry.topic]) {
          clearTimeout(inactivityTimers.current[entry.topic]);
          delete inactivityTimers.current[entry.topic];
        }
        continue;
      }

      // Guard check — skip if condition not met
      if (entry.guard === 'no_overlay' && hasOverlayRef.current) {
        logger().debug('subscription.guard-blocked', { topic: entry.topic, guard: entry.guard });
        continue;
      }

      // Check trigger filter
      if (entry.onEvent && eventName !== entry.onEvent) {
        // Check also_on as secondary trigger
        if (entry.alsoOnEvent && eventName === entry.alsoOnEvent) {
          if (entry.alsoOnCondition === 'no_overlay' && hasOverlayRef.current) {
            logger().debug('subscription.also-on-blocked', { topic: entry.topic, condition: entry.alsoOnCondition });
            continue;
          }
          // Fall through to show overlay
        } else {
          logger().debug('subscription.event-filtered', { topic: entry.topic, expected: entry.onEvent, received: eventName });
          continue;
        }
      }

      // Resolve component from registry
      const Component = entry.overlay ? widgetRegistry.get(entry.overlay) : null;
      if (!Component) {
        logger().warn('subscription.widget-not-found', { topic: entry.topic, overlay: entry.overlay });
        continue;
      }

      // Show the overlay — include onClose/onSessionEnd mapped to dismissOverlay
      // so components like PianoVisualizer get the callbacks they expect
      const dismissFn = () => dismissOverlay(entry.mode);
      logger().info('subscription.show-overlay', { topic: entry.topic, overlay: entry.overlay, mode: entry.mode, event: eventName });
      showOverlay(Component, { ...data, onClose: dismissFn, onSessionEnd: dismissFn }, {
        mode: entry.mode,
        priority: entry.priority,
        timeout: entry.timeout,
      });

      // Start inactivity timer if configured
      if (entry.dismissInactivity != null && entry.dismissInactivity > 0) {
        // Clear any existing timer for this topic
        if (inactivityTimers.current[entry.topic]) {
          clearTimeout(inactivityTimers.current[entry.topic]);
        }
        inactivityTimers.current[entry.topic] = setTimeout(() => {
          dismissOverlay(entry.mode);
          delete inactivityTimers.current[entry.topic];
        }, entry.dismissInactivity * 1000);
      }
    }

    if (!matched) {
      logger().debug('subscription.no-match', { messageTopic, event: eventName, registeredTopics: entriesRef.current.map(e => e.topic) });
    }
  }, [showOverlay, dismissOverlay, widgetRegistry]);

  // Subscribe to all relevant topics (single subscription)
  useWebSocketSubscription(
    topics.length > 0 ? topics : null,
    handleMessage,
    [handleMessage]
  );
}
