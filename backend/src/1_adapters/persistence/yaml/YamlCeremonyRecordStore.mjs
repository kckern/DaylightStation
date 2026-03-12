import path from 'path';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

export class YamlCeremonyRecordStore {
  #basePath;

  constructor({ basePath }) {
    this.#basePath = basePath;
  }

  hasRecord(username, type, periodId) {
    const records = this.#loadRecords(username);
    return records.some(r => r.type === type && r.period_id === periodId);
  }

  saveRecord(username, record) {
    const records = this.#loadRecords(username);
    records.push(record);
    const filePath = this.#filePath(username);
    saveYaml(filePath, records);
  }

  getRecords(username, type) {
    const records = this.#loadRecords(username);
    if (!type) return records;
    return records.filter(r => r.type === type);
  }

  getLatestRecord(username, type) {
    const records = this.getRecords(username, type);
    return records.length > 0 ? records[records.length - 1] : null;
  }

  #loadRecords(username) {
    const filePath = this.#filePath(username);
    const data = loadYamlSafe(filePath);
    return Array.isArray(data) ? data : [];
  }

  #filePath(username) {
    return path.join(this.#basePath, username, 'ceremony-records.yml');
  }
}
