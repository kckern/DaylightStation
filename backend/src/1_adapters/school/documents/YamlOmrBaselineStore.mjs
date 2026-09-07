import path from 'node:path';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Only structurally valid, alignment-accepted scans belong here; raw history is separate. */
export class YamlOmrBaselineStore {
  constructor({ directory }) { this.directory = path.join(directory, 'scan-alignment'); }
  #file(cardId) {
    if (!/^\d{7}$/.test(String(cardId))) throw new Error('Invalid OMR baseline card ID');
    return path.join(this.directory, `${cardId}.yml`);
  }
  async get(cardId) {
    try { return readYamlFromPath(this.#file(cardId)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async save(cardId, baseline) { saveYamlToPathAtomic(this.#file(cardId), baseline); }
}
