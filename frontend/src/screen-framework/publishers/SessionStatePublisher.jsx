import React, { useMemo } from 'react';
import { useSessionStatePublisher } from './useSessionStatePublisher.js';
import { createSessionSource } from './SessionSource.js';
import { useSessionSourceContext } from './SessionSourceContext.jsx';

/**
 * SessionStatePublisher — renderless component that mounts the
 * session-state publisher for a screen.
 *
 * Sibling to <CommandAckPublisher>. Either may be mounted independently.
 * Mount this one whenever the screen has `wsConfig.publishState === true`.
 *
 * Source resolution: explicit `source` prop wins, else context-provided
 * source, else a fallback idle source keyed on deviceId so the published
 * snapshot at least carries the owner identity while no player is mounted.
 */
export function SessionStatePublisher({ deviceId, source: explicitSource }) {
  const ctxSource = useSessionSourceContext();

  const fallbackSource = useMemo(() => {
    if (!deviceId) return null;
    return createSessionSource({ ownerId: deviceId });
  }, [deviceId]);

  const source = explicitSource ?? ctxSource ?? fallbackSource;

  const getSnapshot = useMemo(
    () => (source ? () => source.getSnapshot() : null),
    [source],
  );
  const subscribe = useMemo(
    () => (source ? source.subscribe.bind(source) : null),
    [source],
  );

  useSessionStatePublisher({ deviceId, getSnapshot, subscribe });

  return null;
}

export default SessionStatePublisher;
