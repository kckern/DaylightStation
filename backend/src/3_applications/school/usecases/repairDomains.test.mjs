/**
 * Wave-5 repair domains (spec D1/D2/D3): attestation with real gate-unlock,
 * evidence reassignment as a physical shard move with provenance, and
 * standalone notes riding the review-note delivery surfaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { YamlAttestationLog } from '#adapters/persistence/yaml/YamlAttestationLog.mjs';
import { YamlTeacherNotes } from '#adapters/persistence/yaml/YamlTeacherNotes.mjs';
import { RecordAttestation } from './RecordAttestation.mjs';
import { RecordTeacherNote } from './RecordTeacherNote.mjs';
import { ReassignEvidence } from './ReassignEvidence.mjs';
import { GetMilestoneStatuses } from './GetMilestoneStatuses.mjs';
import { YamlMilestoneStore } from '#adapters/persistence/yaml/YamlMilestoneStore.mjs';
import { GuestForbiddenError, } from '#domains/school/errors.mjs';

let dir;
const configService = { getHouseholdPath: (p) => path.join(dir, p) };
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-')); });

const passingGate = () => ({ assert: vi.fn() });
const refusingGate = () => ({ assert: vi.fn(() => { throw new GuestForbiddenError('no'); }) });

describe('RecordAttestation', () => {
  it('gate-checked, reason mandatory, appended with attribution', async () => {
    const log = new YamlAttestationLog({ configService });
    const uc = new RecordAttestation({ log, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'att_1' });
    const { entry } = await uc.execute({ learnerId: 'felix', unitId: 'math-fractions.02', reason: 'OMR reader was down; graded on paper by hand', attestedBy: 'kckern', pin: '7410' });
    expect(entry).toMatchObject({ id: 'att_1', learnerId: 'felix', unitId: 'math-fractions.02', attestedBy: 'kckern' });
    expect(log.list({ learnerId: 'felix' }).length).toBe(1);
    await expect(uc.execute({ learnerId: 'felix', unitId: 'u', reason: '  ', attestedBy: 'kckern' })).rejects.toThrow(/reason/);
  });

  it('refusal appends nothing', async () => {
    const log = new YamlAttestationLog({ configService });
    const uc = new RecordAttestation({ log, teacherGate: refusingGate() });
    await expect(uc.execute({ learnerId: 'felix', unitId: 'u', reason: 'r', attestedBy: 'felix' })).rejects.toThrow(GuestForbiddenError);
    expect(log.list().length).toBe(0);
  });
});

describe('attestation gate-unlock', () => {
  it('an attested unit counts as met for milestones', async () => {
    const store = new YamlMilestoneStore({ configService });
    await store.replace([{ id: 'm1', learnerId: 'felix', courseId: 'c', unitId: 'math-fractions.02', dueBy: '2026-07-01' }], { editedBy: 'k' });
    const attestations = new YamlAttestationLog({ configService });
    await attestations.append({ id: 'att_1', at: '2026-08-06T12:00:00Z', attestedBy: 'kckern', learnerId: 'felix', unitId: 'math-fractions.02', reason: 'r' });
    const uc = new GetMilestoneStatuses({ store, sessions: { listForLearner: async () => [] }, attestations, clock: () => new Date('2026-08-06T12:00:00Z') });
    const { milestones } = await uc.execute({ learnerId: 'felix' });
    expect(milestones[0].status).toBe('met');
  });
});

describe('RecordTeacherNote', () => {
  it('gate-checked, trimmed, capped at 240', async () => {
    const notes = new YamlTeacherNotes({ configService });
    const uc = new RecordTeacherNote({ notes, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'note_1' });
    const { entry } = await uc.execute({ learnerId: 'felix', note: `  ${'x'.repeat(300)}  `, from: 'kckern' });
    expect(entry.note.length).toBe(240);
    expect(notes.list({ learnerId: 'felix' })[0].id).toBe('note_1');
  });
});

describe('ReassignEvidence', () => {
  const mkDatastore = () => {
    const shards = new Map(); // `${user}:${day}` -> rows
    return {
      shards,
      seed(user, day, rows) { shards.set(`${user}:${day}`, rows); },
      moveAttempts({ fromUserId, toUserId, day, assessmentId, reassignedBy, at }) {
        const from = shards.get(`${fromUserId}:${day}`) ?? [];
        const matches = (a) => (a.sessionId ?? a.provenance?.recordId ?? null) === assessmentId;
        const moving = from.filter(matches);
        shards.set(`${fromUserId}:${day}`, from.filter((a) => !matches(a)));
        const to = shards.get(`${toUserId}:${day}`) ?? [];
        shards.set(`${toUserId}:${day}`, [...to, ...moving.map((a) => ({ ...a, attributedTo: toUserId, reassignedFrom: fromUserId, reassignedBy, reassignedAt: at }))]);
        return moving.length;
      },
    };
  };

  it('moves exactly the named assessment and stamps provenance', async () => {
    const ds = mkDatastore();
    ds.seed('felix', '2026-08-06', [
      { sessionId: 'ses_1', itemId: 'q1', attributedTo: 'felix', at: '2026-08-06T10:00:00Z' },
      { sessionId: 'ses_2', itemId: 'q1', attributedTo: 'felix', at: '2026-08-06T11:00:00Z' },
    ]);
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z') });
    const out = await uc.execute({ fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' });
    expect(out.moved).toBe(1);
    expect(ds.shards.get('felix:2026-08-06').map((a) => a.sessionId)).toEqual(['ses_2']);
    expect(ds.shards.get('milo:2026-08-06')[0]).toMatchObject({ sessionId: 'ses_1', attributedTo: 'milo', reassignedFrom: 'felix', reassignedBy: 'kckern' });
  });

  it('an unknown assessment is a 404-shaped refusal, and from===to is invalid', async () => {
    const ds = mkDatastore();
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate() });
    await expect(uc.execute({ fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ghost', reassignedBy: 'k' })).rejects.toThrow(/attempts/);
    await expect(uc.execute({ fromLearnerId: 'felix', toLearnerId: 'felix', day: '2026-08-06', assessmentId: 's', reassignedBy: 'k' })).rejects.toThrow(/differ/);
  });
});

describe('YamlSchoolDatastore.moveAttempts (real shards)', () => {
  it('moves rows between real day files with provenance, destination-first semantics', async () => {
    const { YamlSchoolDatastore } = await import('#adapters/persistence/yaml/YamlSchoolDatastore.mjs');
    const usersDir = path.join(dir, 'users');
    const ds = new YamlSchoolDatastore({ configService: {
      getDataDir: () => dir,
      getUserProfile: () => ({ id: 'x' }),
      getUserDir: (id) => path.join(usersDir, id),
      getHouseholdPath: (p) => path.join(dir, 'household', p),
    } });
    ds.appendAttempt('felix', { sessionId: 'ses_1', itemId: 'q1', attributedTo: 'felix', at: '2026-08-06T10:00:00.000Z' });
    ds.appendAttempt('felix', { sessionId: 'ses_9', itemId: 'q1', attributedTo: 'felix', at: '2026-08-06T10:05:00.000Z' });
    const moved = ds.moveAttempts({ fromUserId: 'felix', toUserId: 'milo', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern' });
    expect(moved).toBe(1);
    expect(ds.readAttemptDay('felix', '2026-08-06').map((a) => a.sessionId)).toEqual(['ses_9']);
    const landed = ds.readAttemptDay('milo', '2026-08-06');
    expect(landed[0]).toMatchObject({ sessionId: 'ses_1', attributedTo: 'milo', reassignedFrom: 'felix' });
  });
});
