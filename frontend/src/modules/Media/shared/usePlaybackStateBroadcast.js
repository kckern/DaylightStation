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

  useEffect(() => {
    return () => {
      send({
        topic: 'playback_state',
        clientId,
        sessionId: snapshot?.sessionId,
        displayName,
        state: 'stopped',
        currentItem: null,
        position: 0,
        ts: new Date().toISOString(),
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default usePlaybackStateBroadcast;
