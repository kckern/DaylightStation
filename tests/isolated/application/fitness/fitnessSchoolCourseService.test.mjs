import { describe, expect, it, vi } from 'vitest';
import {
  FitnessSchoolCourseService,
  deriveObservations,
} from '#apps/fitness/FitnessSchoolCourseService.mjs';
import { defaultFitnessSuccessPolicy, revisionFor } from '#domains/school/fitnessCourse.mjs';

class MemoryStore {
  records = new Map();
  async get(id) { return structuredClone(this.records.get(id) ?? null); }
  async put(record) { this.records.set(record.workSessionId, structuredClone(record)); return record; }
}

const activity = () => ({
  provider: 'fitness', courseRevision: 'course-1',
  policyRevision: revisionFor(defaultFitnessSuccessPolicy()),
  source: { adapter: 'plex', showId: '44' },
  segments: [{ id: 'main', role: 'main', kind: 'plex-video', sourceId: '101', durationSeconds: 100, required: true }],
  successPolicy: defaultFitnessSuccessPolicy(),
});

const build = ({ session = null } = {}) => {
  const store = new MemoryStore();
  const publish = vi.fn();
  const service = new FitnessSchoolCourseService({
    attemptStore: store,
    sessionService: { getSession: vi.fn(async () => session && ({ toJSON: () => structuredClone(session) })) },
    publications: {
      accepted: (payload) => publish('fitness.school-attempt.accepted', payload),
      assessed: (payload) => publish('fitness.school-attempt.assessed', payload),
    },
    clock: () => new Date('2026-08-25T12:00:00.000Z'),
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { service, store, publish };
};

describe('FitnessSchoolCourseService', () => {
  it('freezes the School plan and explicitly accepts learner ownership', async () => {
    const { service, publish } = build();
    const descriptor = activity();
    const prepared = await service.prepare({
      workSessionId: 'ses_1', learnerId: 'kid1', unitId: 'bike.101', activity: descriptor,
    });
    descriptor.successPolicy.all[0].value = 1;
    expect(prepared.successPolicy.all[0].value).toBe(0.5);

    const accepted = await service.accept({ workSessionId: 'ses_1', learnerId: 'kid1' });
    expect(accepted.status).toBe('accepted');
    expect(publish).toHaveBeenCalledWith('fitness.school-attempt.accepted', expect.objectContaining({
      workSessionId: 'ses_1', learnerId: 'kid1', unitId: 'bike.101',
    }));
  });

  it('rejects a kiosk learner who does not own the prepared School attempt', async () => {
    const { service } = build();
    await service.prepare({ workSessionId: 'ses_1', learnerId: 'kid1', unitId: 'bike.101', activity: activity() });
    await expect(service.accept({ workSessionId: 'ses_1', learnerId: 'kid2' })).rejects.toThrow(/does not own/);
  });

  it('derives sensor facts from Fitness records, stores an immutable verdict, and publishes a School-safe summary', async () => {
    const session = {
      timeline: {
        tick_count: 10,
        interval_seconds: 10,
        series: { 'user:kid1:heart_rate': [120, 122, 124, 126, 128, 130, 132, 134] },
      },
      participants: { kid1: { zone_time_seconds: { vigorous: 80 } } },
      summary: { media: [{ durationMs: 90000 }], voiceMemos: [] },
      strength: { runs: [] },
    };
    const { service, publish } = build({ session });
    await service.prepare({ workSessionId: 'ses_1', learnerId: 'kid1', unitId: 'bike.101', activity: activity() });
    await service.accept({ workSessionId: 'ses_1', learnerId: 'kid1' });
    const assessed = await service.assess({
      workSessionId: 'ses_1', learnerId: 'kid1', fitnessSessionIds: ['fs_abc'],
      clientObservations: { media: { completion_ratio: 0.9, elapsed_seconds: 90 }, segments: { completed: 1, in_order: true } },
    });

    expect(assessed).toMatchObject({
      status: 'assessed', fitnessSessionIds: ['abc'],
      assessment: { result: 'passed', observations: { heart_rate: { coverage_ratio: 0.8 } } },
    });
    expect(publish).toHaveBeenLastCalledWith('fitness.school-attempt.assessed', expect.objectContaining({
      result: 'passed', observations: { engagements: 1, completions: 1, durationMs: 90000 },
    }));
  });

  it('returns the stored assessment on a duplicate assess instead of creating a second verdict', async () => {
    const { service, publish } = build();
    await service.prepare({ workSessionId: 'ses_1', learnerId: 'kid1', unitId: 'bike.101', activity: activity() });
    await service.accept({ workSessionId: 'ses_1', learnerId: 'kid1' });
    const first = await service.assess({ workSessionId: 'ses_1', learnerId: 'kid1' });
    const calls = publish.mock.calls.length;
    const second = await service.assess({ workSessionId: 'ses_1', learnerId: 'kid1' });
    expect(second.assessment).toEqual(first.assessment);
    expect(publish).toHaveBeenCalledTimes(calls);
  });

  it('derives configured HR ranges and counts only learner-attributed voice reflection', () => {
    const record = {
      segments: [{ kind: 'sensor-block' }, { kind: 'voice-reflection' }],
      successPolicy: { all: [
        { metric: 'heart_rate.seconds_in_range', range: [120, 130], op: 'gte', value: 10 },
        { metric: 'voice_memo.count', op: 'gte', value: 1 },
      ] },
    };
    const result = deriveObservations({
      record, learnerId: 'kid1', sessions: [{
        participants: { kid1: {}, kid2: {} },
        timeline: { interval_seconds: 5, tick_count: 3, series: { 'kid1:hr': [119, 125, 130] } },
        summary: { participants: { kid1: {} }, media: [], voiceMemos: [
          { transcript: 'group memo', durationSeconds: 30 },
          { userId: 'kid1', transcript: 'mine', durationSeconds: 12 },
          { userId: 'kid2', transcript: 'not mine', durationSeconds: 20 },
        ] },
      }],
    });
    expect(result.heart_rate.seconds_in_range).toEqual([{ min: 120, max: 130, seconds: 10 }]);
    expect(result.voice_memo).toEqual({ count: 1, duration_seconds: 12 });
  });
});
