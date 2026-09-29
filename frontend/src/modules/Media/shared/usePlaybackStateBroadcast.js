// The browser's one authoritative house-state publication path. LocalSessionProvider
// mounts this hook once; Fleet consumes only the relayed playback_state projection.
import { useCallback, useEffect, useMemo, useRef } from 'react';
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

// Only the identity contract's fields go on the wire (validatePlaybackStateBroadcast:
// clientId, deviceId, name, connectedAt, optional room) — never the whole
// identity context, which also carries UI state and a rename callback.
function wireIdentity(identity) {
  if (!identity) return identity;
  const { clientId, deviceId, name, room, connectedAt } = identity;
  return { clientId, deviceId, name, ...(room !== undefined ? { room } : {}), connectedAt };
}

// Heartbeat cadence: the playing cadence while the session is actively
// moving (position/state a Fleet row shows live), the browser cadence
// otherwise — an open idle tab only needs to prove it is still there, well
// inside the two-minute uncertainty window.
const ACTIVE_STATES = new Set(['playing', 'buffering', 'stalled', 'loading']);
const heartbeatDelay = (snapshot) => (ACTIVE_STATES.has(snapshot?.state)
  ? TIMING.PLAYBACK_HEARTBEAT_MS
  : TIMING.BROWSER_HEARTBEAT_MS);

/**
 * `ready` gates every frame on the control registration (identify) having
 * completed for this connection: the relay drops a frame whose identity is
 * not yet registered, with a WARN. When it flips true, the current state is
 * published at once.
 */
export function usePlaybackStateBroadcast({ send, identity: providedIdentity, clientId, displayName, snapshot, ready = true }) {
  const rawIdentity = providedIdentity ?? legacyIdentity({ clientId, displayName });
  const { clientId: idClient, deviceId: idDevice, name: idName, room: idRoom, connectedAt: idConnectedAt } = rawIdentity ?? {};
  const identity = useMemo(
    () => wireIdentity(rawIdentity),
    // Keyed on the projected fields only, so an unrelated identity-context
    // change (e.g. controlReady) doesn't count as a state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idClient, idDevice, idName, idRoom, idConnectedAt],
  );
  const latestRef = useRef({ snapshot, send, identity, ready });
  latestRef.current = { snapshot, send, identity, ready };
  const publishedRef = useRef(false);
  const heartbeatRef = useRef(null);

  const scheduleHeartbeat = useCallback(() => {
    clearTimeout(heartbeatRef.current);
    heartbeatRef.current = null;
    const latest = latestRef.current;
    if (!latest.ready || !latest.snapshot || !latest.identity?.clientId) return;
    heartbeatRef.current = setTimeout(() => {
      const current = latestRef.current;
      if (!current.ready || !current.snapshot || !current.identity?.clientId) return;
      current.send(buildMessage({ ...current, reason: 'heartbeat' }));
      scheduleHeartbeat();
    }, heartbeatDelay(latest.snapshot));
  }, []);

  useEffect(() => {
    if (!ready || !snapshot || !identity?.clientId) {
      clearTimeout(heartbeatRef.current);
      heartbeatRef.current = null;
      return;
    }
    send(buildMessage({
      identity,
      snapshot,
      reason: publishedRef.current ? 'change' : 'initial',
    }));
    publishedRef.current = true;
    scheduleHeartbeat();
  }, [send, identity, snapshot, ready, scheduleHeartbeat]);

  useEffect(() => () => clearTimeout(heartbeatRef.current), []);

  useEffect(() => {
    const publishClosed = () => {
      const latest = latestRef.current;
      if (!latest.identity?.clientId || !latest.ready) return;
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
