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
import { applyCommand, insertNote, insertRest, deleteNote, deleteBeforeCaret, moveCaret } from './model/index.js';
import { midiToPitch } from './model/editor.js';
import getLogger from '../../../../../lib/logging/Logger.js';

const DURATION_KEYS = { Numpad1: '16th', Numpad3: 'eighth', Numpad5: 'quarter', Numpad7: 'half', Numpad9: 'whole' };

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
      { label: '🎹', code: null, does: 'With Write on, play a piano key to add that note at the chosen length.' },
      { label: '0', code: 'Numpad0', does: 'Add a rest' },
    ],
  },
  {
    group: 'Edit',
    keys: [
      { label: '−', code: 'NumpadSubtract', does: 'Delete the note before the caret' },
      { label: '⌫', code: 'Backspace', does: 'Delete the note before the caret' },
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

export function useComposerInput({ setEditorState, subscribe, logger }) {
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
  const [hud, setHud] = useState({ ...sticky.current, armed: false });
  // `sync` only ever touches refs (stable identities) + setHud (stable), so the
  // useCallback'd setters below may safely close over the first render's copy.
  const sync = () => setHud({ ...sticky.current, armed: armedRef.current });

  const setDuration = useCallback((type) => { sticky.current = { ...sticky.current, type }; sync(); log.info('composer.input.duration', { type }); }, [log]);
  const toggleDot = useCallback(() => { sticky.current = { ...sticky.current, dots: sticky.current.dots ? 0 : 1 }; sync(); log.info('composer.input.dot', { dots: sticky.current.dots }); }, [log]);
  const toggleArm = useCallback(() => { armedRef.current = !armedRef.current; sync(); log.info('composer.input.arm', { armed: armedRef.current }); }, [log]);
  const addRest = useCallback(() => {
    log.info('composer.input.rest', { duration: sticky.current.type, dots: sticky.current.dots });
    setEditorState((s) => applyCommand(s, insertRest, { ...sticky.current }));
  }, [setEditorState, log]);
  const deleteAtCaret = useCallback(() => {
    log.info('composer.input.delete', {});
    setEditorState((s) => applyCommand(s, deleteNote, s.caret));
  }, [setEditorState, log]);
  // Backspace semantics — deletes the note BEFORE the caret, which is the note
  // just entered. Distinct from deleteAtCaret, which needs the caret parked ON
  // an existing note to do anything.
  const deleteBack = useCallback(() => {
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
      e.preventDefault();
      switch (m.kind) {
        case 'duration': setDuration(m.type); break;
        case 'dot': toggleDot(); break;
        case 'arm': toggleArm(); break;
        case 'rest': addRest(); break;
        case 'deleteBack': deleteBack(); break;
        case 'deleteAt': deleteAtCaret(); break;
        // Caret navigation is high-frequency (held arrow key) — debug, not info.
        case 'caret': log.debug('composer.input.caret', { where: m.where }); setEditorState((s) => applyCommand(s, moveCaret, m.where)); break;
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
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      const pitch = midiToPitch(evt.note);
      if (!armedRef.current) {
        // Disarmed = audition-only (play freely, no score edit). Sampled: a kid
        // can play many notes/sec, and this fires per note while disarmed.
        log.sampled('composer.input.audition', { note: evt.note, pitch }, { maxPerMinute: 30, aggregate: true });
        return;
      }
      // Armed insert — the core "did my note land?" signal. Sampled high so a
      // fast passage is captured but a stuck stream can't storm the transport.
      log.sampled('composer.input.note', {
        note: evt.note,
        pitch,
        velocity: evt.velocity,
        duration: sticky.current.type,
        dots: sticky.current.dots,
      }, { maxPerMinute: 120, aggregate: true });
      setEditorState((s) => applyCommand(s, insertNote, pitch, { ...sticky.current }));
    });
    return () => { log.debug('composer.input.midi-unsubscribed', {}); if (unsub) unsub(); };
  }, [subscribe, setEditorState, log]);

  return { hud, armed: hud.armed, setDuration, toggleDot, toggleArm, addRest, deleteBack };
}
