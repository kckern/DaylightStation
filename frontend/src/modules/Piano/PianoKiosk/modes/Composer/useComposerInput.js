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
import { useEffect, useRef, useState } from 'react';
import { applyCommand, insertNote, insertRest, deleteNote, moveCaret } from './model/index.js';
import { midiToPitch } from './model/editor.js';

const DURATION_KEYS = { Numpad1: '16th', Numpad3: 'eighth', Numpad5: 'quarter', Numpad7: 'half', Numpad9: 'whole' };

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
  // is mirrored to React state so the HUD can render it.
  const sticky = useRef({ type: 'quarter', dots: 0, triplet: false });
  const armedRef = useRef(false);
  const [hud, setHud] = useState({ ...sticky.current, armed: false });
  const sync = () => setHud({ ...sticky.current, armed: armedRef.current });

  useEffect(() => {
    const onKey = (e) => {
      const m = mapKey(e.code);
      if (!m) return;
      e.preventDefault();
      switch (m.kind) {
        case 'duration': sticky.current = { ...sticky.current, type: m.type }; sync(); break;
        case 'dot': sticky.current = { ...sticky.current, dots: sticky.current.dots ? 0 : 1 }; sync(); break;
        case 'arm': armedRef.current = !armedRef.current; sync(); break;
        case 'rest': setEditorState((s) => applyCommand(s, insertRest, { ...sticky.current })); break;
        case 'deleteBack':
        case 'deleteAt': setEditorState((s) => applyCommand(s, deleteNote, s.caret)); break;
        case 'caret': setEditorState((s) => applyCommand(s, moveCaret, m.where)); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setEditorState]);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      if (!armedRef.current) return; // disarmed = audition-only, no edit
      const pitch = midiToPitch(evt.note);
      setEditorState((s) => applyCommand(s, insertNote, pitch, { ...sticky.current }));
    });
  }, [subscribe, setEditorState]);

  return { hud, armed: hud.armed };
}
