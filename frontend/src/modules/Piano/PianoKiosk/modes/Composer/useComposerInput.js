// useComposerInput.js — numpad keymap + sticky duration + armed MIDI note entry.
//
// Owns the "how do notes get INTO the score" input layer for the Composer mode:
//   - a numpad keydown listener maps duration/arm/rest/dot/delete/caret keys
//     (see `mapKey`, exported standalone for pure unit testing) to model commands
//   - a sticky-duration + armed flag, kept in refs so the MIDI callback (which
//     closes over the hook's first render otherwise) always reads the LATEST
//     value, mirrored into React state for the HUD to render
//   - a MIDI note-on subscription: when armed, a note-on inserts a note at the
//     sticky duration; when disarmed, MIDI is audition-only (no score edit) —
//     this lets a player try notes on the keyboard without committing them.
//
// NOTE: `midiToPitch` is a real editor.js export but is NOT re-exported from the
// model barrel (./model/index.js), so it's imported directly from editor.js.
// Everything else the hook needs comes through the barrel.
//
// HEADS-UP for anyone hosting Composer inside another shell: `Backspace` is bound
// to "back / previous" elsewhere in this codebase — lib/keyboard/keyboardConfig.js,
// Emulator/ui/useArcadeInput.js, Player/renderers/WebViewRenderer.jsx. PianoKiosk
// imports NONE of those, so there is no conflict today and this hook's Backspace
// (delete the note before the caret) is unambiguous. If Composer is ever mounted
// under one of those shells, the two bindings will fight over the same key.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyCommand, insertNote, insertRest, deleteNote, deleteBeforeCaret, moveCaret,
  setDuration as setNoteDuration, findNoteByTag,
} from './model/index.js';
import { midiToPitch } from './model/editor.js';
import { classifyHeldMs, DURATION_CLASS_TYPE } from './model/durationClass.js';
import getLogger from '../../../../../lib/logging/Logger.js';
import { record, intern, KIND } from '../../../../../lib/logging/inputRecorder.js';

const DURATION_KEYS = { Numpad1: '16th', Numpad3: 'eighth', Numpad5: 'quarter', Numpad7: 'half', Numpad9: 'whole' };

// CHORD-GROUPING DIAGNOSTIC TOLERANCE (task 27). Recon finding: this pipeline has
// NO chord-onset-grouping logic today — every armed note-on inserts as its own
// independent, caret-advancing note, regardless of how close in time it lands to
// the previous one. That absence IS the root cause of the "a chord renders
// sequential" complaint. Per the task's explicit sequencing (logging first,
// tuning later), this constant is NOT wired into insertion behavior — it only
// drives the `composer.input.chord-decision` diagnostic log below, so a future
// grouping feature can be tuned from real spread-vs-tolerance data instead of a
// guess. 40ms is a first-pass, defensible starting point (commonly-cited
// simultaneity window for grouping near-simultaneous onsets as one attack in
// MIDI transcription literature, ~30-50ms) — NOT validated against this app's
// actual hardware/BLE latency yet.
export const CHORD_ONSET_TOLERANCE_MS = 40;

// KEY_LEGEND — human-readable documentation of the numpad map, grouped for the
// on-screen (i) help panel (ComposerHelp.jsx). This is the SSOT for that panel:
// keep every `code` in step with `mapKey` below (the drift-guard test in
// useComposerInput.test.js asserts each legend `code` still maps to a command,
// and that no mapped key is left undocumented). The `piano` entry has no key
// code — it documents that armed piano keys enter notes, which mapKey can't
// express because it comes through the MIDI subscription, not a keydown.
export const KEY_LEGEND = [
  {
    group: 'Note length',
    keys: [
      { label: '1', code: 'Numpad1', does: 'Sixteenth note' },
      { label: '3', code: 'Numpad3', does: 'Eighth note' },
      { label: '5', code: 'Numpad5', does: 'Quarter note' },
      { label: '7', code: 'Numpad7', does: 'Half note' },
      { label: '9', code: 'Numpad9', does: 'Whole note' },
      { label: '.', code: 'NumpadDecimal', does: 'Dotted note (toggle)' },
    ],
  },
  {
    group: 'Add notes',
    keys: [
      // Copy tracks the toolbar's Write button (DurationPalette.jsx). The help
      // panel and the button must name the same thing, or the numpad key and
      // the on-screen control read as two unrelated features.
      { label: '4', code: 'Numpad4', does: 'Turn Write on or off. With Write ON, the piano writes notes; with it off, play freely without changing the song.' },
      // WORDS, not glyphs. This is DATA in a .js module rendered as text by
      // ComposerHelp, so it cannot carry an SVG component the way the toolbar
      // does — and the emoji/symbol it used to carry painted as a tofu box on
      // the kiosk, i.e. an unlabelled row in the panel that explains the keys.
      { label: 'Piano', code: null, does: 'With Write on, play a piano key to add that note at the chosen length.' },
      { label: '0', code: 'Numpad0', does: 'Add a rest' },
    ],
  },
  {
    group: 'Listen',
    keys: [
      // Copy tracks the toolbar's Play/Pause button (EditorSurface.jsx).
      { label: 'Enter', code: 'NumpadEnter', does: 'Play your song from the caret, or pause it' },
    ],
  },
  {
    group: 'Edit',
    keys: [
      { label: '−', code: 'NumpadSubtract', does: 'Delete the note before the caret' },
      { label: 'Backspace', code: 'Backspace', does: 'Delete the note before the caret' },
      { label: 'Del', code: 'Delete', does: 'Delete the note at the caret' },
    ],
  },
  {
    group: 'Move around',
    keys: [
      { label: '← →', code: 'ArrowLeft', does: 'Move the caret one note left or right' },
      { label: 'PgUp / PgDn', code: 'PageUp', does: 'Jump to the previous or next bar' },
    ],
  },
];

/** Pure numpad keymap: KeyboardEvent.code → command descriptor, or null. */
export function mapKey(code) {
  if (DURATION_KEYS[code]) return { kind: 'duration', type: DURATION_KEYS[code] };
  switch (code) {
    case 'Numpad4': return { kind: 'arm' };
    case 'NumpadEnter': return { kind: 'play' };
    case 'Numpad0': return { kind: 'rest' };
    case 'NumpadDecimal': return { kind: 'dot' };
    case 'NumpadSubtract': case 'Backspace': return { kind: 'deleteBack' };
    case 'Delete': return { kind: 'deleteAt' };
    case 'ArrowLeft': return { kind: 'caret', where: 'left' };
    case 'ArrowRight': return { kind: 'caret', where: 'right' };
    case 'PageUp': return { kind: 'caret', where: 'prevBar' };
    case 'PageDown': return { kind: 'caret', where: 'nextBar' };
    default: return null;
  }
}

/**
 * @param {function} [onTogglePlay] invoked by the NumpadEnter transport key. The
 *   hook does not own the transport (EditorSurface does) — it only routes the key.
 * @param {boolean} [playing] whether score playback is currently running. Gates
 *   armed note entry; see the echo guard on the MIDI subscription below.
 */
export function useComposerInput({ setEditorState, subscribe, logger, onTogglePlay, playing = false, caretMeasureRef }) {
  // Reuse the parent's child logger when given (keeps one `composer-editor`
  // context); fall back to a `composer-input` child so the hook is still
  // observable when used standalone (and in tests).
  const log = useMemo(() => logger || getLogger().child({ component: 'composer-input' }), [logger]);
  // Sticky entry state lives in a ref (read by the MIDI callback, which must
  // always see the LATEST duration/arm state rather than a stale closure) and
  // is mirrored to React state so the toolbar palette can render it. The setters
  // below are the ONE path both the numpad keydowns AND the on-screen palette
  // taps go through, so keyboard and touch can never drift apart.
  const sticky = useRef({ type: 'quarter', dots: 0, triplet: false });
  const armedRef = useRef(false);
  // Mirrored every render for the same reason as `sticky`: the MIDI callback is
  // registered once and would otherwise read `playing` from its first closure.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const onTogglePlayRef = useRef(onTogglePlay);
  onTogglePlayRef.current = onTogglePlay;
  // task 27 — note-entry instrumentation + duration-classification state, all
  // read/written ONLY inside the MIDI subscription callback below (never during
  // render), so plain refs are correct here the same way `sticky`/`armedRef` are.
  //   pendingOnsetsRef: midi note -> FIFO queue of {tag, t, pitch} for armed
  //     presses awaiting their note_off (a queue, not a single slot, so the same
  //     pitch pressed twice before either releases is handled correctly).
  //   entryTagCounterRef: monotonic id stamped on each inserted note (see
  //     model/note.js `entryTag`) so note_off can find that EXACT note again via
  //     findNoteByTag — object identity doesn't survive the score being
  //     re-cloned by any intervening edit.
  //   chordClusterRef: rolling onset-cluster tracker for the chord-decision
  //     diagnostic log (see CHORD_ONSET_TOLERANCE_MS above) — NOT wired to any
  //     actual insertion behavior.
  const pendingOnsetsRef = useRef(new Map());
  const entryTagCounterRef = useRef(0);
  const chordClusterRef = useRef({ lastT: null, size: 0 });
  const [hud, setHud] = useState({ ...sticky.current, armed: false });
  // `sync` only ever touches refs (stable identities) + setHud (stable), so the
  // useCallback'd setters below may safely close over the first render's copy.
  const sync = () => setHud({ ...sticky.current, armed: armedRef.current });

  // Recorder tap for every model mutation — a compact EDIT row (type, note,
  // measure, duration) pushed into the zero-alloc input-recorder ring ALONGSIDE
  // the semantic log below. The ring feeds the backend .jsonl trace; the logs
  // stay for human-readable diagnostics. `type`/`duration` are interned strings.
  //
  // `measure` defaults to the LIVE caret measure (read from the ref each call,
  // NOT captured at hook-mount) so an EDIT row carries the bar the note landed
  // in — the "@bar3" correlation the trace exists for. Callers may still pass an
  // explicit measure; the ref is optional so the hook works standalone.
  const recordEdit = (type, note = 0, measure = caretMeasureRef?.current ?? 0, duration = '') =>
    record(KIND.EDIT, intern(type), note | 0, measure | 0, intern(duration));

  const setDuration = useCallback((type) => { sticky.current = { ...sticky.current, type }; sync(); recordEdit('duration', 0, 0, type); log.info('composer.input.duration', { type }); }, [log]);
  const toggleDot = useCallback(() => { sticky.current = { ...sticky.current, dots: sticky.current.dots ? 0 : 1 }; sync(); recordEdit('dot'); log.info('composer.input.dot', { dots: sticky.current.dots }); }, [log]);
  const toggleArm = useCallback(() => { armedRef.current = !armedRef.current; sync(); recordEdit('arm'); log.info('composer.input.arm', { armed: armedRef.current }); }, [log]);
  const addRest = useCallback(() => {
    recordEdit('insert-rest', 0, undefined, sticky.current.type); // measure ← live caret
    log.info('composer.input.rest', { duration: sticky.current.type, dots: sticky.current.dots });
    setEditorState((s) => applyCommand(s, insertRest, { ...sticky.current }));
  }, [setEditorState, log]);
  const deleteAtCaret = useCallback(() => {
    recordEdit('delete');
    log.info('composer.input.delete', {});
    setEditorState((s) => applyCommand(s, deleteNote, s.caret));
  }, [setEditorState, log]);
  // Backspace semantics — deletes the note BEFORE the caret, which is the note
  // just entered. Distinct from deleteAtCaret, which needs the caret parked ON
  // an existing note to do anything.
  const deleteBack = useCallback(() => {
    recordEdit('delete-back');
    log.info('composer.input.delete-back', {});
    setEditorState((s) => applyCommand(s, deleteBeforeCaret));
  }, [setEditorState, log]);

  useEffect(() => {
    const onKey = (e) => {
      // Listener is on `window` and preventDefault()s every mapped code, so it
      // must stand down inside text entry. Otherwise Backspace/Delete get
      // swallowed (characters type but never erase) AND edit the score behind
      // the field. Composer gains a rename field in a later unit.
      const t = e.target;
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '')) return;
      const m = mapKey(e.code);
      if (!m) return;
      // Recorder tap: a KEY row (which physical key, which command kind) plus a
      // rAF-deferred TAP row measuring keydown→next-frame latency — the same
      // shape ScorePlayer records, for the numpad instead of on-screen controls.
      const kid = intern(e.code), mkid = intern(m.kind);
      record(KIND.KEY, kid, mkid, 0, 0);
      const t0 = performance.now();
      requestAnimationFrame(() => record(KIND.TAP, kid, Math.round(performance.now() - t0), 0, 0));
      e.preventDefault();
      switch (m.kind) {
        case 'duration': setDuration(m.type); break;
        case 'dot': toggleDot(); break;
        case 'arm': toggleArm(); break;
        case 'rest': addRest(); break;
        // Routed through a ref so this listener (registered once) always reaches
        // the CURRENT handler — EditorSurface rebuilds it as the transport changes.
        case 'play': onTogglePlayRef.current?.(); break;
        case 'deleteBack': deleteBack(); break;
        case 'deleteAt': deleteAtCaret(); break;
        // Caret navigation is high-frequency (held arrow key) — debug, not info.
        case 'caret': recordEdit('caret'); log.debug('composer.input.caret', { where: m.where }); setEditorState((s) => applyCommand(s, moveCaret, m.where)); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDuration, toggleDot, toggleArm, addRest, deleteAtCaret, deleteBack, setEditorState, log]);

  useEffect(() => {
    if (!subscribe) return undefined;
    log.debug('composer.input.midi-subscribed', {});
    const unsub = subscribe((evt) => {
      if (!evt) return;

      // --- RELEASE: resolve a pending armed insert's held duration, then
      // reclassify its rendered type (see model/durationClass.js — the LIGHT
      // short/medium/long -> 16th/eighth/quarter classifier). A note_off
      // with no matching pending entry (audition, playback-echo, or a stray
      // hardware note_off) is logged for completeness (task 27, "every
      // note_on/note_off") but otherwise a no-op.
      if (evt.type === 'note_off') {
        const t = evt.time ?? Date.now();
        log.sampled('composer.input.note-off', { note: evt.note, t }, { maxPerMinute: 120, aggregate: true });
        const queue = pendingOnsetsRef.current.get(evt.note);
        if (!queue || queue.length === 0) return; // not an armed/tracked press
        const { tag, t: onsetT, pitch } = queue.shift();
        if (queue.length === 0) pendingOnsetsRef.current.delete(evt.note);
        const heldMs = Math.max(0, t - onsetT);
        const cls = classifyHeldMs(heldMs);
        const type = DURATION_CLASS_TYPE[cls];
        log.sampled('composer.input.note-duration', {
          note: evt.note, pitch, heldMs, class: cls, type,
        }, { maxPerMinute: 120, aggregate: true });
        // HISTORY-NEUTRAL WRITE (fix round 1): call the raw `setNoteDuration`
        // command directly, NOT through `applyCommand`. applyCommand always
        // pushes a history entry whenever the score reference changes (it has
        // no no-op short-circuit for "this is just a follow-up patch of the
        // insert that already recorded history"), so routing this through it
        // pushed a SECOND `past` entry per played note — one undo only
        // downgraded the type back toward the default, a second undo was
        // needed to actually remove the note (doubled undo presses, and half
        // the effective depth of HISTORY_CAP=200).
        //
        // The insert-then-classify pair must read as ONE atomic edit for
        // undo, so the classify step reuses the SAME history entry the insert
        // already pushed: `setNoteDuration` itself never touches `state.history`
        // (see model/editor.js — it returns `{ ...state, score, dirty, revision }`,
        // which spreads the existing `history` through unchanged), so calling
        // it directly here still returns a genuinely new `state` object (new
        // score reference, bumped revision) — `setEditorState` still sees a
        // changed reference and still re-renders/settles exactly as before —
        // it just never calls `pushHistory`. One undo after this now restores
        // the score as it was immediately before the note_on insert, i.e. it
        // removes the note entirely, in one press.
        setEditorState((s) => {
          const pos = findNoteByTag(s.score, tag);
          if (!pos) return s; // deleted/undone since insertion — nothing to reclassify
          const note = s.score.parts[0].measures[pos.measureIdx].notes[pos.noteIdx];
          return setNoteDuration(s, pos, { type, dots: note.dots, triplet: note.triplet });
        });
        return;
      }

      if (evt.type !== 'note_on') return; // ignore anything else on this channel
      const pitch = midiToPitch(evt.note);
      const t = evt.time ?? Date.now();
      // Raw fact, logged regardless of arm state or velocity (task 27, "every
      // note_on/note_off with timestamps").
      log.sampled('composer.input.note-on', { note: evt.note, pitch, velocity: evt.velocity, t }, { maxPerMinute: 120, aggregate: true });
      if (!evt.velocity) return; // some devices send note_on vel=0 as note_off; unchanged pre-existing behavior — dropped, not tracked

      if (!armedRef.current) {
        // Disarmed = audition-only (play freely, no score edit). Sampled: a kid
        // can play many notes/sec, and this fires per note while disarmed.
        log.sampled('composer.input.audition', { note: evt.note, pitch }, { maxPerMinute: 30, aggregate: true });
        return;
      }
      // PLAYBACK ECHO GUARD. Score playback sends notes OUT over Web MIDI; the
      // kiosk's Jamcorder routes MIDI in a way that can echo those sends back to
      // the INPUT port, where they are indistinguishable from a played key. With
      // Write armed, an unguarded editor would therefore re-record the whole
      // playback into the score — silent data corruption, and baffling to debug.
      // Gate the INSERT only: the arm flag is untouched, so Write is still on
      // when playback stops.
      if (playingRef.current) {
        log.sampled('composer.input.playback-echo-ignored', { note: evt.note, pitch }, { maxPerMinute: 10, aggregate: true });
        return;
      }

      // --- CHORD-GROUPING DIAGNOSTIC (decision is NOT enacted — see
      // CHORD_ONSET_TOLERANCE_MS doc above). Every armed note-on still inserts
      // below as an independent, caret-advancing note; there is no simultaneity
      // grouping in this pipeline. This block only MEASURES, per note-on, the
      // gap since the previous armed note-on (spreadMs) against the candidate
      // tolerance, and logs whether it WOULD cluster — data to tune a real
      // grouping feature later, per the task's explicit "logging first" order.
      const cluster = chordClusterRef.current;
      const spreadMs = cluster.lastT == null ? null : t - cluster.lastT;
      const withinTolerance = spreadMs !== null && spreadMs <= CHORD_ONSET_TOLERANCE_MS;
      cluster.size = withinTolerance ? cluster.size + 1 : 1;
      cluster.lastT = t;
      log.sampled('composer.input.chord-decision', {
        note: evt.note, pitch, spreadMs, toleranceMs: CHORD_ONSET_TOLERANCE_MS,
        grouped: withinTolerance, size: cluster.size,
      }, { maxPerMinute: 120, aggregate: true });

      // Armed insert — the core "did my note land?" signal. Inserted NOW at the
      // sticky/default type (unchanged timing from before this task: the note
      // appears the instant the key is pressed); `entryTag` lets the note_off
      // branch above find this EXACT note again to reclassify its type once the
      // held duration is known (task 27, duration classification "assigned on
      // release" — see note.js `entryTag` doc for why release can't just be
      // "render at default then update" via a stale position/reference).
      recordEdit('insert-note', evt.note, undefined, sticky.current.type); // measure ← live caret
      const entryTag = ++entryTagCounterRef.current;
      setEditorState((s) => applyCommand(s, insertNote, pitch, { ...sticky.current, entryTag }));
      const queue = pendingOnsetsRef.current.get(evt.note) ?? [];
      queue.push({ tag: entryTag, t, pitch });
      pendingOnsetsRef.current.set(evt.note, queue);
    });
    return () => { log.debug('composer.input.midi-unsubscribed', {}); if (unsub) unsub(); };
  }, [subscribe, setEditorState, log]);

  return { hud, armed: hud.armed, setDuration, toggleDot, toggleArm, addRest, deleteBack };
}
