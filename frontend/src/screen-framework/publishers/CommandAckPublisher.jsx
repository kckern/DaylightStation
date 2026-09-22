import React, { useContext, useEffect, useMemo } from 'react';
import { useCommandAckPublisher } from './useCommandAckPublisher.js';
import SessionSourceContext from './SessionSourceContext.jsx';
import { createHandoffExecutor } from '../../lib/media/handoffExecutor.js';

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
  const { source } = useContext(SessionSourceContext);
  const handoffExecutor = useMemo(() => {
    if (!deviceId || !source) return null;
    try {
      return createHandoffExecutor({ owner: source, destination: { kind: 'device', id: deviceId } });
    } catch {
      return null;
    }
  }, [deviceId, source]);
  useEffect(() => () => handoffExecutor?.dispose?.(), [handoffExecutor]);
  useCommandAckPublisher({ deviceId, actionBus, handoffExecutor });
  return null;
}

export default CommandAckPublisher;
