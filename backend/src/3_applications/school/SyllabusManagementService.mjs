import { validateSyllabus } from '#domains/school/curriculum/syllabus.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/** Teacher-gated syllabus validation and persistence workflow. */
export class SyllabusManagementService {
  constructor({ store, teacherGate, curriculum, clock }) {
    Object.assign(this, { store, teacherGate, curriculum, clock });
  }

  get(id) { return this.store.get(id); }
  list() { return this.store.list(); }

  async save({ raw, editedBy, pin }) {
    this.teacherGate.assert({ userId: editedBy, pin, action: 'syllabus.put', context: { syllabusId: raw?.syllabusId } });
    const works = await this.curriculum.listWorks();
    const courseIds = new Set(works.map((work) => work.work).filter(Boolean));
    const profileIds = new Set(Object.keys(works.find((work) => work.work === raw?.courseId)?.profiles ?? {}));
    const { errors, syllabus } = validateSyllabus(
      { schema: 'school.syllabus/v1', ...raw },
      { courseIds, profileIds },
    );
    if (errors.length) {
      const error = new ValidationError(errors.join('; '));
      error.status = 400;
      throw error;
    }
    return this.store.put({ ...syllabus, editedBy, updatedAt: this.clock().toISOString() });
  }

  archiveGuarded({ syllabusId, archivedBy, pin }) {
    this.teacherGate.assert({ userId: archivedBy, pin, action: 'syllabus.archive', context: { syllabusId } });
    return this.store.archive(syllabusId, { archivedBy, at: this.clock().toISOString() });
  }
}

export default SyllabusManagementService;
