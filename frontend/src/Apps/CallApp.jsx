import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import { useMediaDevices } from '../modules/Input/hooks/useMediaDevices';
import { useWebcamStream } from '../modules/Input/hooks/useWebcamStream';
import { useWebRTCPeer } from '../modules/Input/hooks/useWebRTCPeer';
import { useHomeline } from '../modules/Input/hooks/useHomeline';
import getLogger from '../lib/logging/Logger.js';
import './CallApp.scss';

export default function CallApp() {
  const logger = useMemo(() => getLogger().child({ component: 'CallApp' }), []);
  const {
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const { videoRef: localVideoRef, stream } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const peer = useWebRTCPeer(stream);
  const { peerConnected, status, connect, hangUp } = useHomeline('phone', null, peer);
  const [devices, setDevices] = useState(null); // null = loading, [] = none found
  const [waking, setWaking] = useState(false);
  const connectedDeviceRef = useRef(null);

  const remoteVideoRef = useRef(null);

  // Fetch available devices from API on mount
  useEffect(() => {
    logger.info('mounted');
    DaylightAPI('/api/v1/device')
      .then(data => {
        const tvDevices = (data.devices || []).filter(d => d.capabilities?.contentControl);
        logger.info('devices-loaded', { count: tvDevices.length, ids: tvDevices.map(d => d.id) });
        setDevices(tvDevices);
      })
      .catch(err => {
        logger.warn('devices-fetch-failed', { error: err.message });
        setDevices([]);
      });
    return () => logger.info('unmounted');
  }, [logger]);

  // Log status transitions
  useEffect(() => {
    logger.debug('status-change', { status, peerConnected });
  }, [logger, status, peerConnected]);

  // Attach remote stream
  useEffect(() => {
    if (remoteVideoRef.current && peer.remoteStream) {
      const tracks = peer.remoteStream.getTracks();
      logger.info('remote-stream-attached', { tracks: tracks.map(t => ({ kind: t.kind, enabled: t.enabled })) });
      remoteVideoRef.current.srcObject = peer.remoteStream;
    }
  }, [logger, peer.remoteStream]);

  // Hang up signaling + power off TV
  const endCall = useCallback(() => {
    const devId = connectedDeviceRef.current;
    hangUp();
    if (devId) {
      logger.info('tv-power-off', { targetDeviceId: devId });
      DaylightAPI(`/api/v1/device/${devId}/off`).catch(err => {
        logger.warn('tv-power-off-failed', { targetDeviceId: devId, error: err.message });
      });
      connectedDeviceRef.current = null;
    }
  }, [hangUp, logger]);

  // Send hangup + power off on tab close
  useEffect(() => {
    const handleBeforeUnload = () => endCall();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [endCall]);

  // Wake device (power on + load videocall URL) then connect signaling
  const dropIn = useCallback(async (targetDeviceId) => {
    logger.info('drop-in-start', { targetDeviceId });
    setWaking(true);
    try {
      await DaylightAPI(`/api/v1/device/${targetDeviceId}/load?open=videocall/${targetDeviceId}`);
      logger.info('wake-success', { targetDeviceId });
    } catch (err) {
      logger.warn('wake-failed', { targetDeviceId, error: err.message });
    }
    setWaking(false);
    connectedDeviceRef.current = targetDeviceId;
    // connect() subscribes and waits for the TV's heartbeat before sending the offer
    connect(targetDeviceId);
  }, [logger, connect]);

  // Auto-connect if only one device
  useEffect(() => {
    if (devices && devices.length === 1 && status === 'idle') {
      dropIn(devices[0].id);
    }
  }, [devices, status, dropIn]);

  // Lobby: device list or loading state
  if (status === 'idle' || status === 'occupied') {
    return (
      <div className="call-app call-app--lobby">
        <div className="call-app__lobby-content">
          <h1 className="call-app__title">Home Line</h1>

          {devices === null && (
            <p className="call-app__message">Loading devices...</p>
          )}

          {devices && devices.length === 0 && (
            <p className="call-app__message">No video call devices configured</p>
          )}

          {status === 'occupied' && (
            <p className="call-app__message">Room is busy</p>
          )}

          {devices && devices.length > 1 && (
            <div className="call-app__device-list">
              {devices.map((device) => (
                <button
                  key={device.id}
                  className="call-app__device-btn"
                  onClick={() => dropIn(device.id)}
                >
                  {device.id}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Connecting: waking TV + waiting for heartbeat
  if (status === 'connecting') {
    return (
      <div className="call-app call-app--lobby">
        <div className="call-app__lobby-content">
          <h1 className="call-app__title">Home Line</h1>
          <p className="call-app__message">
            {waking ? 'Waking up TV...' : 'Waiting for TV...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="call-app call-app--connected">
      {/* Remote: TV landscape video */}
      <div className="call-app__remote">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
        />
      </div>

      {/* Local: phone portrait self-preview */}
      <div className="call-app__local">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="call-app__video call-app__video--tall"
          style={{ transform: 'scaleX(-1)' }}
        />
      </div>

      {/* Hang up button */}
      <button className="call-app__hangup" onClick={endCall}>
        Hang Up
      </button>
    </div>
  );
}
