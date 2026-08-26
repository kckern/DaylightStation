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
import { YamlAttestationLog } from './YamlAttestationLog.mjs';
import { YamlTeacherNotes } from './YamlTeacherNotes.mjs';
import { YamlEnrichmentLog } from './YamlEnrichmentLog.mjs';

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
      at: '2026-08-06T12:00:00Z', fromLearnerId: 'learner4', toLearnerId: 'learner3',
      day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'kckern',
    };
    await log.append(entry);
    expect(log.list()).toEqual([entry]);
    // Persisted to the expected file, not just held in memory.
    const raw = await fs.readFile(path.join(dir, 'school/records/reassignments.yml'), 'utf8');
    expect(raw).toMatch(/fromLearnerId: learner4/);
  });

  it('append-only: multiple entries accumulate in order, none overwritten', async () => {
    const log = new YamlReassignmentLog({ configService });
    await log.append({ at: 't1', fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'k' });
    await log.append({ at: 't2', fromLearnerId: 'learner3', toLearnerId: 'learner4', day: '2026-08-07', assessmentId: 'ses_2', moved: 1, reassignedBy: 'k' });
    expect(log.list().map((e) => e.at)).toEqual(['t1', 't2']);
  });

  it('serializes concurrent appends through the write chain (no lost writes)', async () => {
    const log = new YamlReassignmentLog({ configService });
    await Promise.all([1, 2, 3, 4, 5].map((n) => log.append({ at: `t${n}`, fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: `ses_${n}`, moved: 1, reassignedBy: 'k' })));
    expect(log.list().map((e) => e.assessmentId).sort()).toEqual(['ses_1', 'ses_2', 'ses_3', 'ses_4', 'ses_5']);
  });

  it('has no retract() and list() takes no includeRetracted — an audit trail is never retracted', () => {
    const log = new YamlReassignmentLog({ configService });
    expect(log.retract).toBeUndefined();
  });

  it('a corrupt file refuses to append rather than truncating itself, but reads degrade to empty with a warning', async () => {
    const log = new YamlReassignmentLog({ configService, logger: { error: vi.fn(), info: vi.fn() } });
    await log.append({ at: 't1', fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'k' });
    await fs.writeFile(path.join(dir, 'school/records/reassignments.yml'), 'entries: { broken', 'utf8');
    const logger = { error: vi.fn(), info: vi.fn() };
    const reread = new YamlReassignmentLog({ configService, logger });
    expect(reread.list()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('school.reassignments.file-corrupt', expect.anything());
    await expect(reread.append({ at: 't2', fromLearnerId: 'learner3', toLearnerId: 'learner4', day: '2026-08-07', assessmentId: 'ses_2', moved: 1, reassignedBy: 'k' }))
      .rejects.toThrow(/cannot be read/);
  });
});

/**
 * Final-review F2: one rejected append must not WEDGE the write chain for the
 * process lifetime — once the file is fixed, the next append succeeds. All
 * four school append-only logs share the chain skeleton, so all four are held
 * to it.
 */
describe.each([
  ['YamlReassignmentLog', YamlReassignmentLog, 'school/records/reassignments.yml'],
  ['YamlAttestationLog', YamlAttestationLog, 'school/records/attestations.yml'],
  ['YamlTeacherNotes', YamlTeacherNotes, 'school/records/teacher-notes.yml'],
  ['YamlEnrichmentLog', YamlEnrichmentLog, 'school/records/enrichment.yml'],
])('%s write chain recovery', (name, LogClass, filename) => {
  it('append → forced failure (corrupt file) → fix the file → append succeeds (un-wedged)', async () => {
    const log = new LogClass({ configService, logger: { error: vi.fn(), info: vi.fn() } });
    const file = path.join(dir, filename);
    await log.append({ id: 'e1', at: 't1' });
    await fs.writeFile(file, 'entries: { broken', 'utf8');
    await expect(log.append({ id: 'e2', at: 't2' })).rejects.toThrow(/cannot be read/);
    // Restore a readable file (the human fixed it) — the SAME instance must
    // append again without a restart.
    await fs.writeFile(file, 'entries: []\n', 'utf8');
    await log.append({ id: 'e3', at: 't3' });
    expect(log.list().map((e) => e.at)).toEqual(['t3']);
  });
});
