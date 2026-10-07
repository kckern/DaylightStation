// frontend/src/modules/Media/peek/PeekProvider.jsx
// Owns the ack router (ONE device-ack:* subscription) and a cache of remote
// session controllers. Multiple peeks may be active at once (C5.5); the
// local session is never touched by anything here (C5.6).
import React, { useContext, useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { PeekContext } from './PeekContext.js';
import { createAckRouter } from './ackRouter.js';
import { createRemoteSessionController } from './RemoteSessionController.js';
import { createBrowserSessionController } from './BrowserSessionController.js';
import { createClientControlCorrelator } from '../externalControl/clientControlCorrelator.js';
import { subscribeTopicKind } from '../net/ws.js';
import { wsService } from '../../../services/WebSocketService.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';
import mediaLog from '../logging/mediaLog.js';

export function PeekProvider({ children }) {
  const fleet = useContext(FleetContext);
  if (!fleet) throw new Error('PeekProvider must be inside FleetProvider');
  const { store: fleetStore } = fleet;
  // Every command names this device, so the screen can say who changed it
  // ("Paused by Dad's phone", RQ-STEER-21). Read at send time: a rename or a
  // late identity applies to controllers created before it.
  const identity = useContext(ClientIdentityContext);
  const originRef = useRef(null);
  originRef.current = {
    id: fleet.identity?.deviceId ?? (identity?.clientId ? `browser:${identity.clientId}` : null),
    name: typeof identity?.displayName === "string" ? identity.displayName.slice(0, 80) : null,
  };
  const commandOrigin = useMemo(() => ({
    kind: 'device',
    get id() { return originRef.current.id ?? undefined; },
    get name() { return originRef.current.name ?? undefined; },
  }), [originRef]);
  const correlatorRef = useRef(null);
  if (!correlatorRef.current && fleet.identity?.clientId) {
    correlatorRef.current = createClientControlCorrelator({
      controlClientId: fleet.identity.clientId,
      service: wsService,
    });
  }

  const ackRouterRef = useRef(null);
  if (!ackRouterRef.current) ackRouterRef.current = createAckRouter();
  const ackRouter = ackRouterRef.current;

  const controllersRef = useRef(new Map()); // deviceId -> controller
  const [steeringByDevice, setSteeringByDevice] = useState(() => new Map());
  // STEER.1a/AC4: the screen most recently sent to or steered, for the handle.
  const [lastSteeredId, setLastSteeredId] = useState(null);

  // RemoteSessionController calls this only after a command is acknowledged
  // against fresh, currently playing playback. Merely opening a Remote never
  // reaches this callback. CastTargetProvider re-checks this identity against
  // the latest fleet snapshot before it uses the record as an idle exemption.
  const recordSteeringActivity = useCallback(({ deviceId, playback, ownerId = null }) => {
    if (typeof deviceId !== 'string' || !deviceId
      || typeof playback?.sessionId !== 'string' || !playback.sessionId
      || typeof playback?.contentId !== 'string' || !playback.contentId) return;
    setSteeringByDevice((previous) => {
      const next = new Map(previous);
      next.set(deviceId, { playback, ownerId });
      return next;
    });
    setLastSteeredId(deviceId);
  }, []);

  // DispatchProvider has already correlated this backend playback confirmation
  // to an attempt created by this browser. This records provenance only; the
  // CastTargetProvider remains the sole gate and requires fresh matching
  // receiver state before it grants any inactivity exemption.
  const recordConfirmedDispatch = useCallback((receipt) => {
    if (receipt?.ownerId !== receipt?.deviceId) return;
    recordSteeringActivity(receipt);
  }, [recordSteeringActivity]);

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
    correlatorRef.current?.dispose?.();
    correlatorRef.current = null;
  }, []);

  const getController = useCallback((deviceId) => {
    if (typeof deviceId !== 'string' || !deviceId) return null;
    let ctl = controllersRef.current.get(deviceId);
    if (!ctl) {
      ctl = deviceId.startsWith('browser:')
        ? createBrowserSessionController({
          deviceId, callerDeviceId: fleet.identity?.deviceId,
          fleetStore, correlator: correlatorRef.current,
        })
        : createRemoteSessionController({
          deviceId, fleetStore, ackRouter, onSteeringActivity: recordSteeringActivity,
          origin: originRef.current.id ? commandOrigin : null,
        });
      controllersRef.current.set(deviceId, ctl);
    }
    return ctl;
  }, [fleetStore, ackRouter, recordSteeringActivity, fleet.identity?.deviceId, commandOrigin]);

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
    () => ({ getController, enterPeek, exitPeek, getSteeringActivity, recordConfirmedDispatch, lastSteeredId }),
    [getController, enterPeek, exitPeek, getSteeringActivity, recordConfirmedDispatch, lastSteeredId]
  );

  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>;
}

export default PeekProvider;
