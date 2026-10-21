import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSchoolLedgerReader } from "./SchoolLedgerReader.mjs";

let base;
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'school-ledger-reader-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe('school ledger reader', () => {
  it('reads a day back, skipping a torn last line', async () => {
    fs.mkdirSync(path.join(base, 'school'));
    fs.writeFileSync(path.join(base, 'school', '2026-10-20.jsonl'),
      '{"event":"school.issue.failed","data":{"sessionId":"ses_a"}}\n\n{"event":"school.print.ready"}\n{"event":"school.tor');
    const events = await createSchoolLedgerReader({ baseDir: base }).readDay('2026-10-20');
    expect(events.map((e) => e.event)).toEqual(['school.issue.failed', 'school.print.ready']);
  });

  it('reads a missing day, or a day that is not a date, as empty', async () => {
    const reader = createSchoolLedgerReader({ baseDir: base });
    expect(await reader.readDay('2026-10-19')).toEqual([]);
    expect(await reader.readDay('../secrets')).toEqual([]);
  });

  it('surfaces a read error other than a missing file', async () => {
    fs.mkdirSync(path.join(base, 'school', '2026-10-20.jsonl'), { recursive: true });
    await expect(createSchoolLedgerReader({ baseDir: base }).readDay('2026-10-20')).rejects.toThrow();
  });
});
