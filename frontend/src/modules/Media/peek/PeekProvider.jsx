// frontend/src/modules/Media/peek/PeekProvider.jsx
// Owns the ack router (ONE device-ack:* subscription) and a cache of remote
// session controllers. Multiple peeks may be active at once (C5.5); the
// local session is never touched by anything here (C5.6).
import React, { useContext, useEffect, useMemo, useRef, useCallback } from 'react';
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

  useEffect(() => {
    return subscribeTopicKind('device-ack', (msg) => {
      if (typeof msg.commandId !== 'string') return;
      ackRouter.resolve({ commandId: msg.commandId, ok: msg.ok, error: msg.error });
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
      ctl = createRemoteSessionController({ deviceId, fleetStore, ackRouter });
      controllersRef.current.set(deviceId, ctl);
    }
    return ctl;
  }, [fleetStore, ackRouter]);

  const enterPeek = useCallback((deviceId) => {
    mediaLog.peekEntered({ deviceId });
    getController(deviceId);
  }, [getController]);

  const exitPeek = useCallback((deviceId) => {
    mediaLog.peekExited({ deviceId });
  }, []);

  const value = useMemo(
    () => ({ getController, enterPeek, exitPeek }),
    [getController, enterPeek, exitPeek]
  );

  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>;
}

export function usePeek() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeek must be used inside PeekProvider');
  return ctx;
}

export default PeekProvider;
