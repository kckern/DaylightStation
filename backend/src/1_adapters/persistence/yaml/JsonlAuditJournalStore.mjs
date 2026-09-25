/**
 * JsonlAuditJournalStore — the nutrition auditor's run journal, one JSONL file
 * per user per month per writer, next to the rest of that user's nutrition data:
 *   users/{userId}/lifelog/nutrition/auditor-journal/YYYY-MM[.<source>].jsonl
 *
 * The month comes from the row's `at`. The data tree is Dropbox-synced, and two
 * writers (prod + a dev machine) appending the same file is the conflict loop
 * that hit backend.log, so each writer gets its own file via `source` (the
 * AiUsageLedger pattern). `list` reads every writer's files.
 *
 * Unlike the AI usage ledger, `append` REJECTS on a write failure: the ledger
 * observes someone else's call and must never break it, while the journal is
 * written by NutritionCleanup itself, which catches and logs the failure with
 * the run context it has and this adapter lacks.
 *
 * Volume: at ~25 runs/day a month file holds ~750 rows, so `list` reads whole
 * files rather than indexing.
 */
import path from 'path';
import { appendTextFile, listFiles, readTextFromPathAsync } from '#system/utils/FileIO.mjs';
import { IAuditJournalStore } from '#apps/nutrition/ports/IAuditJournalStore.mjs';

const FILE_RE = /^(\d{4})-(\d{2})(?:\.[\w.-]+)?\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value, label) {
  if (value == null || value === '') return null;
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new Error(`Invalid ${label}: ${value}`);
  return t;
}

export class JsonlAuditJournalStore extends IAuditJournalStore {
  static PATH = 'lifelog/nutrition/auditor-journal';

  constructor({ dataService, source = null, logger = null } = {}) {
    super();
    if (!dataService?.user?.resolveDir) throw new Error('JsonlAuditJournalStore requires dataService');
    this.dataService = dataService;
    this.suffix = source ? `.${String(source).replace(/[^\w.-]+/g, '-')}` : '';
    this.logger = logger;
    this.tail = Promise.resolve();
  }

  dir(userId) {
    if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error('Invalid owner');
    return this.dataService.user.resolveDir(JsonlAuditJournalStore.PATH, userId);
  }

  /** @returns {Promise<void>} rejects on invalid rows and write failures. */
  append(userId, row) {
    let file, line;
    try {
      const dir = this.dir(userId);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Journal row must be an object');
      if (typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) throw new Error('Journal row requires an ISO `at`');
      if (!row.runId && !row.skipped) throw new Error('Journal row requires `runId` or `skipped`');
      file = path.join(dir, `${row.at.slice(0, 7)}${this.suffix}.jsonl`);
      line = `${JSON.stringify(row)}\n`;
    } catch (error) {
      return Promise.reject(error);
    }
    const write = this.tail.then(() => appendTextFile(file, line));
    // Keep the queue alive past a failed write; the caller still sees the rejection.
    this.tail = write.catch(() => {});
    return write;
  }

  async list(userId, { from, to } = {}) {
    const dir = this.dir(userId);
    const fromMs = parseTime(from, 'from');
    const toMs = parseTime(to, 'to');

    const files = listFiles(dir).filter((name) => {
      const m = FILE_RE.exec(name);
      if (!m) return false;
      // Month span, padded a day each side: `at` may carry a UTC offset, so its
      // month prefix can differ from the UTC month by one day at the edges.
      const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) - DAY_MS;
      const end = Date.UTC(Number(m[1]), Number(m[2]), 1) + DAY_MS;
      return (fromMs == null || end > fromMs) && (toMs == null || start < toMs);
    }).sort();

    const byRun = new Map();
    const loose = [];
    for (const name of files) {
      const text = await readTextFromPathAsync(path.join(dir, name));
      for (const raw of text.split('\n')) {
        if (!raw.trim()) continue;
        let row;
        try { row = JSON.parse(raw); } catch {
          this.logger?.warn?.('nutrition.auditor-journal.malformed-line', { file: name });
          continue;
        }
        if (!row || typeof row !== 'object' || typeof row.at !== 'string') continue;
        const t = Date.parse(row.at);
        if (!Number.isFinite(t)) continue;
        const entry = { row, t };
        if (row.runId) {
          byRun.delete(row.runId); // re-insert so the last line in file order wins
          byRun.set(row.runId, entry);
        } else {
          loose.push(entry);
        }
      }
    }
    // Dedupe before the range filter, so a started row never stands in for a
    // completed row whose `at` falls outside the range.
    return [...byRun.values(), ...loose]
      .filter(({ t }) => (fromMs == null || t >= fromMs) && (toMs == null || t < toMs))
      .sort((a, b) => b.t - a.t)
      .map((e) => e.row);
  }

  /** The latest row for `runId` (last line in file order wins, as in `list`), or null. */
  async findRun(userId, runId, { around } = {}) {
    if (around != null) {
      const t = parseTime(around, 'around');
      const rows = await this.list(userId, { from: new Date(t - DAY_MS).toISOString(), to: new Date(t + DAY_MS).toISOString() });
      return rows.find((row) => row.runId === runId) ?? null;
    }
    // Every row of a run carries the run's start as `at`, so one month holds them all.
    const dir = this.dir(userId);
    const months = new Map();
    for (const name of listFiles(dir).sort()) {
      const m = FILE_RE.exec(name);
      if (m) months.set(`${m[1]}-${m[2]}`, [...(months.get(`${m[1]}-${m[2]}`) || []), name]);
    }
    for (const month of [...months.keys()].sort().reverse()) {
      let found = null;
      for (const name of months.get(month)) {
        for (const raw of (await readTextFromPathAsync(path.join(dir, name))).split('\n')) {
          if (!raw.includes(runId)) continue;
          let row;
          try { row = JSON.parse(raw); } catch { continue; }
          if (row?.runId === runId && typeof row.at === 'string' && Number.isFinite(Date.parse(row.at))) found = row;
        }
      }
      if (found) return found;
    }
    return null;
  }
}
