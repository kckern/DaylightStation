/**
 * ChordCard — large chord-symbol face for chord-spelling flashcards.
 * Root name renders big; the quality suffix (m, 7, sus4, …) smaller beside it.
 */
export function ChordCard({ card }) {
  return (
    <div className="piano-flashcards__chord-symbol">
      <span className="piano-flashcards__chord-root">{card.rootName}</span>
      {card.suffix && (
        <span className="piano-flashcards__chord-suffix">{card.suffix}</span>
      )}
    </div>
  );
}

export default ChordCard;
