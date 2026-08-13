import './GestureCards.scss';

/**
 * The things you can play that are not squares.
 *
 * Three gestures do the work a mouse would: put the piece back, show where it
 * can go, ask what the best move is. None of them is discoverable, and a
 * sentence describing "a run of three adjacent semitones" is not something a
 * five-year-old can act on — so each one is DRAWN, as the keys you actually
 * press. A picture of two keys an octave apart is a thing a child can copy
 * without reading.
 *
 * They sit in the left rail because that rail answers "what can I do now",
 * and they are the only complete answer to it.
 */

/** A tiny keyboard with the pressed keys marked — the gesture, as it is played. */
function KeyDiagram({ pressed, span = 13 }) {
  // One octave of keys, laid out like the instrument: seven whites with blacks
  // straddling them. `pressed` holds semitone offsets from the left-hand key.
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const BLACK = [1, 3, 6, 8, 10];
  const whiteW = 100 / 8;
  const xOf = (semitone) => {
    const white = WHITE.indexOf(semitone);
    if (white >= 0) return { x: white * whiteW, w: whiteW, black: false };
    const below = WHITE.filter((w) => w < semitone).length - 1;
    return { x: (below + 1) * whiteW - whiteW * 0.28, w: whiteW * 0.56, black: true };
  };
  const marks = new Set(pressed);
  return (
    <svg className="gesture-card__keys" viewBox={`0 0 ${100 + whiteW} 34`} aria-hidden="true" focusable="false">
      {[...Array(span).keys()].filter((s) => WHITE.includes(s % 12) || s === 12).map((semitone) => {
        const { x, w } = xOf(semitone % 12 === 0 && semitone > 0 ? 12 : semitone);
        const at = semitone === 12 ? 7 * whiteW : x;
        return (
          <rect
            key={`w${semitone}`}
            className={`gesture-card__key${marks.has(semitone) ? ' gesture-card__key--on' : ''}`}
            x={at} y="0" width={w} height="34" rx="1.5"
          />
        );
      })}
      {BLACK.filter((s) => s < span).map((semitone) => {
        const { x, w } = xOf(semitone);
        return (
          <rect
            key={`b${semitone}`}
            className={`gesture-card__key gesture-card__key--black${marks.has(semitone) ? ' gesture-card__key--on' : ''}`}
            x={x} y="0" width={w} height="21" rx="1.2"
          />
        );
      })}
    </svg>
  );
}

/**
 * @param {object[]} gestures  {id, pressed, title, note, active, charged}
 */
export function GestureCards({ gestures }) {
  return (
    <ul className="gesture-cards">
      {gestures.map((gesture) => (
        <li
          key={gesture.id}
          className={`gesture-card${gesture.active ? ' gesture-card--active' : ''}${gesture.muted ? ' gesture-card--muted' : ''}`}
        >
          <KeyDiagram pressed={gesture.pressed} />
          <div className="gesture-card__text">
            <span className="gesture-card__title">{gesture.title}</span>
            {gesture.note && <span className="gesture-card__note">{gesture.note}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default GestureCards;
