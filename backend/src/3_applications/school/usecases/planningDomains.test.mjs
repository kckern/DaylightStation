/**
 * Wave-3 planning domains (teacher-console plan W3-1..W3-4): the periods
 * config→data promotion, pass-criteria overrides, milestones, and the
 * enrichment log — stores, domain rules, and gated use cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { YamlAcademicPeriodStore } from '#adapters/persistence/yaml/YamlAcademicPeriodStore.mjs';
import { YamlPassOverrideStore } from '#adapters/persistence/yaml/YamlPassOverrideStore.mjs';
import { YamlMilestoneStore } from '#adapters/persistence/yaml/YamlMilestoneStore.mjs';
import { YamlEnrichmentLog } from '#adapters/persistence/yaml/YamlEnrichmentLog.mjs';
import { validateMilestone, milestoneStatus } from '#domains/school/milestones.mjs';
import { SetAcademicPeriods } from './SetAcademicPeriods.mjs';
import { SetPassOverride } from './SetPassOverride.mjs';
import { SetMilestones } from './SetMilestones.mjs';
import { GetMilestoneStatuses } from './GetMilestoneStatuses.mjs';
import { RecordEnrichment } from './RecordEnrichment.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

let dir;
const configService = { getHouseholdPath: (p) => path.join(dir, p) };
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planning-'));
});

const PERIOD = {
  periodId: '2026-fall', kind: 'semester', label: 'Fall 2026',
  startsAt: '2026-08-24T00:00:00.000Z', endsAt: '2026-12-19T00:00:00.000Z',
};
const passingGate = () => ({ assert: vi.fn() });
const refusingGate = () => ({ assert: vi.fn(() => { throw new GuestForbiddenError('no'); }) });

describe('YamlAcademicPeriodStore', () => {
  it('serves the fallback until the first write, then the data file wins', async () => {
    const fallback = { listPeriods: () => [{ ...PERIOD, periodId: 'config-era' }] };
    const store = new YamlAcademicPeriodStore({ configService, fallback });
    expect(store.listPeriods().map((p) => p.periodId)).toEqual(['config-era']);
    await store.replacePeriods([PERIOD], { editedBy: 'kckern', at: '2026-08-06T12:00:00Z' });
    expect(store.listPeriods().map((p) => p.periodId)).toEqual(['2026-fall']);
    const fresh = new YamlAcademicPeriodStore({ configService, fallback });
    expect(fresh.listPeriods().map((p) => p.periodId)).toEqual(['2026-fall']);
    expect(fresh.getPeriod('2026-fall').label).toBe('Fall 2026');
  });

  it('refuses an invalid or duplicate period without writing', async () => {
    const store = new YamlAcademicPeriodStore({ configService, fallback: null });
    await expect(store.replacePeriods([{ ...PERIOD, startsAt: 'nope' }], { editedBy: 'k' }))
      .rejects.toThrow(/startsAt|canonical/i);
    await expect(store.replacePeriods([PERIOD, PERIOD], { editedBy: 'k' }))
      .rejects.toThrow(/duplicate/i);
    expect(store.listPeriods()).toEqual([]);
  });

  it('every replace appends to history', async () => {
    const store = new YamlAcademicPeriodStore({ configService, fallback: null });
    await store.replacePeriods([PERIOD], { editedBy: 'kckern', at: 't1' });
    await store.replacePeriods([{ ...PERIOD, label: 'Fall!' }], { editedBy: 'liz', at: 't2' });
    const raw = await fs.readFile(path.join(dir, 'school/plans/periods.yml'), 'utf8');
    expect(raw).toContain('t1');
    expect(raw).toContain('t2');
    expect(raw).toContain('editedBy: liz');
  });
});

describe('YamlPassOverrideStore', () => {
  it('set/get/clear with history', async () => {
    const store = new YamlPassOverrideStore({ configService });
    expect(store.percentFor('math-fractions.01')).toBe(null);
    await store.set('math-fractions.01', 70, { editedBy: 'kckern', at: 't1' });
    expect(store.percentFor('math-fractions.01')).toBe(70);
    expect(store.all()).toEqual({ 'math-fractions.01': 70 });
    await store.set('math-fractions.01', null, { editedBy: 'kckern', at: 't2' });
    expect(store.percentFor('math-fractions.01')).toBe(null);
    expect(store.all()).toEqual({});
  });
});

describe('milestones domain', () => {
  it('validateMilestone enforces shape', () => {
    expect(validateMilestone({ id: 'm1', learnerId: 'felix', courseId: 'math', unitId: 'math.04', dueBy: '2026-10-01' }).errors).toEqual([]);
    expect(validateMilestone({ id: 'm1', learnerId: 'felix', courseId: 'math', unitId: 'math.04', dueBy: 'oct 1' }).errors.length).toBeGreaterThan(0);
    expect(validateMilestone({ learnerId: 'felix', courseId: 'math', unitId: 'math.04', dueBy: '2026-10-01' }).errors.length).toBeGreaterThan(0);
  });

  it('milestoneStatus: met beats the calendar; behind only past due; else upcoming', () => {
    const m = { id: 'm1', unitId: 'math.04', dueBy: '2026-10-01' };
    expect(milestoneStatus(m, { passedUnitIds: new Set(['math.04']), today: '2026-12-01' })).toBe('met');
    expect(milestoneStatus(m, { passedUnitIds: new Set(), today: '2026-10-02' })).toBe('behind');
    expect(milestoneStatus(m, { passedUnitIds: new Set(), today: '2026-09-01' })).toBe('upcoming');
    expect(milestoneStatus(m, { passedUnitIds: new Set(), today: '2026-10-01' })).toBe('upcoming'); // due day itself is not behind
  });
});

describe('gated planning use cases', () => {
  it('SetAcademicPeriods: gate first, then validate+write', async () => {
    const store = new YamlAcademicPeriodStore({ configService, fallback: null });
    const gate = passingGate();
    const uc = new SetAcademicPeriods({ store, teacherGate: gate, clock: () => new Date('2026-08-06T00:00:00Z') });
    const out = await uc.execute({ periods: [PERIOD], editedBy: 'kckern', pin: '7410' });
    expect(gate.assert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'kckern', pin: '7410', action: 'periods.edit' }));
    expect(out.periods.map((p) => p.periodId)).toEqual(['2026-fall']);
    expect(store.listPeriods().length).toBe(1);
  });

  it('SetAcademicPeriods: refusal writes nothing', async () => {
    const store = new YamlAcademicPeriodStore({ configService, fallback: null });
    const uc = new SetAcademicPeriods({ store, teacherGate: refusingGate() });
    await expect(uc.execute({ periods: [PERIOD], editedBy: 'felix' })).rejects.toThrow(GuestForbiddenError);
    expect(store.listPeriods()).toEqual([]);
  });

  it('SetPassOverride validates the percent and clears with null', async () => {
    const store = new YamlPassOverrideStore({ configService });
    const uc = new SetPassOverride({ store, teacherGate: passingGate(), clock: () => new Date() });
    await uc.execute({ unitId: 'math.01', percent: 65, editedBy: 'kckern' });
    expect(store.percentFor('math.01')).toBe(65);
    await expect(uc.execute({ unitId: 'math.01', percent: 105, editedBy: 'kckern' })).rejects.toThrow(/1.100|percent/i);
    await uc.execute({ unitId: 'math.01', percent: null, editedBy: 'kckern' });
    expect(store.percentFor('math.01')).toBe(null);
  });

  it('SetMilestones is learner-scoped: validates every entry and preserves the siblings', async () => {
    const store = new YamlMilestoneStore({ configService });
    await store.replace([{ id: 'mx', learnerId: 'milo', courseId: 'math', unitId: 'math.01', dueBy: '2026-09-01' }], { editedBy: 'k' });
    const uc = new SetMilestones({ store, teacherGate: passingGate(), clock: () => new Date() });
    const good = { id: 'm1', courseId: 'math', unitId: 'math.04', dueBy: '2026-10-01' };
    await uc.execute({ learnerId: 'felix', milestones: [good], editedBy: 'kckern' });
    expect(store.list().map((m) => m.id).sort()).toEqual(['m1', 'mx']);
    await expect(uc.execute({ learnerId: 'felix', milestones: [{ ...good, dueBy: 'later' }], editedBy: 'kckern' })).rejects.toThrow(/dueBy/);
    expect(store.list().length).toBe(2);
  });

  it('GetMilestoneStatuses joins passed sessions, scoped to the learner', async () => {
    const store = new YamlMilestoneStore({ configService });
    await store.replace([
      { id: 'm1', learnerId: 'felix', courseId: 'math', unitId: 'math.04', dueBy: '2026-07-01' },
      { id: 'm2', learnerId: 'felix', courseId: 'math', unitId: 'math.05', dueBy: '2026-07-01' },
      { id: 'm3', learnerId: 'milo', courseId: 'math', unitId: 'math.04', dueBy: '2026-07-01' },
    ], { editedBy: 'k', at: 't' });
    // The REAL repo fact shape: result lives under `outcome`, never top-level.
    const sessions = { listForLearner: async () => [
      { unitId: 'math.04', outcome: { result: 'passed' } },
      { unitId: 'math.05', outcome: { result: 'needs_remediation' } },
    ] };
    const uc = new GetMilestoneStatuses({ store, sessions, clock: () => new Date('2026-08-06T12:00:00Z') });
    const out = await uc.execute({ learnerId: 'felix' });
    expect(out.milestones.map((m) => [m.id, m.status])).toEqual([['m1', 'met'], ['m2', 'behind']]);
  });

  it('RecordEnrichment appends an attributed entry', async () => {
    const log = new YamlEnrichmentLog({ configService });
    const uc = new RecordEnrichment({
      log, teacherGate: passingGate(),
      clock: () => new Date('2026-08-06T12:00:00Z'), idGen: () => 'enr_1',
    });
    const out = await uc.execute({
      recordedBy: 'kckern', pin: '7410', learnerIds: ['felix', 'milo'],
      from: '2026-08-10', to: '2026-08-14', title: 'Yellowstone trip',
      subjectIds: ['science', 'history'], note: 'Geysers + fort tour',
    });
    expect(out.entry).toMatchObject({ id: 'enr_1', recordedBy: 'kckern', title: 'Yellowstone trip' });
    expect(log.list({ learnerId: 'felix' }).length).toBe(1);
    expect(log.list({ learnerId: 'soren' }).length).toBe(0);
  });

  it('RecordEnrichment refuses garbage dates and an empty title', async () => {
    const log = new YamlEnrichmentLog({ configService });
    const uc = new RecordEnrichment({ log, teacherGate: passingGate(), clock: () => new Date(), idGen: () => 'x' });
    await expect(uc.execute({ recordedBy: 'k', learnerIds: ['felix'], from: 'next week', title: 'T' })).rejects.toThrow(/from/);
    await expect(uc.execute({ recordedBy: 'k', learnerIds: ['felix'], from: '2026-08-10', title: ' ' })).rejects.toThrow(/title/);
    await expect(uc.execute({ recordedBy: 'k', learnerIds: [], from: '2026-08-10', title: 'T' })).rejects.toThrow(/learner/);
  });
});


describe('corrupt-file posture (M3 F3)', () => {
  it('a corrupt periods file never silently reverts: reads warn, writes refuse', async () => {
    const store = new YamlAcademicPeriodStore({ configService, fallback: null, logger: { error: vi.fn(), info: vi.fn() } });
    await store.replacePeriods([PERIOD], { editedBy: 'k', at: 't1' });
    await fs.writeFile(path.join(dir, 'school/plans/periods.yml'), '{ not: [ yaml', 'utf8');
    const logger = { error: vi.fn(), info: vi.fn() };
    const reread = new YamlAcademicPeriodStore({ configService, fallback: null, logger });
    expect(reread.listPeriods()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('school.periods.file-corrupt', expect.anything());
    await expect(reread.replacePeriods([PERIOD], { editedBy: 'k' })).rejects.toThrow(/cannot be read/);
  });

  it('a corrupt enrichment log refuses to append rather than truncating itself', async () => {
    const log = new YamlEnrichmentLog({ configService, logger: { error: vi.fn(), info: vi.fn() } });
    await log.append({ id: 'e1', title: 'T', learnerIds: ['felix'], from: '2026-08-01', to: '2026-08-01' });
    await fs.writeFile(path.join(dir, 'school/records/enrichment.yml'), 'entries: { broken', 'utf8');
    await expect(log.append({ id: 'e2', title: 'U', learnerIds: ['felix'], from: '2026-08-02', to: '2026-08-02' }))
      .rejects.toThrow(/cannot be read/);
  });

  it('a dangling parentPeriodId is refused now that periodId is runtime-editable', async () => {
    const store = new YamlAcademicPeriodStore({ configService, fallback: null });
    await expect(store.replacePeriods([{ ...PERIOD, parentPeriodId: 'ghost-year' }], { editedBy: 'k' }))
      .rejects.toThrow(/missing parent/);
  });
});

describe('paceMilestones (spec C5)', async () => {
  const { paceMilestones } = await import('#domains/school/milestones.mjs');
  const behind = { id: 'm1', unitId: 'u', dueBy: '2026-08-01', status: 'behind' };

  it('a behind milestone fully covered by enrichment days is excused', () => {
    const out = paceMilestones([behind], [
      { from: '2026-08-02', to: '2026-08-06', learnerIds: ['felix'] },
    ], { today: '2026-08-05' });
    expect(out[0]).toMatchObject({ effectiveStatus: 'excused', overdueDays: 4, excusedDays: 4 });
  });

  it('partial coverage stays behind, with the excused count visible', () => {
    const out = paceMilestones([behind], [
      { from: '2026-08-02', to: '2026-08-02' },
    ], { today: '2026-08-05' });
    expect(out[0]).toMatchObject({ effectiveStatus: 'behind', overdueDays: 4, excusedDays: 1 });
  });

  it('enrichment days outside the overdue window never count', () => {
    const out = paceMilestones([behind], [
      { from: '2026-07-20', to: '2026-07-25' }, { from: '2026-09-01' },
    ], { today: '2026-08-05' });
    expect(out[0]).toMatchObject({ effectiveStatus: 'behind', excusedDays: 0 });
  });

  it('met and upcoming pass through untouched', () => {
    const out = paceMilestones([
      { id: 'a', unitId: 'u', dueBy: '2026-08-01', status: 'met' },
      { id: 'b', unitId: 'u', dueBy: '2026-09-01', status: 'upcoming' },
    ], [{ from: '2026-08-02' }], { today: '2026-08-05' });
    expect(out.map((m) => m.effectiveStatus)).toEqual(['met', 'upcoming']);
  });
});
