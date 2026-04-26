import React, { useMemo } from 'react';
import { getActionBus } from './input/ActionBus.js';
import { CommandAckPublisher }   from './publishers/CommandAckPublisher.jsx';
import { SessionStatePublisher } from './publishers/SessionStatePublisher.jsx';

/**
 * ScreenSessionPublishers — Mounts the per-screen WS publishers based on the
 * screen's `websocket:` YAML block. Two independent publishers, two gates:
 *   - CommandAckPublisher mounts when `commands: true`. Required for backend
 *     WS-first dispatch to confirm delivery and avoid the FKB-URL steamroll.
 *   - SessionStatePublisher mounts when `publishState: true`. Used for live
 *     session-state hand-off.
 */
export function ScreenSessionPublishers({ wsConfig }) {
  const bus = useMemo(() => getActionBus(), []);
  const deviceId = wsConfig?.guardrails?.device;
  if (!deviceId) return null;

  const wantsAck = wsConfig?.commands === true;
  const wantsState = wsConfig?.publishState === true;
  if (!wantsAck && !wantsState) return null;

  return (
    <>
      {wantsAck   && <CommandAckPublisher  deviceId={deviceId} actionBus={bus} />}
      {wantsState && <SessionStatePublisher deviceId={deviceId} />}
    </>
  );
}

export default ScreenSessionPublishers;
