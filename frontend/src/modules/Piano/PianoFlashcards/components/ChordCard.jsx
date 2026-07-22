import { ChordStaffRenderer } from '../../../MusicNotation/renderers/ChordStaffRenderer.jsx';

/**
 * ChordCard — chord-spelling card face:
 *  - a grand staff that starts empty and live-renders whatever is being played
 *  - the tab-style symbol, big (e.g. "Dm", "G7")
 *  - the spelled-out name, small and light (e.g. "D minor")
 */
export function ChordCard({ card, activeNotes }) {
  return (
    <div className="piano-flashcards__chord-face">
      {/* keep .chord-staff — it carries the renderer's sizing contract */}
      <ChordStaffRenderer notes={activeNotes} className="chord-staff piano-flashcards__chord-staff" />
      <div className="piano-flashcards__chord-symbol">
        <span className="piano-flashcards__chord-root">{card.rootName}</span>
        {card.suffix && (
          <span className="piano-flashcards__chord-suffix">{card.suffix}</span>
        )}
      </div>
      <div className="piano-flashcards__chord-longname">{card.longLabel}</div>
    </div>
  );
}

export default ChordCard;
