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
// model barrel (./model/index.js) — the barrel is frozen and this hook must not
// modify the model, so it's imported directly from editor.js instead of the
// barrel to avoid inventing an export that doesn't exist yet.
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyCommand, insertNote, insertRest, deleteNote, moveCaret } from './model/index.js';
import { midiToPitch } from './model/editor.js';

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
      { label: '4', code: 'Numpad4', does: 'Arm / disarm. When ARMED, the piano writes notes; when off, play freely without changing the song.' },
      { label: '🎹', code: null, does: 'With 4 armed, play a piano key to add that note at the chosen length.' },
      { label: '0', code: 'Numpad0', does: 'Add a rest' },
    ],
  },
  {
    group: 'Edit',
    keys: [
      { label: '−', code: 'NumpadSubtract', does: 'Delete the note before the caret' },
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
    case 'NumpadSubtract': return { kind: 'deleteBack' };
    case 'Delete': return { kind: 'deleteAt' };
    case 'ArrowLeft': return { kind: 'caret', where: 'left' };
    case 'ArrowRight': return { kind: 'caret', where: 'right' };
    case 'PageUp': return { kind: 'caret', where: 'prevBar' };
    case 'PageDown': return { kind: 'caret', where: 'nextBar' };
    default: return null;
  }
}

export function useComposerInput({ setEditorState, subscribe }) {
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

  const setDuration = useCallback((type) => { sticky.current = { ...sticky.current, type }; sync(); }, []);
  const toggleDot = useCallback(() => { sticky.current = { ...sticky.current, dots: sticky.current.dots ? 0 : 1 }; sync(); }, []);
  const toggleArm = useCallback(() => { armedRef.current = !armedRef.current; sync(); }, []);
  const addRest = useCallback(() => { setEditorState((s) => applyCommand(s, insertRest, { ...sticky.current })); }, [setEditorState]);
  const deleteAtCaret = useCallback(() => { setEditorState((s) => applyCommand(s, deleteNote, s.caret)); }, [setEditorState]);

  useEffect(() => {
    const onKey = (e) => {
      const m = mapKey(e.code);
      if (!m) return;
      e.preventDefault();
      switch (m.kind) {
        case 'duration': setDuration(m.type); break;
        case 'dot': toggleDot(); break;
        case 'arm': toggleArm(); break;
        case 'rest': addRest(); break;
        case 'deleteBack':
        case 'deleteAt': deleteAtCaret(); break;
        case 'caret': setEditorState((s) => applyCommand(s, moveCaret, m.where)); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDuration, toggleDot, toggleArm, addRest, deleteAtCaret, setEditorState]);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      if (!armedRef.current) return; // disarmed = audition-only, no edit
      const pitch = midiToPitch(evt.note);
      setEditorState((s) => applyCommand(s, insertNote, pitch, { ...sticky.current }));
    });
  }, [subscribe, setEditorState]);

  return { hud, armed: hud.armed, setDuration, toggleDot, toggleArm, addRest };
}
