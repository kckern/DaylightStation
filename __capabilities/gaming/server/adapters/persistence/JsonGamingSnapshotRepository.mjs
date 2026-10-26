import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  closeFileDescriptor, deleteFileStrict, ensureDir, openFileExclusive,
  readTextFromPath, renameFile, writeFileExclusive,
} from '#system/utils/FileIO.mjs';
import { SnapshotRepository } from '../../application/ports/SnapshotRepository.mjs';
import { storageVersion } from './storageVersion.mjs';

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const conflict = (revision) => Object.assign(new Error('gaming snapshot revision conflict'), { code: 'revision_conflict', current_revision: revision ?? null });

export class JsonGamingSnapshotRepository extends SnapshotRepository {
  constructor({ snapshotsDir, legacy = null }) {
    super(); Object.assign(this, { snapshotsDir, legacy }); this.listeners = new Map(); ensureDir(snapshotsDir);
  }
  #file(id) { return SESSION_ID.test(String(id)) ? path.join(this.snapshotsDir, `${id}.json`) : null; }
  #read(file) {
    try {
      const value = JSON.parse(readTextFromPath(file));
      if (!value?.header || !Number.isInteger(value.header.revision)) throw new Error('invalid checkpoint header');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw Object.assign(new Error(`gaming snapshot corruption: ${error.message}`), { code: 'snapshot_corrupt' });
    }
  }
  async get(id) {
    const file = this.#file(id); if (!file) return null;
    return this.#read(file) ?? (this.legacy ? this.legacy.get(id) : null);
  }
  async getVersion(id) {
    const file = this.#file(id); if (!file) return null;
    const current = storageVersion(file);
    const legacy = this.legacy ? await this.legacy.getVersion?.(id) : null;
    if (this.legacy && legacy === undefined) return undefined;
    return current === null && legacy === null ? null : JSON.stringify([current, legacy]);
  }
  async put(session, { expectedRevision }) {
    const id = session?.header?.session_id, file = this.#file(id);
    if (!file) throw new Error('invalid gaming session id');
    const lock = `${file}.lock`; let descriptor;
    try { descriptor = openFileExclusive(lock); }
    catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error; }
    let temporary;
    try {
      const current = this.#read(file) ?? (this.legacy ? await this.legacy.get(id) : null);
      if (expectedRevision === null ? current !== null : current?.header?.revision !== expectedRevision) throw conflict(current?.header?.revision);
      temporary = `${file}.${randomUUID()}.tmp`;
      writeFileExclusive(temporary, JSON.stringify(session));
      renameFile(temporary, file); temporary = null;
    } finally {
      if (temporary && storageVersion(temporary) !== null) deleteFileStrict(temporary);
      closeFileDescriptor(descriptor); deleteFileStrict(lock);
    }
    for (const listener of this.listeners.get(id) || []) listener(structuredClone(session));
  }
  observe(id, listener) {
    const listeners = this.listeners.get(id) || new Set(); listeners.add(listener); this.listeners.set(id, listeners);
    return () => listeners.delete(listener);
  }
}
