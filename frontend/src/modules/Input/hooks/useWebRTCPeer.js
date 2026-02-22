import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useWebRTCPeer' });
  return _logger;
}

const STUN_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export const useWebRTCPeer = (localStream) => {
  const pcRef = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const iceCandidateCallbackRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  const createPC = useCallback(() => {
    if (pcRef.current) {
      logger().debug('pc-closing-previous', { state: pcRef.current.connectionState });
      pcRef.current.close();
    }

    const pc = new RTCPeerConnection(STUN_CONFIG);
    pcRef.current = pc;

    if (localStream) {
      const tracks = localStream.getTracks();
      tracks.forEach(track => {
        pc.addTrack(track, localStream);
      });
      logger().debug('pc-created', { tracks: tracks.map(t => ({ kind: t.kind, label: t.label, enabled: t.enabled })) });
    } else {
      logger().debug('pc-created', { tracks: [] });
    }

    const remote = new MediaStream();
    setRemoteStream(remote);

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => {
        remote.addTrack(track);
      });
      setRemoteStream(new MediaStream(remote.getTracks()));
      logger().debug('remote-track-added', { kind: event.track.kind });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && iceCandidateCallbackRef.current) {
        iceCandidateCallbackRef.current(event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      logger().debug('connection-state', { state: pc.connectionState });
    };

    return pc;
  }, [localStream]);

  const createOffer = useCallback(async () => {
    const pc = createPC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }, [createPC]);

  const handleOffer = useCallback(async (offer) => {
    const pc = createPC();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // If local tracks aren't ready yet (e.g. TV webcam still starting),
    // upgrade recvonly transceivers to sendrecv so the SDP answer
    // advertises bidirectional media. replaceTrack() will swap in real
    // tracks once the stream arrives — no renegotiation needed.
    const upgraded = [];
    pc.getTransceivers().forEach(t => {
      if (!t.sender.track && t.direction === 'recvonly') {
        t.direction = 'sendrecv';
        upgraded.push(t.receiver.track?.kind ?? 'unknown');
      }
    });
    if (upgraded.length > 0) {
      logger().info('transceivers-upgraded-sendrecv', { kinds: upgraded });
    }

    // Flush any ICE candidates that arrived before remote description was set
    const queued = pendingCandidatesRef.current.splice(0);
    if (queued.length > 0) {
      logger().debug('ice-candidates-flushed', { count: queued.length });
    }
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        logger().warn('ice-candidate-flush-failed', { error: err.message });
      }
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }, [createPC]);

  const handleAnswer = useCallback(async (answer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    // Flush any ICE candidates that arrived before remote description was set
    const queued = pendingCandidatesRef.current.splice(0);
    if (queued.length > 0) {
      logger().debug('ice-candidates-flushed', { count: queued.length });
    }
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        logger().warn('ice-candidate-flush-failed', { error: err.message });
      }
    }
  }, []);

  const addIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) {
      // PC not ready — queue for later flush
      pendingCandidatesRef.current.push(candidate);
      logger().debug('ice-candidate-queued', { queueLength: pendingCandidatesRef.current.length });
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      logger().warn('ice-candidate-failed', { error: err.message });
    }
  }, []);

  const onIceCandidate = useCallback((callback) => {
    iceCandidateCallbackRef.current = callback;
  }, []);

  const reset = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
    setConnectionState('new');
  }, []);

  // Late-bind: when localStream arrives after PC was created without tracks,
  // swap null sender tracks for real ones via replaceTrack (no renegotiation).
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !localStream || pc.connectionState === 'closed') return;

    const transceivers = pc.getTransceivers();
    const empty = transceivers.filter(t => !t.sender.track);
    if (empty.length === 0) return;

    const tracks = localStream.getTracks();
    logger().info('late-bind-tracks', {
      trackCount: tracks.length,
      emptySlots: empty.length,
    });

    for (const track of tracks) {
      const match = empty.find(t => t.receiver.track?.kind === track.kind);
      if (match) {
        match.sender.replaceTrack(track)
          .then(() => logger().info('track-replaced', { kind: track.kind }))
          .catch(err => logger().warn('track-replace-failed', { kind: track.kind, error: err.message }));
      }
    }
  }, [localStream]);

  useEffect(() => {
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, []);

  return {
    pcRef,
    remoteStream,
    connectionState,
    createOffer,
    handleOffer,
    handleAnswer,
    addIceCandidate,
    onIceCandidate,
    reset,
  };
};
