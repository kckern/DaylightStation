import path from 'path';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

export class YamlLifeplanMetricsStore {
  #basePath;

  constructor({ basePath }) {
    this.#basePath = basePath;
  }

  getLatest(username) {
    const history = this.getHistory(username);
    return history.length > 0 ? history[history.length - 1] : null;
  }

  saveSnapshot(username, snapshot) {
    const history = this.getHistory(username);
    history.push({ ...snapshot, timestamp: snapshot.timestamp || new Date().toISOString() });
    const filePath = this.#filePath(username);
    saveYamlToPathAtomic(filePath, history, { preserveMode: true });
  }

  getHistory(username) {
    const filePath = this.#filePath(username);
    let data;
    try {
      data = readYamlFromPath(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    if (!Array.isArray(data)) {
      throw new Error('Invalid Life plan metrics YAML: expected a list');
    }
    return data;
  }

  #filePath(username) {
    return path.join(this.#basePath, username, 'lifeplan-metrics.yml');
  }
}
