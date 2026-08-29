import { describe, it, expect, vi } from 'vitest';
import { ManageProgramDayBypass } from './ManageProgramDayBypass.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

/** In-memory stand-in for YamlProgramDayBypassStore, same four-method surface. */
const fakeStore = (seed = []) => {
  const records = [...seed];
  const active = () => records.filter((r) => r.operation === 'applied'
    && !records.some((x) => x.operation === 'retracted' && x.bypassId === r.bypassId));
  return {
    records,
    list: async () => records,
    append: async (r) => { records.push(r); return r; },
    active: async () => active(),
    activeFor: async ({ learnerId, programId, studyDate }) => active().find(
      (r) => r.learnerId === learnerId && r.programId === programId && r.studyDate === studyDate,
    ) ?? null,
  };
};

const fakeAssignments = (enrolled = true) => ({
  get: async () => ({ programs: enrolled ? [{ programId: 'piano-course', courseId: 'plex:1' }] : [] }),
});

const fakeGate = (allow = true) => ({
  assert: vi.fn(() => { if (!allow) throw new Error('refused'); }),
});

describe('ManageProgramDayBypass.grant', () => {
  it('requires a reason', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.grant({ learnerId: 'kid1', reason: '', decidedBy: 'kckern' })).rejects.toThrow(ValidationError);
  });

  it('requires learnerId', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.grant({ learnerId: '', reason: 'x', decidedBy: 'kckern' })).rejects.toThrow(ValidationError);
  });

  it('refuses a learner not enrolled in the program', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(false), teacherGate: fakeGate() });
    await expect(uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' })).rejects.toThrow(EntityNotFoundError);
  });

  it('asserts via teacherGate and propagates a refusal', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(false) });
    await expect(uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' })).rejects.toThrow('refused');
  });

  it('grants, stamping studyDate from the injected clock/timezone', async () => {
    const store = fakeStore();
    const uc = new ManageProgramDayBypass({
      store, assignments: fakeAssignments(), teacherGate: fakeGate(),
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-27T20:00:00Z'), // 13:00 PDT
    });
    const record = await uc.grant({ learnerId: 'kid1', reason: 'Recital', decidedBy: 'kckern' });
    expect(record.studyDate).toBe('2026-08-27');
    expect(record.operation).toBe('applied');
    expect(record.reason).toBe('Recital');
    expect(store.records).toHaveLength(1);
  });

  it('files a small-hours grant under the PREVIOUS study day (4am boundary)', async () => {
    // 2026-08-28T09:00Z = 02:00 PDT on the 28th — before the 4am boundary,
    // so it belongs to the study day that began on the 27th.
    const uc = new ManageProgramDayBypass({
      store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(),
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-28T09:00:00Z'),
    });
    const record = await uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' });
    expect(record.studyDate).toBe('2026-08-27');
  });

  it('is idempotent — a second grant the same day returns the existing record, no duplicate', async () => {
    const store = fakeStore();
    const uc = new ManageProgramDayBypass({
      store, assignments: fakeAssignments(), teacherGate: fakeGate(),
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-27T20:00:00Z'),
    });
    const first = await uc.grant({ learnerId: 'kid1', reason: 'Recital', decidedBy: 'kckern' });
    const second = await uc.grant({ learnerId: 'kid1', reason: 'Recital again', decidedBy: 'kckern' });
    expect(second.bypassId).toBe(first.bypassId);
    expect(store.records.filter((r) => r.operation === 'applied')).toHaveLength(1);
  });

  it('broadcasts program-day-bypass-changed on the school topic', async () => {
    const broadcast = vi.fn();
    const uc = new ManageProgramDayBypass({
      store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(),
      realtime: { programDayBypassChanged: (payload) => broadcast('school', { event: 'program-day-bypass-changed', ...payload }) }, clock: () => new Date('2026-08-27T20:00:00Z'),
    });
    await uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' });
    expect(broadcast).toHaveBeenCalledWith('school', expect.objectContaining({
      event: 'program-day-bypass-changed', learnerId: 'kid1', active: true,
    }));
  });

  it('a dead event bus does not fail the grant', async () => {
    const uc = new ManageProgramDayBypass({
      store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(),
      realtime: { programDayBypassChanged: () => { throw new Error('bus down'); } },
      logger: { warn() {} },
    });
    await expect(uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' })).resolves.toBeTruthy();
  });
});

describe('ManageProgramDayBypass.retract', () => {
  it('404s an unknown/inactive bypassId', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.retract({ bypassId: 'nope', reason: 'x', retractedBy: 'kckern' })).rejects.toThrow(EntityNotFoundError);
  });

  it('requires a reason', async () => {
    const store = fakeStore([{ operation: 'applied', bypassId: 'pdb_1', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' }]);
    const uc = new ManageProgramDayBypass({ store, assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.retract({ bypassId: 'pdb_1', reason: '', retractedBy: 'kckern' })).rejects.toThrow(ValidationError);
  });

  it('retracts an active bypass and broadcasts active:false', async () => {
    const broadcast = vi.fn();
    const store = fakeStore([{
      schema: 'school.program-day-bypass/v1', operation: 'applied', bypassId: 'pdb_1',
      learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27',
    }]);
    const uc = new ManageProgramDayBypass({ store, assignments: fakeAssignments(), teacherGate: fakeGate(), realtime: { programDayBypassChanged: (payload) => broadcast('school', { event: 'program-day-bypass-changed', ...payload }) } });
    const record = await uc.retract({ bypassId: 'pdb_1', reason: 'wrong kid', retractedBy: 'kckern' });
    expect(record.operation).toBe('retracted');
    expect(await store.active()).toEqual([]);
    expect(broadcast).toHaveBeenCalledWith('school', expect.objectContaining({
      event: 'program-day-bypass-changed', learnerId: 'kid1', active: false,
    }));
  });
});

describe('ManageProgramDayBypass.list', () => {
  it('filters to one learner when given', async () => {
    const store = fakeStore([
      { operation: 'applied', bypassId: 'a', learnerId: 'kid1', studyDate: '2026-08-27' },
      { operation: 'applied', bypassId: 'b', learnerId: 'kid2', studyDate: '2026-08-27' },
    ]);
    const uc = new ManageProgramDayBypass({ store, assignments: fakeAssignments(), teacherGate: fakeGate() });
    const result = await uc.list({ learnerId: 'kid1' });
    expect(result.active.map((r) => r.bypassId)).toEqual(['a']);
    expect(result.history.map((r) => r.bypassId)).toEqual(['a']);
  });

  it('returns every learner when no filter is given', async () => {
    const store = fakeStore([
      { operation: 'applied', bypassId: 'a', learnerId: 'kid1', studyDate: '2026-08-27' },
      { operation: 'applied', bypassId: 'b', learnerId: 'kid2', studyDate: '2026-08-27' },
    ]);
    const uc = new ManageProgramDayBypass({ store, assignments: fakeAssignments(), teacherGate: fakeGate() });
    const result = await uc.list();
    expect(result.active).toHaveLength(2);
  });
});
