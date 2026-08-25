/**
 * Human-facing curriculum names. IDs remain joins and form values only; a
 * missing catalog record must be disclosed, not title-cased into fake copy.
 */
export function curriculumTitles(units = []) {
  const lessonTitles = new Map();
  const courseTitles = new Map();
  for (const unit of units) {
    if (unit?.unitId && unit.title) lessonTitles.set(unit.unitId, unit.title);
    if (unit?.courseId && unit.courseTitle) courseTitles.set(unit.courseId, unit.courseTitle);
  }
  return {
    lesson: (unitId) => lessonTitles.get(unitId) ?? 'Lesson title unavailable',
    course: (courseId) => courseTitles.get(courseId) ?? 'Course title unavailable',
  };
}
