/**
 * Where the piano backend reaches the tablet's MIDI bridge, chosen by one key in
 * the piano app config:
 *
 *   bridge_provider: piano-bridge        # default: the old piano-bridge APK, unauthenticated
 *   bridge_provider: daylight-android    # the DaylightStation Android app's control API
 *
 * `piano-bridge` keeps today's path exactly: the URL from `bridge_url`, no
 * headers, a relaunch through the remote-admin `launch-app` action.
 *
 * `daylight-android` reads the tablet's `content_control` block in devices.yml
 * (the same block `content_control.provider: daylight-android` switches the
 * content adapter with): its host and control port, the lifeline port
 * (`lifeline_port`, default control port + 1) and the token from the household
 * auth file named by `auth_ref`, keyed by the device id. The token goes in the
 * `X-Daylight-Token` header only; it is never part of a URL or a log line.
 * Switching the tablet back is setting `bridge_provider` back.
 *
 * Plan: ops:docs/superpowers/plans/2026-11-17-daylight-android-phases-4-6-cutover.md
 *
 * @module piano/composition/bridge-endpoint
 */

export const PIANO_BRIDGE = 'piano-bridge';
export const DAYLIGHT_ANDROID = 'daylight-android';
const DEFAULT_CONTROL_PORT = 8780;
const TOKEN_HEADER = 'X-Daylight-Token';

/**
 * @param {Object} opts
 * @param {Object} opts.piano - the piano app config
 * @param {string} opts.deviceId - the tablet's device id in devices.yml
 * @param {string|null} [opts.bridgeUrl] - the old bridge's URL (piano-bridge only)
 * @param {Object} [opts.configService] - getDeviceConfig, getHouseholdAuth
 * @param {Object} [opts.logger]
 * @param {string} [opts.event] - prefix for the misconfiguration log line
 * @returns {null | {provider: string, httpBase: string, wsUrl: string, headers: Object, lifelineBase: string|null}}
 *   null when the chosen provider cannot be reached with what is configured (logged as an error)
 */
export function resolvePianoBridgeEndpoint({ piano = {}, deviceId, bridgeUrl = null, configService = null, logger = console, event = 'piano-bridge' }) {
  const provider = piano.bridge_provider || PIANO_BRIDGE;
  if (provider === PIANO_BRIDGE) {
    if (!bridgeUrl) return null;
    return {
      provider,
      httpBase: bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, ''),
      wsUrl: bridgeUrl.replace(/^http(s?):\/\//i, 'ws$1://'),
      headers: {},
      lifelineBase: null,
    };
  }
  if (provider !== DAYLIGHT_ANDROID) {
    logger.error?.(`${event}.unknown-provider`, { provider, known: [PIANO_BRIDGE, DAYLIGHT_ANDROID] });
    return null;
  }
  const control = configService?.getDeviceConfig?.(deviceId)?.content_control;
  // The bridge and the kiosk are one app on this provider; a tablet whose content
  // control still says fully-kiosk has not been switched, and its address would
  // be Fully's.
  if (control?.provider !== DAYLIGHT_ANDROID || !control.host) {
    logger.error?.(`${event}.provider-mismatch`, {
      deviceId, bridgeProvider: provider, contentProvider: control?.provider ?? null, hasHost: !!control?.host,
    });
    return null;
  }
  if (control.token) logger.warn?.(`${event}.inline-token-ignored`, { deviceId });
  const token = control.auth_ref ? configService?.getHouseholdAuth?.(control.auth_ref)?.[deviceId]?.token : null;
  if (!token) {
    logger.error?.(`${event}.no-token`, { deviceId, authRef: control.auth_ref ?? null });
    return null;
  }
  const port = Number(control.port) || DEFAULT_CONTROL_PORT;
  const lifelinePort = Number(control.lifeline_port) || port + 1;
  return {
    provider,
    httpBase: `http://${control.host}:${port}`,
    wsUrl: `ws://${control.host}:${port}/`,
    headers: { [TOKEN_HEADER]: token },
    lifelineBase: `http://${control.host}:${lifelinePort}`,
  };
}
