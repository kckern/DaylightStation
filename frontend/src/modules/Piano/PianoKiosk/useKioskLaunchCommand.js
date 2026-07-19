import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { wsService } from '../../../services/WebSocketService.js';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { launchIntent } from '../../../lib/fkb.js';
import { KIOSK_DEVICE_ID } from './kioskDeviceIdentity.js';
import getLogger from '../../../lib/logging/Logger.js';

export const KIOSK_LAUNCH_TOPIC = 'kiosk.launch';
export const KIOSK_LAUNCH_RESULT_TOPIC = 'kiosk.launch.result';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'kiosk-launch-command' });
  return _logger;
}

/**
 * useKioskLaunchCommand — run a parent-initiated app launch on THIS tablet.
 *
 * A parent picks a game in the admin UI; that publishes `kiosk.launch` on the
 * event bus, the backend relays it (see backend/src/0_system/eventbus/
 * kioskLaunchRelay.mjs), and this hook performs the launch in-page.
 *
 * It has to happen in-page: passing intent extras (RetroArch's ROM/LIBRETRO)
 * requires FKB's `fully.startIntent`, which only exists inside the kiosk
 * WebView. The backend cannot reach it from outside.
 *
 * Device targeting is enforced HERE, not by the bus. Frontend subscriptions sync
 * to the server as '*', so every kiosk sees every relayed message — without the
 * identity guard, one parent click would launch on every tablet at once. Same
 * reasoning as the screensaver's `isThisDevice` gate in PianoApp.
 *
 * @param {Object}   [opts]
 * @param {string}   [opts.deviceId]  - this client's identity (defaults to KIOSK_DEVICE_ID)
 * @param {string[]} [opts.allow]     - override the fetched allowlist (tests); null = fetch it
 * @param {boolean}  [opts.enabled]   - false makes the hook inert
 */
export function useKioskLaunchCommand({
  deviceId = KIOSK_DEVICE_ID,
  allow = null,
  enabled = true
} = {}) {
  // Resolved per launch rather than cached at mount: a parent who edits the
  // allowlist expects the next launch to honor it, and the kiosk can sit for
  // days between launches.
  const resolveAllow = useCallback(async () => {
    if (Array.isArray(allow)) return allow;
    try {
      const res = await DaylightAPI('api/v1/content/launch-targets/retroarch');
      const mine = (res?.targets || []).find((t) => t.deviceId === deviceId);
      return mine ? mine.allow : null;
    } catch (err) {
      logger().error('allowlist-fetch-failed', { deviceId, error: err?.message });
      return null;
    }
  }, [allow, deviceId]);

  const publishResult = useCallback((payload) => {
    try {
      wsService.send({ topic: KIOSK_LAUNCH_RESULT_TOPIC, deviceId, ...payload });
    } catch (err) {
      // A missing result is a UI inconvenience, never a reason to fail a launch
      // that may already have happened.
      logger().warn('result-publish-failed', { error: err?.message });
    }
  }, [deviceId]);

  const handle = useCallback(async (msg) => {
    if (!enabled) return;
    const contentId = msg?.contentId;
    if (!contentId) return;

    // Not addressed to this tablet — the common case on a multi-kiosk bus.
    if (!deviceId || msg.deviceId !== deviceId) {
      logger().debug('ignored-other-device', { target: msg?.deviceId, self: deviceId });
      return;
    }

    // Re-check the allowlist on receipt. Admin filters too, but a stale admin
    // tab holds a stale list, and launching an unlisted title is what creates a
    // second divergent save on a device that has no save-sync.
    //
    // Fail CLOSED: an unreadable or unconfigured allowlist refuses the launch.
    // The failure mode we are guarding against is irreversible — two divergent
    // .srm files cannot be reconciled — so "launch nothing" beats "launch
    // anything" when we don't know what is permitted.
    const list = await resolveAllow();
    if (!Array.isArray(list) || !list.includes(contentId)) {
      logger().warn('refused-not-allowed', {
        contentId,
        deviceId,
        configured: Array.isArray(list) ? list.length : null
      });
      publishResult({ contentId, ok: false, error: 'not_allowed' });
      return;
    }

    logger().info('launch-requested', { contentId, deviceId });

    let target;
    let params;
    try {
      const intent = await DaylightAPI(`api/v1/launch/intent/${contentId}`);
      target = intent?.target;
      params = intent?.params || {};
    } catch (err) {
      logger().error('intent-resolve-failed', { contentId, error: err?.message });
      publishResult({ contentId, ok: false, error: 'intent_resolve_failed' });
      return;
    }

    // `target` is "package/activity" as built by the content adapter.
    const slash = typeof target === 'string' ? target.indexOf('/') : -1;
    if (slash <= 0) {
      logger().error('intent-target-malformed', { contentId, target });
      publishResult({ contentId, ok: false, error: 'target_malformed' });
      return;
    }

    const launched = launchIntent(target.slice(0, slash), target.slice(slash + 1), params);
    if (!launched) {
      // FKB absent (a laptop tab) or the URI was rejected.
      logger().error('launch-failed', { contentId, target });
      publishResult({ contentId, ok: false, error: 'fkb_unavailable' });
      return;
    }

    logger().info('launch-dispatched', { contentId, target });
    publishResult({ contentId, ok: true });
  }, [enabled, deviceId, resolveAllow, publishResult]);

  useWebSocketSubscription(KIOSK_LAUNCH_TOPIC, handle, [handle]);
}

export default useKioskLaunchCommand;
