import path from 'node:path';
import YAML from 'yaml';
import { fileExists, readTextFromPath, saveYamlToPathAtomic, deleteFileStrict } from '#system/utils/FileIO.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SCORE = /^[a-z0-9-]{1,120}$/;

/** Durable transaction intent plus immutable deduplication receipts. */
export class YamlPianoLearnCoachStore {
  constructor({ usersDir }) { this.usersDir = usersDir; }
  #root(userId, scoreKey) {
    if (!ID.test(String(userId)) || !SCORE.test(String(scoreKey))) throw new Error('Invalid coaching scope');
    return path.join(this.usersDir, userId, 'apps', 'piano', 'learn-coach', scoreKey);
  }
  #read(file) { return fileExists(file) ? YAML.parse(readTextFromPath(file), { uniqueKeys: true }) : null; }
  #eventFile(userId, scoreKey, id) {
    if (!ID.test(String(id))) throw new Error('Invalid coaching event identity');
    return path.join(this.#root(userId, scoreKey), 'events', `${id}.yml`);
  }
  loadPending(userId, scoreKey) { return this.#read(path.join(this.#root(userId, scoreKey), 'pending.yml')); }
  savePending(userId, scoreKey, value) { saveYamlToPathAtomic(path.join(this.#root(userId, scoreKey), 'pending.yml'), value, { durable: true }); }
  clearPending(userId, scoreKey) {
    const file = path.join(this.#root(userId, scoreKey), 'pending.yml');
    if (fileExists(file)) deleteFileStrict(file);
  }
  getReceipt(userId, scoreKey, id) { return this.#read(this.#eventFile(userId, scoreKey, id)); }
  saveReceipt(userId, scoreKey, id, value) {
    const file = this.#eventFile(userId, scoreKey, id);
    const current = this.#read(file);
    if (current) {
      if (current.signature !== value.signature || current.revision !== value.revision) throw new Error('Conflicting coaching receipt');
      return current;
    }
    saveYamlToPathAtomic(file, value, { durable: true });
    return value;
  }
}
