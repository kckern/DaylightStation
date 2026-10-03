// frontend/src/modules/Media/session/LocalSessionProvider.jsx
// Owns the local session: builds the controller from persisted state,
// attaches side effects (persistence, recents, logging), and mounts the
// player bridge plus the URL-command / external-control / state-broadcast
// hooks. Everything below the provider sees only the controller interface.
import React, { useMemo, useEffect } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { createLocalSessionController } from './LocalSessionController.js';
import { attachPersistence, attachRecents, attachLogging, attachSlowStartWatchdog } from './attachments.js';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
} from './persistence.js';
import { STORAGE_KEYS } from '../constants.js';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { PlayerBridge } from './PlayerBridge.jsx';
import { useSessionController } from '../controller/useSessionController.js';
import { useUrlCommand } from '../externalControl/useUrlCommand.js';
import { useExternalControl } from '../externalControl/useExternalControl.js';
import { usePlaybackStateBroadcast } from '../shared/usePlaybackStateBroadcast.js';
import { publish } from '../net/ws.js';
import mediaLog from '../logging/mediaLog.js';

function SessionSideEffects() {
  const identity = useClientIdentity();
  const { controller, snapshot } = useSessionController('local');
  useUrlCommand(controller);
  useExternalControl(controller);
  // Frames wait for this connection's identify (controlReady); the hook
  // projects the identity to its wire contract fields.
  usePlaybackStateBroadcast({ send: publish, identity, snapshot, ready: identity.controlReady === true });
  return null;
}

export function LocalSessionProvider({ children }) {
  const { clientId } = useClientIdentity();

  const controller = useMemo(() => {
    // Restore hydrates before any default persistence is attached: an
    // older or malformed record is discarded (and logged), never guessed at.
    const persisted = readPersistedSession();
    const discarded = persisted === 'schema-mismatch' || persisted === 'malformed';
    const persistedSnapshot = persisted && !discarded ? persisted.snapshot : null;
    if (discarded) {
      mediaLog.sessionRestoreDiscarded({ reason: persisted });
      mediaLog.sessionReset({ reason: persisted });
      clearPersistedSession();
    }
    const ctl = createLocalSessionController({
      clientId,
      persistedSnapshot,
      // §11.3: reset clears the session AND the URL-command dedupe token,
      // so a deep link works again after an explicit reset.
      clearPersisted: () => {
        clearPersistedSession();
        try { localStorage.removeItem(STORAGE_KEYS.URL_COMMAND_TOKEN); } catch { /* ignore */ }
      },
    });
    // Attach side effects synchronously: child effects (URL command,
    // external control) fire before any parent effect could attach, and
    // their first mutations must be persisted/logged too.
    ctl.detachers = [
      attachPersistence(ctl.store, { write: writePersistedSession }),
      attachRecents(ctl.store),
      attachLogging(ctl.store),
      attachSlowStartWatchdog(ctl.store),
    ];
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

  useEffect(() => () => controller.detachers?.forEach((d) => d()), [controller]);

  const value = useMemo(() => ({ controller }), [controller]);

  return (
    <LocalSessionContext.Provider value={value}>
      <PlayerHostProvider>
        <SessionSideEffects />
        {children}
        <PlayerBridge />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
  );
}

export default LocalSessionProvider;
