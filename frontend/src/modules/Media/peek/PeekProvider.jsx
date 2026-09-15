// frontend/src/modules/Media/peek/PeekProvider.jsx
// Owns the ack router (ONE device-ack:* subscription) and a cache of remote
// session controllers. Multiple peeks may be active at once (C5.5); the
// local session is never touched by anything here (C5.6).
import React, { useContext, useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { PeekContext } from './PeekContext.js';
import { createAckRouter } from './ackRouter.js';
import { createRemoteSessionController } from './RemoteSessionController.js';
import { subscribeTopicKind } from '../net/ws.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import mediaLog from '../logging/mediaLog.js';

export function PeekProvider({ children }) {
  const fleet = useContext(FleetContext);
  if (!fleet) throw new Error('PeekProvider must be inside FleetProvider');
  const { store: fleetStore } = fleet;

  const ackRouterRef = useRef(null);
  if (!ackRouterRef.current) ackRouterRef.current = createAckRouter();
  const ackRouter = ackRouterRef.current;

  const controllersRef = useRef(new Map()); // deviceId -> controller
  const [steeringByDevice, setSteeringByDevice] = useState(() => new Map());

  // RemoteSessionController calls this only after a command is acknowledged
  // against fresh, currently playing playback. Merely opening a Remote never
  // reaches this callback. CastTargetProvider re-checks this identity against
  // the latest fleet snapshot before it uses the record as an idle exemption.
  const recordSteeringActivity = useCallback(({ deviceId, playback }) => {
    if (typeof deviceId !== 'string' || !deviceId
      || typeof playback?.sessionId !== 'string' || !playback.sessionId
      || typeof playback?.contentId !== 'string' || !playback.contentId) return;
    setSteeringByDevice((previous) => {
      const next = new Map(previous);
      next.set(deviceId, { playback });
      return next;
    });
  }, []);

  useEffect(() => {
    return subscribeTopicKind('device-ack', (msg) => {
      if (typeof msg.commandId !== 'string') return;
      ackRouter.resolve({
        deviceId: msg.deviceId, commandId: msg.commandId, ok: msg.ok,
        error: msg.error, code: msg.code, appliedAt: msg.appliedAt, handoff: msg.handoff,
      });
    });
  }, [ackRouter]);

  useEffect(() => () => {
    for (const ctl of controllersRef.current.values()) ctl.destroy?.();
    controllersRef.current.clear();
  }, []);

  const getController = useCallback((deviceId) => {
    if (typeof deviceId !== 'string' || !deviceId) return null;
    let ctl = controllersRef.current.get(deviceId);
    if (!ctl) {
      ctl = createRemoteSessionController({
        deviceId, fleetStore, ackRouter, onSteeringActivity: recordSteeringActivity,
      });
      controllersRef.current.set(deviceId, ctl);
    }
    return ctl;
  }, [fleetStore, ackRouter, recordSteeringActivity]);

  const enterPeek = useCallback((deviceId) => {
    mediaLog.peekEntered({ deviceId });
    getController(deviceId);
  }, [getController]);

  const exitPeek = useCallback((deviceId) => {
    mediaLog.peekExited({ deviceId });
  }, []);

  const getSteeringActivity = useCallback(
    (deviceId) => steeringByDevice.get(deviceId) ?? null,
    [steeringByDevice]
  );

  const value = useMemo(
    () => ({ getController, enterPeek, exitPeek, getSteeringActivity }),
    [getController, enterPeek, exitPeek, getSteeringActivity]
  );

  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>;
}

export default PeekProvider;
