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
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }, [createPC]);

  const handleAnswer = useCallback(async (answer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const addIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (!pc) return;
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
    setRemoteStream(null);
    setConnectionState('new');
  }, []);

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
