// exerciseDetailPath.js — the per-exercise detail-record path for
// ExerciseDetail.jsx, split out so Fast Refresh can hot-reload the detail
// sheet on its own.

/** Path for one full record. */
export function detailPath(slug) {
  return `api/v1/fitness/exercises/${encodeURIComponent(slug)}`;
}
