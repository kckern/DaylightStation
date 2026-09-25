import path from 'node:path';
import { writeFileAtomic, readDirectoryAsync, readTextFromPathAsync } from '#system/utils/FileIO.mjs';

const SAFE_SEGMENT = /^[\w-]{1,128}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

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

  /**
   * One saved transcript by turn id, or null. Callers know a time near the turn
   * (e.g. the run that started it), not the turn's own start, so the file is
   * looked for in that UTC day and the next (a run that crossed midnight).
   * Files are named `<HHMMSS-mmm>-<turnId[0..8]>.json`.
   */
  async find({ agentId, userId, startedAt, turnId }) {
    const at = Date.parse(startedAt);
    if (!SAFE_SEGMENT.test(agentId || '') || !SAFE_SEGMENT.test(userId || 'anonymous') || !turnId || !Number.isFinite(at)) return null;
    const suffix = `-${turnId.slice(0, 8)}.json`;
    for (const day of [at, at + DAY_MS].map(ms => new Date(ms).toISOString().slice(0, 10))) {
      const dir = path.join(this.mediaDir, 'logs', 'agents', agentId, day, userId || 'anonymous');
      let names;
      try { names = await readDirectoryAsync(dir); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of names.filter(entry => entry.endsWith(suffix)).sort()) {
        let transcript;
        try { transcript = JSON.parse(await readTextFromPathAsync(path.join(dir, name))); } catch { continue; }
        if (!transcript?.turnId || transcript.turnId === turnId) return transcript;
      }
    }
    return null;
  }
}

export default AgentTranscriptFileStore;
