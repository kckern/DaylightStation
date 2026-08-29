/** Teacher-facing curriculum projections over the curriculum repository. */
export class SchoolCurriculumQueryService {
  constructor({ curriculum = null, getLearnerTimeline = null, manageCurriculumException = null } = {}) {
    this.curriculum = curriculum;
    this.getLearnerTimeline = getLearnerTimeline;
    this.manageCurriculumException = manageCurriculumException;
  }

  isConfigured() { return Boolean(this.curriculum); }
  async getCoursePoster(courseId) { return this.curriculum?.getCoursePoster?.(courseId) ?? null; }
  async getUnit(unitId) { return this.curriculum?.getUnitSummary?.(unitId) ?? null; }

  async getCourse(courseId) {
    if (!this.curriculum) return { kind: 'unconfigured' };
    const [works, units] = await Promise.all([
      this.curriculum.listWorks(), this.curriculum.listUnitSummaries(),
    ]);
    const course = works.find((work) => work.work === courseId);
    return course ? { kind: 'found', course, units: units.filter((unit) => unit.courseId === course.work) } : { kind: 'not_found' };
  }

  async getLesson(courseId, lessonId) {
    const unit = await this.getUnit(lessonId);
    return unit && unit.courseId === courseId ? unit : null;
  }

  async getSyllabusUnits(courseId) {
    if (!this.curriculum) return null;
    return (await this.curriculum.listUnitSummaries())
      .filter((unit) => unit.courseId === courseId)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }

  async getLearnerCourse(learnerId, courseId) {
    if (!this.curriculum || !this.getLearnerTimeline) return { kind: 'unconfigured' };
    const [units, timeline, exceptionRead] = await Promise.all([
      this.curriculum.listUnitSummaries(),
      this.getLearnerTimeline.execute({ learnerId, limit: 200 }),
      this.manageCurriculumException?.list?.() ?? { active: [] },
    ]);
    const courseUnits = units.filter((unit) => unit.courseId === courseId);
    if (!courseUnits.length) return { kind: 'not_found' };
    const byUnit = new Map((timeline.items ?? []).map((item) => [item.unitId, item]));
    const projected = courseUnits.map((unit) => ({
      ...unit,
      status: (() => {
        const paused = exceptionRead.active.find((row) => row.kind === 'paused' && row.resolvedLessonIds?.includes(unit.unitId));
        if (paused) return 'paused';
        const learnerException = exceptionRead.active.find((row) => row.learnerId === learnerId
          && row.resolvedLessonIds?.includes(unit.unitId));
        return learnerException?.kind ?? (byUnit.get(unit.unitId)?.outcome?.result === 'passed' ? 'passed' : 'remaining');
      })(),
      sessionId: byUnit.get(unit.unitId)?.sessionId ?? null,
    }));
    return {
      kind: 'found', units: projected,
      completed: projected.filter((unit) => ['mastered', 'passed', 'excused', 'replaced'].includes(unit.status)).length,
    };
  }
}

export default SchoolCurriculumQueryService;
