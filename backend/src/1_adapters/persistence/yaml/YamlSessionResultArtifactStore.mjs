import path from 'node:path';
import { ensureDir, readBinaryFromPath, writeBinaryExclusive } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

/** Immutable generated-result bytes. Kept beside School records, never authored curriculum. */
export class YamlSessionResultArtifactStore {
  #config;
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlSessionResultArtifactStore requires configService');
    this.#config = configService;
  }
  #file(sessionId) {
    if (!SAFE_ID.test(sessionId ?? '')) throw new Error(`unsafe result session id: ${sessionId}`);
    return path.join(this.#config.getHouseholdPath('school/records/session-results'), `${sessionId}.machine.png`);
  }
  async getMachine(sessionId) {
    try { return readBinaryFromPath(this.#file(sessionId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async putMachineIfAbsent(sessionId, bytes) {
    const file = this.#file(sessionId);
    ensureDir(path.dirname(file));
    try { writeBinaryExclusive(file, bytes, { mode: 0o644 }); return { created: true, bytes }; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { created: false, bytes: readBinaryFromPath(file) };
    }
  }
}

export default YamlSessionResultArtifactStore;
