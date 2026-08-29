import StaffNoteLabel from './StaffNoteLabel.jsx';
import './AddressRail.scss';

/**
 * The board's own answer to "which key means which place on the board."
 *
 * Chess already solved this by drawing staff notation directly on the file
 * and rank rim instead of naming squares in a side panel — the axis IS the
 * legend, read the same way the player reads it back on any staff. This is
 * that idea, pulled out so Connect Four and Checkers stop reinventing it
 * worse: a text legend tucked in a settings panel, or note names crowding the
 * playable cells. Neither told the player anything while their hands were on
 * the board, which is the one moment the answer actually matters.
 *
 * `addresses` is a flat, ordered list — one card per file, per rank, or per
 * column, however the caller's axis is shaped. Order is layout order: card 0
 * is first along the strip, whatever direction `orientation` runs it.
 *
 * `notation` picks what each card actually shows:
 *   - "staff"  (default) — a drawn note on its own staff (StaffNoteLabel).
 *     This is the one that fixes the stated problem: no unicode glyph, no
 *     typed text, an actual engraved note the player reads the way they read
 *     anything else on this instrument.
 *   - "chords" — the chord spelling text a caller supplies per address
 *     (`address.chord`), for players reading by chord shape rather than staff.
 *   - "names"  — the plain note name text (`address.label`), for players who
 *     read neither yet and just need "this key".
 *
 * AddressRail does not compute chord/letter text itself — it only draws what
 * the caller hands it in `address.chord`/`address.label`. Different games mean
 * different things by "the note's name" (Connect Four already has a chord
 * table per column; checkers does not), so that translation stays with the
 * game that knows its own vocabulary, not duplicated here per notation mode.
 */
export default function AddressRail({
  addresses = [],
  notation = 'staff',
  orientation = 'horizontal',
  active = null,
  className = '',
}) {
  return (
    <div
      className={`address-rail address-rail--${orientation} ${className}`.trim()}
      role="list"
    >
      {addresses.map((address, index) => (
        <div
          // midi is the natural key here — two cards sharing one note would be a
          // scheme bug, not a rendering choice — but a shuffled deal can (rarely)
          // repeat within a render tick before state settles, so fall back to the
          // position rather than let React throw on a duplicate key.
          key={Array.isArray(address?.midi) ? address.midi.join('-') : (address?.midi ?? `address-${index}`)}
          role="listitem"
          className={`address-rail__card${active === index ? ' address-rail__card--active' : ''}`}
        >
          {notation === 'chords' && <span className="address-rail__text">{address.chord}</span>}
          {notation === 'names' && <span className="address-rail__text">{address.label}</span>}
          {notation !== 'chords' && notation !== 'names' && <StaffNoteLabel midi={address.midi} />}
        </div>
      ))}
    </div>
  );
}
