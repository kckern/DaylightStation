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

/* MUI-style SVG icons (24×24 viewBox, Material Design paths) */
const SvgIcon = ({ d, className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
    <path d={d} />
  </svg>
);

const STEP_DEFS = [
  { key: 'power',   label: 'Powering on TV',      icon: 'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0119 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.15.97-4.08 2.5-5.37L6.17 5.17A8.96 8.96 0 003 12c0 4.97 4.03 9 9 9s9-4.03 9-9a8.96 8.96 0 00-3.17-6.83z' },
  { key: 'prepare', label: 'Preparing kiosk',      icon: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z' },
  { key: 'load',    label: 'Loading video call',    icon: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z' },
  { key: 'media',   label: 'Verifying connection',  icon: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z' },
];

function WakeStepper({ progress }) {
  // Find the active step index (last non-null step, or 0)
  let activeIdx = 0;
  for (let i = STEP_DEFS.length - 1; i >= 0; i--) {
    if (progress[STEP_DEFS[i].key]) { activeIdx = i; break; }
  }
  const activeStep = STEP_DEFS[activeIdx];
  const activeStatus = progress[activeStep.key] || 'running';

  return (
    <div className="call-app__stepper">
      <div className="call-app__stepper-track">
        {STEP_DEFS.map((step, i) => {
          const status = progress[step.key];
          const isCurrent = i === activeIdx;
          const nodeClass = `call-app__stepper-node call-app__stepper-node--${status || 'pending'}${isCurrent ? ' call-app__stepper-node--current' : ''}`;

          return (
            <React.Fragment key={step.key}>
              {i > 0 && (
                <div className={`call-app__stepper-seg call-app__stepper-seg--${status === 'done' || status === 'running' || status === 'failed' ? 'filled' : 'empty'}`} />
              )}
              <div className={nodeClass}>
                {status === 'done' ? (
                  <SvgIcon d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" className="call-app__stepper-check" />
                ) : status === 'failed' ? (
                  <SvgIcon d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" className="call-app__stepper-x" />
                ) : (
                  <SvgIcon d={step.icon} className="call-app__stepper-icon" />
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className={`call-app__stepper-label call-app__stepper-label--${activeStatus}`}>
        {activeStatus === 'failed' ? progress.failReason || 'Failed' : activeStep.label}
        {activeStatus === 'running' && (
          <svg className="call-app__stepper-spinner" viewBox="0 0 18 18" width="14" height="14">
            <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="8" />
          </svg>
        )}
      </div>
    </div>
  );
}

export default function CallApp() {
  const logger = useMemo(() => getLogger().child({ component: 'CallApp' }), []);
  const {
    videoDevices,
    selectedVideoDevice,
    selectedAudioDevice,
    cycleVideoDevice,
  } = useMediaDevices();

  const { videoRef: localVideoRef, stream, error } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const peer = useWebRTCPeer(stream);
  const { connectionState } = peer;
  const { peerConnected, status, connect, hangUp, sendMuteState, remoteMuteState } = useHomeline('phone', null, peer);
  const { audioMuted, videoMuted, toggleAudio, toggleVideo, reset } = useMediaControls(stream);

  // Mirror only front-facing cameras. facingMode is "user" (front), "environment" (back),
  // or undefined (desktop/USB — treat as front).
  const isFrontCamera = useMemo(() => {
    const facingMode = stream?.getVideoTracks()[0]?.getSettings()?.facingMode;
    return facingMode !== 'environment';
  }, [stream, selectedVideoDevice]);

  const [devices, setDevices] = useState(null); // null = loading, [] = none found
  const [waking, setWaking] = useState(false);
  const [connectingTooLong, setConnectingTooLong] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(null);
  const [iceError, setIceError] = useState(null);
  const [wakeError, setWakeError] = useState(null);
  const [wakeAllowOverride, setWakeAllowOverride] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const connectedDeviceRef = useRef(null);
  const coldWakeRef = useRef(false);
  const { isOwner } = useCallOwnership(activeDeviceId);
  const { progress: wakeProgress, reset: resetWakeProgress } = useWakeProgress(
    (waking || status === 'connecting') ? activeDeviceId : null
  );

  const remoteVideoRef = useRef(null);
  const [remoteVerified, setRemoteVerified] = useState(false);
  const [transitionReady, setTransitionReady] = useState(false);

  // Verify remote stream has live video + audio tracks before transitioning to dual view.
  // Gates the "connected" state so we don't show an empty remote panel.
  useEffect(() => {
    if (!peerConnected || !peer.remoteStream) {
      setRemoteVerified(false);
      return;
    }

    const check = () => {
      const stream = peer.remoteStream;
      const hasVideo = stream.getVideoTracks().some(t => t.readyState === 'live');
      const hasAudio = stream.getAudioTracks().some(t => t.readyState === 'live');
      if (hasVideo && hasAudio) {
        logger.info('remote-media-verified', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        });
        setRemoteVerified(true);
      }
      return hasVideo && hasAudio;
    };

    // Check immediately (tracks may already be present)
    if (check()) return;

    // Poll every 200ms until tracks arrive
    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 200);

    // Timeout: proceed anyway after 8s — don't block forever
    const timeout = setTimeout(() => {
      clearInterval(interval);
      logger.warn('remote-media-timeout', { elapsed: '8s' });
      setRemoteVerified(true);
    }, 8000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [peerConnected, peer.remoteStream, logger]);

  // Merge backend wake progress with frontend media verification step
  const displayProgress = useMemo(() => {
    if (!wakeProgress) return null;
    const loadDone = wakeProgress?.load === 'done';
    const mediaStatus = remoteVerified ? 'done'
      : (loadDone || peerConnected) ? 'running'
      : null;
    return { ...wakeProgress, media: mediaStatus };
  }, [wakeProgress, peerConnected, remoteVerified]);

  // Brief delay after all steps complete before transitioning to the call UI,
  // so the user sees the final checkmark before the stepper disappears.
  useEffect(() => {
    if (!remoteVerified) {
      setTransitionReady(false);
      return;
    }
    const timer = setTimeout(() => setTransitionReady(true), 1200);
    return () => clearTimeout(timer);
  }, [remoteVerified]);

  const remoteContainerRef = useRef(null);
  const [zoomMode, setZoomMode] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoomScale, setZoomScale] = useState(1);
  const zoomScaleRef = useRef(1);
  const coverRatioRef = useRef(1);

  // Keep scale ref in sync for use inside gesture callbacks (avoids stale closures).
  useEffect(() => { zoomScaleRef.current = zoomScale; }, [zoomScale]);

  // Get the rendered video dimensions inside the contain-fitted element.
  const getVideoMetrics = useCallback(() => {
    const video = remoteVideoRef.current;
    const container = remoteContainerRef.current;
    if (!video || !container || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const containScale = Math.min(cW / vW, cH / vH);
    const rvW = vW * containScale; // rendered video width at contain
    const rvH = vH * containScale; // rendered video height at contain
    const coverRatio = Math.max(cW / vW, cH / vH) / containScale;
    return { cW, cH, rvW, rvH, coverRatio };
  }, []);

  // Clamp pan offset so the scaled video always covers the viewport.
  // |tx| <= (rvW * scale - cW) / 2, |ty| <= (rvH * scale - cH) / 2
  const clampPan = useCallback((tx, ty, scale) => {
    const m = getVideoMetrics();
    if (!m) return { x: 0, y: 0 };
    const maxTx = Math.max(0, (m.rvW * scale - m.cW) / 2);
    const maxTy = Math.max(0, (m.rvH * scale - m.cH) / 2);
    return {
      x: Math.max(-maxTx, Math.min(maxTx, tx)),
      y: Math.max(-maxTy, Math.min(maxTy, ty)),
    };
  }, [getVideoMetrics]);

  const enterZoom = useCallback(() => {
    setZoomMode(true);
    logger.info('zoom-enter');
  }, [logger]);

  const exitZoom = useCallback(() => {
    setZoomMode(false);
    setZoomScale(1);
    zoomScaleRef.current = 1;
    setPanOffset({ x: 0, y: 0 });
    logger.info('zoom-exit');
  }, [logger]);

  // After zoom layout renders, calculate cover ratio from the now-fullscreen container
  // and set the initial scale to fill the viewport.
  useEffect(() => {
    if (!zoomMode) return;

    // Use rAF to ensure the browser has applied the fullscreen layout
    const raf = requestAnimationFrame(() => {
      const m = getVideoMetrics();
      if (m) {
        coverRatioRef.current = m.coverRatio;
        setZoomScale(m.coverRatio);
        zoomScaleRef.current = m.coverRatio;
        setPanOffset({ x: 0, y: 0 });
        logger.info('zoom-cover-applied', { coverRatio: m.coverRatio, cW: m.cW, cH: m.cH });
      } else {
        logger.warn('zoom-cover-no-metrics');
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [zoomMode, getVideoMetrics, logger]);

  // Tap to recenter: compute translate so the tapped point becomes viewport center.
  // Tap coords (x, y) are fractions of the element's visual bounds (getBoundingClientRect).
  const handleZoomTap = useCallback((x, y) => {
    const S = zoomScaleRef.current;
    const container = remoteContainerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    // Map screen tap to video content coordinates accounting for current pan,
    // then compute the pan offset that centers that video point on screen.
    // newTX = currentTX + (0.5 - x) * cW
    setPanOffset(prev => clampPan(prev.x + (0.5 - x) * cW, prev.y + (0.5 - y) * cH, S));
    logger.debug('zoom-recenter', { x, y });
  }, [clampPan, logger]);

  // Drag to pan: convert fractional deltas to pixel deltas for 1:1 finger tracking.
  // Hook sends (-pointerDelta / visualWidth), so pixel delta = -dx * cW * S.
  const handleZoomPan = useCallback((dx, dy) => {
    const S = zoomScaleRef.current;
    const container = remoteContainerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    setPanOffset(prev => clampPan(prev.x - dx * cW * S, prev.y - dy * cH * S, S));
  }, [clampPan]);

  // Pinch to zoom: adjust scale and translate so the pinch center stays fixed on screen.
  const handleZoomPinch = useCallback((scaleDelta, cx, cy) => {
    const container = remoteContainerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const S = zoomScaleRef.current;
    const minScale = coverRatioRef.current;
    const maxScale = coverRatioRef.current * 4;
    const newScale = Math.max(minScale, Math.min(maxScale, S * scaleDelta));
    const actualDelta = newScale / S;
    // Adjust pan so pinch center stays fixed: TX' = TX + cW*S*(cx-0.5)*(1-actualDelta)
    setPanOffset(prev => {
      const newTx = prev.x + cW * S * (cx - 0.5) * (1 - actualDelta);
      const newTy = prev.y + cH * S * (cy - 0.5) * (1 - actualDelta);
      return clampPan(newTx, newTy, newScale);
    });
    setZoomScale(newScale);
    zoomScaleRef.current = newScale;
  }, [clampPan]);

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

  // User-facing connection timeout (15s normal, 35s cold wake)
  useEffect(() => {
    if (status !== 'connecting') {
      setConnectingTooLong(false);
      return;
    }
    const timeoutMs = coldWakeRef.current ? 35_000 : 15_000;
    const timer = setTimeout(() => setConnectingTooLong(true), timeoutMs);
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

    // Don't attach an empty stream — wait for tracks to arrive.
    // Setting srcObject with 0 tracks then re-setting with 2 tracks
    // causes play() AbortError (interrupted by new load request).
    if (tracks.length === 0) return;

    // Log received track settings to trace aspect ratio through the pipeline
    const videoTrack = peer.remoteStream.getVideoTracks()[0];
    if (videoTrack) {
      const s = videoTrack.getSettings?.() || {};
      logger.info('remote-video-track-settings', {
        w: s.width, h: s.height, aspectRatio: s.aspectRatio, frameRate: s.frameRate,
      });
    }

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
    // AbortError is benign (stream changed mid-play); retry once after short delay.
    const playPromise = el.play();
    if (playPromise) {
      playPromise.then(() => {
        logger.info('remote-video-playing', {
          muted: el.muted, volume: el.volume, paused: el.paused,
          audioTracks: peer.remoteStream.getAudioTracks().length,
          videoTracks: peer.remoteStream.getVideoTracks().length
        });
      }).catch(err => {
        if (err.name === 'AbortError') {
          logger.debug('remote-video-play-abort-retry');
          setTimeout(() => {
            if (el.paused && el.srcObject) el.play().catch(() => {});
          }, 100);
        } else {
          logger.error('remote-video-play-failed', { error: err.message, name: err.name });
        }
      });
    }

    // Log video dimensions once intrinsic size is known
    const onResize = () => {
      if (el.videoWidth && el.videoHeight) {
        logger.info('remote-video-dimensions', {
          intrinsic: { w: el.videoWidth, h: el.videoHeight },
          element: { w: el.clientWidth, h: el.clientHeight },
          aspectRatio: (el.videoWidth / el.videoHeight).toFixed(3),
        });
      }
    };
    el.addEventListener('resize', onResize);
    // Also check immediately in case dimensions are already set
    onResize();

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
      el.removeEventListener('resize', onResize);
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
    exitZoom();
    resetWakeProgress();
    coldWakeRef.current = false;
    setRemoteVerified(false);
    setTransitionReady(false);
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
  }, [reset, exitZoom, resetWakeProgress, hangUp, logger, isOwner]);

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
        setWakeAllowOverride(!!result.allowOverride);
        setWakeError(result.error || 'Could not wake device');
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
    coldWakeRef.current = !!result.coldWake;
    connect(targetDeviceId, { coldWake: !!result.coldWake });
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
  const isConnecting = status === 'connecting' || waking || (peerConnected && !transitionReady);
  const isConnected = !isIdle && !isConnecting && !wakeError && transitionReady;

  const handleRemoteClick = useCallback(() => {
    if (zoomMode || !isConnected) return;
    enterZoom();
  }, [zoomMode, isConnected, enterZoom]);

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
          style={isFrontCamera ? { transform: 'scaleX(-1)' } : undefined}
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
        onClick={handleRemoteClick}
      >
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
          style={zoomMode ? {
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
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
          className={`call-app__ctrl-btn ${audioMuted ? 'call-app__ctrl-btn--active' : ''}`}
          onClick={handleToggleAudio}
          aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
        >
          <SvgIcon d={audioMuted
            ? 'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z'
            : 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z'
          } />
        </button>
        <button
          className={`call-app__ctrl-btn ${videoMuted ? 'call-app__ctrl-btn--active' : ''}`}
          onClick={handleToggleVideo}
          aria-label={videoMuted ? 'Enable video' : 'Disable video'}
        >
          <SvgIcon d={videoMuted
            ? 'M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z'
            : 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z'
          } />
        </button>
        <button className="call-app__ctrl-btn call-app__ctrl-btn--hangup" onClick={endCall} aria-label="Hang up">
          <SvgIcon d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </button>
        {videoDevices.length > 1 && (
          <button
            className="call-app__ctrl-btn"
            onClick={() => cycleVideoDevice()}
            aria-label="Switch camera"
          >
            <SvgIcon d="M20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 11.5V13H9v2.5L5.5 12 9 8.5V11h6V8.5l3.5 3.5-3.5 3.5z" />
          </button>
        )}
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
              setWakeAllowOverride(false);
              const devId = connectedDeviceRef.current;
              if (devId) dropIn(devId);
            }}
          >
            {cooldown ? 'Wait...' : 'Try Again'}
          </button>
          {wakeAllowOverride && (
            <button
              className="call-app__device-btn"
              onClick={() => {
                setWakeError(null);
                setWakeAllowOverride(false);
                const devId = connectedDeviceRef.current;
                if (devId) {
                  setWaking(false);
                  connect(devId);
                }
              }}
            >
              Connect anyway
            </button>
          )}
          <button className="call-app__cancel" onClick={() => {
            setWakeError(null);
            setWakeAllowOverride(false);
            connectedDeviceRef.current = null;
            setActiveDeviceId(null);
          }}>
            Cancel
          </button>
        </div>
      )}

      {/* Connecting overlay — vertical stepper with real-time progress */}
      {isConnecting && (
        <div className="call-app__connecting-overlay">
          {displayProgress ? (
            <WakeStepper progress={displayProgress} />
          ) : (
            <p className="call-app__status-text">
              {waking ? 'Waking up TV...' : 'Establishing call...'}
            </p>
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
