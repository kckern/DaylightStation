/**
 * gateMaterial — the D10 provider seam. The game gate does not care where the
 * thing it asks a child to play comes from; it only needs something the
 * assessment engine can grade.
 *
 * Three kinds are named from day one so the vocabulary cannot drift:
 *   - `keys`     — a lit-keyboard ask, SYNTHESIZED here. Tiers 0-1 material is
 *                  one white key, or two a third-to-a-fifth apart; there is no
 *                  bank entry for "press a key", and inventing a network round
 *                  trip for one would put a 502 between a four-year-old and the
 *                  easiest thing the gate can ask.
 *   - `exercise` — an instance out of the exercise bank. Either named outright
 *                  (`instanceId`) or addressed by collection/roots, which the
 *                  scales bank can be asked for directly by id.
 *   - `score`    — a compiled score expectation. Named, but declined in phase 1:
 *                  there is no ghost/notation for a score on the run surface
 *                  yet, so a gate that got one would put a child in front of a
 *                  blank stave. The caller LOGS AND SKIPS it; it must never
 *                  crash, and it must never be mistaken for a typo'd kind,
 *                  which is why it has its own error code.
 *
 * Pure of React and of logging: every path resolves to a value describing what
 * happened — `{ ok: true, ... }` or `{ ok: false, error }`, plus a `skipped`
 * list the gate host can log with the learner/device/session context that makes
 * those decisions queryable. Nothing here throws on a bad config.
 */
import { pianoLearningApi } from '../Exercises/pianoLearningApi.js';
import { pickMaterial } from './gateRepertoire.js';

/**
 * The white keys of C4 through C6, in order.
 *
 * White only, and deliberately: a lit-key ask is the floor of the whole
 * ladder, reached by a child who has already failed everything above it. A
 * black key there asks for a hand position as well as a note.
 */
const WHITE_KEYS = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]);
/** The C4-B4 window a single-note ask is drawn from. */
const WHITE_KEYS_IN_ONE_OCTAVE = 7;
/** Diatonic steps between the notes of a multi-note ask: a third to a fifth. */
const SPREADS = Object.freeze([2, 3, 4]);
/** How many keys one ask may light. Single note, dyad, triad — no further. */
const MAX_LIT_KEYS = 3;

/**
 * A lit-key ask, built from nothing but the spec and the gate's own pick
 * counter. `pickIndex` is the ONLY source of variation: the gate persists it
 * and advances it on every serve, so consecutive gates light different keys and
 * a test that names an index gets the same ask every time.
 */
export function keysInstance(spec, pickIndex = 0) {
  const requested = Math.floor(Number(spec?.notes));
  const notes = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, MAX_LIT_KEYS) : 1;
  const arrangement = spec?.arrangement === 'sequence' ? 'sequence' : 'together';
  const index = Math.abs(Math.trunc(Number(pickIndex)) || 0);
  const start = index % WHITE_KEYS_IN_ONE_OCTAVE;
  const spread = notes > 1 ? SPREADS[index % SPREADS.length] : 0;
  const midis = Array.from({ length: notes }, (_, i) => WHITE_KEYS[start + (i * spread)]);

  // `ordering` follows the arrangement, and the spec may say so explicitly.
  // A chord graded in order would fail a child for rolling it; a sequence
  // graded out of order would not be a sequence.
  const ordering = spec?.ordering === 'strict' || spec?.ordering === 'any'
    ? spec.ordering
    : (arrangement === 'sequence' ? 'strict' : 'any');

  const notesOf = (list) => list.map((midi) => ({ midi, hand: 'right' }));
  const events = arrangement === 'sequence'
    ? midis.map((midi, i) => ({ id: `lit-${i + 1}`, value: 'quarter', notes: notesOf([midi]) }))
    : [{ id: 'lit-1', value: 'quarter', notes: notesOf(midis) }];

  return {
    id: `keys/lit@notes=${notes},arrangement=${arrangement},pick=${index}`,
    title: notes === 1 ? 'One key' : `${notes} keys`,
    form: 'keys',
    ordering,
    key: 'C',
    meter: '4/4',
    // A free attempt still compiles a tempo map, and an instance with no tempo
    // at all reaches the expectation compiler with NaN. Nothing is graded on
    // this number — the ask is untimed — but it has to be a number.
    tempo: { unit: 'quarter', start_bpm: 60 },
    level: { free: 1 },
    supports: ['free'],
    axes: {},
    staff: 'treble',
    events,
  };
}

/**
 * Load whatever a resolved material descriptor points at.
 *
 * `material.instance` short-circuits the fetch. The gate resolves the instance
 * itself now (it needs the axes and the events to write the child's ask), so
 * re-fetching the same id on the run's own load would be more than wasted: a
 * backend restart between the two calls is exactly how an already-resolved gate
 * used to land a child on "Exercise not found".
 */
export async function resolveGateMaterial(material) {
  if (material?.kind === 'keys') {
    return material.instance
      ? { ok: true, kind: 'keys', instance: material.instance }
      : { ok: false, error: 'keys-material-unresolved' };
  }
  if (material?.kind === 'exercise') {
    if (material.instance) return { ok: true, kind: 'exercise', instance: material.instance };
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

/**
 * The scales bank is addressable by id — `scales/modes` expands over a `root`
 * axis, so a level naming roots does not need a catalog walk to find them.
 * Every other collection does.
 */
const SCALES_SEED = 'scales/modes';
const scaleInstanceId = (root) => `${SCALES_SEED}@root=${root},mode=ionian,direction=up,span_octaves=1`;

/**
 * How many seeds to try before giving up on a catalog-addressed collection. A
 * seed can sit in the right collection and still have nothing this level can
 * run — its instance list can 502, come back empty, or contain only variants
 * that do not support the level's mode. One try would report "no material" for
 * a bank that plainly has some.
 */
const SEED_ATTEMPTS = 3;

/** The roots a level names, filtered to the strings the bank could address. */
const rootsOf = (spec) => (Array.isArray(spec?.roots) ? spec.roots : []).filter((r) => typeof r === 'string' && r);

async function loadInstance(instanceId) {
  const res = await pianoLearningApi.instance(instanceId);
  if (!res?.ok || !res.data) return { ok: false, error: 'instance-unavailable' };
  return { ok: true, material: { kind: 'exercise', instanceId, instance: res.data }, instance: res.data };
}

/** The catalog walk, for a collection whose ids cannot be derived. */
async function resolveByCatalog(spec, mode) {
  const catalog = await pianoLearningApi.catalog();
  const seeds = Array.isArray(catalog?.data?.seeds) ? catalog.data.seeds : null;
  if (!catalog?.ok || !seeds) return { ok: false, error: 'catalog-unavailable' };

  const candidates = seeds.filter((seed) => inCollection(seed?.category, spec.collection)
    && supportsMode(seed?.supports, mode));
  if (!candidates.length) return { ok: false, error: 'no-seed-for-level' };

  for (let i = 0; i < Math.min(SEED_ATTEMPTS, candidates.length); i += 1) {
    const seed = candidates[i];
    const response = await pianoLearningApi.instances(seed.id);
    const instances = Array.isArray(response?.data?.instances) ? response.data.instances : [];
    if (!response?.ok || !instances.length) continue;
    const runnable = instances.filter((instance) => supportsMode(instance?.supports ?? seed?.supports, mode));
    if (!runnable.length) continue;
    // The level's `hands` is a preference, not a filter: it should hand a child
    // a one-handed variant when the bank has one, but a bank that only
    // publishes two-handed variants must not read as "no material".
    const handed = runnable.filter((instance) => String(instance?.axes?.hands ?? '') === String(spec.hands ?? ''));
    const chosen = (handed.length ? handed : runnable)[0];
    if (!chosen?.id) continue;
    return { ok: true, material: { kind: 'exercise', instanceId: chosen.id, instance: chosen }, instance: chosen };
  }
  return { ok: false, error: 'no-instance-for-level' };
}

/** One material spec becomes one runnable thing, or one reason it did not. */
async function resolveSpec(spec, { pickIndex, mode }) {
  if (spec?.kind === 'keys') {
    const instance = keysInstance(spec, pickIndex);
    return { ok: true, material: { kind: 'keys', instance }, instance };
  }
  if (spec?.kind === 'exercise') {
    if (typeof spec.instanceId === 'string' && spec.instanceId) return loadInstance(spec.instanceId);
    const roots = rootsOf(spec);
    // Rotation over the roots, driven by the same counter that rotates the
    // level's material list — which is what makes two consecutive gates at a
    // three-root level two different scales rather than the same one twice.
    if (roots.length) return loadInstance(scaleInstanceId(roots[pickIndex % roots.length]));
    if (typeof spec.collection === 'string' && spec.collection) return resolveByCatalog(spec, mode);
    return { ok: false, error: 'no-collection-or-instance' };
  }
  if (spec?.kind === 'score') return { ok: false, error: 'score-material-phase-2' };
  return { ok: false, error: 'unknown-material-kind' };
}

/**
 * Choose what a child is asked to play for one gate attempt, from one level.
 *
 * Rotation picks the STARTING candidate (`pickMaterial`, which avoids the spec
 * served last time); the rest of the level's material is the fallback order. A
 * `score` entry in an otherwise playable level therefore costs that attempt
 * nothing — it is skipped and the level's other material is served — while a
 * level with nothing BUT score material declines, and the gate fails open.
 * Failing the whole gate because one entry is ahead of its phase would take a
 * match away from a child for a config decision they cannot see.
 *
 * @param {{id:string, tier:number, material:object[]}} level A resolved repertoire level.
 * @param {{lastMaterialId?:string|null, pickIndex?:number, mode?:'free'|'cued'}} [options]
 * @returns {Promise<{ok:boolean, spec?:object, material?:object, instance?:object,
 *                    skipped:Array<{kind:string|null, reason:string}>, error?:string}>}
 */
export async function pickGateMaterial(level, { lastMaterialId = null, pickIndex = 0, mode = 'free' } = {}) {
  const candidates = Array.isArray(level?.material) ? level.material : [];
  const skipped = [];
  if (!candidates.length) return { ok: false, error: 'no-material-in-level', skipped };

  // One normalization, used by both rotations — the material list's and the
  // roots' — so a hand-edited counter cannot make them disagree.
  const index = Math.abs(Math.trunc(Number(pickIndex)) || 0);
  const first = pickMaterial(level, lastMaterialId, index);
  const order = [first, ...candidates.filter((spec) => spec !== first)];
  for (const spec of order) {
    const resolved = await resolveSpec(spec, { pickIndex: index, mode });
    if (resolved.ok) {
      return { ok: true, spec, material: resolved.material, instance: resolved.instance, skipped };
    }
    skipped.push({ kind: spec?.kind ?? null, reason: resolved.error });
  }
  return { ok: false, error: skipped.at(-1)?.reason ?? 'no-material-in-level', skipped };
}

export default resolveGateMaterial;
