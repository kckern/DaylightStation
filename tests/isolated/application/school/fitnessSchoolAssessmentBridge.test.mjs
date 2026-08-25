import { describe, expect, it, vi } from 'vitest';
import { FitnessSchoolAssessmentBridge } from '#apps/school/FitnessSchoolAssessmentBridge.mjs';
import {
  FITNESS_SCHOOL_ACCEPTED_TOPIC,
  FITNESS_SCHOOL_ASSESSED_TOPIC,
} from '#apps/fitness/FitnessSchoolCourseService.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const SID = 'ses_school_1';
const activity = {
  provider: 'fitness', courseRevision: 'course-1', policyRevision: 'policy-1',
};

function build() {
  const handlers = new Map();
  const events = [{
    type: 'created', at: '2026-08-25T10:00:00.000Z', sessionId: SID, seq: 1,
    learnerId: 'kid1', unitId: 'bike.101',
  }];
  const sessions = {
    readEvents: vi.fn(async () => structuredClone(events)),
    appendEvent: vi.fn(async (_id, event) => { events.push({ ...event, seq: events.length + 1 }); }),
  };
  const closeSessionOutcome = { execute: vi.fn(async () => ({ ok: true })) };
  const evidenceRepository = { appendEvidence: vi.fn(async () => {}) };
  const bridge = new FitnessSchoolAssessmentBridge({
    eventBus: {
      subscribe: vi.fn((topic, handler) => { handlers.set(topic, handler); return () => handlers.delete(topic); }),
    },
    sessions,
    curriculum: { getUnit: vi.fn(async () => ({ unitId: 'bike.101', subject: 'skills', courseId: 'bike', module: 'one', activity })) },
    closeSessionOutcome,
    evidenceRepository,
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  bridge.start();
  return { bridge, handlers, events, sessions, closeSessionOutcome, evidenceRepository };
}

const accepted = {
  workSessionId: SID, learnerId: 'kid1', unitId: 'bike.101', provider: 'fitness',
  courseRevision: 'course-1', policyRevision: 'policy-1', acceptedAt: '2026-08-25T10:05:00.000Z',
};
const assessed = {
  ...accepted, assessmentId: 'fitness-assessment-1', assessedAt: '2026-08-25T10:35:00.000Z',
  result: 'passed', observations: { engagements: 1, completions: 1, durationMs: 1800000 },
};

describe('FitnessSchoolAssessmentBridge', () => {
  it('turns kiosk acceptance and Fitness assessment into the normal School session/evidence lifecycle', async () => {
    const h = build();
    await h.handlers.get(FITNESS_SCHOOL_ACCEPTED_TOPIC)(accepted);
    expect(reduceSession(h.events).state).toBe('external_activity_dispatched');

    await h.handlers.get(FITNESS_SCHOOL_ASSESSED_TOPIC)(assessed);
    const state = reduceSession(h.events);
    expect(state).toMatchObject({
      state: 'external_activity_assessed', gradedPercent: 100,
      externalActivity: { assessmentId: 'fitness-assessment-1', result: 'passed' },
    });
    expect(h.evidenceRepository.appendEvidence).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'kid1', verification: 'verified',
      learning: { subjectId: 'skills', courseId: 'bike', unitId: 'one', lessonId: 'bike.101' },
      measures: assessed.observations,
    }));
    expect(h.closeSessionOutcome.execute).toHaveBeenCalledWith({ sessionId: SID });
  });

  it('ignores a stale assessment revision instead of advancing the wrong course version', async () => {
    const h = build();
    await h.handlers.get(FITNESS_SCHOOL_ASSESSED_TOPIC)({ ...assessed, policyRevision: 'old-policy' });
    expect(h.events).toHaveLength(1);
    expect(h.closeSessionOutcome.execute).not.toHaveBeenCalled();
  });

  it('unsubscribes both event topics on stop', () => {
    const h = build();
    h.bridge.stop();
    expect(h.handlers.size).toBe(0);
  });
});
