/**
 * The game-budget day files: household/history/piano-games/{YYYY-MM-DD}.yml
 * (design layer 2 — durable, authoritative).
 *
 * THIS IS A BALANCE, NOT A LEDGER TAIL (D16). schoolLedger.mjs swallows write
 * failures by design; for a balance a swallowed write is a lost debit, and a
 * lost debit is free game time — the exact failure the feature exists to
 * prevent. So: writes are atomic and THROW on failure (the service surfaces
 * that as budget.settle-failed), and a corrupt or wrong-schema file on read
 * THROWS rather than quietly loading as a zero-balance fresh day.
 *
 * A genuinely absent file IS a fresh day — the store distinguishes "never
 * written" from "written and unreadable", the same posture the school attempt
 * shards take.
 */
import path from 'node:path';
import { loadYamlSafe, saveYamlToPathAtomic, ensureDir, fileExists } from '#system/utils/FileIO.mjs';
import { emptyDay } from '#domains/piano/gameBudget.mjs';

const SCHEMA = 'piano.game-budget-day/v1';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class YamlPianoGameBudgetStore {
  #root; #logger;

  constructor({ historyRoot, logger = console } = {}) {
    if (!historyRoot) throw new Error('YamlPianoGameBudgetStore requires historyRoot');
    this.#root = historyRoot;
    this.#logger = logger;
  }

  #fileFor(studyDateStr) {
    if (!DAY.test(String(studyDateStr))) throw new Error(`invalid study date: ${studyDateStr}`);
    return path.join(this.#root, `${studyDateStr}.yml`);
  }

  /**
   * `loadYamlSafe` takes an extensionless base path and folds BOTH "file
   * absent" and "file present but unparseable" into a `null` return — it
   * cannot tell those apart on its own. The `fileExists` check up front is
   * what recovers the distinction: if the file is there and the load still
   * comes back null, that null can only mean corrupt YAML, not "no file yet".
   */
  loadDay(studyDateStr) {
    const file = this.#fileFor(studyDateStr);
    if (!fileExists(file)) return emptyDay(studyDateStr);
    const raw = loadYamlSafe(file.replace(/\.yml$/, ''));
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`corrupt game-budget day file: ${file}`);
    }
    if (raw.schema !== SCHEMA) {
      throw new Error(`unexpected schema in ${file}: ${raw.schema ?? '(none)'}`);
    }
    return raw;
  }

  saveDay(day) {
    ensureDir(this.#root);
    saveYamlToPathAtomic(this.#fileFor(day.studyDate), day);
  }
}

export default YamlPianoGameBudgetStore;
