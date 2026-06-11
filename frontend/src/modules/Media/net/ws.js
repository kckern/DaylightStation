// frontend/src/modules/Media/net/ws.js
// The Media App's single touchpoint for the WebSocket service. Every subsystem
// (fleet, peek, cast, external control, broadcast) subscribes and publishes
// through these helpers so topic construction stays aligned with
// shared/contracts/media/topics.mjs and the underlying service is swappable
// in tests.
import { wsService } from '../../../services/WebSocketService.js';
import {
  PLAYBACK_STATE_TOPIC,
  DEVICE_STATE_TOPIC,
  DEVICE_ACK_TOPIC,
  HOMELINE_TOPIC,
  CLIENT_CONTROL_TOPIC,
  parseDeviceTopic,
} from '@shared-contracts/media/topics.mjs';

export const topics = {
  playbackState: PLAYBACK_STATE_TOPIC,
  deviceState: DEVICE_STATE_TOPIC,
  deviceAck: DEVICE_ACK_TOPIC,
  homeline: HOMELINE_TOPIC,
  clientControl: CLIENT_CONTROL_TOPIC,
};

export { parseDeviceTopic };

/** Subscribe to one exact topic string. Returns an unsubscribe function. */
export function subscribeTopic(topic, callback, service = wsService) {
  return service.subscribe((msg) => msg?.topic === topic, callback);
}

/**
 * Subscribe to every per-device topic of one kind (e.g. all `device-state:*`).
 * The callback receives the raw message; use `parseDeviceTopic(msg.topic)` for
 * the deviceId when the payload doesn't carry it.
 */
export function subscribeTopicKind(kind, callback, service = wsService) {
  const prefix = `${kind}:`;
  return service.subscribe(
    (msg) => typeof msg?.topic === 'string' && msg.topic.startsWith(prefix),
    callback
  );
}

/** Publish a message envelope. The payload must carry its own `topic`. */
export function publish(message, service = wsService) {
  return service.send(message);
}

/** Connection status changes: callback receives { connected, connecting }. */
export function onStatus(callback, service = wsService) {
  return service.onStatusChange(callback);
}
