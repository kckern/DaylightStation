import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { ITeacherActionReceiptStore } from '#apps/school/ports/ITeacherActionReceiptStore.mjs';
import { ensureDir, readTextFromPath, renameFile, writeFileExclusive } from '#system/utils/FileIO.mjs';

const SCHEMA = 'school.teacher-action-receipt/v1';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const dump = (value) => yaml.dump(value, { lineWidth: -1, noRefs: true });

export class YamlTeacherActionReceiptStore extends ITeacherActionReceiptStore {
  #configService;

  constructor({ configService } = {}) {
    super();
    if (!configService?.getHouseholdPath) throw new Error('YamlTeacherActionReceiptStore requires configService');
    this.#configService = configService;
  }

  #dir() { return this.#configService.getHouseholdPath('school/records/teacher-action-receipts'); }
  #file(key) { return path.join(this.#dir(), `${digest(key)}.yml`); }

  async #read(key) {
    let raw;
    try { raw = readTextFromPath(this.#file(key)); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    let record;
    try { record = yaml.load(raw); } catch (error) {
      throw new Error(`teacher action receipt is corrupt: ${error.message}`);
    }
    if (record?.schema !== SCHEMA || record.key !== key || !['pending', 'completed'].includes(record.status)) {
      throw new Error('teacher action receipt is corrupt');
    }
    return record;
  }

  async claim({ key, fingerprint, at }) {
    if (typeof key !== 'string' || !key.trim() || key.length > 240 || typeof fingerprint !== 'string' || !fingerprint) {
      throw new Error('teacher action receipt requires a bounded key and fingerprint');
    }
    const normalized = key.trim();
    ensureDir(this.#dir());
    const pending = { schema: SCHEMA, key: normalized, fingerprint, status: 'pending', createdAt: at };
    try {
      writeFileExclusive(this.#file(normalized), dump(pending));
      return { kind: 'new' };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const existing = await this.#read(normalized);
    if (existing.fingerprint !== fingerprint) return { kind: 'conflict' };
    if (existing.status === 'completed') return { kind: 'replay', receipt: existing.receipt };
    return { kind: 'pending' };
  }

  async complete({ key, fingerprint, receipt, at }) {
    const normalized = key.trim();
    const existing = await this.#read(normalized);
    if (!existing || existing.fingerprint !== fingerprint || existing.status !== 'pending') {
      throw new Error('teacher action receipt reservation changed before completion');
    }
    const completed = { ...existing, status: 'completed', completedAt: at, receipt };
    const file = this.#file(normalized);
    const temporary = `${file}.${process.pid}-${Date.now()}.tmp`;
    writeFileExclusive(temporary, dump(completed));
    renameFile(temporary, file);
    return receipt;
  }
}

export default YamlTeacherActionReceiptStore;
