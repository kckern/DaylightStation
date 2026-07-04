import './TransportSheets.scss';

// Circle of fifths, clockwise from 12 o'clock (design §5). Also quietly teaches
// where keys sit relative to each other.
const CIRCLE = [
  { name: 'C', pc: 0 }, { name: 'G', pc: 7 }, { name: 'D', pc: 2 }, { name: 'A', pc: 9 },
  { name: 'E', pc: 4 }, { name: 'B', pc: 11 }, { name: 'F♯', pc: 6 }, { name: 'D♭', pc: 1 },
  { name: 'A♭', pc: 8 }, { name: 'E♭', pc: 3 }, { name: 'B♭', pc: 10 }, { name: 'F', pc: 5 },
];

/** Shortest signed semitone step from `fromPc` to `toPc` (−6..+5). */
export function shortestKeyDelta(fromPc, toPc) {
  return (((toPc - fromPc) % 12) + 18) % 12 - 6;
}

/**
 * KeySheet — tap-to-open key picker as a circle of fifths (design §5). Tapping a
 * wedge nudges the jam key to that tonic by the shortest path (the workspace
 * models key as an absolute semitone shift, so we emit a signed delta).
 *
 * @param {number} keyPc  current tonic pitch class (0..11)
 * @param {(delta:number) => void} onKeyNudge
 * @param {() => void} onClose
 */
export function KeySheet({ keyPc, onKeyNudge, onClose }) {
  // Center-to-center ring radius as an ABSOLUTE distance: the 18rem ring minus
  // half a wedge (~3.1rem). A `%` here would resolve against the wedge's own
  // box, not the ring, and collapse every key into the center.
  const radius = '7rem';
  const pick = (pc) => {
    const delta = shortestKeyDelta(keyPc, pc);
    if (delta !== 0) onKeyNudge(delta);
    onClose();
  };
  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="piano-sheet piano-key-sheet"
        role="dialog"
        aria-label="key"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="piano-key-sheet__ring">
          {CIRCLE.map((k, i) => {
            const angle = i * 30; // degrees clockwise from top
            return (
              <button
                key={k.pc}
                type="button"
                className={`piano-key-sheet__wedge${k.pc === keyPc ? ' is-on' : ''}`}
                aria-label={`key ${k.name}`}
                aria-pressed={k.pc === keyPc}
                style={{
                  transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}) rotate(${-angle}deg)`,
                }}
                onClick={() => pick(k.pc)}
              >{k.name}</button>
            );
          })}
          <span className="piano-key-sheet__center" aria-hidden="true">Key</span>
        </div>
        <button type="button" className="piano-sheet__done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default KeySheet;
