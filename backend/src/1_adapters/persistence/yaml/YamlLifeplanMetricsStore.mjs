import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

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
    saveYaml(filePath, history);
  }

  getHistory(username) {
    const filePath = this.#filePath(username);
    const data = loadYamlSafe(filePath);
    return Array.isArray(data) ? data : [];
  }

  #filePath(username) {
    return path.join(this.#basePath, username, 'lifeplan-metrics.yml');
  }
}
