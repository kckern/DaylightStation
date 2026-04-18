import React, { createContext, useContext, useMemo, useEffect, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { LocalSessionAdapter } from './LocalSessionAdapter.js';
import { useClientIdentity } from './ClientIdentityProvider.jsx';
import { HiddenPlayerMount } from './HiddenPlayerMount.jsx';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
} from './persistence.js';
import { wsService } from '../../../services/WebSocketService.js';
import mediaLog from '../logging/mediaLog.js';
import { useSessionController } from './useSessionController.js';
import { useUrlCommand } from '../externalControl/useUrlCommand.js';
import { usePlaybackStateBroadcast } from '../shared/usePlaybackStateBroadcast.js';

export const PlayerHostContext = createContext(null);
const PlayerHostSetterContext = createContext(() => {});

export function usePlayerHostSetter() {
  return useContext(PlayerHostSetterContext);
}

function UrlAndBroadcastMount() {
  const { clientId, displayName } = useClientIdentity();
  const controller = useSessionController('local');
  useUrlCommand(controller);
  usePlaybackStateBroadcast({
    send: (data) => wsService.send(data),
    clientId,
    displayName,
    snapshot: controller.snapshot,
  });
  return null;
}

export function LocalSessionProvider({ children }) {
  const { clientId } = useClientIdentity();

  const adapter = useMemo(() => {
    return new LocalSessionAdapter({
      clientId,
      wsSend: (data) => wsService.send(data),
      persistence: {
        read: readPersistedSession,
        write: writePersistedSession,
        clear: clearPersistedSession,
      },
    });
  }, [clientId]);

  useEffect(() => {
    mediaLog.mounted({ clientId });

    const persisted = readPersistedSession();
    if (persisted && persisted !== 'schema-mismatch') {
      mediaLog.sessionResumed({
        sessionId: persisted.snapshot.sessionId,
        resumedPosition: persisted.snapshot.position ?? 0,
      });
    }

    const onUnload = () => {
      try {
        wsService.send({
          topic: 'playback_state',
          clientId,
          sessionId: adapter.getSnapshot().sessionId,
          state: 'stopped',
          ts: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    };

    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      mediaLog.unmounted({});
    };
  }, [adapter, clientId]);

  const [playerHostEl, setPlayerHostEl] = useState(null);

  const value = useMemo(() => ({ adapter }), [adapter]);

  return (
    <LocalSessionContext.Provider value={value}>
      <PlayerHostContext.Provider value={playerHostEl}>
        <PlayerHostSetterContext.Provider value={setPlayerHostEl}>
          <UrlAndBroadcastMount />
          {children}
          <HiddenPlayerMount />
        </PlayerHostSetterContext.Provider>
      </PlayerHostContext.Provider>
    </LocalSessionContext.Provider>
  );
}

export default LocalSessionProvider;
