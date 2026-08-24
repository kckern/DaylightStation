import fs from 'node:fs/promises';
import path from 'node:path';

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
    try { return await fs.readFile(this.#file(sessionId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async putMachineIfAbsent(sessionId, bytes) {
    const file = this.#file(sessionId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o644 }); return { created: true, bytes }; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { created: false, bytes: await fs.readFile(file) };
    }
  }
}

export default YamlSessionResultArtifactStore;
