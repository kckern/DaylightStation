// schoolMatrixModel.js — pure grid derivation for SchoolMatrix.jsx, split
// out so Fast Refresh can hot-reload the matrix component on its own.

/** Pure model: rows per learner, columns per course, plus the flag sets. */
export function deriveMatrix({ assignments, units, kids, syllabi = [] }) {
  const courseIds = [...new Set((units ?? []).map((u) => u.courseId).filter(Boolean))].sort();
  const known = new Set(courseIds);
  const titleOf = new Map((syllabi ?? []).map((s) => [s.syllabusId, s.title]));
  const courseOf = (c) => (typeof c === 'string' ? c : c?.courseId);
  const byLearner = new Map((assignments ?? []).map((r) => [r.learnerId, r]));
  const rows = (kids ?? []).map((kid) => {
    const rec = byLearner.get(kid.id);
    const assigned = new Set((rec?.courses ?? []).map(courseOf).filter(Boolean));
    // One cell per assigned course. `managed` is false for an enrollment with
    // no syllabusId -- a hand-authored record, which renders first-class and
    // flagged, never as broken (learner-a.yml must keep working).
    const cells = {};
    (rec?.courses ?? []).forEach((entry) => {
      const id = courseOf(entry);
      if (!id) return;
      const obj = typeof entry === 'object' ? entry : {};
      cells[id] = {
        enrolled: true,
        syllabusId: obj.syllabusId ?? null,
        syllabusTitle: obj.syllabusId ? (titleOf.get(obj.syllabusId) ?? obj.syllabusId) : null,
        profile: obj.profile ?? null,
        passing: obj.passing ?? null,
        hasEnrollment: Boolean(obj.enrollment),
        managed: Boolean(obj.syllabusId),
      };
    });
    return {
      learnerId: kid.id,
      name: kid.name,
      assigned,
      cells,
      deadRefs: [...assigned].filter((id) => !known.has(id)).sort(),
    };
  });
  // Assignment records for ids that are NOT on the kids roster (a departed
  // or renamed learner still holding courses) — the orphan the admin can't
  // otherwise see.
  const kidIds = new Set((kids ?? []).map((k) => k.id));
  const orphanLearners = (assignments ?? [])
    .filter((r) => !kidIds.has(r.learnerId) && (r.courses ?? []).length)
    .map((r) => r.learnerId)
    .sort();
  const enrollment = new Map(courseIds.map((id) => [id, rows.filter((r) => r.assigned.has(id)).length]));
  const unenrolled = courseIds.filter((id) => enrollment.get(id) === 0);
  return { courseIds, rows, unenrolled, orphanLearners };
}
