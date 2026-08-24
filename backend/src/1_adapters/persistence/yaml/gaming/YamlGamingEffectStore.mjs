import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const SAFE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

export class YamlGamingEffectStore {
  constructor({ effectsDir }) { this.effectsDir = effectsDir; this.receiptsDir = path.join(effectsDir, 'receipts'); this.auditDir = path.join(effectsDir, 'audit'); this.sessionDir = path.join(effectsDir, 'sessions'); [this.receiptsDir, this.auditDir, this.sessionDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true })); }
  #safe(value) { if (!SAFE.test(String(value))) throw new Error('invalid gaming effect key'); return String(value).replaceAll(':', '_'); }
  #receipt(key) { return path.join(this.receiptsDir, `${this.#safe(key)}.yml`); }
  async get(key) { const file = this.#receipt(key); return fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true }) : null; }
  async put(key, receipt) { const file = this.#receipt(key); if (fs.existsSync(file)) return this.get(key); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, YAML.stringify(receipt), { flag: 'wx' }); fs.renameSync(temporary, file); return receipt; }
  async appendAudit(sessionId, entry) { fs.appendFileSync(path.join(this.auditDir, `${this.#safe(sessionId)}.jsonl`), `${JSON.stringify(entry)}\n`); }
  async appendEffect(sessionId, effect) { fs.appendFileSync(path.join(this.sessionDir, `${this.#safe(sessionId)}.jsonl`), `${JSON.stringify(effect)}\n`); }
  async listEffects(sessionId) { const file = path.join(this.sessionDir, `${this.#safe(sessionId)}.jsonl`); if (!fs.existsSync(file)) return []; return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
}
