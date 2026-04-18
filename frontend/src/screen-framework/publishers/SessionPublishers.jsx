import React, { useMemo } from 'react';
import { useSessionStatePublisher } from './useSessionStatePublisher.js';
import { useCommandAckPublisher } from './useCommandAckPublisher.js';
import { createSessionSource } from './SessionSource.js';
import { useSessionSourceContext } from './SessionSourceContext.jsx';

/**
 * SessionPublishers — renderless component that wires the session-state
 * and command-ack publishers for a screen.
 *
 * Renders nothing. Activates only when:
 *   - `deviceId` is truthy, AND
 *   - `actionBus` is provided.
 *
 * If an ancestor supplied a SessionSource via `SessionSourceProvider`, that
 * source is used. Otherwise we create a fallback idle source so the
 * published snapshot at least carries the owner identity while no player
 * is mounted. This matches Phase 1's "publish baseline device state"
 * semantics — §2.3 of the plan upgrades this to a live player source.
 *
 * @param {object} props
 * @param {string} props.deviceId   - device id (usually wsConfig.guardrails.device)
 * @param {object} props.actionBus  - the ActionBus instance
 * @param {object} [props.source]   - optional explicit source (overrides context)
 */
export function SessionPublishers({ deviceId, actionBus, source: explicitSource }) {
  // Read context unconditionally (hook order rule). If no provider is present,
  // this returns null.
  const ctxSource = useSessionSourceContext();

  // Build a stable fallback source so the hook receives the same identity
  // across renders while no external source is present. Keyed on deviceId
  // so the fallback regenerates when the device id changes.
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
  useCommandAckPublisher({ deviceId, actionBus });

  return null;
}

export default SessionPublishers;
