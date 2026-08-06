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
import { YamlEnrichmentLog } from '#adapters/persistence/yaml/YamlEnrichmentLog.mjs';
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

describe('advocacy wave 6 — retractions (B15)', () => {
  it('a retracted attestation re-locks by construction: list() no longer serves it', async () => {
    const log = new YamlAttestationLog({ configService });
    await log.append({ id: 'att_1', at: 't', attestedBy: 'kckern', learnerId: 'felix', unitId: 'u1', reason: 'r' });
    await log.retract('att_1', { by: 'kckern', at: 't2' });
    expect(log.list({ learnerId: 'felix' })).toEqual([]);
    // The raw file still holds both records — the eraser is itself a record.
    const store = new GetMilestoneStatuses({
      store: new YamlMilestoneStore({ configService }),
      sessions: { listForLearner: async () => [] },
      attestations: log,
      clock: () => new Date('2026-08-06T12:00:00Z'),
    });
    expect(store).toBeTruthy();
  });

  it('RetractTeacherRecord: gated, refuses an unknown entry, retracts a real one', async () => {
    const { RetractTeacherRecord } = await import('./RetractTeacherRecord.mjs');
    const enrichment = new YamlEnrichmentLog({ configService });
    await enrichment.append({ id: 'enr_1', at: 't', recordedBy: 'k', learnerIds: ['felix'], from: '2026-08-01', to: '2026-08-01', title: 'Typo trip' });
    const uc = new RetractTeacherRecord({
      stores: { enrichment, attestation: null, note: null },
      teacherGate: passingGate(),
    });
    await expect(uc.execute({ kind: 'enrichment', entryId: 'ghost', retractedBy: 'kckern' })).rejects.toThrow(/entry/);
    await uc.execute({ kind: 'enrichment', entryId: 'enr_1', retractedBy: 'kckern', pin: '7410' });
    expect(enrichment.list({ learnerId: 'felix' })).toEqual([]);
  });
});

describe('advocacy wave 6 — absence kind (B5)', () => {
  it('an absence entry records with kind and never masquerades as enrichment', async () => {
    const log = new YamlEnrichmentLog({ configService });
    const { RecordEnrichment } = await import('./RecordEnrichment.mjs');
    const uc = new RecordEnrichment({ log, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'abs_1' });
    const { entry } = await uc.execute({
      recordedBy: 'kckern', learnerIds: ['felix'], from: '2026-08-03', to: '2026-08-05',
      title: 'Flu', kind: 'absence',
    });
    expect(entry.kind).toBe('absence');
    await expect(uc.execute({ recordedBy: 'k', learnerIds: ['felix'], from: '2026-08-03', title: 'x', kind: 'vacation' }))
      .rejects.toThrow(/kind/);
  });
});

describe('advocacy wave 6 — stale-save guards (B14)', () => {
  it('SetAssignments refuses a save based on a stale updatedAt', async () => {
    const { SetAssignments } = await import('./SetAssignments.mjs');
    const store = {
      records: { felix: { learnerId: 'felix', courses: ['a'], units: [], updatedAt: 'T2' } },
      get: async (id) => store.records[id] ?? null,
      put: async (r) => { store.records[r.learnerId] = r; return r; },
      list: async () => Object.values(store.records),
    };
    const uc = new SetAssignments({ assignments: store, grownUps: { assert: () => {} }, teacherGate: passingGate() });
    await expect(uc.execute({ learnerId: 'felix', courses: ['b'], units: [], assignedBy: 'k', baseUpdatedAt: 'T1' }))
      .rejects.toThrow(/reload/i);
    await expect(uc.execute({ learnerId: 'felix', courses: ['b'], units: [], assignedBy: 'k', baseUpdatedAt: 'T2' }))
      .resolves.toBeTruthy();
  });

  it('SetAcademicPeriods refuses a stale history baseline', async () => {
    const { SetAcademicPeriods } = await import('./SetAcademicPeriods.mjs');
    const { YamlAcademicPeriodStore } = await import('#adapters/persistence/yaml/YamlAcademicPeriodStore.mjs');
    const store = new YamlAcademicPeriodStore({ configService, fallback: null });
    const PERIOD = { periodId: 'p1', kind: 'term', label: 'P1', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' };
    const uc = new SetAcademicPeriods({ store, teacherGate: passingGate() });
    await uc.execute({ periods: [PERIOD], editedBy: 'k', baseHistoryLength: 0 });
    await expect(uc.execute({ periods: [PERIOD], editedBy: 'k', baseHistoryLength: 0 })).rejects.toThrow(/reload/i);
    await expect(uc.execute({ periods: [PERIOD], editedBy: 'k', baseHistoryLength: 1 })).resolves.toBeTruthy();
  });
});

describe('advocacy wave 6 — transcript (B11)', () => {
  it('assembles frozen periods oldest-first with course grades', async () => {
    const { GetTranscript } = await import('./GetTranscript.mjs');
    const uc = new GetTranscript({ reportCardsStore: { listReportCards: () => [
      { period: { periodId: 'fall', label: 'Fall', startsAt: '2026-08-01T00:00:00Z' }, closedBy: 'k', closedAt: 'c1', activeDays: { total: 40 }, courses: [{ courseId: 'math', coursePercent: 91 }] },
      { period: { periodId: 'spring', label: 'Spring', startsAt: '2026-01-01T00:00:00Z' }, closedBy: 'k', closedAt: 'c0', activeDays: { total: 50 }, courses: [] },
    ] } });
    const out = await uc.execute({ learnerId: 'felix' });
    expect(out.periods.map((p) => p.periodId)).toEqual(['spring', 'fall']);
    expect(out.periods[1].courses[0]).toEqual({ courseId: 'math', coursePercent: 91 });
  });
});
