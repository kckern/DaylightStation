import { useMemo } from 'react';
import { getStaffPositionOnClef } from '../model/pitch.js';
import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';
import {
  ACCIDENTAL_WIDTH,
  ACCIDENTAL_GAP,
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  SharpShape,
  FlatShape,
  ledgerLineYs,
  ClefGlyph,
} from './staffGlyphs.jsx';
import './SvgSequenceStaff.scss';

/**
 * SvgSequenceStaff — the house engraver, extended from "a chord" to "an ordered
 * sequence".
 *
 * `SvgStaffRenderer` draws one simultaneity: a set of noteheads in a single
 * column. A free-timing ask (play this scale, play these notes in order) needs
 * the same ink laid out left to right, with a cursor that says where the child
 * is, and — the reason this exists — the note they actually played drawn at ITS
 * OWN staff position when it is the wrong one. A child who can only see that
 * they are wrong learns nothing; a child who can see they are one line too low
 * learns where they are.
 *
 * Everything below the layout is shared with the sibling renderer: staff
 * positions from model/pitch.js, stem direction and length from model/stems.js,
 * and the drawn accidental/ledger/clef glyphs from ./staffGlyphs.jsx. Nothing
 * here re-derives that math.
 *
 * @param {Array<{midi?:number, midis?:number[], accidental?:'sharp'|'flat'}>} notes
 *   Ordered asks. One entry = one column; an entry with `midis` is a
 *   simultaneity (a dyad or triad) and draws as a chord in that column.
 * @param {number} cursorIndex - entries before it are done, at it is next, after it todo.
 * @param {number|null} wrongMidi - the note actually played, ghosted at its true position.
 * @param {Map|null} activeNotes - currently held keys, ghosted at 50% (targets excluded).
 * @param {'treble'|'bass'|null} clef - explicit clef; omit to derive from the majority pitch.
 * @param {'sharp'|'flat'} accidental - default spelling for black keys (per-note overridable).
 */

// ── Geometry (viewBox units) ─────────────────────────────────────────────────
// The vertical half matches SvgStaffRenderer exactly so a note is the same size
// on both surfaces; only the horizontal extent is this component's own.
const LINE_SPACING = 14;
const TOP_PAD = LINE_SPACING * 2;
const BOTTOM_LINE_Y = TOP_PAD + LINE_SPACING * 4;
const VIEWBOX_H = BOTTOM_LINE_Y + LINE_SPACING * 2;
const STEP_SIZE = LINE_SPACING / 2;
/** Left edge of the first notehead column — clear of the clef and its accidental gutter. */
const FIRST_COLUMN_X = 64;
/**
 * Column pitch. A notehead is 18 wide and its accidental another 14 with air,
 * so 36 is the narrowest spacing at which an accidental never touches the
 * previous column's head — which is what keeps a Db major scale legible.
 */
const COLUMN_W = 36;
/** How far right of the cursor column a ghost stands: clear of the target, still in the same beat. */
const GHOST_DX = 16;
const RIGHT_PAD = 30;
const MIN_VIEWBOX_W = 100;
/** Held ghosts outside this range would draw off the card; the wrong note is always drawn. */
const HELD_GHOST_MIN = -3;
const HELD_GHOST_MAX = 11;

/**
 * The viewBox a sequence of `entryCount` columns needs. Exported so a host can
 * size its box to the same aspect — the staff lines stretch to fill while the
 * notation scales uniformly and centres, so the two only agree at this ratio
 * (the STAFF_ASPECT lesson from SvgStaffRenderer).
 */
export function sequenceStaffViewBox(entryCount = 0) {
  const width = Math.max(
    MIN_VIEWBOX_W,
    FIRST_COLUMN_X + Math.max(0, entryCount - 1) * COLUMN_W + RIGHT_PAD
  );
  return { width, height: VIEWBOX_H };
}

/** One ask → a list of midi numbers, whatever shape the caller used. */
function entryMidis(entry) {
  if (typeof entry === 'number') return [entry];
  if (Array.isArray(entry?.midis)) return entry.midis.filter((m) => Number.isFinite(m));
  if (Number.isFinite(entry?.midi)) return [entry.midi];
  return [];
}

/**
 * Clef by engraving rule 1: an explicit choice wins; otherwise the MAJORITY of
 * the sequence's pitches decides. Deriving from the FIRST pitch — what the
 * single-simultaneity renderer does, correctly, for one note — is what put a
 * treble scale on a bass staff, because one low pickup note spoke for the run.
 * A tie goes treble, matching "C4 and above is treble" for the pitch that sits
 * exactly on the boundary.
 */
function deriveClef(naturalClefs) {
  if (!naturalClefs.length) return 'treble';
  const treble = naturalClefs.filter((c) => c === 'treble').length;
  return treble >= naturalClefs.length - treble ? 'treble' : 'bass';
}

export function SvgSequenceStaff({
  notes = [],
  cursorIndex = 0,
  wrongMidi = null,
  activeNotes = null,
  clef = null,
  accidental = 'sharp',
}) {
  // Black keys are spelled deterministically — spellAccidental's no-argument
  // default is a coin flip, which on a kiosk means the same note flickering
  // between C# and Db between renders. Callers that know the key pass
  // `accidental` (or set it per note); everything else reads as sharps.
  const entries = useMemo(() => {
    const built = [];
    for (const entry of notes ?? []) {
      const midis = entryMidis(entry);
      if (!midis.length) continue;
      built.push({ midis, accidental: entry?.accidental ?? accidental });
    }
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(notes ?? []), accidental]);

  // Which clef each pitch would pick for itself; the majority of those decides
  // the one staff, unless the caller named it.
  const naturalClefs = useMemo(
    () => entries.flatMap((e) => e.midis.map((midi) => getStaffPositionOnClef(midi, null, e.accidental).clef)),
    [entries]
  );

  const activeClef = clef ?? deriveClef(naturalClefs);

  const columns = useMemo(
    () =>
      entries.map((entry, index) => {
        const heads = entry.midis
          .map((midi) => ({ midi, ...getStaffPositionOnClef(midi, activeClef, entry.accidental) }))
          .sort((a, b) => a.position - b.position);

        // Shared engraving rules (model/stems.js): the notehead farthest from
        // the middle line decides the group; the outer notehead sets the length.
        const dir = stemDirectionFor(heads.map((h) => h.position));
        const stemUp = dir === 'up';
        const outerPos = stemUp ? heads[heads.length - 1].position : heads[0].position;

        // Seconds inside a simultaneity sit on opposite sides of the stem —
        // the same rule the single-simultaneity renderer uses.
        const offsets = heads.map(() => 0);
        for (let i = 1; i < heads.length; i++) {
          if (heads[i].position - heads[i - 1].position <= 1) {
            if (stemUp) offsets[i - 1] = -2 * NOTEHEAD_RX;
            else offsets[i] = 2 * NOTEHEAD_RX;
          }
        }

        // Accidentals alternate columns by how many the CHORD carries, not by
        // notehead index — two accidentals three heads apart still need
        // separate columns, and two adjacent naturals must not consume one.
        let accCount = 0;
        const drawn = heads.map((head, i) => {
          const hasAccidental = head.isSharp || head.isFlat;
          return { ...head, offset: offsets[i], hasAccidental, accStagger: hasAccidental ? accCount++ % 2 : 0 };
        });

        const colX = FIRST_COLUMN_X + index * COLUMN_W;
        const state = index < cursorIndex ? 'done' : index === cursorIndex ? 'next' : 'todo';
        return { index, heads: drawn, colX, state, stemUp, stemLen: LINE_SPACING * stemLengthUnits(outerPos, dir) };
      }),
    [entries, activeClef, cursorIndex]
  );

  const targetMidis = useMemo(
    () => new Set(entries.flatMap((e) => e.midis)),
    [entries]
  );

  const cursorColumn = columns.length
    ? Math.min(Math.max(cursorIndex, 0), columns.length - 1)
    : 0;
  const ghostX = FIRST_COLUMN_X + cursorColumn * COLUMN_W + GHOST_DX;

  const wrongGhost = useMemo(() => {
    if (!Number.isFinite(wrongMidi)) return null;
    return { midi: wrongMidi, ...getStaffPositionOnClef(wrongMidi, activeClef, accidental) };
  }, [wrongMidi, activeClef, accidental]);

  // Held keys, ghosted like the sibling: targets excluded (they are already
  // drawn as ink) and the wrong note excluded (it has its own, louder ghost).
  const heldGhosts = useMemo(() => {
    if (!activeNotes || activeNotes.size === 0) return [];
    const ghosts = [];
    for (const [midi] of activeNotes) {
      if (targetMidis.has(midi) || midi === wrongMidi) continue;
      const pos = getStaffPositionOnClef(midi, activeClef, accidental);
      if (pos.position < HELD_GHOST_MIN || pos.position > HELD_GHOST_MAX) continue;
      ghosts.push({ midi, ...pos });
    }
    return ghosts;
  }, [activeNotes, targetMidis, wrongMidi, activeClef, accidental]);

  const { width: viewBoxW } = sequenceStaffViewBox(columns.length);
  const viewBox = `0 0 ${viewBoxW} ${VIEWBOX_H}`;
  const staffLineYs = [0, 1, 2, 3, 4].map((i) => BOTTOM_LINE_Y - i * LINE_SPACING);
  const yOf = (position) => BOTTOM_LINE_Y - position * STEP_SIZE;
  const showCursor = columns.length > 0 && cursorIndex >= 0 && cursorIndex < columns.length;

  return (
    <div
      className="sequence-staff"
      data-clef={activeClef}
      style={{ aspectRatio: `${viewBoxW} / ${VIEWBOX_H}` }}
    >
      <div className="action-staff__staff-area">
        {/* Staff lines stretch to fill the box; the notation scales uniformly
            and centres. They agree only because the host box carries the
            aspect ratio set above. */}
        <svg className="action-staff__lines-svg" viewBox={viewBox} preserveAspectRatio="none">
          <g className="action-staff__staff">
            {staffLineYs.map((y, i) => (
              <line key={i} x1="0" y1={y} x2={viewBoxW} y2={y}
                stroke="rgba(0,0,0,1)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        </svg>

        <svg className="action-staff__notation-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
          <ClefGlyph clef={activeClef} lineSpacing={LINE_SPACING} bottomLineY={BOTTOM_LINE_Y} />

          {showCursor && (
            <rect
              className="sequence-staff__cursor"
              data-cursor-index={cursorIndex}
              x={FIRST_COLUMN_X + cursorIndex * COLUMN_W - COLUMN_W / 2}
              y={TOP_PAD - LINE_SPACING}
              width={COLUMN_W}
              height={LINE_SPACING * 6}
              rx="4"
            />
          )}

          {columns.map((col) => (
            <g
              key={col.index}
              className="action-staff__note-group"
              data-sequence-index={col.index}
              data-state={col.state}
            >
              {col.heads.map((head, i) =>
                ledgerLineYs(head.position, BOTTOM_LINE_Y, STEP_SIZE).map((ly, li) => (
                  <line key={`ledger-${i}-${li}`} className="action-staff__ledger"
                    x1={col.colX - 14} y1={ly} x2={col.colX + 14} y2={ly}
                    stroke="rgba(0,0,0,1)" strokeWidth="1" />
                ))
              )}

              {/* Stems and accidentals take their run-state from the group's
                  `data-state`, never a `sequence-note-*` class of their own:
                  that class names a NOTEHEAD, and counting it is how a test
                  says "one note is next". */}
              <line
                className="action-staff__stem"
                x1={col.stemUp ? col.colX + 8 : col.colX - 8}
                x2={col.stemUp ? col.colX + 8 : col.colX - 8}
                y1={
                  col.stemUp
                    ? Math.min(...col.heads.map((h) => yOf(h.position))) - col.stemLen
                    : Math.min(...col.heads.map((h) => yOf(h.position)))
                }
                y2={
                  col.stemUp
                    ? Math.max(...col.heads.map((h) => yOf(h.position)))
                    : Math.max(...col.heads.map((h) => yOf(h.position))) + col.stemLen
                }
              />

              {col.heads.map((head, i) => {
                const noteX = col.colX + head.offset;
                const noteY = yOf(head.position);
                // Accidental column: left of every notehead in this column,
                // staggered when a chord carries more than one.
                const accX =
                  Math.min(col.colX, noteX) - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2
                  - head.accStagger * (ACCIDENTAL_WIDTH + 2);
                return (
                  <g key={`${head.midi}-${i}`}>
                    <ellipse
                      className={`action-staff__note sequence-note-${col.state}`}
                      data-midi={head.midi}
                      data-line-offset={head.position}
                      cx={noteX} cy={noteY} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY}
                      transform={`rotate(-12, ${noteX}, ${noteY})`}
                    />
                    {head.hasAccidental && (
                      <g
                        className="action-staff__accidental"
                        data-kind={head.isSharp ? 'sharp' : 'flat'}
                        transform={`translate(${accX}, ${noteY})`}
                      >
                        {head.isSharp ? <SharpShape /> : <FlatShape />}
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          ))}

          {/* The wrong note, where it actually is. Ledger lines included: a note
              off the staff is exactly the case where a child cannot tell how
              far off they are without them. */}
          {wrongGhost && (
            <g className="sequence-staff__wrong">
              {ledgerLineYs(wrongGhost.position, BOTTOM_LINE_Y, STEP_SIZE).map((ly, li) => (
                <line key={`wrong-ledger-${li}`} className="sequence-staff__wrong-ledger"
                  x1={ghostX - 14} y1={ly} x2={ghostX + 14} y2={ly}
                  stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
              ))}
              <ellipse
                className="sequence-note-wrong-ghost"
                data-midi={wrongGhost.midi}
                data-line-offset={wrongGhost.position}
                cx={ghostX} cy={yOf(wrongGhost.position)} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY}
                transform={`rotate(-12, ${ghostX}, ${yOf(wrongGhost.position)})`}
              />
              {(wrongGhost.isSharp || wrongGhost.isFlat) && (
                <g
                  className="sequence-staff__ghost-accidental"
                  data-kind={wrongGhost.isSharp ? 'sharp' : 'flat'}
                  transform={`translate(${ghostX - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2}, ${yOf(wrongGhost.position)})`}
                >
                  {wrongGhost.isSharp ? <SharpShape /> : <FlatShape />}
                </g>
              )}
            </g>
          )}

          {heldGhosts.map((gn) => (
            <ellipse
              key={`held-${gn.midi}`}
              className="sequence-staff__held-ghost"
              data-midi={gn.midi}
              data-line-offset={gn.position}
              cx={ghostX} cy={yOf(gn.position)} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY}
              fill="rgba(0,0,0,0.15)" stroke="rgba(0,0,0,0.1)" strokeWidth="0.5"
              transform={`rotate(-12, ${ghostX}, ${yOf(gn.position)})`}
              opacity="0.5"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

export default SvgSequenceStaff;
