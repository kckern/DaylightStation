import React, { useRef, useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { useMediaDevices } from './hooks/useMediaDevices';
import { useWebcamStream } from './hooks/useWebcamStream';
import { useAudioProbe } from './hooks/useAudioProbe';
import { useNativeAudioBridge } from './hooks/useNativeAudioBridge';
import { useWebRTCPeer } from './hooks/useWebRTCPeer';
import { useCallSignaling } from './hooks/useCallSignaling.js';
import { useMediaHealth } from './hooks/useMediaHealth.js';
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

  const { videoRef, stream, error: cameraError } = useWebcamStream(selectedVideoDevice, effectiveAudioDevice, {
    videoResolution: inputConfig?.video_resolution,
    ready: configLoaded,
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
  const [callSession, setCallSession] = useState(null);
  const [remoteMuteState, setRemoteMuteState] = useState({ audioMuted: false, videoMuted: false });
  const peerConnected = connectionState === 'connected';
  const status = peerConnected ? 'connected' : callSession ? 'connecting' : 'waiting';
  const signaling = useCallSignaling({
    role: 'tv', session: callSession, peer,
    onEvent: event => {
      if (event.type === 'mute-state') setRemoteMuteState({ audioMuted: !!event.audioMuted, videoMuted: !!event.videoMuted });
      if (event.type === 'hangup') { peer.reset(); setCallSession(null); clear?.(); }
    },
  });
  const [iceError, setIceError] = useState(null);
  // Why the TV is still waiting. On 2026-09-08 the join was refused 23 times
  // in a row and the camera denied, and the screen said only "Waiting" — which
  // from the sofa is indistinguishable from a crash.
  const [joinError, setJoinError] = useState(null);
  const [, setStatusVisible] = useState(true);
  const [callDuration, setCallDuration] = useState(0);

  const remoteVideoRef = useRef(null);

  // The lease only becomes active once BOTH peers have reported live media.
  // Until 2026-09-08 only the phone did, so every call was still in its
  // 180s setup window when the server expired it and restored the TV —
  // a connected call died at three minutes. Same monitor as the phone, one
  // report per verified result per peer revision.
  const health = useMediaHealth(peer, peerConnected, remoteVideoRef);
  const verifiedSentRef = useRef(null);
  useEffect(() => { verifiedSentRef.current = null; }, [callSession]);
  useEffect(() => {
    if (!callSession || !health.verified || !(health.audio || health.video)) return;
    const key = `${signaling.revisionRef.current}:${health.audio}:${health.video}`;
    if (verifiedSentRef.current === key) return;
    verifiedSentRef.current = key;
    const delivered = signaling.send('media-verified', { audio: health.audio, video: health.video });
    logger.info('media-verified', { callId: callSession.callId, audio: health.audio, video: health.video, delivered });
  }, [callSession, health, logger, signaling]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const join = async () => {
      try {
        const active = await DaylightAPI(`api/v1/homeline/devices/${deviceId}/join-active`, {}, 'POST');
        if (cancelled) return;
        setJoinError(null);
        if (active) {
          setCallSession({ ...active, peerId: active.tvPeerId, credential: active.tvCredential, peerRevision: 0 });
          logger.info('lease.joined', { callId: active.callId, attemptId: active.attemptId, dispatchId: active.dispatchId });
          return;
        }
      } catch (error) {
        if (!cancelled) {
          logger.warn('lease.join.failed', { reason: error.message });
          setJoinError(/DEVICE_ID_MISMATCH/.test(error.message) ? 'This screen is not recognised as the call TV'
            : 'Cannot reach the call service');
        }
      }
      if (!cancelled) timer = setTimeout(join, 2_000);
    };
    void join();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deviceId, logger]);

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
    logger.info('volume-duck', { deviceId, level: 5 });
    DaylightAPI(`api/v1/device/${deviceId}/volume/5`).catch(err =>
      logger.warn('volume-duck-failed', { deviceId, error: err.message })
    );
    return () => {
      logger.info('volume-restore', { deviceId, level: 50 });
      DaylightAPI(`api/v1/device/${deviceId}/volume/50`).catch(err =>
        logger.warn('volume-restore-failed', { deviceId, error: err.message })
      );
    };
  }, [peerConnected, deviceId, logger]);

  // AEC reference signal — tap remote audio and feed to main-thread AEC.
  //
  // The tap runs in an AudioWorklet, not a ScriptProcessorNode. The mic and
  // reference rings are paired by sample COUNT, so every reference sample the
  // tap fails to deliver shifts the two streams by that much for the rest of
  // the call. A ScriptProcessor's callback runs on the main thread and Chrome
  // drops it whenever that thread is busy (React render, video decode), 512
  // samples at a time; a few dozen drops push the reference behind the echo
  // it is meant to predict and Speex has nothing it can subtract. A worklet
  // process() runs on the audio thread and never skips; its port messages
  // queue rather than drop. The worklet also watches currentFrame so an
  // audio-thread underrun is zero-filled instead of silently lost.
  const refTapRef = useRef(null);

  useEffect(() => {
    const remoteStream = peer.remoteStream;
    if (!remoteStream || !bridgeActive) return;

    const audioTracks = remoteStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    let cancelled = false;
    const ctx = new AudioContext({ sampleRate: 48000 });
    // Android WebView starts AudioContext suspended — resume or the graph
    // never runs and AEC never gets reference data.
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
    const tapSource = `
class RefTapProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.expected = null; this.gaps = 0; this.gapSamples = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.expected !== null && currentFrame > this.expected) {
      const missing = currentFrame - this.expected;
      this.gaps += 1; this.gapSamples += missing;
      this.port.postMessage({ gap: missing, gaps: this.gaps, gapSamples: this.gapSamples });
      this.port.postMessage({ ref: new Float32Array(missing) });
    }
    this.expected = currentFrame + ch.length;
    const copy = new Float32Array(ch.length); copy.set(ch);
    this.port.postMessage({ ref: copy }, [copy.buffer]);
    return true;
  }
}
registerProcessor('ref-tap', RefTapProcessor);`;
    const blobUrl = URL.createObjectURL(new Blob([tapSource], { type: 'application/javascript' }));
    let node = null;
    let gapsReported = 0;
    (async () => {
      try {
        await ctx.audioWorklet.addModule(blobUrl);
        if (cancelled) return;
        node = new AudioWorkletNode(ctx, 'ref-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = event => {
          const msg = event.data;
          if (msg.ref) bridge.feedReference(msg.ref);
          else if (msg.gap && msg.gaps >= gapsReported + 10) {
            gapsReported = msg.gaps;
            logger.warn('aec-ref-gap', { gaps: msg.gaps, gapMs: Math.round(msg.gapSamples / 48) });
          }
        };
        // The worklet must be connected to the destination to be pulled;
        // its output is silenced so the tap is never audible.
        const muteGain = ctx.createGain();
        muteGain.gain.value = 0;
        source.connect(node);
        node.connect(muteGain);
        muteGain.connect(ctx.destination);
        refTapRef.current = { ctx, source, node, muteGain };
        logger.info('aec-ref-tap-started', { audioTracks: audioTracks.length, tap: 'worklet' });
      } catch (error) {
        logger.error('aec-ref-tap-failed', { error: error.message });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })();

    return () => {
      cancelled = true;
      const tap = refTapRef.current;
      if (tap) { tap.node.port.onmessage = null; tap.source.disconnect(); tap.node.disconnect(); tap.muteGain.disconnect(); }
      else source.disconnect();
      ctx.close().catch(() => {});
      refTapRef.current = null;
      logger.info('aec-ref-tap-stopped');
    };
    // narrowed to bridge.feedReference (the stable method), not the bridge object — this is a
    // live WebRTC echo-cancellation audio tap; real-time audio/hardware capture code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {!peerConnected && joinError && (
          <span className="videocall-tv__info-error">{joinError}</span>
        )}
        {!peerConnected && cameraError && (
          <span className="videocall-tv__info-error">TV camera unavailable</span>
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
