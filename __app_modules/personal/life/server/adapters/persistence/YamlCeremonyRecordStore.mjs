import path from 'path';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { ICeremonyRecordRepository } from "../../application/ports/ICeremonyRecordRepository.mjs";

export class YamlCeremonyRecordStore extends ICeremonyRecordRepository {
  #basePath;

  constructor({ basePath }) {
    super();
    this.#basePath = basePath;
  }

  hasRecord(username, type, periodId) {
    const records = this.#loadRecords(username);
    // CeremonyService writes camelCase periodId; accept legacy snake_case too
    return records.some(r => r.type === type && (r.periodId === periodId || r.period_id === periodId));
  }

  saveRecord(username, record) {
    const records = this.#loadRecords(username);
    records.push(record);
    const filePath = this.#filePath(username);
    saveYamlToPathAtomic(filePath, records, { preserveMode: true });
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
    let data;
    try {
      data = readYamlFromPath(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    if (!Array.isArray(data)) {
      throw new Error('Invalid ceremony record YAML: expected a list');
    }
    return data;
  }

  #filePath(username) {
    return path.join(this.#basePath, username, 'ceremony-records.yml');
  }
}
