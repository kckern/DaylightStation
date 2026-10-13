import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Renders published lesson material for a teacher's private inspection.
 *
 * This is intentionally not a shortened IssueDocument path.  It has no
 * learner, session, allocation, artifact, printer, token, or persistence
 * dependency.  A preview is a transient representation of published content,
 * never evidence that a learner received or completed anything.
 */
export class PreviewTeacherLessonMaterial {
  #curriculum; #documents; #renderer;

  constructor({ curriculum, printDocuments, renderPrintDocument } = {}) {
    if (!curriculum || !printDocuments || !renderPrintDocument) {
      throw new Error('PreviewTeacherLessonMaterial requires curriculum, printDocuments and renderPrintDocument');
    }
    this.#curriculum = curriculum;
    this.#documents = printDocuments;
    this.#renderer = renderPrintDocument;
  }

  async execute({ courseId, lessonId, answerKey = false } = {}) {
    if (typeof courseId !== 'string' || !courseId.trim()) throw new ValidationError('courseId is required');
    if (typeof lessonId !== 'string' || !lessonId.trim()) throw new ValidationError('lessonId is required');
    if (typeof answerKey !== 'boolean') throw new ValidationError('answerKey must be boolean');

    const unit = await this.#curriculum.getUnit(lessonId);
    if (!unit || unit.courseId !== courseId) throw new EntityNotFoundError('course lesson', lessonId);
    if (!unit.document) throw new EntityNotFoundError('lesson material', lessonId);

    const document = await this.#documents.getPublished(unit.document);
    if (!document) throw new EntityNotFoundError('published lesson material', unit.document);

    // No learner/card/seed/tokens/freshCard context is legal here. The render
    // implementation returns an allocation only when those inputs are given;
    // reject rather than silently accepting a future renderer regression.
    const rendered = await this.#renderer.execute({ document, context: answerKey ? { teacher: true } : {} });
    if (rendered.allocation) throw new Error('teacher lesson preview unexpectedly allocated an answer card');
    return {
      schema: 'school.teacher-lesson-preview/v1',
      courseId, lessonId, title: unit.title, answerKey,
      bytes: rendered.bytes, pageCount: rendered.pageCount ?? null,
    };
  }
}

export default PreviewTeacherLessonMaterial;
