/**
 * YAML persistence for the school app. Dumb storage only — no grading, no
 * policy (see SchoolService). Mirrors YamlEconomyDatastore's layout:
 *   banks:         <dataDir>/content/school/{subject}/{work}/quizzes/{rest}.yml
 *   attempts:      <userDir>/apps/school/attempts/{YYYY-MM-DD}.yml  (append-only)
 *   quiz requests: <dataDir>/household/apps/school/quiz-requests.yml  (one household list —
 *                  NOT under a quizzes dir, where listBankIds would sweep it up)
 *
 * Banks live inside their WORK, beside that work's units and documents, the way
 * scripture/bom/ already did. The `quizzes/` container is not part of the id:
 * `math/algebra/functions/x` is the file
 * `content/school/math/algebra/quizzes/functions/x.yml`. Dropping that segment
 * from the id is what let every already-nested bank keep its id across the
 * 2026-07-30 moves — only the four loose banks, which had no work segment at
 * all, were renamed.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { loadYamlSafe, saveYaml, ensureDir, listYamlFiles } from '#system/utils/FileIO.mjs';
import { SUBJECT_IDS } from '#domains/school/curriculum/unitValidation.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

// Bank ids are nested paths ("history/i-survived/02-shark-attacks/01-alone") so the
// bank tree can be browsed as folders. Every segment must start alphanumeric, which is
// what keeps traversal out: ".." and hidden names cannot match, nor can a leading "/".
// The first segment is the subject shelf (checked against SUBJECT_IDS) and the second
// is the work, so a THREE-segment minimum is structural rather than stylistic.
//
// Dots are allowed AFTER the first character because 43 imported banks name a
// half-step that way (`multiplying_expressions_0.5`). They were previously
// unreachable through readBankRaw while readAllBankRaws — which did not apply this
// pattern — loaded them fine; routing both through one path made that split visible.
const BANK_ID_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;
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

  #schoolDir() { return path.join(this.#configService.getDataDir(), 'content', 'school'); }

  #quizzesDir(subject, work) {
    return path.join(this.#schoolDir(), subject, work, 'quizzes');
  }

  #works(subject) {
    try {
      return fs.readdirSync(path.join(this.#schoolDir(), subject), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Bank id -> file path. An id is `<subject>/<work>/<rest…>`; the `quizzes/`
   * container is NOT part of the id, it is inserted between the work and the
   * rest. So three segments are the minimum, and an unknown subject or a
   * shorter id resolves to null rather than to a stray read.
   */
  #bankFile(bankId) {
    const id = String(bankId);
    if (!BANK_ID_RE.test(id)) return null;
    const [subject, work, ...rest] = id.split('/');
    if (!SUBJECT_IDS.includes(subject) || !work || rest.length === 0) return null;
    return path.join(this.#quizzesDir(subject, work), ...rest);
  }

  #attemptsDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'attempts');
  }

  #quizRequestsPath() {
    return this.#configService.getHouseholdPath('apps/school/quiz-requests');
  }

  readQuizRequests() {
    return loadYamlSafe(this.#quizRequestsPath()) || [];
  }

  saveQuizRequests(list) {
    ensureDir(path.dirname(this.#quizRequestsPath()));
    saveYaml(this.#quizRequestsPath(), list, { noRefs: true });
    return list;
  }

  // Printing: an append-only log of completed jobs (feeds the rolling quota)
  // and a pending queue of jobs awaiting a grown-up's approval. Both are one
  // household-wide list under household/apps/school (attribution is the per-entry
  // userId), same shape as quiz-requests.
  #printLogPath() { return this.#configService.getHouseholdPath('apps/school/print-log'); }
  #printPendingPath() { return this.#configService.getHouseholdPath('apps/school/print-pending'); }

  readPrintLog() { return loadYamlSafe(this.#printLogPath()) || []; }

  appendPrintLog(entry) {
    ensureDir(path.dirname(this.#printLogPath()));
    const list = this.readPrintLog();
    list.push(entry);
    saveYaml(this.#printLogPath(), list, { noRefs: true });
    return entry;
  }

  readPrintPending() { return loadYamlSafe(this.#printPendingPath()) || []; }

  savePrintPending(list) {
    ensureDir(path.dirname(this.#printPendingPath()));
    saveYaml(this.#printPendingPath(), list, { noRefs: true });
    return list;
  }

  listBankIds() {
    return SUBJECT_IDS.flatMap((subject) => this.#works(subject).flatMap((work) => listYamlFiles(this.#quizzesDir(subject, work), { recursive: true })
      .map((rest) => `${subject}/${work}/${rest}`))).sort();
  }

  readBankRaw(bankId) {
    const file = this.#bankFile(bankId);
    return file ? loadYamlSafe(file) : null;
  }

  /**
   * Read every bank's raw YAML ASYNCHRONOUSLY, in bounded-concurrency batches,
   * so the 4600-file scan runs off the main thread (libuv threadpool) instead
   * of blocking the event loop for ~8-10s. Returns [{ id, raw }] (raw null on a
   * parse/read miss). Parsing is sync per file but tiny; batching keeps the
   * per-tick CPU burst small too.
   */
  async readAllBankRaws({ batch = 200 } = {}) {
    const ids = this.listBankIds();
    const out = [];
    for (let i = 0; i < ids.length; i += batch) {
      const slice = ids.slice(i, i + batch);
      // eslint-disable-next-line no-await-in-loop
      const chunk = await Promise.all(slice.map(async (id) => {
        try {
          const file = this.#bankFile(id);
          if (!file) return { id, raw: null };
          const text = await fs.promises.readFile(`${file}.yml`, 'utf8');
          return { id, raw: yaml.load(text) };
        } catch {
          return { id, raw: null };
        }
      }));
      out.push(...chunk);
    }
    return out;
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

  /**
   * Same shape as `readAllAttempts`, but only day files whose name falls
   * within `[fromDay, toDay]` (inclusive) are ever read off disk — a caller
   * asking about last week does not pay to parse three years of history.
   * String comparison is correct ordering for `YYYY-MM-DD` names, so no
   * Date parsing is needed to bound the readdir listing.
   */
  readAttemptsInRange(userId, fromDay, toDay) {
    const dir = this.#attemptsDir(userId);
    if (!dir || !fs.existsSync(dir)) return [];
    const from = String(fromDay);
    const to = String(toDay);
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .filter((f) => {
        const day = f.slice(0, 10);
        return day >= from && day <= to;
      })
      .sort()
      .flatMap((f) => loadYamlSafe(path.join(dir, f.replace(/\.yml$/, ''))) || []);
  }
}

export default YamlSchoolDatastore;
