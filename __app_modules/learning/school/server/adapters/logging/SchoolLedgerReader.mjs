/**
 * Reads back the school ledger `SchoolLedgerTransport` writes: one JSONL file
 * per process-local day under `{logs}/school/YYYY-MM-DD.jsonl`, one log event
 * (`{ts, level, event, data, context}`) per line.
 *
 * Read-only. A missing file is an empty day; a line that does not parse is
 * skipped (the transport appends while we read, so the last line may be
 * half-written).
 */
import path from 'node:path';
import { readFile } from '#system/utils/FileIO.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createSchoolLedgerReader({ baseDir }) {
  if (!baseDir) throw new Error('School ledger reader requires a baseDir option');
  const directory = path.join(baseDir, 'school');
  return {
    /** @param {string} day - the file's day, `YYYY-MM-DD` */
    async readDay(day) {
      if (!DAY.test(day ?? '')) return [];
      const text = readFile(path.join(directory, `${day}.jsonl`));
      if (!text) return [];
      const events = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* a torn last line */ }
      }
      return events;
    },
  };
}

export default createSchoolLedgerReader;
