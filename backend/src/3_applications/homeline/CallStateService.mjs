/**
 * Lightweight in-memory tracker for active homeline calls.
 * Watches WebSocket signaling messages to maintain call state.
 * Used by device endpoints to guard against spurious power-off.
 */

import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({
  source: 'backend',
  app: 'homeline-call-state'
});

const activeCalls = new Map(); // deviceId -> { phonePeerId, startedAt }
const zombieTimers = new Map(); // deviceId -> timeoutId

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — auto-clear stale calls

export function handleSignalingMessage(message) {
  const { topic, type, from } = message;
  if (!topic?.startsWith('homeline:')) return;

  const deviceId = topic.replace('homeline:', '');

  if (type === 'offer' && from?.startsWith('phone-')) {
    activeCalls.set(deviceId, { phonePeerId: from, startedAt: Date.now() });
    logger.info('call-state.started', { deviceId, phonePeerId: from });

    // Clear any existing zombie timer for this device
    if (zombieTimers.has(deviceId)) {
      clearTimeout(zombieTimers.get(deviceId));
    }

    // Auto-clear zombie calls after timeout
    const timerId = setTimeout(() => {
      const call = activeCalls.get(deviceId);
      if (call && call.phonePeerId === from) {
        logger.warn('call-state.zombie-expired', { deviceId, phonePeerId: from });
        activeCalls.delete(deviceId);
      }
      zombieTimers.delete(deviceId);
    }, ZOMBIE_TIMEOUT_MS);

    zombieTimers.set(deviceId, timerId);
  }

  if (type === 'hangup') {
    logger.info('call-state.ended', { deviceId });
    activeCalls.delete(deviceId);
    if (zombieTimers.has(deviceId)) {
      clearTimeout(zombieTimers.get(deviceId));
      zombieTimers.delete(deviceId);
    }
  }
}

export function getActiveCall(deviceId) {
  return activeCalls.get(deviceId) || null;
}

export function hasActiveCall(deviceId) {
  return activeCalls.has(deviceId);
}

export function forceEndCall(deviceId) {
  logger.info('call-state.force-ended', { deviceId });
  activeCalls.delete(deviceId);
  if (zombieTimers.has(deviceId)) {
    clearTimeout(zombieTimers.get(deviceId));
    zombieTimers.delete(deviceId);
  }
}
