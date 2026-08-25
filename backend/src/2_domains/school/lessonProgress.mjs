import { planLearnerWork } from './planner.mjs';
import { inProgressSegments } from './progressRows.mjs';

/**
 * The learner-facing course and current-unit progress rows used on paper.
 * Both the result receipt and an issued lesson card consume this exact shape,
 * so a tick always means the same real module or lesson in either place.
 */
export function lessonProgressRows({ learnerId, unit, assignment, units, sessions, works, now, timezone } = {}) {
  if (!learnerId || !unit?.courseId) return null;
  const coursePolicies = Object.fromEntries((works ?? [])
    .map((work) => [work.work, work.progression]).filter(([, progression]) => progression));
  const plan = planLearnerWork({ learnerId, assignment, units, sessions, now, timezone, coursePolicies });
  const course = assignment?.courses?.find((entry) => entry.courseId === unit.courseId);
  const enrollment = course?.enrollment;
  const optionalModules = new Set(enrollment?.optionalModules ?? []);
  const requiredModules = (enrollment?.moduleOrder ?? []).filter((module) => !optionalModules.has(module));
  const moduleEntries = plan.entries.filter((entry) => entry.courseId === unit.courseId && entry.module === unit.module);
  const completedModules = requiredModules.filter((module) => {
    const entries = plan.entries.filter((entry) => entry.courseId === unit.courseId && entry.module === module);
    return entries.length > 0 && entries.every((entry) => entry.status === 'completed');
  }).length;
  const currentModuleComplete = moduleEntries.length > 0
    && moduleEntries.every((entry) => entry.status === 'completed');
  const courseInProgress = inProgressSegments({ completed: completedModules, total: requiredModules.length, currentComplete: currentModuleComplete });
  const moduleIndex = enrollment?.moduleOrder?.indexOf(unit.module) ?? -1;
  const rows = [
    { label: 'Course', completed: completedModules, total: requiredModules.length,
      ...(courseInProgress ? { inProgress: courseInProgress } : {}) },
    { label: moduleIndex >= 0 ? `Unit ${moduleIndex + 1}` : 'Unit',
      completed: moduleEntries.filter((entry) => entry.status === 'completed').length, total: moduleEntries.length },
  ].filter((row) => row.total > 0);
  return rows.length ? rows : null;
}

export default lessonProgressRows;
