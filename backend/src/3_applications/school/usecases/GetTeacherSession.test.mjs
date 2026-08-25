import { describe, expect, it, vi } from 'vitest';
import { GetTeacherSession } from './GetTeacherSession.mjs';

const events = [
  { type: 'created', seq: 1, at: '2026-08-24T14:27:36.519Z', learnerId: 'milo', unitId: 'atlas-us-p044-illinois' },
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
        moduleTitle: 'United States Regions and States', posterUrl: '/api/v1/school/teacher/curriculum/young-peoples-atlas-us/poster.jpg',
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
