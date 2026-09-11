import { useCallback, useEffect, useMemo, useRef } from 'react';
import wsService from '../../../services/WebSocketService.js';
import getLogger from '../../../lib/logging/Logger.js';

const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate', 'mute-state', 'hangup', 'ready', 'waiting', 'heartbeat', 'media-verified']);

export function useCallSignaling({ role, session, peer, onEvent }) {
  const sequenceRef = useRef(0);
  const revisionRef = useRef(0);
  // Releases the degraded-mode reload hold taken on authorize-ack.
  const releaseAutoReload = useRef(null);
  const answeredRevisionRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const peerRef = useRef(peer);
  peerRef.current = peer;
  const loggerRef = useRef(null);
  if (!loggerRef.current) loggerRef.current = getLogger().child({ component: 'useCallSignaling', role });

  const send = useCallback((type, payload = {}) => {
    if (!session || !SIGNAL_TYPES.has(type)) return false;
    const sequence = sequenceRef.current++;
    const delivered = wsService.sendEphemeral({
      topic: session.topic, callId: session.callId, attemptId: session.attemptId,
      role, peerId: session.peerId, revision: revisionRef.current,
      sequence, type, payload,
    });
    if (!delivered) {
      // Signalling is ephemeral by design: nothing is queued for a closed
      // socket. A dropped offer or answer used to vanish here without a
      // trace, and the call sat in `negotiating` forever (2026-09-08).
      const detail = { callId: session.callId, type, peerRevision: revisionRef.current, sequence };
      if (type === 'heartbeat') loggerRef.current.sampled('signaling.dropped', detail, { maxPerMinute: 2, aggregate: true });
      else loggerRef.current.warn('signaling.dropped', detail);
    }
    return delivered;
  }, [role, session]);

  useEffect(() => {
    if (!session) return undefined;
    revisionRef.current = session.peerRevision || 0;
    sequenceRef.current = 0;
    answeredRevisionRef.current = null;
    peerRef.current.onIceCandidate(candidate => send('candidate', { candidate }));
    const unsubscribe = wsService.subscribeAuthorized({
      topic: session.topic, credential: session.credential, role, peerId: session.peerId,
    }, async message => {
      if (message.type === 'homeline-authorize-ack' && message.ok) {
        // Held for the life of THIS effect, not forever. The old call flipped a
        // tab-wide boolean off here with no matching re-enable, so one call left
        // the kiosk's only self-repair disabled until the page was reloaded by
        // hand — which is the thing that could no longer happen.
        releaseAutoReload.current?.();
        releaseAutoReload.current = wsService.suppressAutoReload?.('home-line call');
        // A reconnect receives a fresh authorization and restarts the
        // handshake. Whether that produces a new offer is decided when the
        // TV's `waiting` arrives, below, not here.
        send(role === 'phone' ? 'ready' : 'waiting');
        return;
      }
      if (message.callId !== session.callId || message.role === role) return;
      try {
        const payload = message.payload || {};
        if (message.revision !== revisionRef.current && message.type === 'candidate') return;
        if (message.type === 'ready' && role === 'tv') send('waiting');
        else if (message.type === 'waiting' && role === 'phone'
          && peerRef.current.connectionState !== 'connected'
          && answeredRevisionRef.current !== revisionRef.current) {
          // Every fresh `waiting` earns a fresh offer until an answer for this
          // revision has been accepted. The TV sends `waiting` once per
          // (re)subscription, so this is self-throttling; the old one-offer-
          // per-revision guard deadlocked the call whenever that single offer
          // was dropped. Once answered, a stray `waiting` from a TV socket
          // flap must not tear down an ICE attempt that is about to succeed.
          onEventRef.current?.({ type: 'tv-ready' });
          const offer = await peerRef.current.createOffer({ revision: revisionRef.current });
          const delivered = send('offer', { description: offer });
          loggerRef.current.info('signaling.offer', { callId: session.callId, peerRevision: revisionRef.current, delivered });
        } else if (message.type === 'offer' && role === 'tv') {
          revisionRef.current = message.revision;
          const answer = await peerRef.current.handleOffer(payload.description, { revision: message.revision });
          send('answer', { description: answer });
        } else if (message.type === 'answer' && role === 'phone') {
          await peerRef.current.handleAnswer(payload.description, { revision: message.revision });
          answeredRevisionRef.current = message.revision;
          onEventRef.current?.({ type: 'answered' });
        } else if (message.type === 'candidate') await peerRef.current.addIceCandidate(payload.candidate, message.revision);
        else if (message.type === 'hangup') onEventRef.current?.({ type: 'hangup' });
        else if (message.type === 'mute-state') onEventRef.current?.({ type: 'mute-state', ...payload });
      } catch (error) {
        loggerRef.current.warn('signaling.failed', { callId: session.callId, reason: error.message, peerRevision: revisionRef.current });
        onEventRef.current?.({ type: 'error', error });
      }
    });
    const statusUnsub = wsService.onStatusChange(status => onEventRef.current?.({ type: 'control-status', ...status }));
    const heartbeat = setInterval(() => send('heartbeat'), 5_000);
    return () => {
      clearInterval(heartbeat); unsubscribe(); statusUnsub(); peerRef.current.onIceCandidate(null);
      releaseAutoReload.current?.();
      releaseAutoReload.current = null;
    };
  }, [role, send, session]);

  const restartIce = useCallback(async () => {
    const offer = await peerRef.current.restartIce(revisionRef.current);
    send('offer', { description: offer, iceRestart: true });
  }, [send]);
  const rebuild = useCallback(async () => {
    revisionRef.current += 1;
    sequenceRef.current = 0;
    answeredRevisionRef.current = null;
    const offer = await peerRef.current.rebuild(revisionRef.current);
    send('offer', { description: offer, rebuild: true });
    return revisionRef.current;
  }, [send]);

  return useMemo(() => ({ send, restartIce, rebuild, revisionRef }), [rebuild, restartIce, send]);
}
