/**
 * usePoseLogger — Streams raw pose keypoints to backend via WebSocket
 *
 * Buffers ~1 second of frames and flushes as a single WS message.
 * Backend writes frames to JSONL files for offline analysis.
 */

import { useEffect, useRef, useCallback } from 'react';
import wsService from '@/services/WebSocketService.js';

export default function usePoseLogger({ poses, isDetecting, backend, modelType }) {
  const bufferRef = useRef([]);
  const flushTimerRef = useRef(null);

  const flush = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    const frames = bufferRef.current;
    bufferRef.current = [];
    wsService.send({ topic: 'pose_log', action: 'frames', frames });
  }, []);

  // Buffer incoming poses
  useEffect(() => {
    if (!isDetecting || !poses?.length) return;
    const pose = poses[0]; // primary pose
    if (!pose?.keypoints) return;
    bufferRef.current.push({ t: Date.now(), kp: pose.keypoints });
  }, [poses, isDetecting]);

  // Start/stop lifecycle
  useEffect(() => {
    if (isDetecting) {
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
