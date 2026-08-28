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
 *   - `score`    — a passage of REAL sheet music: a MusicXML document off the
 *                  media tree, plus the bars of it a child is being asked for.
 *                  Unlike the other two it resolves to no exercise instance at
 *                  all — the ask is whatever the engraver finds in the
 *                  document, so what this returns is the raw score and the run
 *                  surface compiles the expectation from the engraving.
 *
 * Pure of React and of logging: every path resolves to a value describing what
 * happened — `{ ok: true, ... }` or `{ ok: false, error }`, plus a `skipped`
 * list the gate host can log with the learner/device/session context that makes
 * those decisions queryable. Nothing here throws on a bad config.
 */
import { DaylightAPIText } from '../../../../../lib/api.mjs';
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
const ROOT_PITCH_CLASSES = Object.freeze({
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
});
const CHORD_INTERVALS = Object.freeze({ major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6] });

/**
 * A lit-key ask, built from nothing but the spec and the gate's own pick
 * counter. `pickIndex` is the ONLY source of variation: the gate persists it
 * and advances it on every serve, so consecutive gates light different keys and
 * a test that names an index gets the same ask every time.
 */
export function keysInstance(spec, pickIndex = 0) {
  const chordIntervals = CHORD_INTERVALS[spec?.quality];
  const rootPitchClass = ROOT_PITCH_CLASSES[spec?.root];
  if (chordIntervals && Number.isInteger(rootPitchClass)) {
    const root = 60 + rootPitchClass;
    const midis = chordIntervals.map((interval) => root + interval);
    return {
      id: `keys/chord@root=${spec.root},quality=${spec.quality}`,
      title: `${spec.root} ${spec.quality} chord`,
      form: 'keys', ordering: 'any', key: spec.root, meter: '4/4',
      tempo: { unit: 'quarter', start_bpm: 60 }, level: { free: 1 }, supports: ['free'],
      axes: { root: spec.root, quality: spec.quality }, staff: 'treble',
      events: [{ id: 'chord-1', value: 'quarter', notes: midis.map((midi) => ({ midi, hand: 'right' })) }],
    };
  }
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
 * The bars a level named, as PRINTED bar numbers — `[2, 3]` is the second and
 * third bar, which is how a grown-up authoring a level reads them off the page.
 * Anything that is not an ascending pair of whole bars from 1 up is dropped
 * rather than repaired: a range nobody can read means "the whole score", which
 * is always playable, where a guessed one puts a child in front of the wrong
 * bars with nothing on screen to say so.
 *
 * `Number.isInteger` and NOT a truncating coercion, for exactly that reason —
 * `[1.9, 3.2]` is not "bars 1 to 3", it is a config nobody can have meant, and
 * rounding it into a plausible answer is the quiet version of the mistake this
 * whole function exists to refuse. A bar number written as a string is the same
 * kind of mistake and is refused the same way.
 */
function passageMeasures(measures) {
  if (!Array.isArray(measures) || measures.length !== 2) return null;
  const [start, end] = measures;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 1 || end < start) return null;
  return [start, end];
}

/**
 * The content id of a score, as a media path. The `files:` scheme belongs to
 * the CONTENT id and is not part of the path — the same strip `SheetMusic.jsx`
 * does before it streams the raw document.
 */
const scoreStreamPath = (source) => `api/v1/proxy/media/stream/${encodeURIComponent(source.replace(/^[a-z]+:/i, ''))}`;

/**
 * Fetch a score's MusicXML the one way it is fetched anywhere: the media stream
 * endpoint `SheetMusic.jsx` uses. A second route to the same file would be a
 * second thing to keep true.
 *
 * Every failure is `score-unavailable`, deliberately flattened: a 502 mid
 * backend restart, a renamed file, a level naming no source at all, and an
 * empty document are all "there is no passage to put in front of this child",
 * and the gate's answer to all four is the same — fail open, grant the match.
 */
async function loadScore(material) {
  const source = typeof material?.source === 'string' ? material.source.trim() : '';
  if (!source) return { ok: false, error: 'score-unavailable' };
  try {
    const musicXml = await DaylightAPIText(scoreStreamPath(source));
    if (typeof musicXml !== 'string' || !musicXml.trim()) return { ok: false, error: 'score-unavailable' };
    return { ok: true, kind: 'score', score: { id: source, musicXml, measures: passageMeasures(material.measures) } };
  } catch {
    return { ok: false, error: 'score-unavailable' };
  }
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
  if (material?.kind === 'score') return loadScore(material);
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

/**
 * The decline reasons that are a CONFIG MISTAKE rather than an outage.
 *
 * Every one of these is decided without touching the network: a spec naming a
 * `kind` nothing implements, an `exercise` spec naming neither a collection nor
 * an instance, a `score` spec naming no document, and an ask the SCHEMA refuses.
 * They cannot be transient, they will read the same way on every attempt
 * forever, and they are fixed by editing one line of YAML.
 *
 * `ask-invalid` is the newest and the least obvious, so it is worth stating why
 * it belongs here rather than beside the outages. At tier 3 the ask is cued, and
 * `cued ⇒ a source that can carry note values` cannot be answered when the
 * spec's `kind` names nothing — so `askTupleFor` refuses the ask before any
 * resolver is asked for an opinion, and the resolver's own
 * `unknown-material-kind` is never produced. That is the SAME authoring mistake
 * arriving one step earlier, and the live config is one character away from it:
 * `kind: excercise` on L4 would otherwise hand every child who climbed that far
 * a silent free match, forever, where the same typo one rung lower substitutes
 * C major and warns. A classification that depends on which validator noticed
 * first is not a classification.
 *
 * This list is the GATE'S OWN, and is not the `onUnavailable` vocabulary — that
 * one is `no-access | instance-not-found | unrunnable`, it is frozen, and
 * nothing here touches it. What arrives on `onUnavailable`'s second argument is
 * classified by this list; the two are read together and confused separately.
 *
 * Their opposites — `instance-unavailable`, `catalog-unavailable`,
 * `score-unavailable`, and the no-seed/no-instance walks that depend on what
 * the bank served — say the bank could not be reached or had nothing today.
 * Those are infrastructure, and infrastructure fails OPEN: a child who earned
 * a match must not lose it to a 502 during a backend restart.
 *
 * A config mistake failing open is a different thing entirely: it hands out
 * free matches for as long as the typo survives, silently, which is the exact
 * posture `resolveRepertoire` already refuses for a malformed `repertoire`.
 */
const CONFIG_DECLINE_REASONS = Object.freeze([
  'no-score-source',
  'no-collection-or-instance',
  'unknown-material-kind',
  'ask-invalid',
]);

/**
 * Did EVERY spec in this level decline for a config reason?
 *
 * Every one, deliberately: a level whose one reachable spec 502'd is an outage
 * even if a second spec beside it has a typo, and the child should get their
 * match. Only a level where nothing could ever have resolved is a config
 * mistake this can be sure of.
 *
 * @param {Array<{reason:string}>|undefined} skipped The declines collected so
 *   far — `GameGate` accumulates them one at a time as it walks a level's
 *   material through `AskSession`.
 */
export function isConfigOnlyDecline(skipped) {
  const reasons = Array.isArray(skipped) ? skipped.map((entry) => entry?.reason) : [];
  return reasons.length > 0 && reasons.every((reason) => CONFIG_DECLINE_REASONS.includes(reason));
}

/**
 * One material spec becomes one runnable thing, or one reason it did not.
 *
 * Exported for `AskSession` (task 3, ask-platform SP1), which resolves ONE
 * authored spec — the host walks `materialOrder` and hands them over one at a
 * time. It is the only entry point that can answer for every shape a
 * level can name: `resolveGateMaterial` handles a descriptor that already knows
 * its instance or its id, and has nothing to say about `{collection, roots}`,
 * which is what every staff-level rung in the live config is written as.
 */
export async function resolveSpec(spec, { pickIndex, mode }) {
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
  if (spec?.kind === 'score') {
    const source = typeof spec.source === 'string' ? spec.source.trim() : '';
    // A level naming no score names nothing; that is a config mistake and it
    // reads as one in the skip log, rather than as a file that could not be
    // reached. The DOCUMENT is deliberately not fetched here: the rotation may
    // never serve this spec, and a pick that fetched would pull a whole score
    // over the wire to decide it had one. The run fetches it, once.
    if (!source) return { ok: false, error: 'no-score-source' };
    return { ok: true, material: { kind: 'score', source, measures: passageMeasures(spec.measures) }, instance: null };
  }
  return { ok: false, error: 'unknown-material-kind' };
}

/**
 * The order a level's material is TRIED in, for one attempt.
 *
 * Rotation picks the starting candidate (`pickMaterial`, which avoids the spec
 * served last time); everything else in the level follows it, in authored
 * order, as the fallback sequence. Exported because the walk over that sequence
 * no longer happens in one place: `GameGate` now serves one spec at a time
 * through `AskSession` and steps forward when one declines, and an order it
 * computed for itself would be a second answer to the question this module
 * already answers — the first time `pickMaterial`'s anti-repeat rule changed,
 * the two would disagree and nothing would say so.
 *
 * The order is a FALLBACK SEQUENCE, not a preference list: an entry that cannot
 * resolve — a bank 502, a score naming no source — costs that attempt nothing,
 * because the host steps to the next entry and serves that instead. Only a
 * level where nothing resolves declines. Failing a whole gate over one bad
 * entry would take a match away from a child for a config decision they cannot
 * see.
 *
 * @param {{material?:object[]}} level A resolved repertoire level.
 * @param {{lastMaterialId?:string|null, pickIndex?:number}} [options]
 * @returns {object[]} Possibly empty — a level with no material has no order.
 */
export function materialOrder(level, { lastMaterialId = null, pickIndex = 0 } = {}) {
  const candidates = Array.isArray(level?.material) ? level.material : [];
  if (!candidates.length) return [];
  // One normalization, used by both rotations — the material list's and the
  // roots' — so a hand-edited counter cannot make them disagree.
  const index = Math.abs(Math.trunc(Number(pickIndex)) || 0);
  const first = pickMaterial(level, lastMaterialId, index);
  return [first, ...candidates.filter((spec) => spec !== first)];
}

export default resolveGateMaterial;
