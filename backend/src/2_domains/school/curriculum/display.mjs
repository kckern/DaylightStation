/**
 * Learner-facing course/module labels.
 *
 * Curriculum ids and enrollment array indexes are storage/navigation facts;
 * they are not automatically good labels. This projection gives authored
 * `short_title`, explicit module `number`, and the course's
 * `module_number_start` precedence, while keeping older catalogs readable.
 */

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function courseDisplay({ work = null, enrollment = null, fallback = 'Course' } = {}) {
  const title = text(enrollment?.display?.courseTitle) ?? text(work?.title) ?? text(fallback) ?? 'Course';
  const shortTitle = text(enrollment?.display?.courseShortTitle)
    ?? text(work?.short_title)
    ?? title;
  return { title, shortTitle };
}

export function moduleDisplay({ work = null, enrollment = null, moduleId = null,
  fallbackTitle = 'Unit' } = {}) {
  const authoredIndex = work?.modules?.findIndex?.((candidate) => candidate?.module === moduleId) ?? -1;
  const authored = authoredIndex >= 0 ? work.modules[authoredIndex] : null;
  const snapshot = enrollment?.display?.modules?.[moduleId] ?? null;
  const enrollmentIndex = enrollment?.moduleOrder?.indexOf?.(moduleId) ?? -1;
  const numberStart = Number.isInteger(enrollment?.progression?.module_number_start)
    ? enrollment.progression.module_number_start
    : work?.progression?.module_number_start;
  const number = Number.isInteger(snapshot?.number) ? snapshot.number
      : Number.isInteger(authored?.number) ? authored.number
      : Number.isInteger(numberStart) && authoredIndex >= 0 ? numberStart + authoredIndex
        : enrollmentIndex >= 0 ? enrollmentIndex + 1 : null;
  const title = text(snapshot?.title) ?? text(authored?.title) ?? text(fallbackTitle) ?? text(moduleId) ?? 'Unit';
  const shortTitle = text(snapshot?.shortTitle)
    ?? text(authored?.short_title)
    ?? title;
  return {
    number,
    title,
    shortTitle,
    taxonomyLabel: Number.isInteger(number) ? `Unit ${number}: ${title}` : title,
    progressLabel: shortTitle,
  };
}

export function compactCourseModuleLabel({ work = null, enrollment = null, moduleId = null,
  fallbackCourse = 'Course', fallbackModule = 'Unit' } = {}) {
  const course = courseDisplay({ work, enrollment, fallback: fallbackCourse });
  const module = moduleDisplay({ work, enrollment, moduleId, fallbackTitle: fallbackModule });
  const numbered = Number.isInteger(module.number) ? `Unit ${module.number}` : 'Unit';
  return `${course.shortTitle} › ${numbered} · ${module.shortTitle}`;
}

export default { courseDisplay, moduleDisplay, compactCourseModuleLabel };
