import { useCallback, useEffect, useMemo, useRef } from 'react';
import wsService from '../../../services/WebSocketService.js';
import getLogger from '../../../lib/logging/Logger.js';

const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate', 'mute-state', 'media-retry', 'hangup', 'ready', 'waiting', 'heartbeat', 'media-verified']);

export function useCallSignaling({ role, session, peer, onEvent }) {
  const sequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const offeredRevisionRef = useRef(null);
  const controlConnectedRef = useRef(false);
  const activeSessionRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const peerRef = useRef(peer);
  peerRef.current = peer;
  const loggerRef = useRef(null);
  if (!loggerRef.current) loggerRef.current = getLogger().child({ component: 'useCallSignaling', role });

  const send = useCallback((type, payload = {}) => {
    if (!session || activeSessionRef.current !== session || !SIGNAL_TYPES.has(type)) return false;
    const sent = wsService.sendEphemeral({
      topic: session.topic, callId: session.callId, attemptId: session.attemptId,
      role, peerId: session.peerId, revision: revisionRef.current,
      sequence: sequenceRef.current++, type, payload,
    });
    if (type !== 'candidate' && type !== 'heartbeat') {
      loggerRef.current.info('signaling.sent', { callId: session.callId,
        attemptId: session.attemptId, peerId: session.peerId, peerRevision: revisionRef.current,
        state: type, outcome: sent ? 'sent' : 'control_disconnected' });
    }
    return sent;
  }, [role, session]);

  useEffect(() => {
    if (!session) return undefined;
    // A healthy peer-to-peer call must survive a prolonged control-channel
    // outage. The shared service's kiosk fallback reload would otherwise tear
    // down working media after three minutes without WebSocket traffic.
    wsService.setAutoReloadEnabled(false);
    activeSessionRef.current = session;
    revisionRef.current = session.peerRevision || 0;
    sequenceRef.current = 0;
    offeredRevisionRef.current = null;
    peerRef.current.onIceCandidate(candidate => send('candidate', { candidate }));
    const unsubscribe = wsService.subscribeAuthorized({
      topic: session.topic, credential: session.credential, role, peerId: session.peerId,
    }, async message => {
      if (message.type === 'homeline-authorize-ack') {
        if (message.ok === false) {
          const error = new Error(message.code || 'Signaling authorization failed');
          loggerRef.current.warn('signaling.authorization-failed', {
            callId: session.callId, reason: error.message,
          });
          onEventRef.current?.({ type: 'error', error });
        } else {
          // Authorization and signaling share one ordered WebSocket. Waiting
          // for this ack prevents a cold-connect/reconnect handshake from
          // arriving before the server has associated the socket with its
          // lease credential.
          send(role === 'phone' ? 'ready' : 'waiting', { authorized: true });
        }
        return;
      }
      if (message.callId !== session.callId || message.role === role) return;
      try {
        const payload = message.payload || {};
        if (message.revision !== revisionRef.current && message.type === 'candidate') return;
        if (message.type === 'ready' && role === 'tv') send('waiting');
        else if (message.type === 'waiting' && role === 'phone' && offeredRevisionRef.current !== revisionRef.current) {
          // Re-establishing signaling must not disturb a healthy P2P media
          // path. The readiness exchange restores controls; only unhealthy
          // media needs a new offer.
          if (peerRef.current.connectionState === 'connected') return;
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
        else if (message.type === 'media-retry') onEventRef.current?.({ type: 'media-retry' });
      } catch (error) {
        loggerRef.current.warn('signaling.failed', { callId: session.callId, reason: error.message, peerRevision: revisionRef.current });
        onEventRef.current?.({ type: 'error', error });
      }
    });
    controlConnectedRef.current = wsService.getStatus().connected;
    const statusUnsub = wsService.onStatusChange(status => {
      const reconnected = status.connected && !controlConnectedRef.current;
      controlConnectedRef.current = status.connected;
      onEventRef.current?.({ type: 'control-status', ...status });
      if (reconnected) {
        if (role === 'phone') offeredRevisionRef.current = null;
      }
    });
    const heartbeat = setInterval(() => send('heartbeat'), 5_000);
    return () => {
      if (activeSessionRef.current === session) activeSessionRef.current = null;
      wsService.setAutoReloadEnabled(true);
      clearInterval(heartbeat); unsubscribe(); statusUnsub(); peerRef.current.onIceCandidate(null);
    };
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
  }, [send]);

  return useMemo(() => ({ send, restartIce, rebuild, revisionRef }), [rebuild, restartIce, send]);
}
