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

export function createCourseEnrollment({ courseId, profile, units, policy = {}, rng = Math.random } = {}) {
  if (typeof courseId !== 'string' || !courseId) throw new Error('courseId is required');
  const members = (units ?? []).filter((u) => u?.courseId === courseId);
  const modules = [...new Set(members.map((u) => u.module).filter(Boolean))];
  const opening = policy.required_opening_module ?? null;
  const optionalModules = modules.filter((id) => members.some((u) => u.module === id && u.moduleRole === 'optional'));
  const otherModules = modules.filter((id) => id !== opening && !optionalModules.includes(id));
  const moduleOrder = [
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
  return { schema: 'school.course-enrollment/v1', courseId, profile: profile ?? null, moduleOrder, optionalModules, lessonOrder };
}

export default createCourseEnrollment;
