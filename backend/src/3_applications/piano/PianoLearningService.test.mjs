import { describe, expect, it, vi } from 'vitest';
import { PianoLearningService } from './PianoLearningService.mjs';

const requirement = {
  exercise_id: 'drills/hanon/001@root=C,direction=up-then-down,span_octaves=2',
  mode: 'cued',
  rubric: { id: 'hanon-v1', version: '1', criteria: { completeness: 1, cleanliness: 1 } },
  gates: { pace: { target_bpm: 60 } },
  required_passes: 1,
};

const program = {
  id: 'hanon', title: 'Hanon', ordered: true,
  steps: [{ id: 'hanon-01', title: 'Exercise 1', requirement, mastery_bpm: [72] }],
};

function subject({ attempts = [], enrollments = [], assignment = null, pending = [] } = {}) {
  const attemptStore = { list: vi.fn(() => attempts) };
  const learningStore = {
    getEnrollments: vi.fn(() => enrollments),
    getAssignment: vi.fn(() => assignment ?? { learnerId: 'felix', programs: [], updatedAt: null }),
    getPendingCheckpoints: vi.fn(() => pending),
    enroll: vi.fn(() => [{ programId: 'hanon' }]),
    unenroll: vi.fn(() => []),
    putAssignment: vi.fn((value) => value),
    putPendingCheckpoint: vi.fn((_userId, value) => [value]),
  };
  const service = new PianoLearningService({
    exerciseBank: { available: () => true }, attemptStore, learningStore,
    teacherGate: { assert: vi.fn() }, logger: { info: vi.fn() },
  });
  service.programs = () => [program];
  return { service, attemptStore, learningStore };
}

function passingAttempt() {
  return {
    status: 'completed', purpose: 'challenge', score: 1,
    prompt: { exercise_id: requirement.exercise_id },
    criteria: { completeness: 1, cleanliness: 1 },
    gates: { pace: { passed: true, actual: 60, target: 60 } },
    verdict: { score: 1, passed: true },
  };
}

describe('PianoLearningService', () => {
  it('projects the next enrolled step and advances it from portable attempt evidence', () => {
    const first = subject({ enrollments: [{ programId: 'hanon' }] }).service.summary('felix');
    expect(first.next_up).toMatchObject({ program_id: 'hanon', step: { id: 'hanon-01', state: 'current' } });

    const completed = subject({ attempts: [passingAttempt()], enrollments: [{ programId: 'hanon' }] }).service.summary('felix');
    expect(completed.programs[0]).toMatchObject({ passed_steps: 1, complete: true });
    expect(completed.next_up).toBeNull();
  });

  it('puts an unfinished video checkpoint ahead of a program and clears it from evidence', () => {
    const checkpoint = { contentId: 'plex:lesson-1', title: 'Lesson 1', requirement };
    expect(subject({ enrollments: [{ programId: 'hanon' }], pending: [checkpoint] }).service.summary('felix').next_up)
      .toMatchObject({ type: 'video-checkpoint', title: 'Lesson 1' });
    expect(subject({ attempts: [passingAttempt()], pending: [checkpoint] }).service.summary('felix').pending_checkpoints)
      .toEqual([]);
  });

  it('prevents learners from removing a teacher-assigned program', () => {
    const { service, learningStore } = subject({ assignment: { programs: ['hanon'] } });
    expect(() => service.unenroll('felix', 'hanon')).toThrow(/required program/);
    expect(learningStore.unenroll).not.toHaveBeenCalled();
  });

  it('projects a course worth of checkpoint statuses from one attempt-ledger read', () => {
    const { service, attemptStore } = subject({ attempts: [passingAttempt()] });
    expect(service.requirementStatuses('felix', [requirement, { ...requirement, exercise_id: 'another' }])
      .map((status) => status.passed)).toEqual([true, false]);
    expect(attemptStore.list).toHaveBeenCalledTimes(1);
  });

  it('requires teacher authorization before replacing ordered assignments', () => {
    const { service, learningStore } = subject();
    const record = service.putAssignment({
      learnerId: 'felix', programs: ['hanon'], assignedBy: 'parent', pin: '1234', baseUpdatedAt: null,
    });
    expect(service.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'parent', action: 'piano.program-assignments.put', context: { learnerId: 'felix' },
    }));
    expect(learningStore.putAssignment).toHaveBeenCalledWith(expect.objectContaining({ programs: ['hanon'] }));
    expect(record.programs).toEqual(['hanon']);
  });
});
