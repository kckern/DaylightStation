import path from 'node:path';
import yaml from 'js-yaml';
import { IDecodedQuizScanStore } from '#apps/quizzes/ports/IDecodedQuizScanStore.mjs';
import {
  ensureDirAsync,
  readDirectoryAsync,
  readTextFromPathAsync,
  writeTextFileAsync,
} from '#system/utils/FileIO.mjs';

const dump = (records) => yaml
  .dump(records, { indent: 2, lineWidth: -1, noRefs: true, flowLevel: 3 })
  .replace(/^(\s+)'(\d+)':/gm, '$1$2:');

export class YamlDecodedQuizScanStore extends IDecodedQuizScanStore {
  constructor({ decodedRoot, rawHistoryRoot = null }) {
    super();
    if (!decodedRoot) throw new Error('YamlDecodedQuizScanStore requires decodedRoot');
    this.decodedRoot = decodedRoot;
    this.rawHistoryRoot = rawHistoryRoot;
  }

  async append(readerId, record) {
    const day = (typeof record?.ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record.ts))
      ? record.ts.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const dir = path.join(this.decodedRoot, readerId);
    const file = path.join(dir, `${day}.yml`);
    await ensureDirAsync(dir);
    let records = [];
    try {
      const existing = yaml.load(await readTextFromPathAsync(file));
      if (Array.isArray(existing)) records = existing;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    records.push(record);
    await writeTextFileAsync(file, dump(records));
  }

  async listRawReaders() {
    if (!this.rawHistoryRoot) return [];
    try {
      return (await readDirectoryAsync(this.rawHistoryRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async listRawDays(readerId) {
    return (await readDirectoryAsync(path.join(this.rawHistoryRoot, readerId)))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(name)).sort();
  }

  async readRawDay(readerId, dayFile) {
    return yaml.load(await readTextFromPathAsync(path.join(this.rawHistoryRoot, readerId, dayFile)));
  }

  async replaceDecodedDay(readerId, dayFile, records) {
    const dir = path.join(this.decodedRoot, readerId);
    await ensureDirAsync(dir);
    await writeTextFileAsync(path.join(dir, dayFile), dump(records));
  }
}

export default YamlDecodedQuizScanStore;
