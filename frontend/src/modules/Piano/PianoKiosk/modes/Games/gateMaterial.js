/**
 * gateMaterial — the D10 provider seam. The game gate does not care where the
 * thing it asks a child to play comes from; it only needs something the
 * assessment engine can grade.
 *
 * Two kinds are named from day one so the vocabulary cannot drift:
 *   - `exercise` — an instance out of the exercise bank. Fully supported.
 *   - `score`    — a compiled score expectation. Named, but declined in phase 1:
 *                  there is no ghost/notation for a score on the run surface
 *                  yet, so a gate that got one would put a child in front of a
 *                  blank stave. The caller LOGS AND SKIPS it (see ExerciseRun);
 *                  it must never crash, and it must never be mistaken for a
 *                  typo'd kind, which is why it has its own error code.
 *
 * Pure: no React, no logging, no throwing. Every path resolves to
 * `{ ok: true, kind, instance }` or `{ ok: false, error }` so a caller can
 * decide what a child sees.
 */
import { pianoLearningApi } from '../Exercises/pianoLearningApi.js';

export async function resolveGateMaterial(material) {
  if (material?.kind === 'exercise') {
    const res = await pianoLearningApi.instance(material.instanceId);
    if (!res.ok) return { ok: false, error: 'instance-unavailable' };
    return { ok: true, kind: 'exercise', instance: res.data };
  }
  if (material?.kind === 'score') return { ok: false, error: 'score-material-phase-2' };
  return { ok: false, error: 'unknown-material-kind' };
}

export default resolveGateMaterial;
