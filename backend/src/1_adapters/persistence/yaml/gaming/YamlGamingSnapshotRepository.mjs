import path from 'node:path';
import YAML from 'yaml';
import {
  closeFileDescriptor, deleteFileStrict, ensureDir, fileExists, openFileExclusive,
  readTextFromPath, renameFile, writeFileExclusive,
} from '#system/utils/FileIO.mjs';
import { SnapshotRepository } from '#apps/gaming/ports/SnapshotRepository.mjs';

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingSnapshotRepository extends SnapshotRepository {
  constructor({ snapshotsDir }) { super(); this.snapshotsDir = snapshotsDir; this.listeners = new Map(); ensureDir(snapshotsDir); }
  #file(id) { if (!SESSION_ID.test(String(id))) return null; return path.join(this.snapshotsDir, `${id}.yml`); }
  #locked(file, operation) {
    const lock = `${file}.lock`; let descriptor;
    try { descriptor = openFileExclusive(lock); }
    catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('gaming snapshot commit is already in progress'), { code: 'revision_conflict' }); throw error; }
    try { return operation(); }
    finally { closeFileDescriptor(descriptor); deleteFileStrict(lock); }
  }
  async get(id) { const file = this.#file(id); return file && fileExists(file) ? YAML.parse(readTextFromPath(file), { uniqueKeys: true }) : null; }
  async put(session, { expectedRevision }) {
    const file = this.#file(session?.header?.session_id); if (!file) throw new Error('invalid gaming session id');
    this.#locked(file, () => {
      const current = fileExists(file) ? YAML.parse(readTextFromPath(file), { uniqueKeys: true }) : null;
      if (expectedRevision === null && current) throw Object.assign(new Error('gaming snapshot already exists'), { code: 'revision_conflict', current_revision: current?.header?.revision ?? null });
      if (expectedRevision !== null && current?.header?.revision !== expectedRevision) throw Object.assign(new Error('gaming snapshot revision conflict'), { code: 'revision_conflict', current_revision: current?.header?.revision ?? null });
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileExclusive(temporary, YAML.stringify(session)); renameFile(temporary, file);
    });
    for (const listener of this.listeners.get(session.header.session_id) || []) listener(structuredClone(session));
  }
  observe(id, listener) { const listeners = this.listeners.get(id) || new Set(); listeners.add(listener); this.listeners.set(id, listeners); return () => listeners.delete(listener); }
}
