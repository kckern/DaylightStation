import { useMemo } from 'react';
import { getStaffPosition, getStaffPositionOnClef } from '../model/pitch.js';
import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';
import { noteheadOffsets, accidentalColumns } from '../model/chordLayout.js';
import {
  ACCIDENTAL_WIDTH,
  ACCIDENTAL_HEIGHT,
  ACCIDENTAL_GAP,
  NOTEHEAD_RX,
  SharpShape,
  FlatShape,
  ledgerLineYs,
  clefRightEdge,
  ClefGlyph,
} from './staffGlyphs.jsx';

// The accidental box and the drawn sharp/flat shapes now live in
// ./staffGlyphs.jsx so the sequence staff engraves them identically. Re-exported
// here because they are part of this renderer's published contract (hosts and
// its own tests size against them).
export { ACCIDENTAL_WIDTH, ACCIDENTAL_HEIGHT } from './staffGlyphs.jsx';

/**
 * SvgStaffRenderer — hand-rolled SVG staff showing a set of target pitches
 * (plus optional ghost notes for currently-pressed keys).
 *
 * Extracted verbatim (behavior-preserving) from
 * modules/Piano/components/ActionStaff.jsx; the note-position math now comes from
 * the shared MusicNotation model. Emits the same `.action-staff__*` markup so the
 * existing ActionStaff.scss continues to style it.
 *
 * @param {number[]} targetPitches - MIDI notes to display on the staff
 * @param {Map|Set|number[]|null} activeNotes - currently pressed notes (shown as ghosts)
 * @param {boolean} matched - whether the player is currently matching
 * @param {'sharp'|'flat'} [accidental] - spelling for black keys; omit for the
 *   house lean (see spellAccidental). A caller that knows the board's key should
 *   state it, so every card spells the same way.
 */
/**
 * Width-to-height ratio a host box must have for the noteheads to sit on the
 * staff lines. See the geometry note inside the component.
 */
export const STAFF_ASPECT = 100 / 112;

/**
 * The pressed notes, however the host happens to hold them.
 *
 * `activeNotes` arrives as a Map from the MIDI providers (pitch -> velocity),
 * but a host that has already split the held set by hand or by axis has a plain
 * array, and making it build a throwaway Map per render just to be let in is a
 * tax on the surface that needs this most — the rim, where sixteen cards each
 * take their own slice.
 */
function pressedPitches(activeNotes) {
  if (!activeNotes) return [];
  if (Array.isArray(activeNotes)) return activeNotes;
  if (activeNotes instanceof Map || activeNotes instanceof Set) return [...activeNotes.keys()];
  return [];
}

export function SvgStaffRenderer({
  targetPitches = [], activeNotes = null, matched = false, accidental = undefined,
}) {
  const validPitches = targetPitches.filter((p) => p != null);

  // validPitches.join(',') is a deliberate value-key: a stable string proxy for array
  // *content*, avoiding recompute on every render when targetPitches is a fresh array literal.
  const notePositions = useMemo(
    () => validPitches.map((pitch) => ({ pitch, ...getStaffPosition(pitch, accidental) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validPitches.join(','), accidental]
  );

  // ONE CLEF FOR THE WHOLE STAFF, taken from the lowest note, and every other
  // note measured against it.
  //
  // `getStaffPosition` picks a clef PER PITCH, which is right for a lone note
  // deciding which staff it wants and wrong for anything drawn together: a
  // shape straddling middle C got its notes placed on two different clefs and
  // then drawn on the one the first note happened to want, so the others landed
  // an octave and a half from where they belong.
  const clef = notePositions[0]?.clef ?? 'treble';
  const placed = useMemo(
    () => notePositions.map(({ pitch }) => ({ pitch, ...getStaffPositionOnClef(pitch, clef, accidental) })),
    [notePositions, clef, accidental],
  );

  // Ghost notes: the keys currently down, drawn as pencil beside the ink, so a
  // player walking up the scale toward the target can see how close they are.
  // Targets are excluded — a pressed target is already answered by `matched`.
  // validPitches.join(',') is a deliberate value-key: a stable string proxy for array
  // *content*, avoiding recompute on every render when targetPitches is a fresh array literal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targetSet = useMemo(() => new Set(validPitches), [validPitches.join(',')]);
  const pressed = pressedPitches(activeNotes);
  const ghostNotes = useMemo(() => {
    if (!pressed.length) return [];
    const ghosts = [];
    for (const pitch of pressed) {
      if (targetSet.has(pitch)) continue;
      // On THIS staff's clef — a pressed bass note measured on its own clef and
      // then drawn on a treble card lands at a pitch nobody played, which is
      // worse than no ghost at all.
      const pos = getStaffPositionOnClef(pitch, clef, accidental);
      // Off this staff entirely. A ghost four ledger lines away says nothing
      // about the note being hunted, and drawing it would push the card's ink
      // outside its own viewBox.
      if (pos.position < -3 || pos.position > 11) continue;
      ghosts.push({ pitch, ...pos });
    }
    ghosts.sort((a, b) => a.position - b.position);
    // Ghosts obey the same across-the-stem rule as ink: a held cluster drawn in
    // one column is a blob, and the child reading it is trying to count notes.
    const columns = noteheadOffsets(ghosts.map((g) => g.position), 'up');
    return ghosts.map((ghost, i) => ({ ...ghost, column: columns[i] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressed.join(','), targetSet, accidental, clef]);

  /**
   * Staff geometry.
   *
   * NOTE the two SVGs below scale differently: the lines stretch to fill the box
   * (`preserveAspectRatio="none"`) while the notation scales uniformly and
   * centres (`xMidYMid meet`). They therefore only agree when the host box has
   * the same aspect ratio as this viewBox — 100 x viewBoxH. In a box that is
   * wider or taller than that, the noteheads drift off the lines they are
   * supposed to sit on. Hosts should constrain themselves to STAFF_ASPECT.
   */
  const lineSpacing = 14;
  const topPad = lineSpacing * 2;
  const bottomLineY = topPad + lineSpacing * 4;
  const viewBoxH = bottomLineY + lineSpacing * 2;
  const stepSize = lineSpacing / 2;
  const staffLineYs = [0, 1, 2, 3, 4].map((i) => bottomLineY - i * lineSpacing);

  /**
   * Where the noteheads, their accidentals and their stem sit.
   *
   * Hoisted out of the render so the ghosts can share the same notehead column;
   * they used to be drawn at a hard-coded x=65 that only agreed with the ink by
   * coincidence, and stopped agreeing the moment the group moved.
   *
   * THE GROUP MOVES to keep its leftmost ink off the clef. Accidentals were laid
   * out purely relative to the noteheads: a chord needing two of them staggered
   * the second one to x ~= 34 while the clef occupied 2...44, and the two were
   * simply drawn on top of each other — which is what a rank of dyads with
   * accidentals looked like on the rim. So the left edge of the whole group is
   * computed first and the group shifts right by whatever it takes to clear the
   * clef, clamped so it cannot then run off the staff's right edge instead.
   */
  const layout = useMemo(() => {
    const NOMINAL_BASE_X = 65;
    if (!placed.length) return null;

    const sorted = [...placed].sort((a, b) => a.position - b.position);
    // Shared engraving rules (model/stems.js): the notehead farthest from
    // the middle line decides the group; the outer notehead (the one the
    // stem extends beyond) sets the length, far-ledger extension included.
    const dir = stemDirectionFor(sorted.map((n) => n.position));
    const stemUp = dir === 'up';
    const outerPos = stemUp ? sorted[sorted.length - 1].position : sorted[0].position;

    // Seconds cannot share a column, so one of the pair steps ACROSS THE STEM —
    // upper head rightward on an up-stem, lower head leftward on a down-stem.
    // See model/chordLayout.js for why that sentence is worth stating: this
    // renderer had both halves of it backwards, which is what put the middle
    // note of a triad on the wrong side of its own stem.
    const offsets = noteheadOffsets(sorted.map((n) => n.position), dir)
      .map((column) => column * 2 * NOTEHEAD_RX);

    // Accidentals go left of ALL noteheads, with guaranteed air before the
    // leftmost head, and take a further column out only when a neighbour would
    // otherwise be drawn through them. Held as offsets from the notehead column
    // so the whole group can be moved as one.
    const accidentalColumn = accidentalColumns(
      sorted.flatMap((np, index) => (np.isSharp || np.isFlat ? [{ index, position: np.position }] : [])),
      ACCIDENTAL_HEIGHT / stepSize,
    );
    const accDx = sorted.map((np, i) => {
      if (!accidentalColumn.has(i)) return null;
      const columnDx = Math.min(0, ...offsets) - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2;
      return columnDx - accidentalColumn.get(i) * (ACCIDENTAL_WIDTH + 2);
    });

    const leftDx = Math.min(
      ...offsets.map((offset) => offset - NOTEHEAD_RX),
      ...accDx.filter((dx) => dx !== null).map((dx) => dx - ACCIDENTAL_WIDTH / 2),
    );
    const rightDx = Math.max(...offsets.map((offset) => offset + NOTEHEAD_RX), 9);
    const shift = Math.max(0, clefRightEdge(lineSpacing) - (NOMINAL_BASE_X + leftDx));
    const baseX = Math.min(NOMINAL_BASE_X + shift, 100 - rightDx - 1);

    const noteYs = sorted.map((np) => bottomLineY - np.position * stepSize);
    const stemLen = lineSpacing * stemLengthUnits(outerPos, dir);

    // A stem is shortened before it is allowed off the card. The default 3.5
    // spaces from an outer notehead of a triad reaches the very top of the
    // viewBox, and a stem running out of the top of a rim card is the sort of
    // thing that reads as broken rather than as engraved. Standard practice is
    // to shorten rather than overflow.
    const clamp = (y) => Math.min(viewBoxH - 3, Math.max(3, y));
    return {
      baseX,
      sorted,
      offsets,
      accDx,
      noteYs,
      stemX: stemUp ? baseX + 8 : baseX - 8,
      stemTop: clamp(stemUp ? Math.min(...noteYs) - stemLen : Math.min(...noteYs)),
      stemBottom: clamp(stemUp ? Math.max(...noteYs) : Math.max(...noteYs) + stemLen),
    };
  }, [placed, bottomLineY, lineSpacing, stepSize, viewBoxH]);

  // Ghosts land in the ink's column when there is ink; on an empty staff they
  // have the column to themselves.
  const ghostX = layout ? layout.baseX : 65;

  return (
    <div className="action-staff__staff-area">
      {/* Staff lines — preserveAspectRatio="none" so lines stretch to full width */}
      <svg className="action-staff__lines-svg" viewBox={`0 0 100 ${viewBoxH}`} preserveAspectRatio="none">
        {staffLineYs.map((y, i) => (
          <line key={i} x1="0" y1={y} x2="100" y2={y} stroke="rgba(0,0,0,1)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      {/* Notation (clef + notes) — proportional scaling */}
      <svg className="action-staff__notation-svg" viewBox={`0 0 100 ${viewBoxH}`} preserveAspectRatio="xMidYMid meet">
        <ClefGlyph clef={clef} lineSpacing={lineSpacing} bottomLineY={bottomLineY} />

        {layout && (
          <g>
            <line x1={layout.stemX} y1={layout.stemTop} x2={layout.stemX} y2={layout.stemBottom}
              className={`action-staff__stem${matched ? ' action-staff__stem--matched' : ''}`}
            />

            {layout.sorted.map((np, i) => {
              const noteY = layout.noteYs[i];
              const noteX = layout.baseX + layout.offsets[i];
              const ledgerLines = ledgerLineYs(np.position, bottomLineY, stepSize);
              const accDx = layout.accDx[i];

              return (
                <g key={np.pitch}>
                  {ledgerLines.map((ly, li) => (
                    <line key={`ledger-${li}`} x1={layout.baseX - 14} y1={ly} x2={layout.baseX + 14} y2={ly}
                      stroke="rgba(0,0,0,1)" strokeWidth="1" />
                  ))}
                  <ellipse cx={noteX} cy={noteY} rx="9" ry="6.5"
                    className={`action-staff__note${matched ? ' action-staff__note--matched' : ''}`}
                    transform={`rotate(-12, ${noteX}, ${noteY})`}
                  />
                  {accDx !== null && (
                    <g
                      className={`action-staff__accidental${matched ? ' action-staff__accidental--matched' : ''}`}
                      data-kind={np.isSharp ? 'sharp' : 'flat'}
                      transform={`translate(${layout.baseX + accDx}, ${noteY})`}
                    >
                      {np.isSharp ? <SharpShape /> : <FlatShape />}
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/*
          Ghost notes — the keys currently down, drawn as pencil beside the ink.

          Drawn hollow and dashed rather than as a faint fill. The previous
          treatment was `fill rgba(0,0,0,0.15)` at `opacity 0.5` — about 7%
          black, which on a paper-coloured card is nothing at all — and it had
          no ledger lines, so a ghost off the staff could not even be located.
          Both of those matter here: this is the only channel telling a child
          walking up the scale whether they are getting closer.
        */}
        {ghostNotes.map((gn) => {
          const noteY = bottomLineY - gn.position * stepSize;
          const noteX = ghostX + gn.column * 2 * NOTEHEAD_RX;
          const ledgerLines = ledgerLineYs(gn.position, bottomLineY, stepSize);
          return (
            <g key={`ghost-${gn.pitch}`} className="action-staff__ghost">
              {ledgerLines.map((ly, li) => (
                <line key={`ghost-ledger-${li}`} x1={ghostX - 14} y1={ly} x2={ghostX + 14} y2={ly}
                  stroke="rgba(0,0,0,0.45)" strokeWidth="1" strokeDasharray="3 2" />
              ))}
              <ellipse cx={noteX} cy={noteY} rx="9" ry="6.5"
                fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1.6" strokeDasharray="3.5 2.5"
                transform={`rotate(-12, ${noteX}, ${noteY})`}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default SvgStaffRenderer;
