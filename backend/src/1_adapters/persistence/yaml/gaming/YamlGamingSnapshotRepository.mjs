import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingSnapshotRepository {
  constructor({ snapshotsDir }) { this.snapshotsDir = snapshotsDir; this.listeners = new Map(); fs.mkdirSync(snapshotsDir, { recursive: true }); }
  #file(id) { if (!SESSION_ID.test(String(id))) return null; return path.join(this.snapshotsDir, `${id}.yml`); }
  #locked(file, operation) {
    const lock = `${file}.lock`; let descriptor;
    try { descriptor = fs.openSync(lock, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('gaming snapshot commit is already in progress'), { code: 'revision_conflict' }); throw error; }
    try { return operation(); }
    finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }
  async get(id) { const file = this.#file(id); return file && fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true }) : null; }
  async put(session, { expectedRevision }) {
    const file = this.#file(session?.header?.session_id); if (!file) throw new Error('invalid gaming session id');
    this.#locked(file, () => {
      const current = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true }) : null;
      if (expectedRevision === null && current) throw Object.assign(new Error('gaming snapshot already exists'), { code: 'revision_conflict', current_revision: current?.header?.revision ?? null });
      if (expectedRevision !== null && current?.header?.revision !== expectedRevision) throw Object.assign(new Error('gaming snapshot revision conflict'), { code: 'revision_conflict', current_revision: current?.header?.revision ?? null });
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, YAML.stringify(session), { flag: 'wx' }); fs.renameSync(temporary, file);
    });
    for (const listener of this.listeners.get(session.header.session_id) || []) listener(structuredClone(session));
  }
  observe(id, listener) { const listeners = this.listeners.get(id) || new Set(); listeners.add(listener); this.listeners.set(id, listeners); return () => listeners.delete(listener); }
}
