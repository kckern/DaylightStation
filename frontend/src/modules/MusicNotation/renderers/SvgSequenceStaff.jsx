import { useEffect, useMemo, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { classifyHeldPitch, partitionHeldPitches } from '../model/heldPitch.js';
import { getStaffPositionOnClef } from '../model/pitch.js';
import { inkForHead, keySignatureMarks, keySignatureSpec } from '../model/keySignatureLayout.js';

// Re-exported so this renderer's own suite can assert the rule it draws by.
export { classifyHeldPitch };
import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';
import { noteheadOffsets, accidentalColumns } from '../model/chordLayout.js';
import {
  ACCIDENTAL_WIDTH,
  ACCIDENTAL_HEIGHT,
  ACCIDENTAL_GAP,
  ACCIDENTAL_COLUMN_PITCH,
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  GHOST_INK,
  SharpShape,
  FlatShape,
  NaturalShape,
  ledgerLineYs,
  ClefGlyph,
  clefRightEdge,
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
 * @param {number} cursorIndex - entries before it are done and draw BROWN, this
 *   entry is the black cursor target, and entries after it are black too —
 *   unless an attempt is in progress at the cursor (see `activeNotes`).
 * @param {Map|null} activeNotes - currently held keys. This is the ONLY signal
 *   the run-state colouring reads:
 *     - opacity never encodes run state — every notehead is drawn at full
 *       opacity always; the visual weight difference between "played" and
 *       "to play" is a COLOUR (brown vs. jet black), never a fade;
 *     - the run reads left to right as brown behind you, black ahead of you —
 *       the same direction the ABC exercise stage and the engraved score use.
 *       With nothing held, the cursor entry stays black along with the music
 *       ahead of it; the yellow cursor lane is what marks where you are;
 *     - the moment any key is held, the cursor entry's own noteheads colour
 *       per NOTE, not as a group: a target pitch being held is green, a
 *       target pitch not being held is red — a partially-played chord is not
 *       a verdict on the whole chord;
 *     - a held pitch that is not one of the cursor entry's targets, AND was
 *       pressed after the cursor reached this entry, draws as a ghost at the
 *       pitch actually played, semi-opaque black, no stem — "you are here",
 *       not a second verdict. A key that was ALREADY DOWN when the cursor
 *       arrived is a sustain, not a mistake, and draws nothing — see
 *       `classifyHeldPitch`;
 *     - all of it is keyed to the CURRENTLY held set, so it clears the instant
 *       a key is released — nothing here remembers a past mistake.
 * @param {'treble'|'bass'|null} clef - explicit clef; omit to derive from the majority pitch.
 * @param {'sharp'|'flat'} accidental - default spelling for black keys (per-note overridable).
 * @param {string|null} keySignature - a major key to stand after the clef
 *   (`'D'`, `'Bb'`). A sharp or flat the signature carries is not drawn beside
 *   its note again; a natural on a letter the signature alters gets a natural
 *   sign. Null — the default — draws every accidental beside its note, which is
 *   what a child who has not met key signatures yet should see.
 */

// ── Geometry (viewBox units) ─────────────────────────────────────────────────
// Note SIZE matches SvgStaffRenderer exactly — same line spacing, same notehead
// — so a note is the same note on both surfaces; only the horizontal extent and
// the vertical PADDING are this component's own.
const LINE_SPACING = 14;
/**
 * Room beyond each staff edge, and why it is not two line-spacings.
 *
 * Two ledger lines is the range the asks on this surface actually use: a
 * flashcard deck is dealt from the white keys C4..C6, and on a treble staff
 * that is two ledger positions below (middle C) and two above (C6). Padding of
 * exactly `LINE_SPACING * 2` puts the CENTRE of those noteheads on the very
 * edge of the box — so middle C kept half a head and its whole ledger line
 * outside the cursor lane, and C6 lost the top of its head to the viewport
 * itself. A notehead has a radius, and the box has to be told about it.
 */
const LEDGER_ROOM = LINE_SPACING * 2;
const INK_PAD = LEDGER_ROOM + NOTEHEAD_RY + 3.5;
const TOP_PAD = INK_PAD;
const BOTTOM_LINE_Y = TOP_PAD + LINE_SPACING * 4;
const VIEWBOX_H = BOTTOM_LINE_Y + INK_PAD;
const STEP_SIZE = LINE_SPACING / 2;
/** Left edge of the first notehead column — clear of the clef and its accidental gutter. */
const FIRST_COLUMN_X = 64;
/**
 * A key signature stands between the clef and the first column and pushes the
 * music right by its own width: one glyph column per sharp or flat, plus a
 * gutter before the first note. Tighter than the per-note accidental pitch —
 * signature glyphs stagger by height and never share a letter, so their boxes
 * may overlap the way printed ones do.
 */
const SIGNATURE_PITCH = 10;
const SIGNATURE_GUTTER = 6;
export function keySignatureWidth(keySignature) {
  const spec = keySignatureSpec(keySignature);
  return spec ? spec.count * SIGNATURE_PITCH + SIGNATURE_GUTTER : 0;
}
/**
 * Column pitch. A notehead is 18 wide and its accidental another 14 with air,
 * so 36 is the narrowest spacing at which an accidental never touches the
 * previous column's head — which is what keeps a Db major scale legible.
 */
const COLUMN_W = 36;
/** How far right of the cursor column a ghost stands: clear of the target, still in the same beat. */
const GHOST_DX = 16;
/** Air between the cursor lane and the edge of the box, so it reads as a lane and not a wall. */
const CURSOR_INSET = 2;

/**
 * A staff position to a y. Module scope, not a render closure: it reads nothing
 * but the constants above, and the cursor band below is computed before the
 * render body would have defined it.
 */
const yOf = (position) => BOTTOM_LINE_Y - position * STEP_SIZE;
const RIGHT_PAD = 30;
const MIN_VIEWBOX_W = 100;

/**
 * The viewBox a sequence of `entryCount` columns needs. Exported so a host can
 * size its box to the same aspect — the staff lines stretch to fill while the
 * notation scales uniformly and centres, so the two only agree at this ratio
 * (the STAFF_ASPECT lesson from SvgStaffRenderer).
 */
export function sequenceStaffViewBox(entryCount = 0, { keySignature = null } = {}) {
  const width = Math.max(
    MIN_VIEWBOX_W,
    FIRST_COLUMN_X + keySignatureWidth(keySignature) + Math.max(0, entryCount - 1) * COLUMN_W + RIGHT_PAD
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
  keySignature = null,
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

  // The signature, and where the first column lands because of it. Every x
  // below that used to start at FIRST_COLUMN_X starts here instead, so the
  // cursor, the columns and the ghost all move together.
  const signature = useMemo(() => keySignatureMarks(keySignature, activeClef), [keySignature, activeClef]);
  const firstColumnX = FIRST_COLUMN_X + keySignatureWidth(keySignature);
  const signatureX = clefRightEdge(LINE_SPACING, activeClef) + ACCIDENTAL_WIDTH / 2 + 2;

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
        // the same rule the single-simultaneity renderer uses, and now literally
        // the same code (model/chordLayout.js). Both renderers had their own
        // copy and both copies displaced the head to the side the stem ISN'T.
        const offsets = noteheadOffsets(heads.map((h) => h.position), dir)
          .map((column) => column * 2 * NOTEHEAD_RX);

        // Run state, rule 1 + 5: opacity NEVER carries this — every notehead
        // renders at full opacity regardless of state, so the only thing that
        // changes below is colour. `done` (before the cursor), `current` (the
        // resting cursor), and `todo` (after it) are ENTRY-level: every head
        // in the column
        // shares one treatment. `active` — the cursor entry mid-attempt — is
        // the one case colour is decided per notehead, not per entry: a
        // three-note chord with two pitches held and one not is two greens
        // and a red, never a single verdict for the column.
        const isCursor = index === cursorIndex;
        const active = isCursor && attemptInProgress;
        const state = index < cursorIndex ? 'done' : active ? 'active' : isCursor ? 'current' : 'todo';

        // Accidentals take a column of their own only when a neighbour would
        // otherwise be drawn through them: the glyph is nearly two staff spaces
        // tall, so a third apart collides and a fifth apart does not. Counting
        // accidentals and alternating pushed clear ones needlessly outward,
        // which on a narrow staff is what ran them into the clef.
        const accidentalColumn = accidentalColumns(
          heads.flatMap((head, index2) => (
            head.isSharp || head.isFlat ? [{ index: index2, position: head.position }] : []
          )),
          ACCIDENTAL_HEIGHT / STEP_SIZE,
        );
        const drawn = heads.map((head, i) => {
          // Under a signature a covered sharp or flat is not drawn again, and a
          // natural on an altered letter gets a natural sign; without one this
          // is exactly the sharp-or-flat the head was spelled with.
          const ink = inkForHead(head, keySignature, activeClef);
          const hasAccidental = ink !== null;
          // Per-notehead hit/miss (rule 2), meaningful only while this entry
          // is under an active attempt; done/todo entries carry no verdict.
          const hit = active ? Boolean(activeNotes && activeNotes.has(head.midi)) : null;
          const noteState = state === 'active' ? (hit ? 'hit' : 'miss') : state;
          return {
            ...head,
            ink,
            offset: offsets[i],
            hasAccidental,
            accStagger: hasAccidental ? accidentalColumn.get(i) : 0,
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
        //
        // `current` gets its own value rather than folding into `done`: since
        // `done` is the brown "already played" ink, a resting cursor sharing it
        // would hang a brown stem under a black notehead.
        const stemState =
          state === 'todo' || state === 'current' ? state
          : state === 'active'
            ? (drawn.every((h) => h.noteState === 'hit') ? 'hit'
              : drawn.every((h) => h.noteState === 'miss') ? 'miss'
              : 'mixed')
            : 'done';

        const colX = firstColumnX + index * COLUMN_W;
        return { index, heads: drawn, colX, state, stemState, stemUp, stemLen: LINE_SPACING * stemLengthUnits(outerPos, dir) };
      }),
    [entries, activeClef, cursorIndex, activeNotes, attemptInProgress, keySignature, firstColumnX]
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
  const ghostX = firstColumnX + cursorColumn * COLUMN_W + GHOST_DX;

  // Rule 3: every currently-held pitch that is not one of the cursor entry's
  // targets is a ghost — "you are here", drawn at the pitch actually played.
  // Driven purely by `activeNotes` (never a remembered "last wrong note"), so
  // it is real-time by construction: a ghost exists exactly as long as its key
  // is down (rule 4) and vanishes on release with nothing left to clean up.
  // Unlike the resting-ink range this staff otherwise draws within, a ghost is
  // never clipped for being far off the target — the whole point is showing a
  // child how far off they are, ledger lines and all, however far that is.
  /**
   * WHEN THE CURSOR ARRIVED HERE — the other half of `classifyHeldPitch`.
   *
   * Kept in a ref and stamped during render rather than from an effect: the
   * ghosts below are computed in the same pass, and an effect would stamp the
   * arrival one commit LATE, which is exactly one frame of every key still
   * being classified against the previous entry's arrival — the bug, one frame
   * smaller. The ref is written only when the index actually changes, so a
   * re-render for any other reason (a key going down, a parent tick) does not
   * move the clock and silently turn a real ghost into a sustain.
   */
  const cursorArrivalRef = useRef({ index: null, at: 0 });
  if (cursorArrivalRef.current.index !== cursorIndex) {
    cursorArrivalRef.current = { index: cursorIndex, at: Date.now() };
  }
  const cursorArrivedAt = cursorArrivalRef.current.at;

  /**
   * Ghosts are DRAWN; sustains are only logged. Keeping both is what lets the
   * log store prove that a ghost which did not appear was an afterglow, rather
   * than an accusation we quietly dropped.
   */
  const { heldGhosts, heldSustains } = useMemo(() => {
    if (!attemptInProgress) return { heldGhosts: [], heldSustains: [] };
    const { ghosts, sustains } = partitionHeldPitches(activeNotes, {
      cursorArrivedAt, cursorTargets: cursorTargetMidis,
    });
    return {
      heldGhosts: ghosts.map((g) => {
        const head = getStaffPositionOnClef(g.midi, activeClef, accidental);
        return { ...g, ...head, ink: inkForHead(head, keySignature, activeClef) };
      }),
      heldSustains: sustains,
    };
  }, [attemptInProgress, activeNotes, cursorTargetMidis, cursorArrivedAt, activeClef, accidental, keySignature]);

  /**
   * INDEPENDENT TIMESTAMPS FOR THE GHOST AND FOR THE KEY.
   *
   * The question this exists to answer is the one that could not be answered
   * from the logs when a child reported ghost notes on a perfect scale: was
   * that ghost something they PLAYED, or the tail of the note before it? Held
   * sets alone cannot say — `piano.exercise-midi-state` shows `[60,62]` and
   * nothing in it distinguishes "still releasing 60" from "just pressed 60".
   *
   * So each event carries three clocks and the interval between two of them:
   * when the key went down (`pressedAt`, from the MIDI layer), when the cursor
   * reached this entry (`cursorArrivedAt`), and when the staff drew it (`at`).
   * `sinceCursorMs` is the decisive number — negative is impossible for a
   * ghost by construction, and a value in the low tens of milliseconds is a
   * legato overlap being correctly classified rather than accused.
   *
   * Logged on APPEARANCE, not per render: a ghost lives as long as its key is
   * held, which at 60fps would otherwise be sixty identical lines a second.
   * `sampled` is the second belt — this ships from kiosks over a WebSocket, and
   * a child mashing keys must not be able to flood the store.
   */
  const loggerRef = useRef(null);
  if (!loggerRef.current) loggerRef.current = getLogger().child({ component: 'sequence-staff' });
  const reportedRef = useRef({ ghosts: new Set(), sustains: new Set() });
  useEffect(() => {
    const at = Date.now();
    const seen = reportedRef.current;
    const emit = (kind, key, entries) => {
      const live = new Set(entries.map((e) => `${cursorIndex}:${e.midi}`));
      for (const entry of entries) {
        const id = `${cursorIndex}:${entry.midi}`;
        if (seen[key].has(id)) continue;
        seen[key].add(id);
        const payload = {
          midi: entry.midi,
          at,
          pressedAt: entry.pressedAt,
          cursorArrivedAt,
          // How long after the cursor got here the key went down. This one
          // number separates a mistake from an afterglow.
          sinceCursorMs: Number.isFinite(entry.pressedAt) ? entry.pressedAt - cursorArrivedAt : null,
          cursorIndex,
          targets: [...cursorTargetMidis],
        };
        // TELEMETRY MAY NOT TAKE DOWN THE STAGE. `sampled` is the right call
        // here — this ships from kiosks over a WebSocket and a child mashing
        // keys must not flood the store — but a logger that does not have it
        // must degrade to a plain line, and a logger that throws must cost
        // nothing at all. A child's practice does not stop because a log line
        // could not be written.
        try {
          const log = loggerRef.current;
          if (typeof log?.sampled === 'function') {
            log.sampled(`staff.${kind}`, payload, { maxPerMinute: 60, aggregate: true });
          } else if (typeof log?.info === 'function') {
            log.info(`staff.${kind}`, payload);
          }
        } catch { /* never */ }
      }
      // Forget anything no longer held so the same pitch can be reported again
      // if it is pressed again at this same cursor.
      for (const id of [...seen[key]]) if (!live.has(id)) seen[key].delete(id);
    };
    emit('ghost', 'ghosts', heldGhosts);
    emit('sustain', 'sustains', heldSustains);
  }, [heldGhosts, heldSustains, cursorIndex, cursorArrivedAt, cursorTargetMidis]);

  /**
   * The band the cursor lane covers: the staff, plus however far this ask's own
   * ink actually reaches beyond it.
   *
   * Not the whole box. A lane sized to the full ink band always contains its
   * note — which is the bug this started as, middle C hanging out of the bottom
   * of a lane that stopped at its centre — but on a one-card flashcard it is a
   * full-height yellow column behind a single notehead, marking a position that
   * has no alternative. Measured from the drawn columns instead, so it hugs the
   * music: a deck of staff-range cards gets a lane the height of the staff, and
   * a middle-C or a C6 card gets exactly enough more to hold the head and its
   * ledger line. Constant for the whole ask, so the lane slides sideways as the
   * cursor advances and never changes shape underneath it.
   */
  const cursorBand = useMemo(() => {
    const ys = columns.flatMap((col) => col.heads.map((head) => yOf(head.position)));
    const clearance = NOTEHEAD_RY + 4;
    const top = Math.max(CURSOR_INSET, Math.min(TOP_PAD, ...ys.map((y) => y - clearance)));
    const bottom = Math.min(VIEWBOX_H - CURSOR_INSET, Math.max(BOTTOM_LINE_Y, ...ys.map((y) => y + clearance)));
    return { y: top, height: Math.max(0, bottom - top) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  const { width: viewBoxW } = sequenceStaffViewBox(columns.length, { keySignature });
  const viewBox = `0 0 ${viewBoxW} ${VIEWBOX_H}`;
  const staffLineYs = [0, 1, 2, 3, 4].map((i) => BOTTOM_LINE_Y - i * LINE_SPACING);
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

          {/* The key signature, after the clef and before the music, in the
              printed order and on the printed lines. Same glyphs as the
              per-note accidentals, drawn once here instead of beside every
              note they cover — which is the whole lesson a key signature is. */}
          {signature.length > 0 && (
            <g className="sequence-staff__signature" data-key={keySignature}>
              {signature.map((mark, i) => (
                <g
                  key={`${mark.letter}-${i}`}
                  className="action-staff__signature-mark"
                  data-kind={mark.kind}
                  data-letter={mark.letter}
                  data-line-offset={mark.position}
                  transform={`translate(${signatureX + i * SIGNATURE_PITCH}, ${yOf(mark.position)})`}
                >
                  {mark.kind === 'sharp' ? <SharpShape /> : <FlatShape />}
                </g>
              ))}
            </g>
          )}

          {/* THE LANE SPANS THE WHOLE INK BAND, not the staff.

              A cursor sized to the five lines plus one spacing either side ends
              at y = BOTTOM_LINE_Y + LINE_SPACING, which is exactly where middle
              C's notehead CENTRE sits — so the note the lane exists to mark hung
              out of the bottom of it, ledger line and all, on one of the
              commonest cards a reading deck deals. The band the engraver can
              draw ink in is what has to be covered, and that band is the box
              (see INK_PAD). */}
          {showCursor && (
            <rect
              className="sequence-staff__cursor"
              data-cursor-index={cursorIndex}
              x={firstColumnX + cursorIndex * COLUMN_W - COLUMN_W / 2}
              y={cursorBand.y}
              width={COLUMN_W}
              height={cursorBand.height}
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
                // and one column further out only when a neighbour would
                // otherwise be drawn through it (see chordLayout). The pitch is
                // the shared one, so this staff and the single-simultaneity one
                // space their accidentals identically — the whole reason these
                // primitives are shared rather than copied.
                const accX =
                  Math.min(col.colX, noteX) - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2
                  - head.accStagger * ACCIDENTAL_COLUMN_PITCH;
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
                        data-kind={head.ink}
                        transform={`translate(${accX}, ${noteY})`}
                      >
                        {head.ink === 'sharp' ? <SharpShape /> : head.ink === 'flat' ? <FlatShape /> : <NaturalShape />}
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
                  {...GHOST_INK.ledger} />
              ))}
              <ellipse
                className="sequence-note-wrong-ghost"
                data-midi={ghost.midi}
                data-line-offset={ghost.position}
                cx={ghostX} cy={yOf(ghost.position)} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY}
                transform={`rotate(-12, ${ghostX}, ${yOf(ghost.position)})`}
                {...GHOST_INK.head}
              />
              {ghost.ink && (
                <g
                  className="sequence-staff__ghost-accidental"
                  color={GHOST_INK.accidental}
                  data-kind={ghost.ink}
                  transform={`translate(${ghostX - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2}, ${yOf(ghost.position)})`}
                >
                  {ghost.ink === 'sharp' ? <SharpShape /> : ghost.ink === 'flat' ? <FlatShape /> : <NaturalShape />}
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
