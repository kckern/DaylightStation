import path from 'node:path';
import {
  appendTextFile, closeFileDescriptor, deleteFileStrict, ensureDir, fileExists,
  openFileExclusive, readTextFromPath, writeFileExclusive,
} from '#system/utils/FileIO.mjs';
import { SessionJournal } from '#apps/gaming/ports/SessionJournal.mjs';

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingSessionJournal extends SessionJournal {
  constructor({ journalsDir }) { super(); this.journalsDir = journalsDir; ensureDir(journalsDir); }
  #file(id) { if (!SESSION_ID.test(String(id))) return null; return path.join(this.journalsDir, `${id}.jsonl`); }
  #locked(file, operation) {
    const lock = `${file}.lock`;
    let descriptor;
    try { descriptor = openFileExclusive(lock); }
    catch (error) {
      if (error.code === 'EEXIST') throw Object.assign(new Error('gaming journal commit is already in progress'), { code: 'revision_conflict' });
      throw error;
    }
    try { return operation(); }
    finally { closeFileDescriptor(descriptor); deleteFileStrict(lock); }
  }
  async create(id, record) {
    const file = this.#file(id); if (!file) throw new Error('invalid gaming session id');
    this.#locked(file, () => writeFileExclusive(file, `${JSON.stringify({ kind: 'session-created', ...record })}\n`));
  }
  async append(id, record, { expectedRevision }) {
    const file = this.#file(id); if (!file) throw new Error('invalid gaming session id');
    this.#locked(file, () => {
      const records = this.#readFile(file); if (records.length === 0) throw new Error('gaming journal not found');
      const revision = records.filter((entry) => entry.kind === 'command-committed').length;
      if (revision !== expectedRevision) throw Object.assign(new Error('gaming journal revision conflict'), { code: 'revision_conflict', current_revision: revision });
      appendTextFile(file, `${JSON.stringify({ kind: 'command-committed', revision: expectedRevision + 1, ...record })}\n`);
    });
  }
  async read(id) {
    const file = this.#file(id); if (!file || !fileExists(file)) return [];
    return this.#readFile(file);
  }
  #readFile(file) {
    return readTextFromPath(file).split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw Object.assign(new Error(`gaming journal corruption at line ${index + 1}: ${error.message}`), { code: 'journal_corrupt' }); }
    });
  }
}
