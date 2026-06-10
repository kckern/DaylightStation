// frontend/src/modules/Media/session/LocalSessionProvider.jsx
// Owns the local session: builds the controller from persisted state,
// attaches side effects (persistence, recents, logging), and mounts the
// player bridge plus the URL-command / external-control / state-broadcast
// hooks. Everything below the provider sees only the controller interface.
import React, { useMemo, useEffect, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PlayerHostContext, PlayerHostSetterContext } from './playerHostContext.js';
import { createLocalSessionController } from './LocalSessionController.js';
import { attachPersistence, attachRecents, attachLogging } from './attachments.js';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
} from './persistence.js';
import { useClientIdentity } from '../identity/ClientIdentityProvider.jsx';
import { PlayerBridge } from './PlayerBridge.jsx';
import { useSessionController } from '../controller/useSessionController.js';
import { useUrlCommand } from '../externalControl/useUrlCommand.js';
import { useExternalControl } from '../externalControl/useExternalControl.js';
import { usePlaybackStateBroadcast } from '../shared/usePlaybackStateBroadcast.js';
import { publish } from '../net/ws.js';
import mediaLog from '../logging/mediaLog.js';

function SessionSideEffects() {
  const { clientId, displayName } = useClientIdentity();
  const { controller, snapshot } = useSessionController('local');
  useUrlCommand(controller);
  useExternalControl(controller);
  usePlaybackStateBroadcast({ send: publish, clientId, displayName, snapshot });
  return null;
}

export function LocalSessionProvider({ children }) {
  const { clientId } = useClientIdentity();

  const controller = useMemo(() => {
    const persisted = readPersistedSession();
    const persistedSnapshot = persisted && persisted !== 'schema-mismatch' ? persisted.snapshot : null;
    if (persisted === 'schema-mismatch') {
      mediaLog.sessionReset({ reason: 'schema-mismatch' });
      clearPersistedSession();
    }
    const ctl = createLocalSessionController({
      clientId,
      persistedSnapshot,
      clearPersisted: clearPersistedSession,
    });
    if (persistedSnapshot) {
      mediaLog.sessionResumed({
        sessionId: persistedSnapshot.sessionId,
        resumedPosition: persistedSnapshot.position ?? 0,
      });
    } else {
      mediaLog.sessionCreated({ sessionId: ctl.getSnapshot().sessionId });
    }
    return ctl;
  }, [clientId]);

  // Side-effect attachments ride store transitions; detach on teardown.
  useEffect(() => {
    const detachers = [
      attachPersistence(controller.store, { write: writePersistedSession }),
      attachRecents(controller.store),
      attachLogging(controller.store),
    ];
    return () => detachers.forEach((d) => d());
  }, [controller]);

  const value = useMemo(() => ({ controller }), [controller]);

  // Terminal broadcast on tab close (C10.3): the unmount broadcast in
  // usePlaybackStateBroadcast covers SPA unmounts; beforeunload covers the
  // browser closing the tab.
  useEffect(() => {
    const onUnload = () => {
      try {
        publish({
          topic: 'playback_state',
          clientId,
          sessionId: controller.getSnapshot().sessionId,
          state: 'stopped',
          ts: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [controller, clientId]);

  const [playerHostEl, setPlayerHostEl] = useState(null);

  return (
    <LocalSessionContext.Provider value={value}>
      <PlayerHostContext.Provider value={playerHostEl}>
        <PlayerHostSetterContext.Provider value={setPlayerHostEl}>
          <SessionSideEffects />
          {children}
          <PlayerBridge />
        </PlayerHostSetterContext.Provider>
      </PlayerHostContext.Provider>
    </LocalSessionContext.Provider>
  );
}

export default LocalSessionProvider;
