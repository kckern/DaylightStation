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
 * @param {number} cursorIndex - entries before it are done, at/after it are todo
 *   unless an attempt is in progress at the cursor (see `activeNotes`).
 * @param {Map|null} activeNotes - currently held keys. This is the ONLY signal
 *   the run-state colouring reads:
 *     - opacity never encodes run state — every notehead is drawn at full
 *       opacity always; the visual weight difference between "played" and
 *       "to play" is a COLOUR (jet black vs. brown), never a fade;
 *     - with nothing held, the cursor entry reads as plain "not yet played"
 *       (brown) like every entry after it — there is no attempt to judge yet;
 *     - the moment any key is held, the cursor entry's own noteheads colour
 *       per NOTE, not as a group: a target pitch being held is green, a
 *       target pitch not being held is red — a partially-played chord is not
 *       a verdict on the whole chord;
 *     - a held pitch that is not one of the cursor entry's targets draws as a
 *       ghost at the pitch actually played, semi-opaque black, no stem — "you
 *       are here", not a second verdict;
 *     - all of it is keyed to the CURRENTLY held set, so it clears the instant
 *       a key is released — nothing here remembers a past mistake.
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
  activeNotes = null,
  clef = null,
  accidental = 'sharp',
}) {
  // The one gate for every per-note colour below (rule 5): with nothing held,
  // there is no attempt to judge, so the cursor entry reads as plain "not yet
  // played" like everything after it. The instant a key goes down, judging
  // starts; the instant every key comes back up, it stops — colour is a pure
  // function of what is CURRENTLY held, never of what was held a moment ago.
  const attemptInProgress = Boolean(activeNotes && activeNotes.size > 0);
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

        // Run state, rule 1 + 5: opacity NEVER carries this — every notehead
        // renders at full opacity regardless of state, so the only thing that
        // changes below is colour. `done` (before the cursor) and `todo` (at
        // or after it, resting) are ENTRY-level: every head in the column
        // shares one treatment. `active` — the cursor entry mid-attempt — is
        // the one case colour is decided per notehead, not per entry: a
        // three-note chord with two pitches held and one not is two greens
        // and a red, never a single verdict for the column.
        const isCursor = index === cursorIndex;
        const active = isCursor && attemptInProgress;
        const state = index < cursorIndex ? 'done' : active ? 'active' : 'todo';

        // Accidentals alternate columns by how many the CHORD carries, not by
        // notehead index — two accidentals three heads apart still need
        // separate columns, and two adjacent naturals must not consume one.
        let accCount = 0;
        const drawn = heads.map((head, i) => {
          const hasAccidental = head.isSharp || head.isFlat;
          // Per-notehead hit/miss (rule 2), meaningful only while this entry
          // is under an active attempt; done/todo entries carry no verdict.
          const hit = active ? Boolean(activeNotes && activeNotes.has(head.midi)) : null;
          const noteState = state === 'active' ? (hit ? 'hit' : 'miss') : state;
          return {
            ...head,
            offset: offsets[i],
            hasAccidental,
            accStagger: hasAccidental ? accCount++ % 2 : 0,
            noteState,
          };
        });

        // The stem is ONE line shared by every notehead in the column, so a
        // mixed chord (some hit, some missed) cannot hand it a single hit/miss
        // colour without that colour reading as a verdict on the whole chord —
        // exactly what rule 2 forbids. Only a UNANIMOUS entry (all hit, or all
        // missed — which is also what a single-note ask always is) colours the
        // stem; a mixed chord leaves it the plain, no-verdict ink so each
        // notehead's own colour is free to speak for itself.
        const stemState =
          state === 'todo' ? 'todo'
          : state === 'active'
            ? (drawn.every((h) => h.noteState === 'hit') ? 'hit'
              : drawn.every((h) => h.noteState === 'miss') ? 'miss'
              : 'mixed')
            : 'done';

        const colX = FIRST_COLUMN_X + index * COLUMN_W;
        return { index, heads: drawn, colX, state, stemState, stemUp, stemLen: LINE_SPACING * stemLengthUnits(outerPos, dir) };
      }),
    [entries, activeClef, cursorIndex, activeNotes, attemptInProgress]
  );

  // Rule 3's "the target" is the CURSOR ENTRY's targets, not the whole
  // sequence — a held pitch that matches some OTHER entry (already played, or
  // still to come) is exactly as off-target right now as one that matches
  // nothing at all, because it is not what this entry is asking for.
  const cursorTargetMidis = useMemo(
    () => new Set(entries[cursorIndex]?.midis ?? []),
    [entries, cursorIndex]
  );

  const cursorColumn = columns.length
    ? Math.min(Math.max(cursorIndex, 0), columns.length - 1)
    : 0;
  const ghostX = FIRST_COLUMN_X + cursorColumn * COLUMN_W + GHOST_DX;

  // Rule 3: every currently-held pitch that is not one of the cursor entry's
  // targets is a ghost — "you are here", drawn at the pitch actually played.
  // Driven purely by `activeNotes` (never a remembered "last wrong note"), so
  // it is real-time by construction: a ghost exists exactly as long as its key
  // is down (rule 4) and vanishes on release with nothing left to clean up.
  // Unlike the resting-ink range this staff otherwise draws within, a ghost is
  // never clipped for being far off the target — the whole point is showing a
  // child how far off they are, ledger lines and all, however far that is.
  const heldGhosts = useMemo(() => {
    if (!attemptInProgress) return [];
    const ghosts = [];
    for (const [midi] of activeNotes) {
      if (cursorTargetMidis.has(midi)) continue;
      ghosts.push({ midi, ...getStaffPositionOnClef(midi, activeClef, accidental) });
    }
    return ghosts;
  }, [attemptInProgress, activeNotes, cursorTargetMidis, activeClef, accidental]);

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
              data-stem-state={col.stemState}
            >
              {col.heads.map((head, i) =>
                ledgerLineYs(head.position, BOTTOM_LINE_Y, STEP_SIZE).map((ly, li) => (
                  <line key={`ledger-${i}-${li}`} className="action-staff__ledger"
                    x1={col.colX - 14} y1={ly} x2={col.colX + 14} y2={ly}
                    stroke="rgba(0,0,0,1)" strokeWidth="1" />
                ))
              )}

              {/* The stem takes its colour from the group's `data-stem-state`
                  (done/todo/hit/miss/mixed — see the mixed-chord comment where
                  that is computed), never from a notehead class of its own. */}
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
                    {/* rule 1: full opacity in every one of done/todo/hit/miss —
                        the CSS for `sequence-note-*` never touches opacity,
                        only fill/stroke colour. */}
                    <ellipse
                      className={`action-staff__note sequence-note-${head.noteState}`}
                      data-midi={head.midi}
                      data-line-offset={head.position}
                      cx={noteX} cy={noteY} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY}
                      transform={`rotate(-12, ${noteX}, ${noteY})`}
                    />
                    {head.hasAccidental && (
                      <g
                        className={`action-staff__accidental action-staff__accidental--${head.noteState}`}
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

          {/* Rule 3: every held pitch that is not one of the CURSOR ENTRY's
              targets — "you are here", not a second verdict. Semi-opaque
              black, no stem, at the pitch actually played. Ledger lines
              included: a note off the staff is exactly the case where a child
              cannot tell how far off they are without them. Purely a function
              of `activeNotes`, so it is gone the instant the key is released —
              nothing here remembers a past mistake (rule 4). */}
          {heldGhosts.map((ghost) => (
            <g key={`ghost-${ghost.midi}`} className="sequence-staff__ghost">
              {ledgerLineYs(ghost.position, BOTTOM_LINE_Y, STEP_SIZE).map((ly, li) => (
                <line key={`ghost-ledger-${li}`} className="sequence-staff__ghost-ledger"
                  x1={ghostX - 14} y1={ly} x2={ghostX + 14} y2={ly}
                  stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
              ))}
              <ellipse
                className="sequence-note-wrong-ghost"
                data-midi={ghost.midi}
                data-line-offset={ghost.position}
                cx={ghostX} cy={yOf(ghost.position)} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY}
                transform={`rotate(-12, ${ghostX}, ${yOf(ghost.position)})`}
              />
              {(ghost.isSharp || ghost.isFlat) && (
                <g
                  className="sequence-staff__ghost-accidental"
                  data-kind={ghost.isSharp ? 'sharp' : 'flat'}
                  transform={`translate(${ghostX - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2}, ${yOf(ghost.position)})`}
                >
                  {ghost.isSharp ? <SharpShape /> : <FlatShape />}
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export default SvgSequenceStaff;
