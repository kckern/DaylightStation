import path from 'node:path';
import { readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

/** JSONL persistence adapter for durable camera-detection ledgers. */
export class CameraLedgerStore {
  #resolveDestinations;

  constructor({ resolveDestinations = () => [] } = {}) {
    this.#resolveDestinations = resolveDestinations;
  }

  write({ records, camera, day, version = null }) {
    const body = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    const suffix = version ? `.${version}` : '';
    const written = [];
    for (const destination of this.#resolveDestinations()) {
      const filePath = path.join(destination, camera, `${day}${suffix}.jsonl`);
      writeFileAtomic(filePath, body);
      written.push(filePath);
    }
    return { copies: written.length };
  }

  read({ camera, day }) {
    const destination = this.#resolveDestinations()[0];
    if (!destination) return [];
    const filePath = path.join(destination, camera, `${day}.jsonl`);
    try {
      return readTextFromPath(filePath)
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
}

export default CameraLedgerStore;
