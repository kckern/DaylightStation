import path from 'node:path';
import YAML from 'yaml';
import {
  appendTextFile, ensureDir, fileExists, readTextFromPath, renameFile, writeFileExclusive,
} from '#system/utils/FileIO.mjs';

const SAFE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingEffectStore {
  constructor({ effectsDir }) { this.effectsDir = effectsDir; this.receiptsDir = path.join(effectsDir, 'receipts'); this.auditDir = path.join(effectsDir, 'audit'); this.sessionDir = path.join(effectsDir, 'sessions'); [this.receiptsDir, this.auditDir, this.sessionDir].forEach(ensureDir); }
  #safe(value) { if (!SAFE.test(String(value))) throw new Error('invalid gaming effect key'); return String(value).replaceAll(':', '_'); }
  #receipt(key) { return path.join(this.receiptsDir, `${this.#safe(key)}.yml`); }
  async get(key) { const file = this.#receipt(key); return fileExists(file) ? YAML.parse(readTextFromPath(file), { uniqueKeys: true }) : null; }
  async put(key, receipt) { const file = this.#receipt(key); if (fileExists(file)) return this.get(key); const temporary = `${file}.${process.pid}.tmp`; writeFileExclusive(temporary, YAML.stringify(receipt)); renameFile(temporary, file); return receipt; }
  async appendAudit(sessionId, entry) { appendTextFile(path.join(this.auditDir, `${this.#safe(sessionId)}.jsonl`), `${JSON.stringify(entry)}\n`); }
  async appendEffect(sessionId, effect) { appendTextFile(path.join(this.sessionDir, `${this.#safe(sessionId)}.jsonl`), `${JSON.stringify(effect)}\n`); }
  async listEffects(sessionId) { const file = path.join(this.sessionDir, `${this.#safe(sessionId)}.jsonl`); if (!fileExists(file)) return []; return readTextFromPath(file).split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
}
