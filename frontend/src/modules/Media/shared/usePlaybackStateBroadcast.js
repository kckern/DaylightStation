import { useEffect, useRef } from 'react';

function buildMessage({ clientId, sessionId, displayName, state, currentItem, position, config }) {
  // Hidden items (e.g. trigger end-behavior side-effect markers) must not appear
  // in the broadcast — they're internal control items, not media for fleet UIs.
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
  }, [send, clientId, displayName, snapshot?.state, snapshot?.sessionId, snapshot?.currentItem, snapshot?.position, snapshot?.config, snapshot]);

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
    }, 5000);
    return () => clearInterval(id);
  }, [send, clientId, displayName, snapshot?.state, snapshot?.sessionId, snapshot]);

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
