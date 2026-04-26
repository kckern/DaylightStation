import React from 'react';
import { useCommandAckPublisher } from './useCommandAckPublisher.js';

/**
 * CommandAckPublisher — renderless component that mounts the
 * useCommandAckPublisher hook for screens that accept WebSocket commands.
 *
 * Sibling to <SessionStatePublisher>; either may be mounted independently.
 * Mount this one whenever the screen has `wsConfig.commands === true` so
 * backend WS-first dispatch can confirm delivery.
 *
 * Renders nothing. The underlying hook no-ops internally when deviceId or
 * actionBus is missing, so we always call the hook (rules-of-hooks safe).
 */
export function CommandAckPublisher({ deviceId, actionBus }) {
  useCommandAckPublisher({ deviceId, actionBus });
  return null;
}

export default CommandAckPublisher;
