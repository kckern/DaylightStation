import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { usePoseProvider } from '../../hooks/usePoseProvider.js';
import { Webcam } from '../../components/FitnessWebcam.jsx';

const DETECTOR_ID = 'skyline-invaders-aim';
const METRICS_EVERY_MS = 5000;
const START_DELAY_MS = 200;   // same settle delay as PoseDemo
const VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' };
// Kept in the layout at one pixel, not display:none: a browser may stop
// decoding frames for a video that is not rendered.
const HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' };

const messageOf = (error) => (error ? error.message || String(error) : null);

// The only PoseContext consumer in the game. PoseProvider changes its context
// value on every pose, so anything that reads it re-renders at the pose rate.
// This component renders one hidden <video> and nothing else; poses reach the
// game through tracker.processPoses, never through React state.
export default function InvadersPoseBridge({ tracker, enabled = true, onStatus }) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-pose' }), []);
  const pose = usePoseProvider({ autoStart: false });
  const webcamRef = useRef(null);
  const deniedRef = useRef(false);
  const streamReadyRef = useRef(false);
  const startTimerRef = useRef(null);
  const lastRef = useRef({ state: null, at: 0 });
  // The provider's start/stop change identity with its config. Read through a
  // ref so they never re-run an effect or hand the webcam a new callback.
  const live = useRef({});
  live.current = { start: pose.start, stop: pose.stop, setVideoSource: pose.setVideoSource, enabled, onStatus };
  const { registerMoveDetector, unregisterMoveDetector } = pose;

  useEffect(() => {
    registerMoveDetector({ id: DETECTOR_ID, processPoses: tracker.processPoses });
    return () => unregisterMoveDetector(DETECTOR_ID);
  }, [registerMoveDetector, unregisterMoveDetector, tracker]);

  useEffect(() => {
    if (!enabled) { clearTimeout(startTimerRef.current); live.current.stop(); return; }
    if (streamReadyRef.current) live.current.start();   // re-enabled with the camera already up
  }, [enabled]);

  useEffect(() => () => clearTimeout(startTimerRef.current), []);

  const onStreamReady = useCallback(() => {
    const video = webcamRef.current?.getVideoElement?.();
    if (!video) return;
    streamReadyRef.current = true;
    deniedRef.current = false;
    live.current.setVideoSource(video);
    log.info('skyline_invaders.pose.camera_ready', { enabled: live.current.enabled });
    if (!live.current.enabled) return;
    clearTimeout(startTimerRef.current);
    startTimerRef.current = setTimeout(() => { if (live.current.enabled) live.current.start(); }, START_DELAY_MS);
  }, [log]);

  const onError = useCallback((error) => {
    deniedRef.current = true;
    log.warn('skyline_invaders.pose.camera_unavailable', { error: messageOf(error) });
    lastRef.current = { state: 'camera-denied', at: Date.now() };
    live.current.onStatus?.({ state: 'camera-denied', error: messageOf(error) });
  }, [log]);

  const state = deniedRef.current ? 'camera-denied' : pose.error ? 'error' : pose.isDetecting ? 'detecting' : 'loading';
  // Runs after every render (the pose rate) and speaks only on a state change,
  // or every few seconds with fresh metrics, so the game is not re-rendered per pose.
  useEffect(() => {
    const now = Date.now();
    const changed = lastRef.current.state !== state;
    if (!changed && (state !== 'detecting' || now - lastRef.current.at < METRICS_EVERY_MS)) return;
    lastRef.current = { state, at: now };
    const status = { state, fps: pose.fps, latency: pose.latency, backend: pose.backend, modelType: pose.modelType, error: messageOf(pose.error) };
    if (state === 'detecting') log.sampled('skyline_invaders.pose.metrics', status, { maxPerMinute: 12 });
    else if (changed) log.info('skyline_invaders.pose.state', status);
    onStatus?.(status);
  });

  return (
    <div className="skyline-invaders__camera" aria-hidden="true" style={HIDDEN}>
      <Webcam ref={webcamRef} onStreamReady={onStreamReady} onError={onError} videoConstraints={VIDEO} audioConstraints={false} />
    </div>
  );
}
