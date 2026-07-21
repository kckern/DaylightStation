/**
 * YAML persistence for the school app. Dumb storage only — no grading, no
 * policy (see SchoolService). Mirrors YamlEconomyDatastore's layout:
 *   banks:    <dataDir>/content/quizzes/{bankId}.yml
 *   attempts: <userDir>/apps/school/attempts/{YYYY-MM-DD}.yml  (append-only)
 */
import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const BANK_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export class YamlSchoolDatastore {
  #configService;

  constructor(config = {}) {
    if (!config.configService) {
      throw new InfrastructureError('YamlSchoolDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
  }

  #banksDir() { return path.join(this.#configService.getDataDir(), 'content', 'quizzes'); }

  #attemptsDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'attempts');
  }

  listBankIds() {
    const dir = this.#banksDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => f.replace(/\.yml$/, '')).sort();
  }

  readBankRaw(bankId) {
    if (!BANK_ID_RE.test(String(bankId))) return null;
    return loadYamlSafe(path.join(this.#banksDir(), String(bankId))) || null;
  }

  appendAttempt(userId, attempt) {
    const dir = this.#attemptsDir(userId);
    if (!dir) return null;
    const day = String(attempt.at).slice(0, 10);
    const base = path.join(dir, day);
    ensureDir(dir);
    const list = loadYamlSafe(base) || [];
    list.push(attempt);
    saveYaml(base, list, { noRefs: true });
    return attempt;
  }

  readAttemptDay(userId, day) {
    const dir = this.#attemptsDir(userId);
    if (!dir) return [];
    return loadYamlSafe(path.join(dir, day)) || [];
  }

  readAllAttempts(userId) {
    const dir = this.#attemptsDir(userId);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .sort()
      .flatMap((f) => loadYamlSafe(path.join(dir, f.replace(/\.yml$/, ''))) || []);
  }
}

export default YamlSchoolDatastore;
