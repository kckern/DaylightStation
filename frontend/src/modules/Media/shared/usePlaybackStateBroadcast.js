// frontend/src/modules/Media/shared/usePlaybackStateBroadcast.js
// Publish the local session's live state on the playback_state topic (C8.3,
// C10.3): on every state change, every PLAYBACK_HEARTBEAT_MS while playing,
// and a terminal `stopped` on unmount. External dashboards consume this —
// keep the message shape stable (§9.10).
import { useEffect, useRef } from 'react';
import { TIMING } from '../constants.js';

function buildMessage({ clientId, sessionId, displayName, state, currentItem, position, config }) {
  // Hidden items (internal control markers) must not appear in broadcasts.
  const visibleItem = currentItem?.hidden ? null : (currentItem ?? null);
  return {
    topic: 'playback_state',
    clientId,
    sessionId,
    displayName,
    state,
    currentItem: visibleItem,
    position: position ?? 0,
    duration: visibleItem?.duration ?? null,
    config: config ?? null,
    ts: new Date().toISOString(),
  };
}

export function usePlaybackStateBroadcast({ send, clientId, displayName, snapshot }) {
  const lastStateRef = useRef(null);

  useEffect(() => {
    if (!snapshot) return;
    if (lastStateRef.current !== snapshot.state) {
      send(buildMessage({
        clientId, displayName,
        sessionId: snapshot.sessionId,
        state: snapshot.state,
        currentItem: snapshot.currentItem,
        position: snapshot.position,
        config: snapshot.config,
      }));
      lastStateRef.current = snapshot.state;
    }
  }, [send, clientId, displayName, snapshot]);

  useEffect(() => {
    if (!snapshot || snapshot.state !== 'playing') return undefined;
    const id = setInterval(() => {
      send(buildMessage({
        clientId, displayName,
        sessionId: snapshot.sessionId,
        state: snapshot.state,
        currentItem: snapshot.currentItem,
        position: snapshot.position,
        config: snapshot.config,
      }));
    }, TIMING.PLAYBACK_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [send, clientId, displayName, snapshot]);

  // Terminal stopped on unmount. The cleanup must report the CURRENT
  // session, not the one from first render — sessions rotate on reset and
  // adoption, and external consumers correlate by sessionId (§10.3).
  const latestRef = useRef({ snapshot, send, clientId, displayName });
  latestRef.current = { snapshot, send, clientId, displayName };
  useEffect(() => {
    return () => {
      const latest = latestRef.current;
      latest.send({
        topic: 'playback_state',
        clientId: latest.clientId,
        sessionId: latest.snapshot?.sessionId,
        displayName: latest.displayName,
        state: 'stopped',
        currentItem: null,
        position: 0,
        ts: new Date().toISOString(),
      });
    };
  }, []);
}

export default usePlaybackStateBroadcast;
