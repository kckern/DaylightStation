import { describe, expect, it, vi } from 'vitest';
import { PreviewTeacherLessonMaterial } from './PreviewTeacherLessonMaterial.mjs';

describe('PreviewTeacherLessonMaterial', () => {
  it('renders published lesson material without a learner, session, card, artifact or print write', async () => {
    const curriculum = { getUnit: vi.fn(async () => ({
      unitId: 'illinois', courseId: 'atlas-us', title: 'Illinois', document: 'civilization/atlas/illinois',
    })) };
    const printDocuments = { getPublished: vi.fn(async () => ({ id: 'civilization/atlas/illinois', rev: 'frozen' })) };
    const renderPrintDocument = { execute: vi.fn(async () => ({ bytes: Buffer.from('%PDF preview'), pageCount: 1, allocation: null })) };
    const preview = new PreviewTeacherLessonMaterial({ curriculum, printDocuments, renderPrintDocument });

    const result = await preview.execute({ courseId: 'atlas-us', lessonId: 'illinois' });

    expect(result).toMatchObject({ schema: 'school.teacher-lesson-preview/v1', title: 'Illinois', answerKey: false, pageCount: 1 });
    expect(renderPrintDocument.execute).toHaveBeenCalledWith({
      document: { id: 'civilization/atlas/illinois', rev: 'frozen' }, context: {},
    });
  });

  it('allows a teacher answer-key preview without attaching it to a learner', async () => {
    const renderPrintDocument = { execute: vi.fn(async () => ({ bytes: Buffer.from('%PDF'), allocation: null })) };
    const preview = new PreviewTeacherLessonMaterial({
      curriculum: { getUnit: vi.fn(async () => ({ courseId: 'atlas-us', document: 'atlas/illinois', title: 'Illinois' })) },
      printDocuments: { getPublished: vi.fn(async () => ({ id: 'atlas/illinois' })) },
      renderPrintDocument,
    });
    await preview.execute({ courseId: 'atlas-us', lessonId: 'illinois', answerKey: true });
    expect(renderPrintDocument.execute).toHaveBeenCalledWith({ document: { id: 'atlas/illinois' }, context: { teacher: true } });
  });

  it('refuses a renderer that allocates an answer card during preview', async () => {
    const preview = new PreviewTeacherLessonMaterial({
      curriculum: { getUnit: vi.fn(async () => ({ courseId: 'atlas-us', document: 'atlas/illinois', title: 'Illinois' })) },
      printDocuments: { getPublished: vi.fn(async () => ({ id: 'atlas/illinois' })) },
      renderPrintDocument: { execute: vi.fn(async () => ({ bytes: Buffer.from('%PDF'), allocation: { cardId: '1234567' } })) },
    });
    await expect(preview.execute({ courseId: 'atlas-us', lessonId: 'illinois' }))
      .rejects.toThrow('unexpectedly allocated an answer card');
  });
});
