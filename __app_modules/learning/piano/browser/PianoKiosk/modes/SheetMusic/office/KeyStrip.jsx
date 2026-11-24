import { useMemo } from 'react';
import { useNoteSelection } from '../../../../game-platform/input/useNoteSelection.js';
import { StaffNoteLabel } from '../../../../game-platform/families/addressed-board/StaffNoteLabel.jsx';
import { stripSlots } from './officeKeys.js';

/**
 * The drill's key strip on the office screen: the low octave drawn as a row of
 * key faces, each wearing its note and what it does. It replaces every button
 * the tablet's drill shows, because this screen has no touch.
 *
 * Fixed in place: a key always does the same thing, and one that does nothing
 * right now is drawn dim on its own key. `active: false` (a take under way)
 * dims the whole strip and stops listening — every key is music then.
 *
 * @param {object}   props
 * @param {Map}      props.activeNotes - the RAW held notes (before the strip's claim)
 * @param {object}   props.actions     - id → { onSelect, label? }
 * @param {boolean}  props.active
 * @param {boolean}  props.canListen   - false hides Listen
 * @param {Function} props.onSelect    - (id) => void
 */
export default function KeyStrip({ activeNotes, actions, active = true, canListen = false, onSelect }) {
  const slots = useMemo(() => stripSlots(actions, { canListen }), [actions, canListen]);
  const live = useMemo(() => slots.filter((slot) => slot.enabled), [slots]);
  useNoteSelection({ activeNotes, slots: live, enabled: active, onSelect: (_item, slot) => onSelect?.(slot.id) });
  return (
    <ol className="office-key-strip" data-active={active || undefined} aria-label="Keys" style={{ '--strip-count': slots.length }}>
      {slots.map((slot) => (
        <li key={slot.id} className="office-key-strip__key" data-key={slot.id} data-enabled={(slot.enabled && active) || undefined}>
          <span className="office-key-strip__card"><StaffNoteLabel midi={slot.note} /></span>
          <span className="office-key-strip__text">
            <span className="office-key-strip__note">{slot.noteName}</span>
            <span className="office-key-strip__label">{slot.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
