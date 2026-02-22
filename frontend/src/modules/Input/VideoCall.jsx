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

  return (
    <div className={`videocall-tv ${peerConnected ? 'videocall-tv--connected' : ''}`}>
      {/* Remote: phone portrait video — always mounted, hidden until connected via CSS */}
      <div className="videocall-tv__remote-panel">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="videocall-tv__video videocall-tv__video--portrait"
        />
      </div>

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

      {/* Remote mute indicator */}
      {peerConnected && remoteMuteState.audioMuted && (
        <div className="videocall-tv__remote-muted">Phone audio muted</div>
      )}

      {/* Status indicator */}
      <div className="videocall-tv__status">
        {iceError || (
          <>
            {status === 'waiting' && 'Home Line \u2014 Waiting'}
            {status === 'connecting' && 'Connecting...'}
            {status === 'connected' && 'Connected'}
          </>
        )}
      </div>

      {/* Volume meter */}
      <div className="videocall-tv__meter">
        <div className="videocall-tv__meter-fill" style={{ width: `${volumePercentage}%` }} />
      </div>
    </div>
  );
}
