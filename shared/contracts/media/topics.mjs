export const PLAYBACK_STATE_TOPIC = 'playback_state';

export const DEVICE_STATE_TOPIC   = (deviceId) => `device-state:${deviceId}`;
export const DEVICE_ACK_TOPIC     = (deviceId) => `device-ack:${deviceId}`;
export const HOMELINE_TOPIC       = (deviceId) => `homeline:${deviceId}`;
export const SCREEN_COMMAND_TOPIC = (deviceId) => `screen:${deviceId}`;
export const CLIENT_CONTROL_TOPIC = (clientId) => `client-control:${clientId}`;

const DEVICE_TOPIC_KINDS = ['device-state', 'device-ack', 'homeline', 'screen'];

export function parseDeviceTopic(topic) {
  if (typeof topic !== 'string') return null;
  const idx = topic.indexOf(':');
  if (idx < 0) return null;
  const kind = topic.slice(0, idx);
  const deviceId = topic.slice(idx + 1);
  if (!DEVICE_TOPIC_KINDS.includes(kind) || !deviceId) return null;
  return { kind, deviceId };
}
