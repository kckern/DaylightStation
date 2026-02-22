import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import { useMediaDevices } from '../modules/Input/hooks/useMediaDevices';
import { useWebcamStream } from '../modules/Input/hooks/useWebcamStream';
import { useWebRTCPeer } from '../modules/Input/hooks/useWebRTCPeer';
import { useHomeline } from '../modules/Input/hooks/useHomeline';
import useCallOwnership from '../modules/Input/hooks/useCallOwnership.js';
import useMediaControls from '../modules/Input/hooks/useMediaControls.js';
import getLogger from '../lib/logging/Logger.js';
import './CallApp.scss';

export default function CallApp() {
  const logger = useMemo(() => getLogger().child({ component: 'CallApp' }), []);
  const {
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const { videoRef: localVideoRef, stream, error } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const peer = useWebRTCPeer(stream);
  const { connectionState } = peer;
  const { peerConnected, status, connect, hangUp, sendMuteState, remoteMuteState } = useHomeline('phone', null, peer);
  const { audioMuted, videoMuted, toggleAudio, toggleVideo, reset } = useMediaControls(stream);
  const [devices, setDevices] = useState(null); // null = loading, [] = none found
  const [waking, setWaking] = useState(false);
  const [connectingTooLong, setConnectingTooLong] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(null);
  const [iceError, setIceError] = useState(null);
  const [wakeError, setWakeError] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const connectedDeviceRef = useRef(null);
  const { isOwner } = useCallOwnership(activeDeviceId);

  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

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

  // React to ICE connection failures
  useEffect(() => {
    if (connectionState === 'failed') {
      logger.error('ice-connection-failed', { deviceId: connectedDeviceRef.current });
      setIceError('Connection lost — the video link failed.');
    } else if (connectionState === 'disconnected') {
      logger.warn('ice-connection-disconnected', { deviceId: connectedDeviceRef.current });
      setIceError('Connection unstable...');
    } else if (connectionState === 'connected' || connectionState === 'new') {
      setIceError(null);
    }
  }, [connectionState, logger]);

  // User-facing connection timeout (15s)
  useEffect(() => {
    if (status !== 'connecting') {
      setConnectingTooLong(false);
      return;
    }
    const timer = setTimeout(() => setConnectingTooLong(true), 15000);
    return () => clearTimeout(timer);
  }, [status]);

  // Log when timeout becomes visible to user
  useEffect(() => {
    if (connectingTooLong) {
      logger.warn('connect-timeout-user-visible', {
        deviceId: connectedDeviceRef.current,
        elapsed: '15s'
      });
    }
  }, [connectingTooLong, logger]);

  // Attach remote stream — split audio/video across separate elements.
  // Android Chrome routes <video> audio to earpiece, <audio> to speaker.
  useEffect(() => {
    if (!peer.remoteStream) return;
    const tracks = peer.remoteStream.getTracks();
    logger.info('remote-stream-attached', { tracks: tracks.map(t => ({ kind: t.kind, enabled: t.enabled })) });
    const videoTracks = peer.remoteStream.getVideoTracks();
    const audioTracks = peer.remoteStream.getAudioTracks();
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = videoTracks.length
        ? new MediaStream(videoTracks)
        : null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = audioTracks.length
        ? new MediaStream(audioTracks)
        : null;
    }
    logger.debug('remote-stream-split', { videoTracks: videoTracks.length, audioTracks: audioTracks.length });
  }, [logger, peer.remoteStream]);

  // Sync local stream to the self-preview video element.
  // The video element is always mounted now, so we only need to
  // react to stream changes (not status/view transitions).
  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = new MediaStream(stream.getVideoTracks());
    }
  }, [stream]);

  // Clean up call: hangup signaling + power off TV + reset state
  const endCall = useCallback(() => {
    reset();
    const devId = connectedDeviceRef.current;
    hangUp();
    setWaking(false);
    if (devId) {
      if (isOwner()) {
        logger.info('tv-power-off', { targetDeviceId: devId });
        DaylightAPI(`/api/v1/device/${devId}/off?force=true`).catch(err => {
          logger.warn('tv-power-off-failed', { targetDeviceId: devId, error: err.message });
        });
      } else {
        logger.info('tv-power-off-skipped-not-owner', { targetDeviceId: devId });
      }
      connectedDeviceRef.current = null;
      setActiveDeviceId(null);
    }
  }, [reset, hangUp, logger, isOwner]);

  // Mute toggle handlers — toggle local track + notify remote
  const handleToggleAudio = useCallback(() => {
    const newAudioMuted = toggleAudio();
    if (newAudioMuted !== undefined) sendMuteState(newAudioMuted, videoMuted);
  }, [toggleAudio, sendMuteState, videoMuted]);

  const handleToggleVideo = useCallback(() => {
    const newVideoMuted = toggleVideo();
    if (newVideoMuted !== undefined) sendMuteState(audioMuted, newVideoMuted);
  }, [toggleVideo, sendMuteState, audioMuted]);

  // Keep a ref to endCall so the cleanup effect doesn't re-run
  // when endCall's identity changes (which would fire the destructor
  // and spuriously power off the TV mid-call).
  const endCallRef = useRef(endCall);
  endCallRef.current = endCall;

  // Clean up on tab close or component unmount (SPA navigation)
  useEffect(() => {
    const handleBeforeUnload = () => endCallRef.current();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // SPA navigation: power off TV if we were in a call or connecting
      const devId = connectedDeviceRef.current;
      if (devId && isOwner()) {
        DaylightAPI(`/api/v1/device/${devId}/off?force=true`).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wake device (power on + load videocall URL) then connect signaling
  const dropIn = useCallback(async (targetDeviceId) => {
    if (waking || status !== 'idle' || cooldown) return;
    if (!stream) {
      logger.warn('drop-in-blocked-no-stream', { targetDeviceId, error: error?.message });
      return;
    }
    logger.info('drop-in-start', { targetDeviceId });
    setWaking(true);
    setWakeError(null);
    connectedDeviceRef.current = targetDeviceId;
    setActiveDeviceId(targetDeviceId);
    try {
      const result = await DaylightAPI(`/api/v1/device/${targetDeviceId}/load?open=videocall/${targetDeviceId}`);
      logger.info('wake-success', { targetDeviceId, displayVerified: result.displayVerified });

      if (result.displayVerifyFailed) {
        logger.warn('wake-display-not-verified', { targetDeviceId, attempts: result.power?.attempts });
        setWaking(false);
        setWakeError('TV display did not respond. The screen may be off.');
        return;
      }
    } catch (err) {
      logger.warn('wake-failed', { targetDeviceId, error: err.message });
      setWaking(false);
      setWakeError('Could not reach server — try again');
      setCooldown(true);
      setTimeout(() => setCooldown(false), 3000);
      return;
    }
    setWaking(false);
    // connect() subscribes and waits for the TV's heartbeat before sending the offer
    connect(targetDeviceId);
  }, [logger, connect, waking, status, stream, error, cooldown]);

  // Execute pending retry once status returns to idle
  useEffect(() => {
    if (pendingRetry && status === 'idle') {
      const devId = pendingRetry;
      setPendingRetry(null);
      dropIn(devId);
    }
  }, [pendingRetry, status, dropIn]);

  // Auto-connect if only one device
  useEffect(() => {
    if (devices && devices.length === 1 && status === 'idle' && stream) {
      dropIn(devices[0].id);
    }
  }, [devices, status, dropIn, stream]);

  const isIdle = (status === 'idle' || status === 'occupied') && !wakeError && !waking;
  const isConnecting = status === 'connecting' || waking;
  const isConnected = !isIdle && !isConnecting && !wakeError;

  return (
    <div className={`call-app ${isConnected ? 'call-app--connected' : isConnecting ? 'call-app--connecting' : 'call-app--preview'}`}>
      {/* Local camera — always mounted */}
      <div className={`call-app__local ${isConnected ? 'call-app__local--pip' : isConnecting ? 'call-app__local--inset' : 'call-app__local--full'}`}>
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="call-app__video call-app__video--tall"
          style={{ transform: 'scaleX(-1)' }}
        />
        {error && (
          <div className="call-app__camera-error">
            Camera unavailable — check permissions
          </div>
        )}
        {!error && !stream && (
          <div className="call-app__camera-loading">
            Starting camera...
          </div>
        )}
      </div>

      {/* Remote video — always mounted, hidden until connected via CSS */}
      <div className="call-app__remote">
        <video
          ref={remoteVideoRef}
          autoPlay
          muted
          playsInline
          className="call-app__video call-app__video--wide"
        />
        {/* Hidden audio element — forces speaker routing on Android Chrome */}
        <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
      </div>

      {/* Controls — always mounted, hidden until connected via CSS */}
      <div className="call-app__controls">
        <button
          className={`call-app__mute-btn ${audioMuted ? 'call-app__mute-btn--active' : ''}`}
          onClick={handleToggleAudio}
          aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
        >
          {audioMuted ? 'Mic Off' : 'Mic'}
        </button>
        <button className="call-app__hangup" onClick={endCall}>
          Hang Up
        </button>
        <button
          className={`call-app__mute-btn ${videoMuted ? 'call-app__mute-btn--active' : ''}`}
          onClick={handleToggleVideo}
          aria-label={videoMuted ? 'Enable video' : 'Disable video'}
        >
          {videoMuted ? 'Cam Off' : 'Cam'}
        </button>
      </div>

      {/* ICE error banner — conditional is fine (no ref) */}
      {isConnected && iceError && (
        <div className="call-app__ice-error">
          <span>{iceError}</span>
          {connectionState === 'failed' && (
            <button onClick={() => endCall()} className="call-app__ice-error-btn">
              End Call
            </button>
          )}
        </div>
      )}

      {/* Remote mute badge — conditional is fine */}
      {isConnected && remoteMuteState.audioMuted && (
        <div className="call-app__remote-muted">Remote audio muted</div>
      )}

      {/* Lobby overlay — device selection */}
      {isIdle && (
        <div className="call-app__overlay-bottom">
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
                  disabled={waking || status !== 'idle' || !stream}
                  onClick={() => dropIn(device.id)}
                >
                  {device.label || device.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wake error overlay */}
      {wakeError && !isConnecting && !isConnected && (
        <div className="call-app__overlay-bottom">
          <p className="call-app__status-text call-app__status-text--error">
            {wakeError}
          </p>
          <button
            className="call-app__retry-btn"
            disabled={cooldown}
            onClick={() => {
              setWakeError(null);
              const devId = connectedDeviceRef.current;
              if (devId) dropIn(devId);
            }}
          >
            {cooldown ? 'Wait...' : 'Try Again'}
          </button>
          <button
            className="call-app__device-btn"
            onClick={() => {
              setWakeError(null);
              const devId = connectedDeviceRef.current;
              if (devId) {
                setWaking(false);
                connect(devId);
              }
            }}
          >
            Connect anyway
          </button>
          <button className="call-app__cancel" onClick={() => {
            setWakeError(null);
            connectedDeviceRef.current = null;
            setActiveDeviceId(null);
          }}>
            Cancel
          </button>
        </div>
      )}

      {/* Connecting overlay — centered status, no device buttons */}
      {isConnecting && (
        <div className="call-app__connecting-overlay">
          <p className="call-app__status-text">
            {waking ? 'Waking up TV...' : 'Establishing call...'}
          </p>
          {connectingTooLong && (
            <div className="call-app__timeout-msg">
              TV is not responding. You can retry or cancel.
            </div>
          )}
          {connectingTooLong && (
            <button
              className="call-app__retry-btn"
              onClick={() => {
                const devId = connectedDeviceRef.current;
                if (devId) setPendingRetry(devId);
                endCall();
              }}
            >
              Retry
            </button>
          )}
          <button className="call-app__cancel" onClick={endCall}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
