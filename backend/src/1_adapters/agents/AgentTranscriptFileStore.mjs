import path from 'node:path';
import { writeFileAtomic } from '#system/utils/FileIO.mjs';

/**
 * Filesystem implementation of the agent transcript output port.
 *
 * The path and JSON formatting intentionally match the former in-process
 * implementation so existing transcript readers continue to see the exact
 * same records in the exact same locations.
 */
export class AgentTranscriptFileStore {
  constructor({ mediaDir }) {
    this.mediaDir = mediaDir;
  }

  async save({ agentId, userId, turnId, startedAt, transcript }) {
    const day = startedAt.toISOString().slice(0, 10);
    const iso = startedAt.toISOString();
    const time = iso.slice(11, 23).replace(/[:.]/g, '');
    const filenameTs = `${time.slice(0, 6)}-${time.slice(6, 9)}`;
    const turnIdShort = (turnId || '').slice(0, 8) || 'no-id';
    const userDir = userId || 'anonymous';
    const filePath = path.join(
      this.mediaDir,
      'logs',
      'agents',
      agentId,
      day,
      userDir,
      `${filenameTs}-${turnIdShort}.json`,
    );

    writeFileAtomic(filePath, JSON.stringify(transcript, null, 2));
  }
}

export default AgentTranscriptFileStore;
