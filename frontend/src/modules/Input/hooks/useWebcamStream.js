import { useState, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useWebcamStream' });
  return _logger;
}

// 16:9 resolution tiers, highest first. When a configured resolution fails
// (OverconstrainedError) or framerate drops below threshold, we step down.
const RESOLUTION_TIERS = [
  { w: 3840, h: 2160, label: '4K' },
  { w: 1920, h: 1080, label: '1080p' },
  { w: 1280, h: 720,  label: '720p' },
];

const LOW_FPS_THRESHOLD = 10;
const FPS_CHECK_INTERVAL_MS = 5000;
const FPS_CHECK_INITIAL_DELAY_MS = 8000;

function buildVideoConstraint(deviceId, tier) {
  const c = {};
  if (deviceId) c.deviceId = { exact: deviceId };
  c.width = { min: tier.w };
  c.height = { min: tier.h };
  c.aspectRatio = { exact: 16 / 9 };
  return c;
}

function buildAudioConstraint(selectedAudioDevice) {
  if (selectedAudioDevice != null) return { deviceId: { exact: selectedAudioDevice } };
  if (selectedAudioDevice === null) return false;
  return true;
}

export const useWebcamStream = (selectedVideoDevice, selectedAudioDevice, options = {}) => {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const { videoResolution } = options;

  // Track current tier index so FPS monitor can step down
  const tierIdxRef = useRef(0);
  const streamRef = useRef(null);

  useEffect(() => {
    let localStream = null;
    let fpsTimer = null;
    let cancelled = false;

    // Find the starting tier that matches the configured resolution (or default 720p)
    const startTierIdx = videoResolution?.width
      ? RESOLUTION_TIERS.findIndex(t => t.w <= videoResolution.width)
      : RESOLUTION_TIERS.length - 1; // 720p
    tierIdxRef.current = Math.max(0, startTierIdx);

    const acquireStream = async (tierIdx) => {
      if (cancelled) return null;

      // Stop existing tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      const audio = buildAudioConstraint(selectedAudioDevice);

      // Try each tier from tierIdx downward
      for (let i = tierIdx; i < RESOLUTION_TIERS.length; i++) {
        if (cancelled) return null;
        const tier = RESOLUTION_TIERS[i];
        try {
          const constraints = { video: buildVideoConstraint(selectedVideoDevice, tier), audio };
          logger().info('stream-attempt', { tier: tier.label, w: tier.w, h: tier.h });

          const s = await navigator.mediaDevices.getUserMedia(constraints);
          tierIdxRef.current = i;

          const videoTrack = s.getVideoTracks()[0];
          const vSettings = videoTrack?.getSettings?.() || {};
          logger().info('stream-acquired', {
            tier: tier.label,
            tracks: s.getTracks().map(t => ({
              kind: t.kind, label: t.label, enabled: t.enabled,
              muted: t.muted, readyState: t.readyState,
            })),
            videoSettings: {
              w: vSettings.width, h: vSettings.height,
              aspectRatio: vSettings.aspectRatio, frameRate: vSettings.frameRate,
            },
            videoDevice: selectedVideoDevice?.slice(0, 8),
            audioDevice: selectedAudioDevice?.slice(0, 8),
          });

          return s;
        } catch (err) {
          logger().warn('stream-tier-failed', { tier: tier.label, error: err.message });
        }
      }

      // All tiers exhausted — bare minimum fallback (no resolution constraint)
      logger().warn('stream-fallback-bare');
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : true,
          audio,
        });
        const fbTracks = s.getTracks();
        logger().info('stream-acquired-fallback', {
          tracks: fbTracks.map(t => ({ kind: t.kind, label: t.label, enabled: t.enabled,
            muted: t.muted, readyState: t.readyState })),
        });
        tierIdxRef.current = RESOLUTION_TIERS.length; // past all tiers
        return s;
      } catch (fallbackErr) {
        logger().error('webcam.access-error-final', { error: fallbackErr.message });
        return null;
      }
    };

    // FPS monitor — checks actual framerate and steps down if consistently low
    const startFpsMonitor = (s) => {
      const videoTrack = s.getVideoTracks()[0];
      if (!videoTrack) return;
      let lastFrameCount = null;
      let lastCheckTime = null;

      fpsTimer = setInterval(() => {
        if (cancelled || videoTrack.readyState !== 'live') {
          clearInterval(fpsTimer);
          return;
        }
        // ImageCapture-based frame counting isn't available everywhere;
        // use getSettings().frameRate as a live indicator when available,
        // otherwise use track stats from the video element.
        const settings = videoTrack.getSettings?.() || {};
        const reportedFps = settings.frameRate;

        // Also check via video element frame count (more reliable)
        const videoEl = videoRef.current;
        const now = performance.now();
        let measuredFps = null;
        if (videoEl && typeof videoEl.getVideoPlaybackQuality === 'function') {
          const q = videoEl.getVideoPlaybackQuality();
          if (lastFrameCount !== null && lastCheckTime !== null) {
            const elapsed = (now - lastCheckTime) / 1000;
            if (elapsed > 0) measuredFps = (q.totalVideoFrames - lastFrameCount) / elapsed;
          }
          lastFrameCount = q.totalVideoFrames;
          lastCheckTime = now;
        }

        const fps = measuredFps ?? reportedFps;
        if (fps == null) return;

        logger().debug('stream-fps-check', {
          fps: Math.round(fps),
          tier: RESOLUTION_TIERS[tierIdxRef.current]?.label || 'bare',
          measuredFps: measuredFps != null ? Math.round(measuredFps) : null,
          reportedFps,
        });

        if (fps < LOW_FPS_THRESHOLD && tierIdxRef.current < RESOLUTION_TIERS.length - 1) {
          const nextIdx = tierIdxRef.current + 1;
          const nextTier = RESOLUTION_TIERS[nextIdx];
          logger().warn('stream-fps-downgrade', {
            fps: Math.round(fps),
            from: RESOLUTION_TIERS[tierIdxRef.current]?.label,
            to: nextTier.label,
          });
          clearInterval(fpsTimer);
          // Re-acquire at lower tier
          acquireStream(nextIdx).then(newStream => {
            if (cancelled || !newStream) return;
            localStream = newStream;
            streamRef.current = newStream;
            setStream(newStream);
            if (videoRef.current) {
              videoRef.current.srcObject = new MediaStream(newStream.getVideoTracks());
            }
            startFpsMonitor(newStream);
          });
        }
      }, FPS_CHECK_INTERVAL_MS);
    };

    const init = async () => {
      localStream = await acquireStream(tierIdxRef.current);
      if (cancelled || !localStream) {
        if (!cancelled) setError(new Error('No camera available'));
        return;
      }

      streamRef.current = localStream;
      setStream(localStream);
      setError(null);

      if (videoRef.current) {
        videoRef.current.srcObject = new MediaStream(localStream.getVideoTracks());
      }

      // Delay FPS monitoring to let the encoder settle
      if (videoResolution?.width) {
        setTimeout(() => {
          if (!cancelled && streamRef.current) startFpsMonitor(streamRef.current);
        }, FPS_CHECK_INITIAL_DELAY_MS);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (fpsTimer) clearInterval(fpsTimer);
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [selectedVideoDevice, selectedAudioDevice, videoResolution?.width, videoResolution?.height]);

  return { videoRef, stream, error };
};
