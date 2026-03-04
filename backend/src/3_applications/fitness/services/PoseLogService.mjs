/**
 * PoseLogService — Streams raw pose keypoints from WebSocket to JSONL files
 *
 * Handles pose_log messages from the frontend PoseDemo module.
 * Each detection session produces a JSONL file at {mediaDir}/logs/poses/{date}/{timestamp}.jsonl
 * with a session_start metadata line, frame lines (t + kp), and a session_end line.
 *
 * Uses synchronous file descriptor writes (matching sessionFile.mjs pattern) for throughput.
 */

import fs from 'fs';
import path from 'path';

/**
 * @param {import('../../../0_system/config/ConfigService.mjs').ConfigService} configService
 * @param {{ info?: Function, warn?: Function, error?: Function }} logger
 * @returns {Function} onClientMessage handler
 */
export function createPoseLogHandler(configService, logger) {
  const activeSessions = new Map(); // clientId -> { fd, filePath }

  function getLogDir() {
    const mediaDir = configService.getMediaDir();
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(mediaDir, 'logs', 'poses', date);
  }

  function closeSession(clientId) {
    const session = activeSessions.get(clientId);
    if (!session) return;
    try {
      fs.writeSync(session.fd, JSON.stringify({ type: 'session_end', ts: Date.now() }) + '\n');
      fs.closeSync(session.fd);
    } catch { /* ignore close errors */ }
    activeSessions.delete(clientId);
    logger.info?.('pose_log.session_end', { clientId, filePath: session.filePath });
  }

  function handleMessage(clientId, message) {
    if (message.topic !== 'pose_log') return;

    if (message.action === 'start') {
      // Close existing session if any
      closeSession(clientId);

      const dir = getLogDir();
      fs.mkdirSync(dir, { recursive: true });

      const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
      const filePath = path.join(dir, `${ts}.jsonl`);
      const fd = fs.openSync(filePath, 'a');

      activeSessions.set(clientId, { fd, filePath });

      const meta = { type: 'session_start', ts: Date.now(), backend: message.backend, modelType: message.modelType };
      fs.writeSync(fd, JSON.stringify(meta) + '\n');
      logger.info?.('pose_log.session_start', { clientId, filePath });
    }

    if (message.action === 'frames') {
      const session = activeSessions.get(clientId);
      if (!session) return;
      for (const frame of message.frames) {
        fs.writeSync(session.fd, JSON.stringify(frame) + '\n');
      }
    }

    if (message.action === 'stop') {
      closeSession(clientId);
    }
  }

  // Expose for disconnect cleanup
  handleMessage.onDisconnect = (clientId) => closeSession(clientId);

  return handleMessage;
}
