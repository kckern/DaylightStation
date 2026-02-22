import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useMediaDevices } from './hooks/useMediaDevices';
import { useWebcamStream } from './hooks/useWebcamStream';
import { useVolumeMeter } from './hooks/useVolumeMeter';
import { useWebRTCPeer } from './hooks/useWebRTCPeer';
import { useHomeline } from './hooks/useHomeline';
import getLogger from '../../lib/logging/Logger.js';
import './VideoCall.scss';

export default function VideoCall({ deviceId, clear }) {
  const logger = useMemo(() => getLogger().child({ component: 'VideoCall', deviceId }), [deviceId]);
  const {
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const { videoRef, stream } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(stream);
  const peer = useWebRTCPeer(stream);
  const { connectionState } = peer;
  const { peerConnected, status, remoteMuteState } = useHomeline('tv', deviceId, peer);
  const [iceError, setIceError] = useState(null);
  const [statusVisible, setStatusVisible] = useState(true);
  const [callDuration, setCallDuration] = useState(0);

  const remoteVideoRef = useRef(null);

  // Log mount/unmount
  useEffect(() => {
    logger.info('mounted', { deviceId });
    return () => logger.info('unmounted', { deviceId });
  }, [logger, deviceId]);

  // Log status transitions
  useEffect(() => {
    logger.debug('status-change', { status, peerConnected });
  }, [logger, status, peerConnected]);

  // React to ICE connection failures — auto-clear after 10s
  useEffect(() => {
    if (connectionState === 'failed') {
      logger.error('ice-connection-failed', { deviceId });
      setIceError('Connection lost');
      const timer = setTimeout(() => clear(), 10000);
      return () => clearTimeout(timer);
    } else if (connectionState === 'connected') {
      setIceError(null);
    }
  }, [connectionState, clear, deviceId, logger]);

  // Auto-hide status overlay 3s after connecting
  useEffect(() => {
    if (peerConnected) {
      const timer = setTimeout(() => setStatusVisible(false), 3000);
      return () => clearTimeout(timer);
    }
    setStatusVisible(true);
  }, [peerConnected]);

  // Call duration timer
  useEffect(() => {
    if (!peerConnected) {
      setCallDuration(0);
      return;
    }
    const interval = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => clearInterval(interval);
  }, [peerConnected]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && peer.remoteStream) {
      const tracks = peer.remoteStream.getTracks();
      logger.info('remote-stream-attached', { tracks: tracks.map(t => ({ kind: t.kind, enabled: t.enabled })) });
      remoteVideoRef.current.srcObject = peer.remoteStream;
    }
  }, [logger, peer.remoteStream]);

  // Re-sync local camera stream to video element.
  // useWebcamStream sets srcObject on stream acquisition, but if the
  // element wasn't ready or layout changed, this ensures it stays in sync.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = new MediaStream(stream.getVideoTracks());
    }
  }, [stream, videoRef]);

  // Escape to exit
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'XF86Back') {
        clear?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clear]);

  const volumePercentage = Math.min(volume * 100, 100);

  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`videocall-tv ${peerConnected ? 'videocall-tv--connected' : ''}`}>
      {/* Local: TV landscape camera — always mounted */}
      <div className="videocall-tv__local-panel">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="videocall-tv__video"
          style={{ transform: 'scaleX(-1)' }}
        />
      </div>

      {/* Remote: phone portrait video — always mounted, hidden until connected via CSS */}
      <div className="videocall-tv__remote-panel">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="videocall-tv__video videocall-tv__video--portrait"
        />
        {peerConnected && remoteMuteState.videoMuted && (
          <div className="videocall-tv__video-off">Camera off</div>
        )}
      </div>

      {/* Call info bar — replaces old status overlay in connected mode */}
      <div className="videocall-tv__info-bar">
        {iceError ? (
          <span className="videocall-tv__info-error">{iceError}</span>
        ) : (
          <span className="videocall-tv__info-status">
            {status === 'waiting' && 'Home Line \u2014 Waiting'}
            {status === 'connecting' && 'Connecting...'}
            {status === 'connected' && 'Connected'}
          </span>
        )}
        {peerConnected && (
          <span className="videocall-tv__info-duration">{formatDuration(callDuration)}</span>
        )}
        {peerConnected && remoteMuteState.audioMuted && (
          <span className="videocall-tv__info-muted">Phone audio muted</span>
        )}
      </div>

      {/* Volume meter — solo mode only, hidden in connected mode */}
      <div className="videocall-tv__meter">
        <div className="videocall-tv__meter-fill" style={{ width: `${volumePercentage}%` }} />
      </div>
    </div>
  );
}
