/**
 * usePoseLogger — Streams raw pose keypoints to backend via WebSocket
 *
 * Buffers ~1 second of frames and flushes as a single WS message.
 * Backend writes frames to JSONL files for offline analysis.
 *
 * Compact format: keypoints as [x, y, z, score] arrays (no names),
 * decimated to ~15 FPS, floats rounded to reduce data volume ~75%.
 */

import { useEffect, useRef, useCallback } from 'react';
import wsService from '@/services/WebSocketService.js';

const MIN_FRAME_INTERVAL_MS = 66; // ~15 FPS decimation

function compactKeypoints(keypoints) {
  return keypoints.map(kp => [
    Math.round(kp.x * 10) / 10,      // x: 1 decimal
    Math.round(kp.y * 10) / 10,      // y: 1 decimal
    Math.round(kp.z),                 // z: integer
    Math.round(kp.score * 100) / 100  // score: 2 decimals
  ]);
}

export default function usePoseLogger({ poses, isDetecting, backend, modelType }) {
  const bufferRef = useRef([]);
  const flushTimerRef = useRef(null);
  const lastFrameTsRef = useRef(0);

  const flush = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    const frames = bufferRef.current;
    bufferRef.current = [];
    wsService.send({ topic: 'pose_log', action: 'frames', frames });
  }, []);

  // Buffer incoming poses with frame decimation
  useEffect(() => {
    if (!isDetecting || !poses?.length) return;
    const pose = poses[0]; // primary pose
    if (!pose?.keypoints) return;

    const now = Date.now();
    if (now - lastFrameTsRef.current < MIN_FRAME_INTERVAL_MS) return;
    lastFrameTsRef.current = now;

    bufferRef.current.push({ t: now, kp: compactKeypoints(pose.keypoints) });
  }, [poses, isDetecting]);

  // Start/stop lifecycle
  useEffect(() => {
    if (isDetecting) {
      lastFrameTsRef.current = 0;
      wsService.send({ topic: 'pose_log', action: 'start', backend, modelType });
      flushTimerRef.current = setInterval(flush, 1000);
    } else {
      flush();
      wsService.send({ topic: 'pose_log', action: 'stop' });
      clearInterval(flushTimerRef.current);
    }
    return () => {
      flush();
      clearInterval(flushTimerRef.current);
    };
  }, [isDetecting, flush, backend, modelType]);
}
