// assignmentEntries.js — enrollment-entry normalization/merge for
// AssignmentsView.jsx, split out so Fast Refresh can hot-reload the panel
// component on its own.

/** Stored entries can be strings or {courseId|unitId, elective} objects
 * (CurriculumPlanner.toStored always writes the object form). Everything in
 * this panel normalizes to the bare id — rendering the object raw printed
 * `[object Object]` (admin advocacy #6). */
export const idOf = (entry, key) => (typeof entry === 'string' ? entry : entry?.[key] ?? null);
export const idsOf = (list, key) => (list ?? []).map((e) => idOf(e, key)).filter(Boolean);

/**
 * A save must round-trip whatever the record already held. An entry may carry
 * `profile` and a `school.course-enrollment/v1` block (module order, optional
 * modules, a frozen lessonOrder) which this panel neither renders nor
 * understands — flattening it to a bare id silently destroys the enrollment.
 * Checked ids that already had an object entry keep that entire object.
 */
export function mergeEntries(originalEntries, checkedIds, key) {
  const byId = new Map();
  (originalEntries ?? []).forEach((entry) => {
    const id = idOf(entry, key);
    if (id) byId.set(id, entry);
  });
  return checkedIds.map((id) => byId.get(id) ?? id);
}
