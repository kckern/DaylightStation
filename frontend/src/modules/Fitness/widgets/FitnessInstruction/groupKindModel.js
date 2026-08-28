// groupKindModel.js — pure group-kind derivation for GroupEditor.jsx, split
// out so Fast Refresh can hot-reload the editor component on its own.

/**
 * 1 exercise is straight sets, 2 a superset, 3+ a circuit. Mirrors `groupKind` in
 * backend/src/2_domains/fitness/workout/workout.mjs — which the frontend cannot import
 * (no alias resolves `backend/src`). It is re-derived rather than sent by the server
 * because the group being edited has never been to the server; the boundary values are
 * pinned in the tests on both sides.
 */
export function groupKind(group) {
  const count = Array.isArray(group?.exercises) ? group.exercises.length : 0;
  if (count >= 3) return 'circuit';
  if (count === 2) return 'superset';
  return 'sets';
}

export const GROUP_LABELS = { sets: 'Straight sets', superset: 'Superset', circuit: 'Circuit' };

/** The derived label the group shows. */
export function groupLabel(group) {
  return GROUP_LABELS[groupKind(group)];
}
