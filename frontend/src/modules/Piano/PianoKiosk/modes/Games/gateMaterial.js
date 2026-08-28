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
import { requirementForRung } from './gameGateLadder.js';

export async function resolveGateMaterial(material) {
  if (material?.kind === 'exercise') {
    const res = await pianoLearningApi.instance(material.instanceId);
    if (!res.ok) return { ok: false, error: 'instance-unavailable' };
    return { ok: true, kind: 'exercise', instance: res.data };
  }
  if (material?.kind === 'score') return { ok: false, error: 'score-material-phase-2' };
  return { ok: false, error: 'unknown-material-kind' };
}

/**
 * The mode vocabulary is `free | cued` only — never a matcher name. A seed or
 * instance that declares nothing is treated as free-only, the same fallback the
 * exercise browser already applies (`selected.supports ?? seed.supports ?? ['free']`).
 */
const supportsMode = (supports, mode) => (Array.isArray(supports) ? supports : ['free']).includes(mode);

/** The browser's own collection idiom: exact category, or a child of it. */
const inCollection = (category, collection) => typeof category === 'string'
  && typeof collection === 'string'
  && (category === collection || category.startsWith(`${collection}/`));

const randomPick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * How many seeds to try before giving up. A seed can sit in the right
 * collection and still have nothing this rung can run — its instance list can
 * 502, come back empty, or contain only variants that do not support the rung's
 * mode. One try would report "no material" for a bank that plainly has some.
 */
const SEED_ATTEMPTS = 3;

/**
 * Choose what a child is asked to play for one gate attempt.
 *
 * Pure of React and of logging, like `resolveGateMaterial` above: it RETURNS
 * what it declined (`skipped`) instead of writing it anywhere, so the gate host
 * can log those skips with the learner/device/session context that makes them
 * queryable. Every path resolves — a config that is missing, malformed, or all
 * `score` entries produces `{ ok: false, error }`, never a throw.
 *
 * `passScore` is threaded straight into `requirementForRung` and is the single
 * most load-bearing value here: off the floor a requirement carries no rubric
 * and no gates, so the engine's `verdict.passed` is unconditionally true and
 * `ExerciseRun` judges on `result.score >= requirement.passScore` instead. A
 * requirement that reached the run without a finite `passScore` would pass
 * every child at any score, including one who played nothing.
 *
 * @param {Array<{kind:string, collections?:string[]}>} materialConfig `gameGate.material`
 * @param {object} rung The current ladder rung.
 * @param {{passScore?:number, pick?:(list:any[])=>any}} [options]
 * @returns {Promise<{ok:boolean, material?:object, requirement:object, seedId?:string,
 *                    skipped:Array<{kind:string|null, reason:string}>, error?:string}>}
 */
export async function pickGateMaterial(materialConfig, rung, { passScore = 0.8, pick = randomPick } = {}) {
  const requirement = requirementForRung(rung, { passScore });
  const { mode } = requirement;
  const skipped = [];
  const collections = [];

  for (const entry of Array.isArray(materialConfig) ? materialConfig : []) {
    if (entry?.kind !== 'exercise') {
      // `score` is a KNOWN kind that phase 1 declines (there is no notation for
      // a score on the run surface yet), and it must stay distinguishable from
      // a typo'd kind — same two error codes `resolveGateMaterial` uses.
      skipped.push({
        kind: entry?.kind ?? null,
        reason: entry?.kind === 'score' ? 'score-material-phase-2' : 'unknown-material-kind',
      });
      continue;
    }
    const named = (Array.isArray(entry.collections) ? entry.collections : []).filter((c) => typeof c === 'string' && c);
    if (!named.length) { skipped.push({ kind: 'exercise', reason: 'no-collections' }); continue; }
    for (const collection of named) if (!collections.includes(collection)) collections.push(collection);
  }
  if (!collections.length) return { ok: false, error: 'no-exercise-material-configured', requirement, skipped };

  const catalog = await pianoLearningApi.catalog();
  const seeds = Array.isArray(catalog?.data?.seeds) ? catalog.data.seeds : null;
  if (!catalog?.ok || !seeds) return { ok: false, error: 'catalog-unavailable', requirement, skipped };

  const candidates = seeds.filter((seed) => collections.some((c) => inCollection(seed?.category, c))
    && supportsMode(seed?.supports, mode));
  if (!candidates.length) return { ok: false, error: 'no-seed-for-rung', requirement, skipped };

  // Rotate the candidate list so the tries start at the picked seed: the child
  // gets a different exercise each gate, and a dud seed still has neighbours.
  const start = Math.max(0, candidates.indexOf(pick(candidates)));
  for (let i = 0; i < Math.min(SEED_ATTEMPTS, candidates.length); i += 1) {
    const seed = candidates[(start + i) % candidates.length];
    const response = await pianoLearningApi.instances(seed.id);
    const instances = Array.isArray(response?.data?.instances) ? response.data.instances : [];
    if (!response?.ok || !instances.length) continue;
    const runnable = instances.filter((instance) => supportsMode(instance?.supports ?? seed?.supports, mode));
    if (!runnable.length) continue;
    // The rung's `hands` is a preference, not a filter: an eased rung should
    // hand a child a one-handed variant when the bank has one, but a bank that
    // only publishes two-handed variants must not read as "no material" and
    // fail the gate open.
    const handed = runnable.filter((instance) => String(instance?.axes?.hands ?? '') === String(requirement.hands));
    const chosen = pick(handed.length ? handed : runnable);
    if (!chosen?.id) continue;
    return { ok: true, material: { kind: 'exercise', instanceId: chosen.id }, requirement, seedId: seed.id, skipped };
  }
  return { ok: false, error: 'no-instance-for-rung', requirement, skipped };
}

export default resolveGateMaterial;
