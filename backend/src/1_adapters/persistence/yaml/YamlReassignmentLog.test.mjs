/**
 * YamlReassignmentLog — the evidence-reassignment audit trail (Task 12,
 * debt M5). Append-only, corrupt-refusal per the M3 rule, same skeleton as
 * YamlAttestationLog minus retraction — an audit trail is never retracted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { YamlReassignmentLog } from './YamlReassignmentLog.mjs';

let dir;
const configService = { getHouseholdPath: (p) => path.join(dir, p) };
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reassign-log-')); });

describe('YamlReassignmentLog', () => {
  it('starts empty when the file has never been written', () => {
    const log = new YamlReassignmentLog({ configService });
    expect(log.list()).toEqual([]);
  });

  it('append persists the entry and list() returns it back', async () => {
    const log = new YamlReassignmentLog({ configService });
    const entry = {
      at: '2026-08-06T12:00:00Z', fromLearnerId: 'felix', toLearnerId: 'milo',
      day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'kckern',
    };
    await log.append(entry);
    expect(log.list()).toEqual([entry]);
    // Persisted to the expected file, not just held in memory.
    const raw = await fs.readFile(path.join(dir, 'apps/school/reassignments.yml'), 'utf8');
    expect(raw).toMatch(/fromLearnerId: felix/);
  });

  it('append-only: multiple entries accumulate in order, none overwritten', async () => {
    const log = new YamlReassignmentLog({ configService });
    await log.append({ at: 't1', fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'k' });
    await log.append({ at: 't2', fromLearnerId: 'milo', toLearnerId: 'felix', day: '2026-08-07', assessmentId: 'ses_2', moved: 1, reassignedBy: 'k' });
    expect(log.list().map((e) => e.at)).toEqual(['t1', 't2']);
  });

  it('serializes concurrent appends through the write chain (no lost writes)', async () => {
    const log = new YamlReassignmentLog({ configService });
    await Promise.all([1, 2, 3, 4, 5].map((n) => log.append({ at: `t${n}`, fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: `ses_${n}`, moved: 1, reassignedBy: 'k' })));
    expect(log.list().map((e) => e.assessmentId).sort()).toEqual(['ses_1', 'ses_2', 'ses_3', 'ses_4', 'ses_5']);
  });

  it('has no retract() and list() takes no includeRetracted — an audit trail is never retracted', () => {
    const log = new YamlReassignmentLog({ configService });
    expect(log.retract).toBeUndefined();
  });

  it('a corrupt file refuses to append rather than truncating itself, but reads degrade to empty with a warning', async () => {
    const log = new YamlReassignmentLog({ configService, logger: { error: vi.fn(), info: vi.fn() } });
    await log.append({ at: 't1', fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'k' });
    await fs.writeFile(path.join(dir, 'apps/school/reassignments.yml'), 'entries: { broken', 'utf8');
    const logger = { error: vi.fn(), info: vi.fn() };
    const reread = new YamlReassignmentLog({ configService, logger });
    expect(reread.list()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('school.reassignments.file-corrupt', expect.anything());
    await expect(reread.append({ at: 't2', fromLearnerId: 'milo', toLearnerId: 'felix', day: '2026-08-07', assessmentId: 'ses_2', moved: 1, reassignedBy: 'k' }))
      .rejects.toThrow(/cannot be read/);
  });
});
