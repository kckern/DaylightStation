import { describe, expect, it, vi } from 'vitest';
import { GetTeacherSession, GetLearnerTimeline } from './GetTeacherSession.mjs';
import { curriculumPosterRef } from '#apps/common/resources/publicResourceRefs.mjs';

const events = [
  { type: 'created', seq: 1, at: '2026-08-24T14:27:36.519Z', learnerId: 'learner3', unitId: 'atlas-us-p044-illinois' },
  { type: 'issued', seq: 2, at: '2026-08-24T14:28:43.031Z', artifactId: 'civilization/young-peoples-atlas-us/ws-ses-illinois' },
  { type: 'submitted', seq: 3, at: '2026-08-24T15:20:13.805Z' },
  { type: 'graded', seq: 4, at: '2026-08-24T15:20:13.833Z', percent: 100, correctCount: 1, totalCount: 1 },
];

describe('GetTeacherSession artifact read-through', () => {
  it('does not misrepresent a published revision as the original historical worksheet', async () => {
    const getPublished = vi.fn(async () => ({ id: 'civilization/young-peoples-atlas-us/ws-ses-illinois', rev: 'frozen-rev', title: 'Illinois' }));
    const useCase = new GetTeacherSession({
      sessions: {
        readEvents: vi.fn(async () => events),
        listForLearner: vi.fn(async () => [{ sessionId: 'ses_illinois', unitId: 'atlas-us-p044-illinois', outcome: { result: 'passed' } }]),
      },
      curriculum: {
        getUnit: vi.fn(async () => ({ unitId: 'atlas-us-p044-illinois', title: 'Illinois', subject: 'Civilization', courseId: 'young-peoples-atlas-us', module: 'United States' })),
        listWorks: vi.fn(async () => [{ work: 'young-peoples-atlas-us', title: 'Young People’s Atlas of the United States', subject: 'Civilization', modules: [{ module: 'United States', title: 'United States Regions and States' }] }]),
        listUnits: vi.fn(async () => [{ unitId: 'atlas-us-p044-illinois', title: 'Illinois', courseId: 'young-peoples-atlas-us' }]),
      },
      worksheetInstances: { findBySession: vi.fn(async () => ({
        id: 'civilization/young-peoples-atlas-us/ws-ses-illinois', documentId: 'civilization/young-peoples-atlas-us/ws-ses-illinois', documentRevision: 'frozen-rev', issuedAt: '2026-08-24T14:28:43.031Z',
        questions: [{ itemId: 'illinois-1', prompt: 'Which state is Illinois?', options: [{ text: 'Illinois' }] }],
      })) },
      issuedArtifacts: { get: vi.fn(async () => null) },
      reviewQueue: { listForSession: vi.fn(async () => [{ itemId: 'illinois-1', questionNumber: 1, prompt: 'Which state is Illinois?', given: 'Illinois', verdict: 'correct' }]) },
      printDocuments: { getPublished },
    });

    const result = await useCase.execute({ sessionId: 'ses_illinois' });

    expect(result).toMatchObject({
      schema: 'school.teacher-session/v4',
      taxonomy: {
        subject: 'Civilization', lessonTitle: 'Illinois', courseTitle: 'Young People’s Atlas of the United States',
        moduleTitle: 'United States Regions and States', posterUrl: curriculumPosterRef('teacher', 'young-peoples-atlas-us'),
      },
      assignment: { documentRevision: 'frozen-rev', questions: [{ prompt: 'Which state is Illinois?' }] },
      assessment: { items: [{ given: 'Illinois', verdict: 'correct' }] },
      artifacts: [{ artifactId: 'civilization/young-peoples-atlas-us/ws-ses-illinois', availability: 'unavailable', exactBytesRetained: false }],
    });
    expect(result.artifacts[0].originalPdfUrl).toBeUndefined();
    expect(result.artifacts[0].thumbnailUrl).toBeUndefined();
    expect(getPublished).toHaveBeenCalledWith('civilization/young-peoples-atlas-us/ws-ses-illinois', 'frozen-rev');
  });
});

describe('GetLearnerTimeline catalog join', () => {
  const sessions = {
    listForLearner: vi.fn(async () => [
      { sessionId: 's1', learnerId: 'learner3', unitId: 'atlas-us-p044-illinois', state: 'closed', updatedAt: '2026-08-24T15:20:00Z' },
    ]),
  };
  const curriculum = {
    getUnit: vi.fn(async () => ({
      unitId: 'atlas-us-p044-illinois', title: 'Illinois', subject: 'Civilization',
      courseId: 'young-peoples-atlas-us', module: 'United States',
    })),
    listWorks: vi.fn(async () => [{
      work: 'young-peoples-atlas-us', title: 'United States Regions and States', subject: 'Civilization',
      modules: [{ module: 'United States', title: 'Midwest' }],
    }]),
  };

  it('joins the catalog so timeline rows carry the taxonomy the list renders', async () => {
    const useCase = new GetLearnerTimeline({ sessions, curriculum });
    const { items } = await useCase.execute({ learnerId: 'learner3' });
    expect(items[0]).toMatchObject({
      sessionId: 's1',
      lessonTitle: 'Illinois',
      courseId: 'young-peoples-atlas-us',
      courseTitle: 'United States Regions and States',
      subject: 'Civilization',
      moduleTitle: 'Midwest',
      posterUrl: curriculumPosterRef('teacher', 'young-peoples-atlas-us'),
    });
  });

  it('returns raw rows untouched when no curriculum is wired', async () => {
    const useCase = new GetLearnerTimeline({ sessions });
    const { items } = await useCase.execute({ learnerId: 'learner3' });
    expect(items[0].sessionId).toBe('s1');
    expect(items[0].lessonTitle).toBeUndefined();
  });

  it('degrades to raw rows when the catalog read throws', async () => {
    const useCase = new GetLearnerTimeline({
      sessions,
      curriculum: { getUnit: vi.fn(async () => { throw new Error('catalog down'); }), listWorks: vi.fn(async () => { throw new Error('catalog down'); }) },
    });
    const { items } = await useCase.execute({ learnerId: 'learner3' });
    expect(items[0].sessionId).toBe('s1');
  });
});
