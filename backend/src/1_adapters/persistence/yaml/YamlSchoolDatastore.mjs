/**
 * YAML persistence for the school app. Dumb storage only — no grading, no
 * policy (see SchoolService). Mirrors YamlEconomyDatastore's layout:
 *   banks:         <dataDir>/content/quizzes/{bankId}.yml  (bankId may be a nested path)
 *   attempts:      <userDir>/apps/school/attempts/{YYYY-MM-DD}.yml  (append-only)
 *   quiz requests: <dataDir>/apps/school/quiz-requests.yml  (one household list —
 *                  NOT under content/quizzes, where listBankIds would sweep it up)
 */
import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir, listYamlFiles } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

// Bank ids may be nested paths ("i-survived/01-titanic-1912/01-two-am-on-deck") so the
// bank tree can be browsed as folders. Every segment must start alphanumeric, which is
// what keeps traversal out: ".." and hidden names cannot match, nor can a leading "/".
const BANK_ID_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  #quizRequestsPath() {
    return path.join(this.#configService.getDataDir(), 'apps', 'school', 'quiz-requests');
  }

  readQuizRequests() {
    return loadYamlSafe(this.#quizRequestsPath()) || [];
  }

  saveQuizRequests(list) {
    ensureDir(path.dirname(this.#quizRequestsPath()));
    saveYaml(this.#quizRequestsPath(), list, { noRefs: true });
    return list;
  }

  listBankIds() {
    return listYamlFiles(this.#banksDir(), { recursive: true }).sort();
  }

  readBankRaw(bankId) {
    if (!BANK_ID_RE.test(String(bankId))) return null;
    return loadYamlSafe(path.join(this.#banksDir(), String(bankId)));
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
    const dayStr = String(day);
    if (!DAY_RE.test(dayStr)) return [];
    return loadYamlSafe(path.join(dir, dayStr)) || [];
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
