/**
 * Streams pose-log WebSocket messages into the established JSONL files.
 * This is an adapter because it owns file descriptors and filesystem layout.
 */
import path from 'path';
import {
  closeFileDescriptor,
  openFileForAppend,
  writeToFileDescriptor,
} from '#system/utils/FileIO.mjs';

const KEYPOINT_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
];

export function createPoseLogHandler(configService, logger) {
  const activeSessions = new Map();

  function getLogDir() {
    return path.join(configService.getMediaDir(), 'logs', 'poses', new Date().toISOString().slice(0, 10));
  }

  function closeSession(clientId) {
    const session = activeSessions.get(clientId);
    if (!session) return;
    try {
      writeToFileDescriptor(session.fd, JSON.stringify({ type: 'session_end', ts: Date.now() }) + '\n');
      closeFileDescriptor(session.fd);
    } catch { /* preserve fail-soft disconnect behavior */ }
    activeSessions.delete(clientId);
    logger.info?.('pose_log.session_end', { clientId, filePath: session.filePath });
  }

  function handleMessage(clientId, message) {
    if (message.topic !== 'pose_log') return;
    if (message.action === 'start') {
      closeSession(clientId);
      const dir = getLogDir();
      const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
      const filePath = path.join(dir, `${ts}.jsonl`);
      const fd = openFileForAppend(filePath);
      activeSessions.set(clientId, { fd, filePath });
      writeToFileDescriptor(fd, JSON.stringify({
        type: 'session_start', ts: Date.now(), backend: message.backend,
        modelType: message.modelType, format: 'compact', keypoint_names: KEYPOINT_NAMES,
      }) + '\n');
      logger.info?.('pose_log.session_start', { clientId, filePath });
    }
    if (message.action === 'frames') {
      const session = activeSessions.get(clientId);
      if (!session) return;
      for (const frame of message.frames) writeToFileDescriptor(session.fd, JSON.stringify(frame) + '\n');
    }
    if (message.action === 'stop') closeSession(clientId);
  }

  handleMessage.onDisconnect = (clientId) => closeSession(clientId);
  return handleMessage;
}
