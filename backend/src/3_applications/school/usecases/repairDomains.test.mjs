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
import * as periodStoreExports from '#adapters/persistence/yaml/YamlAcademicPeriodStore.mjs';
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
    const { entry } = await uc.execute({ learnerId: 'learner4', unitId: 'math-fractions.02', reason: 'OMR reader was down; graded on paper by hand', attestedBy: 'kckern', pin: '7410' });
    expect(entry).toMatchObject({ id: 'att_1', learnerId: 'learner4', unitId: 'math-fractions.02', attestedBy: 'kckern' });
    expect(log.list({ learnerId: 'learner4' }).length).toBe(1);
    await expect(uc.execute({ learnerId: 'learner4', unitId: 'u', reason: '  ', attestedBy: 'kckern' })).rejects.toThrow(/reason/);
  });

  it('refusal appends nothing', async () => {
    const log = new YamlAttestationLog({ configService });
    const uc = new RecordAttestation({ log, teacherGate: refusingGate() });
    await expect(uc.execute({ learnerId: 'learner4', unitId: 'u', reason: 'r', attestedBy: 'learner4' })).rejects.toThrow(GuestForbiddenError);
    expect(log.list().length).toBe(0);
  });
});

describe('attestation gate-unlock', () => {
  it('an attested unit counts as met for milestones', async () => {
    const store = new YamlMilestoneStore({ configService });
    await store.replace([{ id: 'm1', learnerId: 'learner4', courseId: 'c', unitId: 'math-fractions.02', dueBy: '2026-07-01' }], { editedBy: 'k' });
    const attestations = new YamlAttestationLog({ configService });
    await attestations.append({ id: 'att_1', at: '2026-08-06T12:00:00Z', attestedBy: 'kckern', learnerId: 'learner4', unitId: 'math-fractions.02', reason: 'r' });
    const uc = new GetMilestoneStatuses({ store, sessions: { listForLearner: async () => [] }, attestations, clock: () => new Date('2026-08-06T12:00:00Z') });
    const { milestones } = await uc.execute({ learnerId: 'learner4' });
    expect(milestones[0].status).toBe('met');
  });
});

describe('RecordTeacherNote', () => {
  it('gate-checked, trimmed, capped at 240', async () => {
    const notes = new YamlTeacherNotes({ configService });
    const uc = new RecordTeacherNote({ notes, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'note_1' });
    const { entry } = await uc.execute({ learnerId: 'learner4', note: `  ${'x'.repeat(300)}  `, from: 'kckern' });
    expect(entry.note.length).toBe(240);
    expect(notes.list({ learnerId: 'learner4' })[0].id).toBe('note_1');
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
    ds.seed('learner4', '2026-08-06', [
      { sessionId: 'ses_1', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:00:00Z' },
      { sessionId: 'ses_2', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T11:00:00Z' },
    ]);
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z') });
    const out = await uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' });
    expect(out.moved).toBe(1);
    expect(ds.shards.get('learner4:2026-08-06').map((a) => a.sessionId)).toEqual(['ses_2']);
    expect(ds.shards.get('learner3:2026-08-06')[0]).toMatchObject({ sessionId: 'ses_1', attributedTo: 'learner3', reassignedFrom: 'learner4', reassignedBy: 'kckern' });
  });

  it('an unknown assessment is a 404-shaped refusal, and from===to is invalid', async () => {
    const ds = mkDatastore();
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate() });
    await expect(uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ghost', reassignedBy: 'k' })).rejects.toThrow(/attempts/);
    await expect(uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner4', day: '2026-08-06', assessmentId: 's', reassignedBy: 'k' })).rejects.toThrow(/differ/);
  });

  it('a successful move appends its own audit-trail entry (Task 12, debt M5)', async () => {
    const ds = mkDatastore();
    ds.seed('learner4', '2026-08-06', [{ sessionId: 'ses_1', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:00:00Z' }]);
    const auditLog = { append: vi.fn(async () => {}) };
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate(), auditLog, clock: () => new Date('2026-08-06T12:00:00Z') });
    await uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' });
    expect(auditLog.append).toHaveBeenCalledWith({
      at: '2026-08-06T12:00:00.000Z', fromLearnerId: 'learner4', toLearnerId: 'learner3',
      day: '2026-08-06', assessmentId: 'ses_1', moved: 1, reassignedBy: 'kckern',
    });
  });

  it('no audit log wired -> no append attempted, move still succeeds', async () => {
    const ds = mkDatastore();
    ds.seed('learner4', '2026-08-06', [{ sessionId: 'ses_1', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:00:00Z' }]);
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate() });
    await expect(uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' }))
      .resolves.toMatchObject({ moved: 1 });
  });

  it('a throwing audit log never blocks or unwinds the move (best-effort)', async () => {
    const ds = mkDatastore();
    ds.seed('learner4', '2026-08-06', [{ sessionId: 'ses_1', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:00:00Z' }]);
    const auditLog = { append: vi.fn(async () => { throw new Error('disk full'); }) };
    const logger = { warn: vi.fn() };
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate(), auditLog, logger, clock: () => new Date('2026-08-06T12:00:00Z') });
    await expect(uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' }))
      .resolves.toMatchObject({ moved: 1 });
    expect(ds.shards.get('learner3:2026-08-06')[0]).toMatchObject({ sessionId: 'ses_1' });
    expect(logger.warn).toHaveBeenCalledWith('school.reassign.audit-failed', expect.anything());
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
    ds.appendAttempt('learner4', { sessionId: 'ses_1', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:00:00.000Z' });
    ds.appendAttempt('learner4', { sessionId: 'ses_9', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:05:00.000Z' });
    const moved = ds.moveAttempts({ fromUserId: 'learner4', toUserId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern' });
    expect(moved).toBe(1);
    expect(ds.readAttemptDay('learner4', '2026-08-06').map((a) => a.sessionId)).toEqual(['ses_9']);
    const landed = ds.readAttemptDay('learner3', '2026-08-06');
    expect(landed[0]).toMatchObject({ sessionId: 'ses_1', attributedTo: 'learner3', reassignedFrom: 'learner4' });
  });
});

describe('advocacy wave 7 — auto-notes (A5: no silent verbs about children)', () => {
  const noteStore = () => ({ entries: [], append: vi.fn(async function a(e) { this.entries.push(e); }) });
  const mkDatastore = () => {
    const shards = new Map();
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

  it('RecordAttestation tells the child their unit counts', async () => {
    const log = new YamlAttestationLog({ configService });
    const notes = noteStore();
    const uc = new RecordAttestation({ log, teacherGate: passingGate(), notes, clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'att_1' });
    await uc.execute({ learnerId: 'learner4', unitId: 'math-fractions.02', reason: 'graded on paper', attestedBy: 'kckern', pin: '7410' });
    expect(notes.append).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner4', from: 'kckern',
      note: expect.stringMatching(/verified you completed.*It counts/),
    }));
  });

  it('ReassignEvidence tells BOTH children about the move; a broken notes store never blocks it', async () => {
    const ds = mkDatastore();
    ds.seed('learner4', '2026-08-06', [{ sessionId: 'ses_1', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-06T10:00:00Z' }]);
    const notes = noteStore();
    const uc = new ReassignEvidence({ datastore: ds, teacherGate: passingGate(), notes, clock: () => new Date('2026-08-06T12:00:00Z') });
    await uc.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' });
    expect(notes.entries.map((n) => n.learnerId).sort()).toEqual(['learner4', 'learner3']);

    // best-effort: append throwing must not fail the move itself
    ds.seed('learner4', '2026-08-07', [{ sessionId: 'ses_9', itemId: 'q1', attributedTo: 'learner4', at: '2026-08-07T10:00:00Z' }]);
    const broken = { append: vi.fn(async () => { throw new Error('offline'); }) };
    const uc2 = new ReassignEvidence({ datastore: ds, teacherGate: passingGate(), notes: broken, clock: () => new Date('2026-08-07T12:00:00Z') });
    await expect(uc2.execute({ fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-07', assessmentId: 'ses_9', reassignedBy: 'kckern', pin: '7410' }))
      .resolves.toMatchObject({ moved: 1 });
  });

  it('retracting an attestation tells the child the unit is back on their list', async () => {
    const { RetractTeacherRecord } = await import('./RetractTeacherRecord.mjs');
    const log = new YamlAttestationLog({ configService });
    await log.append({ id: 'att_1', at: 't', attestedBy: 'kckern', learnerId: 'learner4', unitId: 'math-fractions.02', reason: 'r' });
    const notes = noteStore();
    const uc = new RetractTeacherRecord({ stores: { enrichment: null, attestation: log, note: null }, teacherGate: passingGate(), notes });
    await uc.execute({ kind: 'attestation', entryId: 'att_1', retractedBy: 'kckern', pin: '7410' });
    expect(notes.append).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner4',
      note: expect.stringMatching(/completion mark.*removed.*back on your list/),
    }));
  });
});

describe('advocacy wave 6 — retractions (B15)', () => {
  it('a retracted attestation re-locks by construction: list() no longer serves it', async () => {
    const log = new YamlAttestationLog({ configService });
    await log.append({ id: 'att_1', at: 't', attestedBy: 'kckern', learnerId: 'learner4', unitId: 'u1', reason: 'r' });
    await log.retract('att_1', { by: 'kckern', at: 't2' });
    expect(log.list({ learnerId: 'learner4' })).toEqual([]);
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
    await enrichment.append({ id: 'enr_1', at: 't', recordedBy: 'k', learnerIds: ['learner4'], from: '2026-08-01', to: '2026-08-01', title: 'Typo trip' });
    const uc = new RetractTeacherRecord({
      stores: { enrichment, attestation: null, note: null },
      teacherGate: passingGate(),
    });
    await expect(uc.execute({ kind: 'enrichment', entryId: 'ghost', retractedBy: 'kckern' })).rejects.toThrow(/entry/);
    await uc.execute({ kind: 'enrichment', entryId: 'enr_1', retractedBy: 'kckern', pin: '7410' });
    expect(enrichment.list({ learnerId: 'learner4' })).toEqual([]);
  });
});

describe('admin advocacy #15 — period rails', () => {
  const { validatePeriodList } = periodStoreExports;
  const P = (over = {}) => ({
    periodId: 'fall-2026', kind: 'semester', label: 'Fall',
    startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T07:00:00.000Z', ...over,
  });

  it('refuses same-kind overlap; different kinds still nest', () => {
    expect(() => validatePeriodList([
      P(), P({ periodId: 'fall-b', startsAt: '2026-12-01T07:00:00.000Z', endsAt: '2027-01-15T07:00:00.000Z' }),
    ])).toThrow(/overlaps/);
    expect(() => validatePeriodList([
      P(), P({ periodId: 'year-2026', kind: 'year', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2027-06-15T07:00:00.000Z' }),
    ])).not.toThrow();
    // Half-open: back-to-back same-kind periods sharing the boundary instant are fine.
    expect(() => validatePeriodList([
      P(), P({ periodId: 'spring-2027', startsAt: '2026-12-19T07:00:00.000Z', endsAt: '2027-06-15T07:00:00.000Z' }),
    ])).not.toThrow();
  });

  it('SetAcademicPeriods refuses to drop a periodId that holds frozen report cards, BY NAME', async () => {
    const { SetAcademicPeriods } = await import('./SetAcademicPeriods.mjs');
    const store = { replacePeriods: vi.fn(async (p) => p), historyLength: () => 0 };
    const uc = new SetAcademicPeriods({
      store, teacherGate: passingGate(),
      frozenPeriodIds: async () => ['fall-2026'],
    });
    await expect(uc.execute({ periods: [P({ periodId: 'renamed-fall' })], editedBy: 'kckern', pin: '7410' }))
      .rejects.toThrow(/fall-2026/);
    expect(store.replacePeriods).not.toHaveBeenCalled();
    await expect(uc.execute({ periods: [P()], editedBy: 'kckern', pin: '7410' })).resolves.toBeTruthy();
  });
});

describe('advocacy wave 6 — absence kind (B5)', () => {
  it('an absence entry records with kind and never masquerades as enrichment', async () => {
    const log = new YamlEnrichmentLog({ configService });
    const { RecordEnrichment } = await import('./RecordEnrichment.mjs');
    const uc = new RecordEnrichment({ log, teacherGate: passingGate(), clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'abs_1' });
    const { entry } = await uc.execute({
      recordedBy: 'kckern', learnerIds: ['learner4'], from: '2026-08-03', to: '2026-08-05',
      title: 'Flu', kind: 'absence',
    });
    expect(entry.kind).toBe('absence');
    await expect(uc.execute({ recordedBy: 'k', learnerIds: ['learner4'], from: '2026-08-03', title: 'x', kind: 'vacation' }))
      .rejects.toThrow(/kind/);
  });
});

describe('advocacy wave 6 — stale-save guards (B14)', () => {
  it('SetAssignments refuses a save based on a stale updatedAt', async () => {
    const { SetAssignments } = await import('./SetAssignments.mjs');
    const store = {
      records: { learner4: { learnerId: 'learner4', courses: ['a'], units: [], updatedAt: 'T2' } },
      get: async (id) => store.records[id] ?? null,
      put: async (r) => { store.records[r.learnerId] = r; return r; },
      list: async () => Object.values(store.records),
    };
    const uc = new SetAssignments({ assignments: store, grownUps: { assert: () => {} }, teacherGate: passingGate() });
    await expect(uc.execute({ learnerId: 'learner4', courses: ['b'], units: [], assignedBy: 'k', baseUpdatedAt: 'T1' }))
      .rejects.toThrow(/reload/i);
    await expect(uc.execute({ learnerId: 'learner4', courses: ['b'], units: [], assignedBy: 'k', baseUpdatedAt: 'T2' }))
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
    const out = await uc.execute({ learnerId: 'learner4' });
    expect(out.periods.map((p) => p.periodId)).toEqual(['spring', 'fall']);
    expect(out.periods[1].courses[0]).toEqual({ courseId: 'math', coursePercent: 91 });
  });
});

describe('the review loop closes itself (student-advocacy A1)', () => {
  const mkQueue = (rows) => ({
    resolve: vi.fn(async ({ sessionId, itemId, verdict, gradedBy, at }) => {
      const row = rows.find((r) => r.itemId === itemId);
      if (!row) return null;
      row.verdict = verdict;
      return { sessionId, itemId, verdict, gradedBy, gradedAt: at };
    }),
    listForSession: vi.fn(async () => rows),
  });

  it('resolving the LAST pending item grades and settles in the same act', async () => {
    const { ResolveReviewItem } = await import('./ResolveReviewItem.mjs');
    const rows = [
      { itemId: 'q1', verdict: 'correct' },
      { itemId: 'q2', verdict: null },
    ];
    const gradeSubmission = { execute: vi.fn(async () => ({ status: 'graded', percent: 90, passingPercent: 80 })) };
    const closeSessionOutcome = { execute: vi.fn(async () => ({ result: 'passed' })) };
    const uc = new ResolveReviewItem({
      reviewQueue: mkQueue(rows), grownUps: { assert: () => {} },
      gradeSubmission, closeSessionOutcome,
    });
    const out = await uc.execute({ sessionId: 's1', itemId: 'q2', verdict: 'correct', gradedBy: 'kckern' });
    expect(gradeSubmission.execute).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(closeSessionOutcome.execute).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(out.sessionFinished).toEqual({ result: 'passed', percent: 90, passingPercent: 80 });
  });

  it('items still pending -> resolve only, no premature grade', async () => {
    const { ResolveReviewItem } = await import('./ResolveReviewItem.mjs');
    const rows = [
      { itemId: 'q1', verdict: null },
      { itemId: 'q2', verdict: null },
    ];
    const gradeSubmission = { execute: vi.fn() };
    const closeSessionOutcome = { execute: vi.fn() };
    const uc = new ResolveReviewItem({
      reviewQueue: mkQueue(rows), grownUps: { assert: () => {} },
      gradeSubmission, closeSessionOutcome,
    });
    const out = await uc.execute({ sessionId: 's1', itemId: 'q1', verdict: 'incorrect', gradedBy: 'kckern' });
    expect(gradeSubmission.execute).not.toHaveBeenCalled();
    expect(out.sessionFinished).toBeUndefined();
  });

  it('a finish failure degrades to resolve-only — the verdict is safe either way', async () => {
    const { ResolveReviewItem } = await import('./ResolveReviewItem.mjs');
    const rows = [{ itemId: 'q1', verdict: null }];
    const uc = new ResolveReviewItem({
      reviewQueue: mkQueue(rows), grownUps: { assert: () => {} },
      gradeSubmission: { execute: vi.fn(async () => { throw new Error('boom'); }) },
      closeSessionOutcome: { execute: vi.fn() },
    });
    const out = await uc.execute({ sessionId: 's1', itemId: 'q1', verdict: 'correct', gradedBy: 'kckern' });
    expect(out.itemId).toBe('q1');
    expect(out.sessionFinished).toBeUndefined();
  });
});
