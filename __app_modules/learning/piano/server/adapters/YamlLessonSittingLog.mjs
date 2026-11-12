import { YamlUserAppRecordStore } from '#system/persistence/YamlUserAppRecordStore.mjs';

const CAP = 300;

/**
 * YamlLessonSittingLog — one row per piano lesson sitting (a lesson opened on
 * the kiosk), for the teacher console: score, expected vs actual rate, check-ins,
 * drill and outcome. data/users/{id}/apps/piano/lesson-sittings.yml, newest
 * 300 rows.
 */
export class YamlLessonSittingLog {
  #records;
  #logger;

  constructor({ configService, logger = console }) {
    this.#records = new YamlUserAppRecordStore({ configService, app: 'piano', filename: 'lesson-sittings' });
    this.#logger = logger;
  }

  #rows(records) {
    const doc = records.read();
    return Array.isArray(doc?.sittings) ? doc.sittings : [];
  }

  /** Insert or merge one sitting row by sittingId. Unknown user → null. */
  upsert(userId, row) {
    const records = this.#records.forUser(userId);
    if (!records || !row?.sittingId) return null;
    const rows = this.#rows(records);
    const i = rows.findIndex((r) => r.sittingId === row.sittingId);
    const now = new Date().toISOString();
    const merged = i >= 0
      ? { ...rows[i], ...row, startedAt: rows[i].startedAt ?? row.startedAt ?? now, updatedAt: row.updatedAt ?? now }
      : { startedAt: row.startedAt ?? now, updatedAt: row.updatedAt ?? now, ...row };
    if (i >= 0) rows[i] = merged; else rows.push(merged);
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    records.write({ sittings: rows.slice(0, CAP) });
    return merged;
  }

  /** Rows newest first, optionally only those updated at/after sinceIso. Unknown user → null. */
  list(userId, { sinceIso = null } = {}) {
    const records = this.#records.forUser(userId);
    if (!records) return null;
    const rows = this.#rows(records)
      .filter((r) => !sinceIso || String(r.updatedAt) >= sinceIso)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return rows;
  }
}

export default YamlLessonSittingLog;
