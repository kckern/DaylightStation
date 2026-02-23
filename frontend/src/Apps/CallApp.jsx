import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import { useMediaDevices } from '../modules/Input/hooks/useMediaDevices';
import { useWebcamStream } from '../modules/Input/hooks/useWebcamStream';
import { useWebRTCPeer } from '../modules/Input/hooks/useWebRTCPeer';
import { useHomeline } from '../modules/Input/hooks/useHomeline';
import useCallOwnership from '../modules/Input/hooks/useCallOwnership.js';
import useMediaControls from '../modules/Input/hooks/useMediaControls.js';
import useZoomGestures from '../modules/Input/hooks/useZoomGestures.js';
import { useWakeProgress } from '../modules/Input/hooks/useWakeProgress';
import getLogger from '../lib/logging/Logger.js';
import './CallApp.scss';

const STEP_ICONS = { done: '\u2713', running: '\u2022', failed: '\u2717' };

function StepRow({ label, status }) {
  const icon = STEP_ICONS[status] || '\u25CB';
  const className = `call-app__step call-app__step--${status || 'pending'}`;
  return (
    <div className={className}>
      <span className="call-app__step-icon">{icon}</span>
      <span className="call-app__step-label">{label}</span>
      {status === 'running' && <span className="call-app__step-spinner" />}
    </div>
  );
}

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
  const { progress: wakeProgress, reset: resetWakeProgress } = useWakeProgress(
    (waking || status === 'connecting') ? activeDeviceId : null
  );

  const remoteVideoRef = useRef(null);
  const remoteContainerRef = useRef(null);
  const [zoomMode, setZoomMode] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 0.5, y: 0.5 });
  const [zoomScale, setZoomScale] = useState(1);
  const coverRatioRef = useRef(1);

  // Compute the scale needed to go from contain → cover for the remote video.
  const computeCoverRatio = useCallback(() => {
    const video = remoteVideoRef.current;
    const container = remoteContainerRef.current;
    if (!video || !container || !video.videoWidth || !video.videoHeight) return 1;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    // contain scale
    const containScale = Math.min(cW / vW, cH / vH);
    // cover scale
    const coverScale = Math.max(cW / vW, cH / vH);
    return coverScale / containScale;
  }, []);

  const enterZoom = useCallback((tapX, tapY) => {
    const ratio = computeCoverRatio();
    coverRatioRef.current = ratio;
    setZoomScale(ratio);
    setZoomOrigin({ x: tapX, y: tapY });
    setZoomMode(true);
    logger.info('zoom-enter', { tapX, tapY, coverRatio: ratio });
  }, [computeCoverRatio, logger]);

  const exitZoom = useCallback(() => {
    setZoomMode(false);
    setZoomScale(1);
    setZoomOrigin({ x: 0.5, y: 0.5 });
    logger.info('zoom-exit');
  }, [logger]);

  const handleZoomTap = useCallback((x, y) => {
    setZoomOrigin({ x, y });
    logger.debug('zoom-recenter', { x, y });
  }, [logger]);

  const handleZoomPan = useCallback((dx, dy) => {
    setZoomOrigin(prev => ({
      x: Math.max(0, Math.min(1, prev.x + dx)),
      y: Math.max(0, Math.min(1, prev.y + dy)),
    }));
  }, []);

  const handleZoomPinch = useCallback((scaleDelta) => {
    setZoomScale(prev => {
      const minScale = coverRatioRef.current;
      const maxScale = coverRatioRef.current * 4;
      return Math.max(minScale, Math.min(maxScale, prev * scaleDelta));
    });
  }, []);

  useZoomGestures(remoteContainerRef, {
    enabled: zoomMode,
    onTap: handleZoomTap,
    onPan: handleZoomPan,
    onPinch: handleZoomPinch,
  });

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

  // Attach remote stream to a single <video> element (NOT muted).
  // Standard WebRTC pattern: full stream with audio+video on one element.
  //
  // ALSO route audio through Web Audio API as a parallel speaker output.
  // Android Chrome may route <video> WebRTC audio to the earpiece (phone
  // call mode). AudioContext always outputs to the main speaker, so we
  // pipe the audio through both paths to guarantee audibility.
  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);

  useEffect(() => {
    if (!peer.remoteStream) return;
    const tracks = peer.remoteStream.getTracks();
    const details = tracks.map(t => ({
      kind: t.kind, enabled: t.enabled, muted: t.muted,
      readyState: t.readyState, id: t.id.slice(0, 8)
    }));
    logger.info('remote-stream-attached', { trackCount: tracks.length, tracks: details });

    if (!remoteVideoRef.current) {
      logger.warn('remote-video-ref-missing');
      return;
    }

    // 1. Set the full stream on the <video> element (has video + audio).
    const el = remoteVideoRef.current;
    el.srcObject = peer.remoteStream;
    logger.info('remote-srcobject-set', {
      elMuted: el.muted, elVolume: el.volume, elPaused: el.paused
    });

    // Explicitly play — catches autoplay policy blocks.
    const playPromise = el.play();
    if (playPromise) {
      playPromise.then(() => {
        logger.info('remote-video-playing', {
          muted: el.muted, volume: el.volume, paused: el.paused,
          audioTracks: peer.remoteStream.getAudioTracks().length,
          videoTracks: peer.remoteStream.getVideoTracks().length
        });
      }).catch(err => {
        logger.error('remote-video-play-failed', { error: err.message, name: err.name });
      });
    }

    // 2. Web Audio API speaker route — guarantees main speaker on Android.
    //    AudioContext bypasses the telephony audio path that Chrome uses
    //    for <video> elements playing WebRTC streams.
    const audioTracks = peer.remoteStream.getAudioTracks();
    if (audioTracks.length > 0) {
      try {
        // Clean up previous AudioContext if stream changed.
        if (audioSourceRef.current) {
          audioSourceRef.current.disconnect();
          audioSourceRef.current = null;
        }
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        // Resume AudioContext (required after user gesture on mobile).
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
        source.connect(ctx.destination);
        audioSourceRef.current = source;
        logger.info('web-audio-speaker-route', {
          state: ctx.state, sampleRate: ctx.sampleRate,
          audioTrackCount: audioTracks.length
        });
      } catch (err) {
        logger.warn('web-audio-speaker-failed', { error: err.message });
      }
    }

    return () => {
      // Cleanup: disconnect source when stream changes or component unmounts.
      if (audioSourceRef.current) {
        try { audioSourceRef.current.disconnect(); } catch (_) {}
        audioSourceRef.current = null;
      }
    };
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
    resetWakeProgress();
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
  }, [reset, resetWakeProgress, hangUp, logger, isOwner]);

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
      logger.info('wake-result', { targetDeviceId, ok: result.ok, failedStep: result.failedStep });

      if (!result.ok) {
        setWaking(false);
        if (result.allowOverride) {
          setWakeError(result.error || 'Display did not respond');
        } else {
          setWakeError(result.error || 'Could not wake device');
        }
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
      <div className={`call-app__local ${isConnected ? 'call-app__local--pip' : 'call-app__local--inset'}`}>
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
      <div
        ref={remoteContainerRef}
        className={`call-app__remote${zoomMode ? ' call-app__remote--zoomed' : ''}`}
        onClick={!zoomMode && isConnected ? (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          enterZoom(x, y);
        } : undefined}
      >
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
          style={zoomMode ? {
            transform: `scale(${zoomScale})`,
            transformOrigin: `${zoomOrigin.x * 100}% ${zoomOrigin.y * 100}%`,
          } : undefined}
        />
        {zoomMode && (
          <button
            className="call-app__zoom-back"
            onClick={(e) => { e.stopPropagation(); exitZoom(); }}
            aria-label="Exit zoom"
          >
            &#x2190;
          </button>
        )}
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

      {/* Lobby content — device selection */}
      {isIdle && (
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

      {/* Connecting overlay — step tracker with real-time progress */}
      {isConnecting && (
        <div className="call-app__connecting-overlay">
          {wakeProgress ? (
            <div className="call-app__step-tracker">
              <StepRow label="Powering on TV" status={wakeProgress.power} />
              <StepRow label="Verifying display" status={wakeProgress.verify} />
              <StepRow label="Preparing kiosk" status={wakeProgress.prepare} />
              <StepRow label="Loading video call" status={wakeProgress.load} />
            </div>
          ) : (
            <p className="call-app__status-text">
              {waking ? 'Waking up TV...' : 'Establishing call...'}
            </p>
          )}
          {wakeProgress?.failReason && (
            <div className="call-app__timeout-msg">
              {wakeProgress.failReason}
            </div>
          )}
          {connectingTooLong && !wakeProgress?.failReason && (
            <div className="call-app__timeout-msg">
              TV is not responding. You can retry or cancel.
            </div>
          )}
          {(connectingTooLong || wakeProgress?.failReason) && (
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
