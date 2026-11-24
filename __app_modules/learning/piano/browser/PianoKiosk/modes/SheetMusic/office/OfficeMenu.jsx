import { useMemo } from 'react';
import { useNoteSelection } from '../../../../game-platform/input/useNoteSelection.js';
import { rimStaffExtent } from '../../../../../../../../__capabilities/music-notation/browser/renderers/RimStaffRenderer.jsx';
import KeyCard from './KeyCard.jsx';
import { MENU_KEYS } from './officeMenu.js';

const EXTENT = rimStaffExtent(MENU_KEYS.map((key) => key.note));

/**
 * The Sheet Music menu on the office screen: a modal, opaque, over everything
 * Sheet Music draws. While it is open the take is paused and every key is
 * navigation (the host claims them all away from the music); each choice wears
 * its key's staff card and note, on the same key whatever else is offered. A
 * choice that does nothing now keeps its key, drawn as a plain empty key.
 *
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {Array}    props.choices     - menuChoices(): { id, note, noteName, label, enabled }
 * @param {Map}      props.activeNotes - the RAW held notes
 * @param {Function} props.onSelect    - (id) => void
 * @param {string}   [props.title]
 * @param {string}   [props.subtitle]
 * @param {Function} [props.mapRef]    - in a piece: a ref for the passage map row. Learn draws the piece's
 *   passages there (LearnCoach, the coach rail's coins, current one ringed): the passage picker that
 *   Previous and Next move along. The drill's own rail shows only where you are; the menu shows the way.
 */
export default function OfficeMenu({ open, choices, activeNotes, onSelect, title = 'Menu', subtitle = null, mapRef = null }) {
  const live = useMemo(() => choices.filter((choice) => choice.enabled).map((choice) => ({ ...choice, item: choice })), [choices]);
  useNoteSelection({ activeNotes, slots: live, enabled: open, onSelect: (item) => onSelect?.(item.id) });
  if (!open) return null;
  return (
    <div className="office-menu" role="dialog" aria-modal="true" aria-label={title}>
      <header className="office-menu__head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {mapRef && <div className="office-menu__map" aria-label="Passages">
        <span className="office-menu__map-label">Passages</span>
        {/* A map, not a control: nothing in it takes focus (Previous and Next are the keys). */}
        <div className="office-menu__map-coins" ref={mapRef} inert="" />
      </div>}
      <ol className="office-menu__keys">
        {choices.map((choice) => (
          <li key={choice.id} className="office-menu__key" data-choice={choice.id} data-enabled={choice.enabled || undefined}>
            {choice.enabled && (
              <>
                <KeyCard note={choice.note} extent={EXTENT} />
                <span className="office-menu__note">{choice.noteName}</span>
                <span className="office-menu__label">{choice.label}</span>
              </>
            )}
          </li>
        ))}
      </ol>
      <p className="office-menu__foot">Play a key. While this menu is open the keys do not play music.</p>
    </div>
  );
}
