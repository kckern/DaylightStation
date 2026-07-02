/**
 * draftReducer — the `draft` tree of the Producer (design §1): the SONG
 * structure. Starts as `null` and only materializes on the first PROMOTE (or
 * when a saved/example song is loaded as a whole draft) — jamming never
 * creates a hidden section-1-of-1. Pure functions throughout: no DOM, no
 * timers, no logging.
 *
 * Shape once materialized:
 *   {
 *     sections: [{ id, name, lengthBars, stack }],
 *     carriedLayers: { [layerId]: workspaceLayer },   // shared continuity pool
 *     arrangement: [{ sectionId, repeats }],
 *     meta: { title, author, keyShift, bpm },
 *   }
 *
 * INDEPENDENCE BY DEFAULT, CONTINUITY BY REFERENCE (design §4.1):
 * a section's `stack` holds deep COPIES of workspace layers — editing one
 * section never bleeds into another. The exception is layers the player
 * marked `carried` IN THE WORKSPACE (the `carried` flag already lives on
 * workspace layers; there is no draft-side marking verb — PROMOTE just reads
 * it). A carried layer is stored ONCE in `carriedLayers`, keyed by its layer
 * id, and every referencing section's stack holds a `{ carriedRef: layerId }`
 * placeholder instead of a copy. All sections referencing the same id SHARE
 * the layer: a carried groove/bass persists — and mutates everywhere at once
 * via MUTATE_CARRIED — while the harmony changes around it. Re-promoting a
 * carried layer OVERWRITES the shared entry (latest edit wins everywhere) —
 * EXCEPT its channel, which is STRUCTURAL and keeps the existing entry's
 * value (the same lock MUTATE_CARRIED applies): a workspace where the layer
 * drifted onto another channel must not re-seat the shared layer under every
 * section that already references it. A carried layer is garbage-collected
 * as soon as NO section references it (swept on every PROMOTE and
 * DELETE_SECTION). A carried layer REMOVED from the workspace does NOT join
 * later promotes — PROMOTE reads only the layers present in
 * `workspaceState.layers`; the shared entry lives on solely for the sections
 * that already reference it (until the GC sweep).
 *
 * KEY/TEMPO ARE SONG-GLOBAL: sections store layers only. keyShift/bpm live at
 * `meta`, seeded from the workspace at first promotion and never re-seeded —
 * once a song exists, the workspace inherits the song's key/tempo, not the
 * other way around. Section stacks carry NO captured keyShift;
 * toSchedulerInputs applies meta.keyShift uniformly (grooves pinned to
 * transpose 0), the same single-transpose rule as toTransportLayers.
 *
 * SECTION NAMES ARE STRUCTURAL LABELS, NOT TITLES: the auto names 'A', 'B',
 * 'C', … are rehearsal-mark structure — the section honestly IS the first /
 * second / third block. Design §3.1's never-fabricate rule is about human
 * TITLES for material, which stay null (meta.title) until a person types one.
 *
 * THE DRAFT NEVER REACHES INTO THE WORKSPACE: OPEN_SECTION deliberately
 * returns state unchanged — opening a section is a WORKSPACE action. The
 * caller resolves the stack with `resolveSectionStack(draft, sectionId)` and
 * dispatches LOAD_STACK (+ editingSectionId) to the workspace reducer; the
 * two trees only meet in the component layer, connected by the verbs.
 *
 * ERROR POLICY: invalid actions (unknown ids, out-of-range indices,
 * malformed payloads) are silent no-ops returning the SAME state reference.
 * The draft has no `lastError` channel — arrangement/section edits are
 * UI-gated (buttons only exist for valid targets), unlike the workspace's
 * channel pool which can genuinely run out mid-gesture.
 */

// ── constants (mirror workspaceReducer's global-knob ranges) ─────────────────

import { DRUM_CHANNEL } from './workspaceReducer.js';

const BPM_MIN = 40;
const BPM_MAX = 220;
const DEFAULT_BPM = 100;

export const initialDraftState = null;

export const ActionTypes = Object.freeze({
  PROMOTE: 'PROMOTE',
  OPEN_SECTION: 'OPEN_SECTION',
  SET_ARRANGEMENT: 'SET_ARRANGEMENT',
  SET_REPEATS: 'SET_REPEATS',
  MOVE_ENTRY: 'MOVE_ENTRY',
  ADD_ENTRY: 'ADD_ENTRY',
  REMOVE_ENTRY: 'REMOVE_ENTRY',
  SET_SECTION_LENGTH: 'SET_SECTION_LENGTH',
  RENAME_SECTION: 'RENAME_SECTION',
  DELETE_SECTION: 'DELETE_SECTION',
  CLONE_SECTION: 'CLONE_SECTION',
  MUTATE_CARRIED: 'MUTATE_CARRIED',
  SET_META: 'SET_META',
});

// ── internals ────────────────────────────────────────────────────────────────

const clampBpm = (bpm) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
const clampGain = (gain) => Math.max(0, Math.min(1, gain));
const clampBars = (bars) => Math.max(1, Math.floor(bars));

/** Repeat coercion, IDENTICAL to arrangementScheduler's: floor, minimum 1;
 * anything non-numeric means "play it once". */
function coerceRepeats(repeats) {
  const n = Math.floor(Number(repeats));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Plain-data deep clone (layers are JSON-ish: objects/arrays/primitives). */
function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out;
  }
  return v;
}

/** Next section id: sec-1, sec-2, … (max numeric suffix + 1 — ids of deleted
 * sections are never reused, so saved arrangements can't silently rebind). */
function nextSectionId(sections) {
  let max = 0;
  for (const s of sections) {
    const m = /^sec-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `sec-${max + 1}`;
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA', … (spreadsheet-column style). */
function labelFor(n) {
  let s = '';
  let i = n + 1;
  while (i > 0) {
    i -= 1;
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s;
}

/** First structural label not used by any (other) section's name. */
function autoLabel(sections, excludeId = null) {
  const used = new Set(sections.filter((s) => s.id !== excludeId).map((s) => s.name));
  for (let i = 0; ; i += 1) {
    const label = labelFor(i);
    if (!used.has(label)) return label;
  }
}

/** A layer's span in bars, best available source: the notes lookup first
 * (authoritative once loaded), then a take's embedded lengthBars, then the
 * library entry's indexed barSpan. Null when nothing is known. */
function barSpanOf(layer, notesById) {
  const loaded = notesById?.[layer.id];
  if (Number.isFinite(loaded?.barSpan)) return loaded.barSpan;
  if (layer.source?.kind === 'take' && Number.isFinite(layer.source.lengthBars)) {
    return layer.source.lengthBars;
  }
  if (Number.isFinite(layer.source?.entry?.barSpan)) return layer.source.entry.barSpan;
  return null;
}

/** Section length default: the stack's longest layer span, ceiled, min 1. */
function deriveLengthBars(layers, notesById) {
  let max = 0;
  for (const l of layers) {
    const span = barSpanOf(l, notesById);
    if (span != null) max = Math.max(max, span);
  }
  return Math.max(1, Math.ceil(max));
}

/** Split workspace layers into stack entries + the carried-layer map slice:
 * carried → `{ carriedRef: id }` placeholder + a (fresh deep copy) map entry;
 * non-carried → plain deep copy in the stack. */
function buildStackEntries(layers) {
  const stack = [];
  const carried = {};
  for (const layer of layers) {
    if (layer.carried) {
      carried[layer.id] = deepClone(layer);
      stack.push({ carriedRef: layer.id });
    } else {
      stack.push(deepClone(layer));
    }
  }
  return { stack, carried };
}

/** Merge freshly promoted carried entries over the existing shared pool.
 * CHANNEL IS STRUCTURAL (the same lock MUTATE_CARRIED enforces): when a
 * promote refreshes an entry that already exists, the EXISTING channel is
 * preserved — otherwise a workspace channel drift would re-seat the shared
 * layer inside every section that references it, colliding with those
 * sections' own channel claims. Everything else (gain, mute, program, notes)
 * takes the fresh value: latest edit wins everywhere. */
function mergeCarried(base, fresh) {
  const out = { ...base };
  for (const [id, layer] of Object.entries(fresh)) {
    out[id] = base[id] ? { ...layer, channel: base[id].channel } : layer;
  }
  return out;
}

/**
 * Per-section duplicate-channel repair for playback inputs, mirroring
 * workspaceReducer's repairChannels policy: grooves pinned to 9; the FIRST
 * valid claim of a channel wins; duplicates / out-of-range squatters get the
 * lowest free channel; an unplaceable layer (no free channel) is dropped.
 * Section stacks built purely through the verbs can't collide, but a shared
 * carried layer plus historical drafts make collisions possible — playback
 * must never double-drive one channel with two programs.
 */
function repairStackChannels(layers) {
  const used = new Set();
  for (const l of layers) {
    if (l.role !== 'groove' && Number.isInteger(l.channel)
      && l.channel >= 0 && l.channel <= 15 && l.channel !== DRUM_CHANNEL && !used.has(l.channel)) {
      used.add(l.channel);
    }
  }
  const claimed = new Set();
  const out = [];
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
    if (ch == null) continue; // unplaceable — dropped (mirrors repairChannels)
    claimed.add(ch);
    out.push({ ...l, channel: ch });
  }
  return out;
}

/** Drop carriedLayers entries no section references anymore (the GC).
 * Returns the SAME map when nothing changed, so no-op sweeps don't churn. */
function sweepCarried(sections, carriedLayers) {
  const referenced = new Set();
  for (const s of sections) {
    for (const e of s.stack) {
      if (e && e.carriedRef != null) referenced.add(e.carriedRef);
    }
  }
  let changed = false;
  const out = {};
  for (const [id, layer] of Object.entries(carriedLayers)) {
    if (referenced.has(id)) out[id] = layer;
    else changed = true;
  }
  return changed ? out : carriedLayers;
}

// ── initialDraft ─────────────────────────────────────────────────────────────

/**
 * Empty draft seeded with the workspace's key/tempo — the moment of
 * materialization is when song-level key/tempo context is captured (§1:
 * "Song-level key/tempo live in the draft once it exists").
 */
export function initialDraft(workspaceState = {}) {
  return {
    sections: [],
    carriedLayers: {},
    arrangement: [],
    meta: {
      title: null,
      author: null,
      keyShift: Number.isFinite(workspaceState.keyShift) ? Math.trunc(workspaceState.keyShift) : 0,
      bpm: Number.isFinite(workspaceState.bpm) ? clampBpm(workspaceState.bpm) : DEFAULT_BPM,
    },
  };
}

// ── reducer ──────────────────────────────────────────────────────────────────

export function draftReducer(state, action) {
  // Only PROMOTE may materialize a null draft; every other verb needs one.
  if (state == null && action.type !== ActionTypes.PROMOTE) return state ?? null;

  switch (action.type) {
    case ActionTypes.PROMOTE: {
      const wsState = action.workspaceState;
      if (!wsState || !Array.isArray(wsState.layers)) return state ?? null;

      const replacing = state != null && action.sectionId != null;
      if (!replacing && action.sectionId != null && state == null) {
        // A replace target can't exist in a draft that doesn't — caller bug.
        return null;
      }

      const base = state ?? initialDraft(wsState);
      const { stack, carried } = buildStackEntries(wsState.layers);
      const name = typeof action.name === 'string' ? action.name.trim() : '';

      if (replacing) {
        const idx = base.sections.findIndex((s) => s.id === action.sectionId);
        if (idx === -1) return state;
        const prev = base.sections[idx];
        const section = {
          ...prev,
          name: name || prev.name,
          // Section length is a STRUCTURAL choice — a re-promote keeps it
          // (derivation only happens at creation); explicit param overrides.
          lengthBars: Number.isFinite(action.lengthBars)
            ? clampBars(action.lengthBars) : prev.lengthBars,
          stack,
        };
        const sections = base.sections.map((s, i) => (i === idx ? section : s));
        return {
          ...base,
          sections,
          // Merge fresh carried entries first, THEN sweep: a replace can both
          // refresh shared layers and orphan previously-referenced ones.
          carriedLayers: sweepCarried(sections, mergeCarried(base.carriedLayers, carried)),
        };
      }

      const section = {
        id: nextSectionId(base.sections),
        name: name || autoLabel(base.sections),
        lengthBars: Number.isFinite(action.lengthBars)
          ? clampBars(action.lengthBars)
          : deriveLengthBars(wsState.layers, action.notesById),
        stack,
      };
      return {
        ...base,
        sections: [...base.sections, section],
        carriedLayers: mergeCarried(base.carriedLayers, carried),
        // EVERY new section joins the arrangement once — a promoted section
        // is immediately playable (first promote: a one-section song plays).
        arrangement: [...base.arrangement, { sectionId: section.id, repeats: 1 }],
      };
    }

    case ActionTypes.OPEN_SECTION:
      // Deliberate no-op: opening is a WORKSPACE action. The caller resolves
      // the stack via resolveSectionStack and dispatches LOAD_STACK there.
      return state;

    case ActionTypes.SET_ARRANGEMENT: {
      if (!Array.isArray(action.entries)) return state;
      const known = new Set(state.sections.map((s) => s.id));
      // Reject WHOLESALE on any unknown sectionId: compileArrangement treats
      // a dangling ref as a pipeline bug (throws) — never store one.
      if (!action.entries.every((e) => known.has(e?.sectionId))) return state;
      return {
        ...state,
        arrangement: action.entries.map((e) => ({
          sectionId: e.sectionId,
          repeats: coerceRepeats(e.repeats),
        })),
      };
    }

    case ActionTypes.SET_REPEATS: {
      const { index } = action;
      if (!Number.isInteger(index) || index < 0 || index >= state.arrangement.length) return state;
      return {
        ...state,
        arrangement: state.arrangement.map((e, i) => (
          i === index ? { ...e, repeats: coerceRepeats(action.repeats) } : e
        )),
      };
    }

    case ActionTypes.MOVE_ENTRY: {
      const { from, to } = action;
      const len = state.arrangement.length;
      const valid = Number.isInteger(from) && Number.isInteger(to)
        && from >= 0 && from < len && to >= 0 && to < len && from !== to;
      if (!valid) return state;
      const arrangement = [...state.arrangement];
      const [entry] = arrangement.splice(from, 1);
      arrangement.splice(to, 0, entry);
      return { ...state, arrangement };
    }

    case ActionTypes.ADD_ENTRY: {
      if (!state.sections.some((s) => s.id === action.sectionId)) return state;
      const entry = { sectionId: action.sectionId, repeats: 1 };
      const at = Number.isInteger(action.at) && action.at >= 0 && action.at <= state.arrangement.length
        ? action.at : state.arrangement.length;
      const arrangement = [...state.arrangement];
      arrangement.splice(at, 0, entry);
      return { ...state, arrangement };
    }

    case ActionTypes.REMOVE_ENTRY: {
      const { index } = action;
      if (!Number.isInteger(index) || index < 0 || index >= state.arrangement.length) return state;
      return { ...state, arrangement: state.arrangement.filter((_, i) => i !== index) };
    }

    case ActionTypes.SET_SECTION_LENGTH: {
      if (!Number.isFinite(action.lengthBars)) return state;
      if (!state.sections.some((s) => s.id === action.sectionId)) return state;
      return {
        ...state,
        sections: state.sections.map((s) => (
          s.id === action.sectionId ? { ...s, lengthBars: clampBars(action.lengthBars) } : s
        )),
      };
    }

    case ActionTypes.RENAME_SECTION: {
      if (!state.sections.some((s) => s.id === action.sectionId)) return state;
      const trimmed = typeof action.name === 'string' ? action.name.trim() : '';
      // Empty → back to a structural label (never a nameless section, never
      // a fabricated title — 'A'/'B' honestly describe structure).
      const name = trimmed || autoLabel(state.sections, action.sectionId);
      return {
        ...state,
        sections: state.sections.map((s) => (
          s.id === action.sectionId ? { ...s, name } : s
        )),
      };
    }

    case ActionTypes.DELETE_SECTION: {
      if (!state.sections.some((s) => s.id === action.sectionId)) return state;
      const sections = state.sections.filter((s) => s.id !== action.sectionId);
      // Deleting the LAST section leaves an empty-sections draft, NOT null:
      // meta (title/key/tempo) is still the song-in-progress; the UI decides
      // what an empty song means (discard is an explicit act).
      return {
        ...state,
        sections,
        arrangement: state.arrangement.filter((e) => e.sectionId !== action.sectionId),
        carriedLayers: sweepCarried(sections, state.carriedLayers),
      };
    }

    case ActionTypes.CLONE_SECTION: {
      const source = state.sections.find((s) => s.id === action.sectionId);
      if (!source) return state;
      // deepClone keeps { carriedRef } placeholders as placeholders — the
      // clone SHARES carried layers with its source (continuity is a property
      // of the layer, not the section). Non-carried copies diverge freely.
      const clone = {
        id: nextSectionId(state.sections),
        name: autoLabel(state.sections),
        lengthBars: source.lengthBars,
        stack: deepClone(source.stack),
      };
      // Arrangement untouched: cloning duplicates MATERIAL; placing the clone
      // in the play order is an explicit ADD_ENTRY.
      return { ...state, sections: [...state.sections, clone] };
    }

    case ActionTypes.MUTATE_CARRIED: {
      const layer = state.carriedLayers[action.layerId];
      if (!layer) return state;
      const patch = action.patch || {};
      const next = { ...layer };
      let changed = false;
      // Only the MIX knobs are patchable — structural fields (id, source,
      // role, channel, notes) are locked: changing WHAT a carried layer is
      // means re-promoting it from the workspace, not poking the shared copy.
      if (Number.isFinite(patch.gain)) {
        next.gain = clampGain(patch.gain);
        changed = true;
      }
      if (typeof patch.muted === 'boolean') {
        next.muted = patch.muted;
        changed = true;
      }
      // Same rule as workspace SET_VOICE: grooves have no program to set.
      if (patch.gmProgram !== undefined && layer.role !== 'groove') {
        next.gmProgram = patch.gmProgram;
        changed = true;
      }
      if (!changed) return state;
      return {
        ...state,
        carriedLayers: { ...state.carriedLayers, [action.layerId]: next },
      };
    }

    case ActionTypes.SET_META: {
      const patch = action.patch || {};
      const meta = { ...state.meta };
      let changed = false;
      if (patch.title !== undefined) { meta.title = patch.title; changed = true; }
      if (patch.author !== undefined) { meta.author = patch.author; changed = true; }
      if (Number.isFinite(patch.keyShift)) { meta.keyShift = Math.trunc(patch.keyShift); changed = true; }
      if (Number.isFinite(patch.bpm)) { meta.bpm = clampBpm(patch.bpm); changed = true; }
      if (!changed) return state;
      return { ...state, meta };
    }

    default:
      return state;
  }
}

// ── action creators ──────────────────────────────────────────────────────────

export const promote = ({ workspaceState, notesById, sectionId, name, lengthBars } = {}) => (
  { type: ActionTypes.PROMOTE, workspaceState, notesById, sectionId, name, lengthBars }
);
export const openSection = (sectionId) => ({ type: ActionTypes.OPEN_SECTION, sectionId });
export const setArrangement = (entries) => ({ type: ActionTypes.SET_ARRANGEMENT, entries });
export const setRepeats = (index, repeats) => ({ type: ActionTypes.SET_REPEATS, index, repeats });
export const moveEntry = (from, to) => ({ type: ActionTypes.MOVE_ENTRY, from, to });
export const addEntry = (sectionId, at) => ({ type: ActionTypes.ADD_ENTRY, sectionId, at });
export const removeEntry = (index) => ({ type: ActionTypes.REMOVE_ENTRY, index });
export const setSectionLength = (sectionId, lengthBars) => (
  { type: ActionTypes.SET_SECTION_LENGTH, sectionId, lengthBars }
);
export const renameSection = (sectionId, name) => ({ type: ActionTypes.RENAME_SECTION, sectionId, name });
export const deleteSection = (sectionId) => ({ type: ActionTypes.DELETE_SECTION, sectionId });
export const cloneSection = (sectionId) => ({ type: ActionTypes.CLONE_SECTION, sectionId });
export const mutateCarried = (layerId, patch) => ({ type: ActionTypes.MUTATE_CARRIED, layerId, patch });
export const setMeta = (patch) => ({ type: ActionTypes.SET_META, patch });

// ── selectors ────────────────────────────────────────────────────────────────

/**
 * A section's stack with { carriedRef } placeholders expanded into the SHARED
 * carried layers — the caller feeds this to the workspace's LOAD_STACK when
 * opening a section for editing. SECTION STACKS CARRY NO KEY/TEMPO: callers
 * opening a section MUST pass `draft.meta.bpm` and `draft.meta.keyShift` to
 * loadStack alongside these layers, or the workspace keeps its stale jam
 * key/tempo and the section plays wrong. Returns null for an unknown section
 * (or a null draft) so callers can distinguish "no such section" from "empty".
 * A dangling carriedRef is skipped defensively — the GC sweep should make
 * that impossible, but a missing layer must never crash playback.
 * NOTE: carried entries are the LIVE shared objects — treat them read-only
 * (LOAD_STACK normalizes into fresh layer objects anyway).
 */
export function resolveSectionStack(draft, sectionId) {
  const section = draft?.sections?.find((s) => s.id === sectionId);
  if (!section) return null;
  const out = [];
  for (const entry of section.stack) {
    if (entry && entry.carriedRef != null) {
      const layer = draft.carriedLayers?.[entry.carriedRef];
      if (layer) out.push(layer);
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Map the whole draft to compileArrangement's inputs:
 * `{ sections: [{ id, lengthBars, stack: schedulerLayers }], arrangement }`.
 * Mirrors toTransportLayers' rules per section:
 * - meta.keyShift is the transpose for every non-groove layer (key is
 *   song-global; sections don't carry their own);
 * - grooves are pinned to transpose 0 (drum-map pitches are instrument
 *   slots, not notes);
 * - layers with no loaded notes are omitted (take layers fall back to the
 *   notes embedded in their source);
 * - muted applies PER-SECTION solo semantics: muted || (sectionHasSolo &&
 *   !soloed) — a solo scopes to the stack it lives in;
 * - channels pass through a per-section duplicate repair (repairStackChannels
 *   — first claim wins, dupes get lowest-free, grooves pinned 9), so playback
 *   never double-drives one channel with two layers' programs;
 * - a section whose layers are ALL unloaded (or whose stack is empty — a
 *   template slot) compiles to an empty stack, which buildSectionCycle turns
 *   into ZERO-LENGTH blocks; the transport's guarded block walk skips them
 *   without spinning, so an unfilled slot simply takes no time;
 * - scheduler inputs carry NO gmProgram: the program map is the COMPONENT's
 *   job (configureLayer per channel on block boundaries — see
 *   sectionProgramMap); the scheduler only needs channels for event routing.
 * Call as: compileArrangement(sections, arrangement, { bpm: draft.meta.bpm }).
 */
export function toSchedulerInputs(draft, notesById = {}) {
  if (!draft) return { sections: [], arrangement: [] };
  const keyShift = Number.isFinite(draft.meta?.keyShift) ? draft.meta.keyShift : 0;
  const sections = draft.sections.map((section) => {
    const layers = repairStackChannels(resolveSectionStack(draft, section.id) ?? []);
    const sectionHasSolo = layers.some((l) => l.soloed);
    const stack = [];
    for (const layer of layers) {
      const loaded = notesById[layer.id]
        ?? (layer.source?.kind === 'take' && layer.source.notes?.length
          ? { notes: layer.source.notes, ppq: layer.source.ppq, barSpan: layer.source.lengthBars }
          : null);
      if (!loaded?.notes?.length) continue;
      stack.push({
        notes: loaded.notes,
        ppq: loaded.ppq,
        barSpan: loaded.barSpan,
        transpose: layer.role === 'groove' ? 0 : keyShift,
        muted: !!layer.muted || (sectionHasSolo && !layer.soloed),
        channel: layer.channel,
        gain: layer.gain,
      });
    }
    return { id: section.id, lengthBars: section.lengthBars, stack };
  });
  return { sections, arrangement: draft.arrangement };
}

/**
 * Child materials for a section's composite MaterialGlyph — one per resolved
 * layer (carried refs expanded), in the same shape ChannelStrip feeds
 * seedFor: the library index entry, or a `{ kind:'take', id }` stub. Render
 * the section identity as
 * `seedFor({ kind: 'section', children: sectionGlyphSeeds(draft, id) })` —
 * seedFor sorts children, so the same layers in any order yield the same
 * glyph. Unknown section → empty list (a glyph-less card, not a crash).
 */
export function sectionGlyphSeeds(draft, sectionId) {
  const layers = resolveSectionStack(draft, sectionId);
  if (!layers) return [];
  return layers.map((l) => l.source?.entry ?? { kind: 'take', id: l.id });
}

export default draftReducer;
