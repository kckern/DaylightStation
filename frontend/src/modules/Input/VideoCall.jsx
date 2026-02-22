import React, { useRef, useEffect, useMemo } from 'react';
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
  const { peerConnected, status } = useHomeline('tv', deviceId, peer);

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

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && peer.remoteStream) {
      const tracks = peer.remoteStream.getTracks();
      logger.info('remote-stream-attached', { tracks: tracks.map(t => ({ kind: t.kind, enabled: t.enabled })) });
      remoteVideoRef.current.srcObject = peer.remoteStream;
    }
  }, [logger, peer.remoteStream]);

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
    <div className="videocall-tv">
      {peerConnected ? (
        <div className="videocall-tv__split">
          {/* Remote: phone portrait video */}
          <div className="videocall-tv__panel videocall-tv__panel--remote">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="videocall-tv__video videocall-tv__video--portrait"
            />
          </div>

          {/* Local: TV landscape camera */}
          <div className="videocall-tv__panel videocall-tv__panel--local">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="videocall-tv__video videocall-tv__video--landscape"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        </div>
      ) : (
        /* Solo: fullscreen local preview */
        <div className="videocall-tv__solo">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="videocall-tv__video videocall-tv__video--fullscreen"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>
      )}

      {/* Status indicator */}
      <div className="videocall-tv__status">
        {status === 'waiting' && 'Home Line \u2014 Waiting'}
        {status === 'connecting' && 'Connecting...'}
        {status === 'connected' && 'Connected'}
      </div>

      {/* Volume meter */}
      <div className="videocall-tv__meter">
        <div className="videocall-tv__meter-fill" style={{ width: `${volumePercentage}%` }} />
      </div>
    </div>
  );
}
