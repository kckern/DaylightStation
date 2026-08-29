import { useCallback, useEffect, useMemo, useRef } from 'react';
import wsService from '../../../services/WebSocketService.js';
import getLogger from '../../../lib/logging/Logger.js';

const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate', 'mute-state', 'hangup', 'ready', 'waiting', 'heartbeat', 'media-verified']);

export function useCallSignaling({ role, session, peer, onEvent }) {
  const sequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const offeredRevisionRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const peerRef = useRef(peer);
  peerRef.current = peer;
  const loggerRef = useRef(null);
  if (!loggerRef.current) loggerRef.current = getLogger().child({ component: 'useCallSignaling', role });

  const send = useCallback((type, payload = {}) => {
    if (!session || !SIGNAL_TYPES.has(type)) return false;
    return wsService.sendEphemeral({
      topic: session.topic, callId: session.callId, attemptId: session.attemptId,
      role, peerId: session.peerId, revision: revisionRef.current,
      sequence: sequenceRef.current++, type, payload,
    });
  }, [role, session]);

  useEffect(() => {
    if (!session) return undefined;
    revisionRef.current = session.peerRevision || 0;
    sequenceRef.current = 0;
    offeredRevisionRef.current = null;
    peerRef.current.onIceCandidate(candidate => send('candidate', { candidate }));
    const unsubscribe = wsService.subscribeAuthorized({
      topic: session.topic, credential: session.credential, role, peerId: session.peerId,
    }, async message => {
      if (message.type === 'homeline-authorize-ack' && message.ok) {
        wsService.setAutoReloadEnabled?.(false);
        // A reconnect receives a fresh authorization while media remains
        // healthy. Permit one new offer for this revision only when needed.
        offeredRevisionRef.current = null;
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
          && offeredRevisionRef.current !== revisionRef.current) {
          offeredRevisionRef.current = revisionRef.current;
          onEventRef.current?.({ type: 'tv-ready' });
          const offer = await peerRef.current.createOffer({ revision: revisionRef.current });
          send('offer', { description: offer });
        } else if (message.type === 'offer' && role === 'tv') {
          revisionRef.current = message.revision;
          const answer = await peerRef.current.handleOffer(payload.description, { revision: message.revision });
          send('answer', { description: answer });
        } else if (message.type === 'answer' && role === 'phone') {
          await peerRef.current.handleAnswer(payload.description, { revision: message.revision });
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
    return () => { clearInterval(heartbeat); unsubscribe(); statusUnsub(); peerRef.current.onIceCandidate(null); };
  }, [role, send, session]);

  const restartIce = useCallback(async () => {
    const offer = await peerRef.current.restartIce(revisionRef.current);
    send('offer', { description: offer, iceRestart: true });
  }, [send]);
  const rebuild = useCallback(async () => {
    revisionRef.current += 1;
    sequenceRef.current = 0;
    offeredRevisionRef.current = revisionRef.current;
    const offer = await peerRef.current.rebuild(revisionRef.current);
    send('offer', { description: offer, rebuild: true });
    return revisionRef.current;
  }, [send]);

  return useMemo(() => ({ send, restartIce, rebuild, revisionRef }), [rebuild, restartIce, send]);
}
