/**
 * Reads back the school ledger `SchoolLedgerTransport` writes: one JSONL file
 * per process-local day under `{logs}/school/YYYY-MM-DD.jsonl`, one log event
 * (`{ts, level, event, data, context}`) per line.
 *
 * Read-only. A missing file is an empty day; any other read error (a
 * permission, a directory in its place) is thrown so the caller can log it.
 * A line that does not parse is skipped (the transport appends while we read, so the last line may be
 * half-written).
 */
import path from 'node:path';
import { readTextFromPathAsync } from '#system/utils/FileIO.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createSchoolLedgerReader({ baseDir }) {
  if (!baseDir) throw new Error('School ledger reader requires a baseDir option');
  const directory = path.join(baseDir, 'school');
  return {
    /** @param {string} day - the file's day, `YYYY-MM-DD` */
    async readDay(day) {
      if (!DAY.test(day ?? '')) return [];
      let text;
      try {
        text = await readTextFromPathAsync(path.join(directory, `${day}.jsonl`));
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
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
