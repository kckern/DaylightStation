import path from 'node:path';
import { ensureDir, fileExists, readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

const SESSION = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
/** One atomic sidecar per ordinary source; never stores diagnostic sessions. */
export class YamlGamingSessionRestarts {
  constructor({ restartsDir }) { this.restartsDir = restartsDir; ensureDir(restartsDir); }
  file(sessionId) {
    if (!SESSION.test(sessionId) || sessionId.startsWith('diagnostic:')) throw new Error('invalid ordinary gaming session id');
    return path.join(this.restartsDir, `${encodeURIComponent(sessionId)}.json`);
  }
  async get(sessionId) {
    const file = this.file(sessionId);
    return fileExists(file) ? JSON.parse(readTextFromPath(file)).replacementSessionId : null;
  }
  async put(sessionId, replacementSessionId) {
    this.file(replacementSessionId);
    writeFileAtomic(this.file(sessionId), JSON.stringify({ replacementSessionId }));
  }
}
