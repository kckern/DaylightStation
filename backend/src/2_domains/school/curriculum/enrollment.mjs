/**
 * Enrollment ordering is intentionally separate from curriculum ordering.
 * A course says what MAY shuffle; this module chooses once and persists the
 * result on the assignment/enrollment record.  It never reads a clock or RNG.
 */
const shuffle = (items, rng) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function createCourseEnrollment({
  enrollmentId = null, courseId, profile, units, modules = [], policy = {}, today = null, rng = Math.random,
} = {}) {
  if (typeof courseId !== 'string' || !courseId) throw new Error('courseId is required');
  if (enrollmentId !== null && (typeof enrollmentId !== 'string' || !enrollmentId)) {
    throw new Error('enrollmentId must be a non-empty string when provided');
  }
  const members = (units ?? []).filter((u) => u?.courseId === courseId);
  const publishedModules = [...new Set(members.map((u) => u.module).filter(Boolean))];
  const opening = policy.required_opening_module ?? null;
  const optionalModules = publishedModules.filter((id) => members.some((u) => u.module === id && u.moduleRole === 'optional'));
  const otherModules = publishedModules.filter((id) => id !== opening && !optionalModules.includes(id));
  // A dated course's calendar IS its order, so it never shuffles and never
  // takes an opening module. Windows are copied onto the enrollment for the
  // same reason lessonOrder is: later course edits must not move a plan a
  // learner is already living in.
  const dated = policy.mode === 'dated_modules';
  const published = new Set(publishedModules);
  const windowed = dated
    ? (Array.isArray(modules) ? modules : [])
      // A module without published units cannot be assigned. A week that
      // closed before enrollment was never assigned, so it is not backlog.
      .filter((module) => module?.module && published.has(module.module) && module.opensOn && module.closesOn)
      .filter((module) => !today || module.closesOn >= today)
      .sort((left, right) => left.opensOn.localeCompare(right.opensOn))
    : [];
  const moduleOrder = dated
    ? windowed.map((module) => module.module)
    : [
      ...(opening ? [opening] : []),
      ...(policy.module_order === 'shuffle_once' ? shuffle(otherModules, rng) : otherModules),
    ];
  const lessonOrder = {};
  for (const module of [...moduleOrder, ...optionalModules]) {
    const lessons = members.filter((u) => u.module === module)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const overview = lessons.filter((u) => u.moduleRole === 'overview');
    const remainder = lessons.filter((u) => u.moduleRole !== 'overview');
    lessonOrder[module] = [
      ...overview,
      ...(policy.lesson_order === 'shuffle_once' ? shuffle(remainder, rng) : remainder),
    ].map((u) => u.unitId);
  }
  return {
    schema: 'school.course-enrollment/v2',
    ...(enrollmentId ? { enrollmentId } : {}),
    courseId,
    profile: profile ?? null,
    moduleOrder,
    optionalModules,
    lessonOrder,
    // Effective policy snapshot: progression must not change under a learner
    // because the catalog or syllabus was edited after enrollment.
    progression: structuredClone(policy),
    ...(dated ? {
      moduleSchedule: Object.fromEntries(
        windowed.map((module) => [module.module, { opensOn: module.opensOn, closesOn: module.closesOn }]),
      ),
    } : {}),
  };
}

export default createCourseEnrollment;
