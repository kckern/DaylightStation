import fs from 'node:fs';
import path from 'node:path';

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingSessionJournal {
  constructor({ journalsDir }) { this.journalsDir = journalsDir; fs.mkdirSync(journalsDir, { recursive: true }); }
  #file(id) { if (!SESSION_ID.test(String(id))) return null; return path.join(this.journalsDir, `${id}.jsonl`); }
  #locked(file, operation) {
    const lock = `${file}.lock`;
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw Object.assign(new Error('gaming journal commit is already in progress'), { code: 'revision_conflict' });
      throw error;
    }
    try { return operation(); }
    finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }
  async create(id, record) {
    const file = this.#file(id); if (!file) throw new Error('invalid gaming session id');
    this.#locked(file, () => fs.writeFileSync(file, `${JSON.stringify({ kind: 'session-created', ...record })}\n`, { flag: 'wx' }));
  }
  async append(id, record, { expectedRevision }) {
    const file = this.#file(id); if (!file) throw new Error('invalid gaming session id');
    this.#locked(file, () => {
      const records = this.#readFile(file); if (records.length === 0) throw new Error('gaming journal not found');
      const revision = records.filter((entry) => entry.kind === 'command-committed').length;
      if (revision !== expectedRevision) throw Object.assign(new Error('gaming journal revision conflict'), { code: 'revision_conflict', current_revision: revision });
      fs.appendFileSync(file, `${JSON.stringify({ kind: 'command-committed', revision: expectedRevision + 1, ...record })}\n`);
    });
  }
  async read(id) {
    const file = this.#file(id); if (!file || !fs.existsSync(file)) return [];
    return this.#readFile(file);
  }
  #readFile(file) {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw Object.assign(new Error(`gaming journal corruption at line ${index + 1}: ${error.message}`), { code: 'journal_corrupt' }); }
    });
  }
}
