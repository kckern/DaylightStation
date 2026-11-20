// frontend/src/modules/Media/session/LocalSessionProvider.jsx
// Owns the local session: builds the controller from persisted state,
// attaches side effects (persistence, logging), and mounts the
// player bridge plus the URL-command / external-control / state-broadcast
// hooks. Everything below the provider sees only the controller interface.
import React, { useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { browserPreference } from "@/lib/browserPreference.js";
import { LocalSessionContext } from "./LocalSessionContext.js";
import { PlayerHostProvider } from "./PlayerHostProvider.jsx";
import { createLocalSessionController } from "./LocalSessionController.js";
import { attachPersistence, attachLogging, attachSlowStartWatchdog } from "./attachments.js";
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
} from "./persistence.js";
import { useClientIdentity } from "../identity/useClientIdentity.js";
import { PlayerBridge } from "./PlayerBridge.jsx";
import { MusicBehindHost } from "./MusicBehindHost.jsx";
import { useSessionController } from "../controller/useSessionController.js";
import { clearUrlCommandToken, useUrlCommand } from "../externalControl/useUrlCommand.js";
import { useExternalControl } from "../externalControl/useExternalControl.js";
import { usePlaybackStateBroadcast } from "../shared/usePlaybackStateBroadcast.js";
import { publish } from "../net/ws.js";
import { useMediaSession } from "./useMediaSession.js";
import mediaLog from "../logging/mediaLog.js";

const legacyRecents = browserPreference('media-app.recents', null);

function SessionSideEffects() {
  const identity = useClientIdentity();
  const { controller, snapshot } = useSessionController('local');
  useUrlCommand(controller);
  useExternalControl(controller);
  // Lock screen / system media controls for playback here (RQ-STEER-04).
  useMediaSession(controller);
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
        clearUrlCommandToken();
      },
    });
    // Attach side effects synchronously: child effects (URL command,
    // external control) fire before any parent effect could attach, and
    // their first mutations must be persisted/logged too.
    // The browser-only recents list is gone (Home's Recent is the
    // household's); drop its leftover key.
    legacyRecents.clear();
    ctl.detachPersistence = attachPersistence(ctl.store, { write: writePersistedSession });
    ctl.detachers = [
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

  const committedController = useRef(null);
  useLayoutEffect(() => {
    committedController.current = controller;
  }, [controller]);

  const recoveryLifecycleRef = useRef(null);
  useEffect(() => {
    const lifecycle = {};
    recoveryLifecycleRef.current = { controller, lifecycle };
    return () => {
      // A route exit commits its final snapshot. A replaced controller no
      // longer owns persistence once the new controller has committed.
      controller.detachPersistence({ flush: committedController.current === controller });
      controller.detachers?.forEach((d) => d());
      queueMicrotask(() => {
        if (recoveryLifecycleRef.current?.controller !== controller || recoveryLifecycleRef.current?.lifecycle === lifecycle) controller.disposeRecovery?.();
      });
    };
  }, [controller]);

  const value = useMemo(() => ({ controller }), [controller]);

  return (
    <LocalSessionContext.Provider value={value}>
      <PlayerHostProvider>
        <SessionSideEffects />
        {children}
        <PlayerBridge />
        <MusicBehindHost />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
  );
}

export default LocalSessionProvider;
