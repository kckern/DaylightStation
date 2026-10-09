// workoutRunnerDisplay.js — exercise-name/target display helpers for
// WorkoutRunner.jsx (also used by ExerciseDetail.jsx), split out so Fast
// Refresh can hot-reload the runner component on its own.

/** Title-case a slug so a corpus miss still reads as an exercise name. */
export function humanizeSlug(slug) {
  const text = typeof slug === 'string' ? slug.trim() : '';
  if (!text) return 'Exercise';
  return text
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve one slug against the display lookup. Always returns a usable record —
 * a missing entry, a missing name, or a lookup that is not an object all yield
 * the humanised slug and a null image.
 */
export function resolveExercise(lookup, slug) {
  const entry = lookup && typeof lookup === 'object' ? lookup[slug] : null;
  const name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : humanizeSlug(slug);
  const image = typeof entry?.image === 'string' && entry.image.trim() ? entry.image.trim() : null;
  return { name, image, known: Boolean(entry) };
}

/** "12 reps" / "45 sec" / "Until done" — what the athlete is being asked for. */
export function targetLabel(step) {
  if (Number.isFinite(step?.reps) && step.reps !== null) {
    return `${step.reps} ${step.reps === 1 ? 'rep' : 'reps'}`;
  }
  if (Number.isFinite(step?.seconds) && step.seconds !== null) {
    return `${step.seconds} sec`;
  }
  return 'Until done';
}
