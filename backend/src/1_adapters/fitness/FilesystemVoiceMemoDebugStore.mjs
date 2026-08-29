import path from 'node:path';
import { writeBinary } from '#system/utils/FileIO.mjs';

/** Bounded debug capture store; owns filename and storage layout policy. */
export class FilesystemVoiceMemoDebugStore {
  constructor({ dataDir, clock = Date.now } = {}) {
    if (!dataDir) throw new Error('FilesystemVoiceMemoDebugStore requires dataDir');
    this.dataDir = dataDir;
    this.clock = clock;
  }
  async save(buffer) {
    const savedAt = this.clock();
    const filename = `${new Date(savedAt).toISOString().replace(/:/g, '-')}.webm`;
    const filePath = path.join(this.dataDir, '_debug', 'voice_memos', filename);
    writeBinary(filePath, buffer);
    return { path: filePath, filename, size: buffer.length, savedAt };
  }
}
