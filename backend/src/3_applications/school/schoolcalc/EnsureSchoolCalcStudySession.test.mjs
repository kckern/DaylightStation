import { describe, expect, it, vi } from 'vitest';
import { EnsureSchoolCalcStudySession } from './EnsureSchoolCalcStudySession.mjs';

const unit = {
  unitId: 'math-facts', title: 'Math facts', subject: 'math', bank: 'facts',
  schoolcalc: {
    mode: 'adaptive_flashcards', study: { cardCount: 3, maxExposuresPerCard: 4 },
    quiz: { itemCount: 2 },
  },
};
const bank = {
  id: 'facts', items: Array.from({ length: 4 }, (_, index) => ({
    id: `q${index + 1}`, type: 'multiple_choice', prompt: `${index + 1}+1?`,
    choices: [`${index + 1}`, `${index + 2}`], answer: `${index + 2}`,
  })),
};

function memoryStudies() {
  const sessions = [];
  return {
    sessions,
    getByWorkSession: vi.fn(async (id) => sessions.find((value) => value.workSessionId === id) ?? null),
    getByCode: vi.fn(async (code) => sessions.find((value) => value.code === code) ?? null),
    create: vi.fn(async (value) => { sessions.push(structuredClone(value)); return value; }),
  };
}

const artifactBuilder = () => ({
  execute: vi.fn(async () => ({
    artifactId: 'sc:ti86:ABC', platformId: 'ti86', variableName: 'DPABC123',
    byteLength: 1234, byteDigest: 'ab'.repeat(32),
  })),
});

describe('EnsureSchoolCalcStudySession', () => {
  it('pins authored order and reuses one code for the same work session', async () => {
    const studies = memoryStudies();
    const service = new EnsureSchoolCalcStudySession({
      studies, banks: { getBank: vi.fn(async () => bank) }, artifacts: artifactBuilder(),
      newStudySessionId: () => 'study-one', newCode: vi.fn(() => '001234'),
    });
    const input = { workSessionId: 'ses-one', learnerId: 'learner1', unit, at: '2026-08-10T12:00:00.000Z' };
    await expect(service.ensure(input)).resolves.toMatchObject({ studySessionId: 'study-one', code: '001234' });
    await expect(service.ensure(input)).resolves.toMatchObject({ studySessionId: 'study-one', code: '001234' });
    expect(studies.create).toHaveBeenCalledTimes(1);
    expect(studies.sessions[0].curation).toMatchObject({ cardIds: ['q1', 'q2', 'q3'], quizIds: ['q1', 'q2'] });
  });

  it('skips permanently allocated codes and preview never writes', async () => {
    const studies = memoryStudies();
    studies.sessions.push({ workSessionId: 'old-work', code: '000001', studySessionId: 'old-study' });
    const codes = ['000001', '000002'];
    const service = new EnsureSchoolCalcStudySession({
      studies, banks: { getBank: async () => bank }, artifacts: artifactBuilder(), newStudySessionId: () => 'study-two',
      newCode: () => codes.shift(),
    });
    await expect(service.preview({ workSessionId: 'new-work' })).resolves.toEqual({
      eligible: true, studySessionId: null, code: null,
    });
    expect(studies.create).not.toHaveBeenCalled();
    await expect(service.ensure({
      workSessionId: 'new-work', learnerId: 'learner1', unit, at: '2026-08-10T12:00:00.000Z',
    })).resolves.toMatchObject({ code: '000002' });
  });
});
