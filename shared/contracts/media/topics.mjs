export const PLAYBACK_STATE_TOPIC = 'playback_state';
export const ARCADE_SESSIONS_TOPIC = 'arcade-game-sessions';

/**
 * Event names on the arcade-session topics. One definition, because the
 * 2026-09-19 vocabulary rename changed the backend's names while both clocks
 * (fitness hook, Shield film) kept filtering on the old `play.session.*` ones —
 * and for a week no timer rendered anywhere. `arcade-film.html` is a static page
 * that cannot import this; `arcadeFilmContract.test.mjs` pins it to these names.
 */
export const ARCADE_SESSION_EVENTS = Object.freeze({
  STARTED: 'arcade.session.started',
  PROGRESS: 'arcade.session.progress',
  ENDED: 'arcade.session.ended',
});

export const DEVICE_STATE_TOPIC   = (deviceId) => `device-state:${deviceId}`;
export const ARCADE_SESSION_TOPIC = (deviceId) => `arcade-session:${deviceId}`;
export const DEVICE_ACK_TOPIC     = (deviceId) => `device-ack:${deviceId}`;
export const HOMELINE_TOPIC       = (deviceId) => `homeline:${deviceId}`;
// Compact start progress / last failure per device, replayed on subscribe
// (RQ-HOUSE-04). `homeline:<id>` carries the raw per-dispatch step stream.
export const DEVICE_START_TOPIC   = (deviceId) => `device-start:${deviceId}`;
export const SCREEN_COMMAND_TOPIC = (deviceId) => `screen:${deviceId}`;
export const CLIENT_CONTROL_TOPIC = (clientId) => `client-control:${clientId}`;
export const CLIENT_ACK_TOPIC     = (clientId) => `client-ack:${clientId}`;
export const COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX = 'command-handler-presence:';
export const COMMAND_HANDLER_PRESENCE_TOPIC = (deviceId) => `${COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX}${deviceId}`;

const DEVICE_TOPIC_KINDS = ['device-state', 'device-ack', 'homeline', 'screen', 'command-handler-presence', 'arcade-session', 'device-start'];

export function parseDeviceTopic(topic) {
  if (typeof topic !== 'string') return null;
  const idx = topic.indexOf(':');
  if (idx < 0) return null;
  const kind = topic.slice(0, idx);
  const deviceId = topic.slice(idx + 1);
  if (!DEVICE_TOPIC_KINDS.includes(kind) || !deviceId) return null;
  return { kind, deviceId };
}
