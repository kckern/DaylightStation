/**
 * workspaceReducer — the state core of the jam-first Producer (design §1).
 *
 * This is the `workspace` tree ONLY: "what's live right now". No song, no
 * title, no hidden section-1-of-1 — the `draft` tree materializes later
 * (Task 7.1) and is a separate reducer. Pure functions throughout: no DOM,
 * no timers, no logging — the transport hook and UI own side effects.
 *
 * Layer shape:
 *   {
 *     id,         // stable unique: library entry path or take id ("#n" suffix on repeats)
 *     source,     // { kind:'library', entry } | { kind:'take', takeId, notes, ppq, lengthBars? }
 *                 //   (take notes live IN the source for now — persistence comes later)
 *     role,       // 'chords'|'melody'|'bass'|'idea'|'groove'
 *     channel,    // 0..15, assigned at ADD. Grooves ALWAYS 9 (GM drum channel);
 *                 //   multiple grooves SHARE 9 — that is GM-correct: channel 10
 *                 //   (0-indexed 9) is the percussion channel and every drum
 *                 //   layer speaks the same drum map on it.
 *     gmProgram,  // GM program number. Defaults: bass → 33 (fingered bass);
 *                 //   every other melodic/harmonic role → 0 (acoustic grand).
 *                 //   Rationale: the default piano voice preserves today's
 *                 //   "backing plays the piano" feel — users change voices
 *                 //   explicitly. Grooves get null: GM drums ignore program.
 *     gain,       // 0..1 (loopScheduler: scales velocity; ≤0 emits nothing)
 *     muted,      // dropped from the cycle entirely (including its length)
 *     soloed,     // solo semantics: anySolo && !soloed → effectively muted
 *     carried,    // reserved for the draft tree (§4.1 continuity); stored only
 *   }
 *
 * Error mechanism (kept tiny): a failed ADD_LAYER (channel pool exhausted)
 * returns the state otherwise UNCHANGED with `lastError` set; every next
 * successful action clears it. The UI toasts `lastError` — nothing else
 * reads it.
 */

export const DRUM_CHANNEL = 9;

const BPM_MIN = 40;
const BPM_MAX = 220;
const DEFAULT_BPM = 100;

/** Default GM program per role — see the header comment for the rationale. */
const DEFAULT_PROGRAM_BY_ROLE = Object.freeze({
  chords: 0,
  melody: 0,
  bass: 33,
  idea: 0,
  groove: null,
});

export const initialWorkspace = Object.freeze({
  layers: Object.freeze([]),
  keyShift: 0,
  bpm: DEFAULT_BPM,
  metronome: false,
  editingSectionId: null,
  lastError: null,
});

export const ActionTypes = Object.freeze({
  ADD_LAYER: 'ADD_LAYER',
  REMOVE_LAYER: 'REMOVE_LAYER',
  SET_GAIN: 'SET_GAIN',
  TOGGLE_MUTE: 'TOGGLE_MUTE',
  TOGGLE_SOLO: 'TOGGLE_SOLO',
  SET_VOICE: 'SET_VOICE',
  SET_KEY: 'SET_KEY',
  NUDGE_KEY: 'NUDGE_KEY',
  SET_BPM: 'SET_BPM',
  TOGGLE_METRONOME: 'TOGGLE_METRONOME',
  LOAD_STACK: 'LOAD_STACK',
  CLEAR: 'CLEAR',
  SET_EDITING_SECTION: 'SET_EDITING_SECTION',
});

// ── internals ────────────────────────────────────────────────────────────────

const clampBpm = (bpm) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
const clampGain = (gain) => Math.max(0, Math.min(1, gain));

function baseIdFor(source) {
  if (source?.kind === 'take') return String(source.takeId);
  return String(source?.entry?.path ?? source?.entry?.slug ?? 'layer');
}

/** Same source added twice is allowed — suffix "#n" keeps ids unique. */
function uniqueId(layers, base) {
  if (!layers.some((l) => l.id === base)) return base;
  let n = 2;
  while (layers.some((l) => l.id === `${base}#${n}`)) n += 1;
  return `${base}#${n}`;
}

/** Lowest free MIDI channel 0..15 EXCLUDING 9 (reserved for drums), or null
 * when all 15 non-drum channels are taken. Groove layers never consume from
 * this pool — they sit on 9, which the scan skips regardless. */
function lowestFreeChannel(layers) {
  const used = new Set(layers.map((l) => l.channel));
  for (let c = 0; c <= 15; c += 1) {
    if (c === DRUM_CHANNEL) continue;
    if (!used.has(c)) return c;
  }
  return null;
}

/** Immutably update one layer by id; unknown id → state returned as-is
 * (a no-op is not a "successful action", so lastError is left alone). */
function mapLayer(state, id, fn) {
  if (!state.layers.some((l) => l.id === id)) return state;
  return {
    ...state,
    layers: state.layers.map((l) => (l.id === id ? fn(l) : l)),
    lastError: null,
  };
}

/** Fill per-layer defaults for layers arriving via LOAD_STACK. */
function normalizeLayer(layer, index) {
  const role = layer.role ?? 'idea';
  return {
    id: layer.id ?? (layer.source ? baseIdFor(layer.source) : `layer-${index}`),
    source: layer.source ?? null,
    role,
    channel: layer.channel,
    gmProgram: role === 'groove' ? null : (layer.gmProgram ?? DEFAULT_PROGRAM_BY_ROLE[role] ?? 0),
    gain: Number.isFinite(layer.gain) ? clampGain(layer.gain) : 1,
    muted: !!layer.muted,
    soloed: !!layer.soloed,
    carried: !!layer.carried,
  };
}

/**
 * LOAD_STACK channel validation: grooves are forced onto 9; non-groove layers
 * must hold a unique channel in 0..15 excluding 9 — violators (duplicate,
 * out-of-range, or squatting on 9) are reassigned lowest-free. Layers that
 * cannot be placed (more than 15 non-drum layers) are dropped, flagged via
 * the returned `dropped` count.
 */
function repairChannels(layers) {
  const out = [];
  const used = new Set();
  let dropped = 0;
  // First pass: keep every VALID claim so a conflicting later layer never
  // steals an earlier layer's legitimate channel.
  for (const l of layers) {
    if (l.role !== 'groove' && Number.isInteger(l.channel)
      && l.channel >= 0 && l.channel <= 15 && l.channel !== DRUM_CHANNEL && !used.has(l.channel)) {
      used.add(l.channel);
    }
  }
  const claimed = new Set();
  for (const l of layers) {
    if (l.role === 'groove') {
      out.push(l.channel === DRUM_CHANNEL ? l : { ...l, channel: DRUM_CHANNEL });
      continue;
    }
    const valid = Number.isInteger(l.channel) && l.channel >= 0 && l.channel <= 15
      && l.channel !== DRUM_CHANNEL && !claimed.has(l.channel);
    if (valid) {
      claimed.add(l.channel);
      out.push(l);
      continue;
    }
    let ch = null;
    for (let c = 0; c <= 15; c += 1) {
      if (c === DRUM_CHANNEL || used.has(c) || claimed.has(c)) continue;
      ch = c;
      break;
    }
    if (ch == null) { dropped += 1; continue; }
    claimed.add(ch);
    out.push({ ...l, channel: ch });
  }
  return { layers: out, dropped };
}

// ── reducer ──────────────────────────────────────────────────────────────────

export function workspaceReducer(state, action) {
  switch (action.type) {
    case ActionTypes.ADD_LAYER: {
      const { source, role, bpmHint } = action;
      const isGroove = role === 'groove';
      const channel = isGroove ? DRUM_CHANNEL : lowestFreeChannel(state.layers);
      if (channel == null) {
        // Pool exhausted: state otherwise UNCHANGED; UI toasts lastError.
        return { ...state, lastError: 'channels-exhausted' };
      }
      const layer = {
        id: uniqueId(state.layers, baseIdFor(source)),
        source,
        role,
        channel,
        // Careful: grooves map to null in the table, and `null ?? 0` would
        // resurrect a program — gate on role instead.
        gmProgram: isGroove ? null : (DEFAULT_PROGRAM_BY_ROLE[role] ?? 0),
        gain: 1,
        muted: false,
        soloed: false,
        carried: false,
      };
      // Mirror today's "seed tempo from base": the FIRST layer may carry the
      // library entry's bpm, adopted only while bpm is still untouched.
      const adoptBpm = state.layers.length === 0
        && state.bpm === DEFAULT_BPM
        && Number.isFinite(bpmHint);
      return {
        ...state,
        layers: [...state.layers, layer],
        bpm: adoptBpm ? clampBpm(bpmHint) : state.bpm,
        lastError: null,
      };
    }

    case ActionTypes.REMOVE_LAYER: {
      if (!state.layers.some((l) => l.id === action.id)) return state;
      // Channel is freed implicitly (the pool is derived from live layers);
      // mute/solo bookkeeping lives ON the layer, so it leaves with it.
      return {
        ...state,
        layers: state.layers.filter((l) => l.id !== action.id),
        lastError: null,
      };
    }

    case ActionTypes.SET_GAIN: {
      if (!Number.isFinite(action.gain)) return state;
      return mapLayer(state, action.id, (l) => ({ ...l, gain: clampGain(action.gain) }));
    }

    case ActionTypes.TOGGLE_MUTE:
      return mapLayer(state, action.id, (l) => ({ ...l, muted: !l.muted }));

    case ActionTypes.TOGGLE_SOLO:
      return mapLayer(state, action.id, (l) => ({ ...l, soloed: !l.soloed }));

    case ActionTypes.SET_VOICE:
      // No-op for grooves: GM drums live on channel 10's drum map and ignore
      // program changes — there is no voice to set.
      return mapLayer(state, action.id, (l) => (
        l.role === 'groove' ? l : { ...l, gmProgram: action.gmProgram }
      ));

    case ActionTypes.SET_KEY: {
      if (!Number.isFinite(action.shift)) return state;
      return { ...state, keyShift: Math.trunc(action.shift), lastError: null };
    }

    case ActionTypes.NUDGE_KEY: {
      if (!Number.isFinite(action.delta)) return state;
      return { ...state, keyShift: state.keyShift + Math.trunc(action.delta), lastError: null };
    }

    case ActionTypes.SET_BPM: {
      if (!Number.isFinite(action.bpm)) return state;
      return { ...state, bpm: clampBpm(action.bpm), lastError: null };
    }

    case ActionTypes.TOGGLE_METRONOME:
      return { ...state, metronome: !state.metronome, lastError: null };

    case ActionTypes.LOAD_STACK: {
      // Wholesale replace — section open / resume / preset load. Layers arrive
      // complete with channels; we still validate uniqueness + groove-on-9 and
      // repair violations (see repairChannels).
      const { layers: repaired, dropped } = repairChannels(
        (action.layers ?? []).map(normalizeLayer),
      );
      return {
        ...state,
        layers: repaired,
        bpm: Number.isFinite(action.bpm) ? clampBpm(action.bpm) : state.bpm,
        keyShift: Number.isFinite(action.keyShift) ? Math.trunc(action.keyShift) : state.keyShift,
        editingSectionId: action.editingSectionId ?? null,
        lastError: dropped ? 'channels-exhausted' : null,
      };
    }

    case ActionTypes.CLEAR:
      // FULL reset, bpm/metronome included: "clear" means back to the blank
      // jam, and a stale tempo is as much leftover as a stale layer.
      return initialWorkspace;

    case ActionTypes.SET_EDITING_SECTION:
      return { ...state, editingSectionId: action.id ?? null, lastError: null };

    default:
      return state;
  }
}

// ── action creators ──────────────────────────────────────────────────────────

export const addLayer = ({ source, role, bpmHint }) => ({ type: ActionTypes.ADD_LAYER, source, role, bpmHint });
export const removeLayer = (id) => ({ type: ActionTypes.REMOVE_LAYER, id });
export const setGain = (id, gain) => ({ type: ActionTypes.SET_GAIN, id, gain });
export const toggleMute = (id) => ({ type: ActionTypes.TOGGLE_MUTE, id });
export const toggleSolo = (id) => ({ type: ActionTypes.TOGGLE_SOLO, id });
export const setVoice = (id, gmProgram) => ({ type: ActionTypes.SET_VOICE, id, gmProgram });
export const setKey = (shift) => ({ type: ActionTypes.SET_KEY, shift });
export const nudgeKey = (delta) => ({ type: ActionTypes.NUDGE_KEY, delta });
export const setBpm = (bpm) => ({ type: ActionTypes.SET_BPM, bpm });
export const toggleMetronome = () => ({ type: ActionTypes.TOGGLE_METRONOME });
export const loadStack = ({ layers, bpm, keyShift, editingSectionId }) => (
  { type: ActionTypes.LOAD_STACK, layers, bpm, keyShift, editingSectionId }
);
export const clearWorkspace = () => ({ type: ActionTypes.CLEAR });
export const setEditingSection = (id) => ({ type: ActionTypes.SET_EDITING_SECTION, id });

/**
 * Capture keep → ADD_LAYER source (Task 6.2 review follow-up).
 *
 * KEY NORMALIZATION: the recorder hears the TRANSPOSED jam but plays REAL
 * pitches; toTransportLayers then applies keyShift to every non-groove layer.
 * Storing the played pitches verbatim would transpose the take AGAIN on
 * playback (keyShift semitones high). So the stored take is normalized to
 * CANONICAL pitch (midi − keyShift), exactly like library loops — the
 * single-transpose rule stays uniform. Grooves are untouched (drum-map
 * pitches are instrument slots; toTransportLayers gives grooves transpose 0).
 *
 * The harmonic timeline was computed from the PLAYED pitches, so its root
 * shifts with the notes: root − keyShift (mod 12). Slots are root-relative
 * and unchanged.
 *
 * CITIZENSHIP: timeline + drumMode ride on the source so later phases
 * (sections, Crate saves) inherit the enrichment instead of recomputing.
 *
 * @param {{takeId, notes, ppq, lengthBars, kind, drumMode, timeline}} take  keep() output
 * @param {number} [keyShift=0]  workspace keyShift at keep time
 */
export function takeToSource(take, keyShift = 0) {
  const isGroove = take.kind === 'groove';
  const shift = isGroove ? 0 : Math.trunc(Number.isFinite(keyShift) ? keyShift : 0);
  const notes = shift === 0
    ? take.notes
    : take.notes.map((n) => ({ ...n, midi: n.midi - shift }));
  let timeline = take.timeline ?? null;
  if (timeline && shift !== 0 && Number.isFinite(timeline.root)) {
    timeline = { ...timeline, root: (((timeline.root - shift) % 12) + 12) % 12 };
  }
  return {
    kind: 'take',
    takeId: take.takeId,
    notes,
    ppq: take.ppq,
    lengthBars: take.lengthBars,
    timeline,
    drumMode: !!take.drumMode,
  };
}

// ── selectors ────────────────────────────────────────────────────────────────

/** True when any layer is soloed. */
export function anySolo(state) {
  return state.layers.some((l) => l.soloed);
}

/** Solo semantics identical to today's Producer: muted OR (anySolo && !soloed).
 * Unknown id reads as not muted — an absent layer never schedules anyway. */
export function effectiveMuted(state, id) {
  const layer = state.layers.find((l) => l.id === id);
  if (!layer) return false;
  return !!layer.muted || (anySolo(state) && !layer.soloed);
}

/**
 * THE seam the transport consumes (Task 4.2): map workspace layers + a
 * `{ layerId → { notes, ppq, barSpan } }` lookup into the loopScheduler layer
 * array. Layers with no loaded notes yet are omitted (they join the cycle
 * once their notes arrive). Take layers fall back to the notes embedded in
 * their source (`lengthBars` → `barSpan`), so a fresh recording plays without
 * a lookup entry. Grooves get transpose 0 ALWAYS — percussion never
 * transposes (design §4: drum-map pitches are instrument slots, not notes).
 */
export function toTransportLayers(state, loadedNotes = {}) {
  const out = [];
  for (const layer of state.layers) {
    const loaded = loadedNotes[layer.id]
      ?? (layer.source?.kind === 'take' && layer.source.notes?.length
        ? { notes: layer.source.notes, ppq: layer.source.ppq, barSpan: layer.source.lengthBars }
        : null);
    if (!loaded?.notes?.length) continue;
    out.push({
      notes: loaded.notes,
      ppq: loaded.ppq,
      barSpan: loaded.barSpan,
      transpose: layer.role === 'groove' ? 0 : state.keyShift,
      muted: effectiveMuted(state, layer.id),
      channel: layer.channel,
      gain: layer.gain,
    });
  }
  return out;
}

export default workspaceReducer;
