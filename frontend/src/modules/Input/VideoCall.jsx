import React, { useRef, useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { useMediaDevices } from './hooks/useMediaDevices';
import { useWebcamStream } from './hooks/useWebcamStream';
import { useAudioProbe } from './hooks/useAudioProbe';
import { useNativeAudioBridge } from './hooks/useNativeAudioBridge';
import { useWebRTCPeer } from './hooks/useWebRTCPeer';
import { useHomeline } from './hooks/useHomeline';
import getLogger from '../../lib/logging/Logger.js';
import './VideoCall.scss';

export default function VideoCall({ deviceId, clear }) {
  const logger = useMemo(() => getLogger().child({ component: 'VideoCall', deviceId }), [deviceId]);

  // Fetch device-specific input config (preferred camera/mic, audio bridge)
  const [inputConfig, setInputConfig] = useState(undefined);
  useEffect(() => {
    DaylightAPI('api/v1/device/config')
      .then(config => {
        const devices = config?.devices || config || {};
        const dev = devices[deviceId];
        if (dev?.input) {
          setInputConfig(dev.input);
          logger.info('device-input-config', { deviceId, hasAudioBridge: !!dev.input.audio_bridge });
        } else {
          setInputConfig(null);
          logger.info('device-input-config', { deviceId, hasAudioBridge: false });
        }
      })
      .catch(err => {
        setInputConfig(null);
        logger.warn('device-config-fetch-failed', { error: err.message });
      });
  }, [deviceId, logger]);

  const audioBridgeConfig = inputConfig?.audio_bridge || null;

  const {
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices({
    preferredCameraPattern: inputConfig?.preferred_camera,
    preferredMicPattern: inputConfig?.preferred_mic,
  });

  // ── Audio source strategy: bridge-first when configured ──
  const configLoaded = inputConfig !== undefined;
  const hasBridge = !!audioBridgeConfig;

  // Enable bridge immediately when configured (don't wait for probe)
  const bridge = useNativeAudioBridge({
    enabled: configLoaded && hasBridge,
    url: audioBridgeConfig?.url,
    gain: audioBridgeConfig?.gain,
    aec: audioBridgeConfig?.aec,
  });

  // Suppress probe while bridge is being attempted:
  //   - Config not loaded → suppress (don't probe before we know if bridge exists)
  //   - Bridge configured and not terminal → suppress (avoid getUserMedia locking MIC)
  //   - Bridge 'unavailable' (code 1011) → unsuppress (fallback to probe)
  //   - No bridge configured → unsuppress (probe as normal)
  const bridgeTerminal = bridge.status === 'unavailable';
  const suppressProbe = !configLoaded || (hasBridge && !bridgeTerminal);

  const probe = useAudioProbe(suppressProbe ? [] : audioDevices, {
    preferredDeviceId: selectedAudioDevice,
  });

  // When probe finds a working device, use it. When bridge is active, disable
  // getUserMedia audio (video-only) and merge bridge audio separately.
  const bridgeActive = bridge.status === 'connected';
  const effectiveAudioDevice = bridgeActive ? null : (probe.workingDeviceId || selectedAudioDevice);

  const { videoRef, stream } = useWebcamStream(selectedVideoDevice, effectiveAudioDevice, {
    videoResolution: inputConfig?.video_resolution,
  });

  // Merge video-only stream with bridge audio for WebRTC.
  // Apply echoCancellation + noiseSuppression constraints on the bridge
  // audio track — Chrome's WebRTC encoder may honor these even for
  // non-getUserMedia tracks, using the speaker output as AEC reference.
  const mergedStream = useMemo(() => {
    if (!stream) return null;
    if (!bridgeActive || !bridge.stream) return stream;
    const ms = new MediaStream(stream.getVideoTracks());
    bridge.stream.getAudioTracks().forEach(t => {
      t.applyConstraints({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }).catch(() => {});
      ms.addTrack(t);
    });
    return ms;
  }, [stream, bridgeActive, bridge.stream]);

  const peer = useWebRTCPeer(mergedStream);
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
    logger.debug('status-change', { status, peerConnected, bridgeStatus: bridge.status });
  }, [logger, status, peerConnected, bridge.status]);

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

  // Volume ducking — lower TV volume when call connects, restore on disconnect
  useEffect(() => {
    if (!peerConnected) return;
    logger.info('volume-duck', { deviceId, level: 12 });
    DaylightAPI(`api/v1/device/${deviceId}/volume/12`).catch(err =>
      logger.warn('volume-duck-failed', { deviceId, error: err.message })
    );
    return () => {
      logger.info('volume-restore', { deviceId, level: 50 });
      DaylightAPI(`api/v1/device/${deviceId}/volume/50`).catch(err =>
        logger.warn('volume-restore-failed', { deviceId, error: err.message })
      );
    };
  }, [peerConnected, deviceId, logger]);

  // AEC reference signal — tap remote audio and feed to main-thread AEC
  const refTapRef = useRef(null);

  useEffect(() => {
    const remoteStream = peer.remoteStream;
    if (!remoteStream || !bridgeActive) return;

    const audioTracks = remoteStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    // Create a separate AudioContext for the reference tap.
    // ScriptProcessorNode extracts PCM frames from the remote audio stream
    // and feeds them to the main-thread AEC via bridge.feedReference().
    const ctx = new AudioContext({ sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));

    // ScriptProcessor to extract frames. Deprecated but universally supported
    // and simpler than a second AudioWorklet module for this use case.
    const processor = ctx.createScriptProcessor(512, 1, 1);

    // Mute the tap output — we only need the reference data, not audible output.
    // ScriptProcessor requires being connected to destination to fire callbacks.
    const muteGain = ctx.createGain();
    muteGain.gain.value = 0;

    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(ctx.destination);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      bridge.feedReference(copy);
    };

    logger.info('aec-ref-tap-started', { audioTracks: audioTracks.length });
    refTapRef.current = { ctx, source, processor, muteGain };

    return () => {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      muteGain.disconnect();
      ctx.close().catch(() => {});
      refTapRef.current = null;
      logger.info('aec-ref-tap-stopped');
    };
  }, [peer.remoteStream, bridgeActive, bridge.feedReference, logger]);

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

    </div>
  );
}
