/**
 * Seed expansion for the exercise bank.
 *
 * A seed is authored; an instance is computed. One triad seed is 288 playable
 * items, and none of them exist on disk — so this module is what turns a stored
 * file into the thing a player is actually asked to perform.
 *
 * Pure and dependency-free, so the backend can serve instances and the frontend
 * can expand the same seed without a round trip.
 *
 * Schema: docs/reference/piano/exercise-bank.md
 */

const PITCH_CLASSES = Object.freeze({
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
});

/** Sharp spelling; the bank does not yet carry enharmonic intent. */
const PITCH_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

const ALL_ROOTS = Object.freeze(PITCH_NAMES.map((name) => name));

const clone = (value) => structuredClone(value);

/** The values an axis actually ranges over, with `all` and `range` resolved. */
export function axisValues(name, axis) {
  if (!axis) return [];
  if (axis.values === 'all') return [...ALL_ROOTS];
  if (axis.values === 'range') {
    const from = Number(axis.from);
    const to = Number(axis.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return Array.isArray(axis.values) ? [...axis.values] : [];
}

/** An axis value's identity, for ids: objects carry an `id`, scalars are themselves. */
const valueId = (value) => (value && typeof value === 'object' ? value.id : value);

/**
 * Every combination of axis values, in declared order.
 *
 * Declaration order is load-bearing: it fixes the id string, so the same
 * instance is the same id forever and history stays attributable.
 */
export function axisCombinations(seed) {
  const axes = seed?.expansion?.axes ?? {};
  const names = Object.keys(axes);
  let combinations = [{}];
  for (const name of names) {
    const values = axisValues(name, axes[name]);
    if (!values.length) continue;
    const next = [];
    for (const combination of combinations) {
      for (const value of values) next.push({ ...combination, [name]: value });
    }
    combinations = next;
  }
  return combinations;
}

export function countInstances(seed) {
  const axes = seed?.expansion?.axes ?? {};
  return Object.entries(axes).reduce((total, [name, axis]) => {
    const size = axisValues(name, axis).length;
    return size ? total * size : total;
  }, 1);
}

export function instanceId(seedId, axes) {
  const parts = Object.entries(axes).map(([name, value]) => `${name}=${valueId(value)}`);
  return parts.length ? `${seedId}@${parts.join(',')}` : seedId;
}

/** `triads/all@root=D,quality=minor` -> { seedId, axes }. Null when malformed. */
export function parseInstanceId(id) {
  if (typeof id !== 'string' || !id) return null;
  const at = id.indexOf('@');
  if (at < 0) return { seedId: id, axes: {} };
  const seedId = id.slice(0, at);
  const axes = {};
  for (const pair of id.slice(at + 1).split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) return null;
    axes[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return seedId ? { seedId, axes } : null;
}

const rootPitchClass = (root) => (
  Number.isInteger(root) ? ((root % 12) + 12) % 12 : PITCH_CLASSES[String(root)] ?? null
);

/** Lowest note up an octave, n times — the chord keeps its notes and changes its bass. */
function invert(midis, times) {
  const notes = [...midis].sort((a, b) => a - b);
  for (let i = 0; i < times; i += 1) notes.push(notes.shift() + 12);
  return notes.sort((a, b) => a - b);
}

const INVERSION_INDEX = { root: 0, '1st': 1, '2nd': 2, '3rd': 3 };

/**
 * Applies one combination of axis values to the seed's prototype events.
 *
 * Order matters. The recipe (quality or mode) rebuilds the material, inversion
 * rearranges it, root transposes it, octave moves it, and only then is melodic
 * material sequenced. Transposing before rebuilding would throw the recipe away.
 */
export function materialize(seed, axes = {}) {
  if (!seed?.events?.length) return null;
  let events = clone(seed.events);

  // The pitch the prototype is built on — everything is relative to it.
  const anchor = Math.min(...events.flatMap((e) => e.notes.map((n) => n.midi)));

  // 1. Recipe: rebuild from named intervals.
  const recipe = axes.quality ?? axes.mode;
  const intervals = recipe && typeof recipe === 'object' ? recipe.intervals : null;
  if (Array.isArray(intervals) && intervals.length) {
    const template = events[0];
    if (events.length === 1) {
      // A chord: one onset holding the whole recipe.
      events = [{ ...template, notes: intervals.map((step) => ({ ...template.notes[0], midi: anchor + step })) }];
    } else {
      // Melodic: one onset per degree.
      events = intervals.map((step) => ({ ...template, notes: [{ ...template.notes[0], midi: anchor + step }] }));
    }
  }

  // 2. Inversion, for chord material only.
  const inversion = INVERSION_INDEX[valueId(axes.inversion)] ?? 0;
  if (inversion > 0 && events.length === 1 && events[0].notes.length > 1) {
    const inverted = invert(events[0].notes.map((n) => n.midi), inversion);
    events[0] = { ...events[0], notes: inverted.map((midi, i) => ({ ...events[0].notes[i], midi })) };
  }

  // 3. Absolute pitch (single-note seeds) or transposition by root.
  if (axes.pitch !== undefined) {
    const target = Number(axes.pitch);
    if (Number.isInteger(target)) {
      const shift = target - anchor;
      events = events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n, midi: n.midi + shift })) }));
    }
  } else if (axes.root !== undefined) {
    const pitchClass = rootPitchClass(valueId(axes.root));
    if (pitchClass !== null) {
      const shift = (pitchClass - (((anchor % 12) + 12) % 12) + 12) % 12;
      events = events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n, midi: n.midi + shift })) }));
    }
  }

  // 4. Register.
  const octave = Number(valueId(axes.octave));
  if (Number.isInteger(octave) && octave !== 0) {
    events = events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n, midi: n.midi + 12 * octave })) }));
  }

  // 5. Span, then direction — sequencing is last, so it sees final pitches.
  const span = Number(valueId(axes.span_octaves));
  if (Number.isInteger(span) && span > 1 && events.length > 1) {
    const base = clone(events);
    const lastOf = (list) => list.at(-1).notes.at(-1).midi;
    for (let octaveIndex = 1; octaveIndex < span; octaveIndex += 1) {
      const shifted = base.map((event) => ({
        ...event,
        notes: event.notes.map((n) => ({ ...n, midi: n.midi + 12 * octaveIndex })),
      }));
      // A scale's degrees run 0..12 inclusive, so the octave above is both the
      // last note of this block and the first of the next. It is one key, and it
      // is struck once — a two-octave scale is 15 notes, not 16.
      const joined = shifted[0].notes.at(-1).midi === lastOf(events) ? shifted.slice(1) : shifted;
      events.push(...joined);
    }
  }

  const direction = valueId(axes.direction);
  if (direction === 'down') events = [...events].reverse();
  else if (direction === 'up-then-down') {
    // The turn note is not struck twice.
    events = [...events, ...clone(events).reverse().slice(1)];
  }

  const pitches = events.flatMap((e) => e.notes.map((n) => n.midi));
  if (pitches.some((midi) => !Number.isFinite(midi) || midi < 21 || midi > 108)) return null;

  return {
    id: instanceId(seed.id, axes),
    seed_id: seed.id,
    axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, valueId(v)])),
    title: seed.title,
    key: valueId(axes.root) ?? seed.key ?? null,
    // Notational only: the same pitches read in another clef are a real reading
    // difference, but they are not different pitches.
    staff: valueId(axes.staff) ?? seed.staff ?? 'treble',
    meter: seed.meter ?? null,
    tempo: seed.tempo ?? null,
    ordering: seed.ordering ?? 'strict',
    supports: seed.supports ?? ['free'],
    ...(seed.voicing ? { voicing: seed.voicing } : {}),
    events,
    shape: shapeOf(events),
  };
}

/** Shape is measured from the instance's own notes, never inherited from the seed. */
export function shapeOf(events) {
  const pitches = events.flatMap((e) => e.notes.map((n) => n.midi));
  const hands = new Set(events.flatMap((e) => e.notes.map((n) => n.hand).filter(Boolean)));
  return {
    events: events.length,
    notes: pitches.length,
    max_simultaneity: Math.max(...events.map((e) => e.notes.length)),
    hands: hands.size > 1 ? 'both' : [...hands][0] ?? 'right',
    span_semitones: Math.max(...pitches) - Math.min(...pitches),
  };
}

/** Every instance of a seed. `limit` caps the walk for listing endpoints. */
export function expandSeed(seed, { limit = Infinity } = {}) {
  const combinations = axisCombinations(seed);
  const instances = [];
  for (const axes of combinations) {
    if (instances.length >= limit) break;
    const instance = materialize(seed, axes);
    if (instance) instances.push(instance);
  }
  return instances;
}

/** Ids only — cheap enough to list a 504-instance seed without building events. */
export function instanceIds(seed) {
  return axisCombinations(seed).map((axes) => instanceId(seed.id, axes));
}

/** Rebuilds one instance from an id, resolving axis ids back to their values. */
export function materializeById(seed, id) {
  const parsed = parseInstanceId(id);
  if (!parsed || parsed.seedId !== seed.id) return null;
  const declared = seed?.expansion?.axes ?? {};
  const axes = {};
  for (const [name, raw] of Object.entries(parsed.axes)) {
    if (!declared[name]) return null;
    const values = axisValues(name, declared[name]);
    const match = values.find((value) => String(valueId(value)) === String(raw));
    if (match === undefined) return null;
    axes[name] = match;
  }
  return materialize(seed, axes);
}
