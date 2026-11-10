import { storageVersion } from './storageVersion.mjs';
import path from 'node:path';
import {
  appendTextFile, closeFileDescriptor, deleteFileStrict, ensureDir, fileExists,
  openFileExclusive, readTextFromPath, writeFileExclusive,
} from '#system/utils/FileIO.mjs';
import { SessionJournal } from "../../application/ports/SessionJournal.mjs";

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingSessionJournal extends SessionJournal {
  constructor({ journalsDir }) { super(); this.journalsDir = journalsDir; this.heads = new Map(); ensureDir(journalsDir); }
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
    return this.#locked(file, () => {
      writeFileExclusive(file, `${JSON.stringify({ kind: 'session-created', ...record })}\n`);
      this.heads.set(id, { version: storageVersion(file), revision: 0 });
      return { version: this.heads.get(id).version };
    });
  }
  async append(id, record, { expectedRevision }) {
    const file = this.#file(id); if (!file) throw new Error('invalid gaming session id');
    return this.#locked(file, () => {
      const version = storageVersion(file), head = this.heads.get(id);
      if (head && head.version !== version) {
        this.heads.delete(id);
        throw Object.assign(new Error('gaming journal changed; revalidation required'), { code: 'revision_conflict' });
      }
      const records = head ? null : this.#readFile(file);
      if (records?.length === 0) throw new Error('gaming journal not found');
      const revision = head ? head.revision : records.filter((entry) => entry.kind === 'command-committed').length;
      if (revision !== expectedRevision) throw Object.assign(new Error('gaming journal revision conflict'), { code: 'revision_conflict', current_revision: revision });
      try {
        appendTextFile(file, `${JSON.stringify({ kind: 'command-committed', revision: expectedRevision + 1, ...record })}\n`);
        this.heads.set(id, { version: storageVersion(file), revision: expectedRevision + 1 });
        return { version: this.heads.get(id).version };
      } catch (error) { this.heads.delete(id); throw error; }
    });
  }
  async getVersion(id) { return storageVersion(this.#file(id)); }
  async read(id) {
    const file = this.#file(id); if (!file || !fileExists(file)) return [];
    const version = storageVersion(file), records = this.#readFile(file);
    if (storageVersion(file) !== version) throw Object.assign(new Error('gaming journal changed during read'), { code: 'revision_conflict' });
    this.heads.set(id, { version, revision: records.filter(entry => entry.kind === 'command-committed').length });
    return records;
  }
  #readFile(file) {
    return readTextFromPath(file).split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw Object.assign(new Error(`gaming journal corruption at line ${index + 1}: ${error.message}`), { code: 'journal_corrupt' }); }
    });
  }
}
