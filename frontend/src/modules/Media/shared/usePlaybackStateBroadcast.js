// The browser's one authoritative house-state publication path. LocalSessionProvider
// mounts this hook once; Fleet consumes only the relayed playback_state projection.
import { useEffect, useRef } from 'react';
import { buildPlaybackStateBroadcast } from '@shared-contracts/media/envelopes.mjs';
import { TIMING } from '../constants.js';

function legacyIdentity({ clientId, displayName }) {
  return {
    clientId,
    deviceId: `browser:${clientId}`,
    name: displayName,
    connectedAt: new Date().toISOString(),
  };
}

function revisionOf(snapshot) {
  const owner = snapshot?.meta?.playbackOwner;
  if (Number.isInteger(snapshot?.meta?.revision)) return snapshot.meta.revision;
  if (Number.isInteger(owner?.playbackRevision) || Number.isInteger(owner?.queueRevision)) {
    return Math.max(owner?.playbackRevision ?? 0, owner?.queueRevision ?? 0);
  }
  return 0;
}

function buildMessage({ identity, snapshot, reason, connected = true }) {
  const visibleItem = snapshot?.currentItem?.hidden ? null : (snapshot?.currentItem ?? null);
  const lastHeardAt = new Date().toISOString();
  return buildPlaybackStateBroadcast({
    identity,
    clientId: identity.clientId,
    deviceId: identity.deviceId,
    ownerId: snapshot?.meta?.ownerId ?? identity.clientId,
    revision: revisionOf(snapshot),
    origin: snapshot?.meta?.origin,
    sessionId: snapshot?.sessionId ?? `browser:${identity.clientId}`,
    displayName: identity.name,
    state: snapshot?.state ?? 'idle',
    currentItem: visibleItem,
    position: snapshot?.position ?? 0,
    duration: visibleItem?.duration ?? 0,
    queue: snapshot?.queue ?? { items: [], currentIndex: -1, upNextCount: 0 },
    config: snapshot?.config ?? { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
    connected,
    lastHeardAt,
    reason,
    ts: lastHeardAt,
  });
}

export function usePlaybackStateBroadcast({ send, identity: providedIdentity, clientId, displayName, snapshot }) {
  const identity = providedIdentity ?? legacyIdentity({ clientId, displayName });
  const latestRef = useRef({ snapshot, send, identity });
  latestRef.current = { snapshot, send, identity };
  const publishedRef = useRef(false);

  useEffect(() => {
    if (!snapshot || !identity?.clientId) return;
    send(buildMessage({
      identity,
      snapshot,
      reason: publishedRef.current ? 'change' : 'initial',
    }));
    publishedRef.current = true;
  }, [send, identity, snapshot]);

  useEffect(() => {
    if (!identity?.clientId) return undefined;
    const id = setInterval(() => {
      const latest = latestRef.current;
      if (!latest.snapshot) return;
      latest.send(buildMessage({ ...latest, reason: 'heartbeat' }));
    }, TIMING.PLAYBACK_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [identity?.clientId]);

  useEffect(() => {
    const publishClosed = () => {
      const latest = latestRef.current;
      if (!latest.identity?.clientId) return;
      latest.send(buildMessage({
        ...latest,
        snapshot: { ...latest.snapshot, state: 'stopped', currentItem: null, position: 0 },
        reason: 'disconnect',
        connected: false,
      }));
    };
    window.addEventListener('pagehide', publishClosed);
    return () => {
      window.removeEventListener('pagehide', publishClosed);
      publishClosed();
    };
  }, []);
}

export default usePlaybackStateBroadcast;
