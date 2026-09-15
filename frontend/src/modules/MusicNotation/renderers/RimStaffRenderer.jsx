import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getStaffPosition, getStaffPositionOnClef } from '../model/pitch.js';
import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';
import { noteheadOffsets, accidentalColumns } from '../model/chordLayout.js';
import {
  ACCIDENTAL_WIDTH,
  ACCIDENTAL_HEIGHT,
  ACCIDENTAL_GAP,
  ACCIDENTAL_INK_LEFT,
  ACCIDENTAL_COLUMN_PITCH,
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  GHOST_INK,
  SharpShape,
  FlatShape,
  ledgerLineYs,
  ClefGlyph,
  CLEFS,
  CLEF_X,
} from './staffGlyphs.jsx';

/**
 * RimStaffRenderer — a note on a board's rim, drawn over only the range its axis
 * uses.
 *
 * SvgStaffRenderer draws every staff into one fixed 100×112 box: a full-size clef
 * takes a third of the width and two spaces of air above and below the staff
 * take half the height, because it cannot know what will be drawn on it. A rim
 * card can. Every card on one axis names one of a known set of shapes, so the
 * axis can be measured once — the lowest and highest ink any of its cards needs,
 * and the widest group — and every card drawn to exactly that box.
 *
 * What changes against the shared staff, and why:
 *   - The box fits the AXIS (`extent`), not a constant, and lines and notation
 *     scale together in one SVG, so there is no aspect ratio a host must match.
 *   - The card's measured shape widens the drawing to fill it: the clef sits at
 *     the card's left edge and the note is centred in the room after it, rather
 *     than the whole drawing floating in the middle of a wider card.
 *   - The clef is cue-size (3/4), the size notation uses for a clef that is not
 *     at the head of a system — or absent (`showClef={false}`) when the axis
 *     draws ONE clef at its head instead (`RimClef`), which is what a row of
 *     narrow cards needs: the clef was a third of every card's width.
 *   - Stems, by the shared rules (model/stems.js). The rim once dropped them for
 *     height; a stemless notehead reads as a whole note floating on the lines,
 *     and the stem is part of what a child recognises as "a note".
 *   - A held key beyond the drawn range is an arrow at that edge rather than a
 *     notehead off the card: still "you are below it", without the room.
 *
 * Every other rule is the shared one — clef from the first pitch, seconds across
 * the stem, accidental columns, ledger lines, ghost ink — so a note reads the same
 * here as on any other staff in the piano games.
 */

export const RIM_LINE_SPACING = 14;
const STEP = RIM_LINE_SPACING / 2;
export const RIM_CLEF_SCALE = 0.75;
const CLEF_GAP = 5;
/** Air before the group on a card with no clef of its own. */
const LEFT_AIR = 4;
const RIGHT_AIR = 4;
const LEDGER_HALF = 14;
/** Stem offset from the notehead column — the shared staff's own number. */
const STEM_DX = 8;
const STEM_WIDTH = 1.5;
/** Half a space beyond the outer lines, so a line never sits on the card edge. */
const STAFF_LO = -1;
const STAFF_HI = 9;
/** A notehead's reach, in steps: its ry (6.5) inside one step (7). */
const NOTE_REACH = 1;
const ACCIDENTAL_REACH = ACCIDENTAL_HEIGHT / 2 / STEP;
/** The shared staff's limit for a ghost that still says something. */
const GHOST_RANGE = Object.freeze([-3, 11]);

const INK = 'rgba(0,0,0,1)';
/** The shared matched ink (ActionStaff.scss `.action-staff__note--matched`). */
const MATCHED_INK = 'rgba(0,180,80,0.9)';

const pitchesOf = (token) => (Array.isArray(token) ? token : [token]).filter(Number.isFinite);

function pressedPitches(activeNotes) {
  if (!activeNotes) return [];
  if (Array.isArray(activeNotes)) return activeNotes;
  if (activeNotes instanceof Map || activeNotes instanceof Set) return [...activeNotes.keys()];
  return [];
}

const clefSpec = (clef) => CLEFS[clef === 'bass' ? 'bass' : 'treble'];

/** Right edge of the cue clef, in viewBox units. */
export function rimClefRight(clef) {
  return CLEF_X + clefSpec(clef).width * RIM_LINE_SPACING * RIM_CLEF_SCALE;
}

/** Where a card's group may start: after its clef, or near the edge when it has none. */
function rimLeadX(clef, showClef = true) {
  return showClef ? rimClefRight(clef) + CLEF_GAP : LEFT_AIR;
}

/** The cue clef's lowest and highest staff position. */
function clefSpan(clef) {
  const spec = clefSpec(clef);
  const anchor = spec.anchorSpacesAboveBottomLine * 2;
  return [anchor - spec.below * RIM_CLEF_SCALE * 2, anchor + spec.above * RIM_CLEF_SCALE * 2];
}

/** The clef an axis is read in: its first shape's, as on every card. */
// eslint-disable-next-line react-refresh/only-export-components -- rim geometry helpers live with the renderer that draws them (rimStaffExtent, layoutRimCard); a host needs the axis clef for the head card
export function rimAxisClef(tokens = [], { accidental } = {}) {
  const first = pitchesOf(tokens.find((token) => pitchesOf(token).length) ?? []);
  return first.length ? getStaffPosition(first[0], accidental).clef : 'treble';
}

/**
 * One card's layout: where its group sits and the box its ink needs.
 * Pure, so an axis can be measured without rendering it.
 *
 * @param {number[]} pitches
 * @param {'sharp'|'flat'} [accidental]
 * @param {{clef?: boolean}} [options] - `clef: false` for a card whose axis draws
 *   its clef once, at its head
 */
export function layoutRimCard(pitches, accidental, { clef: showClef = true } = {}) {
  const clef = pitches.length ? getStaffPosition(pitches[0], accidental).clef : 'treble';
  const placed = pitches.map((pitch) => ({ pitch, ...getStaffPositionOnClef(pitch, clef, accidental) }));
  const sorted = [...placed].sort((a, b) => a.position - b.position);
  let lo = STAFF_LO;
  let hi = STAFF_HI;
  if (showClef) {
    const [clefLo, clefHi] = clefSpan(clef);
    lo = Math.min(lo, clefLo);
    hi = Math.max(hi, clefHi);
  }
  const leadX = rimLeadX(clef, showClef);

  if (!sorted.length) {
    const baseX = leadX + NOTEHEAD_RX;
    return {
      clef, showClef, sorted, offsets: [], accDx: [], stem: null,
      leadX, inkLeft: -NOTEHEAD_RX, inkRight: NOTEHEAD_RX, baseX,
      width: baseX + NOTEHEAD_RX + RIGHT_AIR, lo, hi,
    };
  }

  const positions = sorted.map((np) => np.position);
  const direction = stemDirectionFor(positions);
  const offsets = noteheadOffsets(positions, direction)
    .map((column) => column * 2 * NOTEHEAD_RX);
  const accidentalColumn = accidentalColumns(
    sorted.flatMap((np, index) => (np.isSharp || np.isFlat ? [{ index, position: np.position }] : [])),
    ACCIDENTAL_HEIGHT / STEP,
  );
  const accDx = sorted.map((np, i) => {
    if (!accidentalColumn.has(i)) return null;
    const columnDx = Math.min(0, ...offsets) - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2;
    return columnDx - accidentalColumn.get(i) * ACCIDENTAL_COLUMN_PITCH;
  });
  const hasLedger = positions.some((position) => position <= -2 || position >= 10);

  const inkLeft = Math.min(
    ...offsets.map((offset) => offset - NOTEHEAD_RX),
    ...sorted.flatMap((np, i) => (accDx[i] === null
      ? []
      : [accDx[i] - ACCIDENTAL_INK_LEFT[np.isSharp ? 'sharp' : 'flat']])),
    ...(hasLedger ? [-LEDGER_HALF] : []),
  );
  const inkRight = Math.max(...offsets.map((offset) => offset + NOTEHEAD_RX), ...(hasLedger ? [LEDGER_HALF] : []));
  const baseX = leadX - inkLeft;

  sorted.forEach((np, i) => {
    const reach = accDx[i] === null ? NOTE_REACH : Math.max(NOTE_REACH, ACCIDENTAL_REACH);
    lo = Math.min(lo, np.position - reach);
    hi = Math.max(hi, np.position + reach);
  });

  // The outer notehead — the one the stem extends beyond — sets the length,
  // far-ledger extension included; the stem runs from the other end of the
  // group so a chord shares one stem.
  const up = direction === 'up';
  const outer = up ? positions[positions.length - 1] : positions[0];
  const stemSteps = stemLengthUnits(outer, direction) * 2;
  const stem = up
    ? { dx: STEM_DX, from: positions[0], to: outer + stemSteps }
    : { dx: -STEM_DX, from: positions[positions.length - 1], to: outer - stemSteps };
  lo = Math.min(lo, stem.to);
  hi = Math.max(hi, stem.to);

  return {
    clef, showClef, sorted, offsets, accDx, stem,
    leadX, inkLeft, inkRight, baseX, width: baseX + inkRight + RIGHT_AIR, lo, hi,
  };
}

/**
 * The box every card on one axis is drawn in: the union of their ranges and the
 * widest of their groups. Hand the same extent to every card on the axis, so the
 * staff is one size all the way along the rim.
 *
 * @param {Array<number|number[]>} tokens the notes (or shapes) the axis names
 * @param {{accidental?: 'sharp'|'flat', clef?: boolean}} [options]
 * @returns {{lo: number, hi: number, width: number}}
 */
export function rimStaffExtent(tokens = [], { accidental, clef = true } = {}) {
  const cards = (tokens.length ? tokens : [[]])
    .map((token) => layoutRimCard(pitchesOf(token), accidental, { clef }));
  return {
    lo: Math.min(...cards.map((card) => card.lo)),
    hi: Math.max(...cards.map((card) => card.hi)),
    width: Math.max(...cards.map((card) => card.width)),
  };
}

/**
 * The drawn box's width-to-height ratio, rounded DOWN so a viewBox built from it
 * is never wider than the box: the height always binds, and every card of one
 * height scales identically — which is what keeps a head clef's lines level with
 * the cards beside it.
 */
function useBoxAspect(ref) {
  const [aspect, setAspect] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const next = Math.floor((width / height) * 100) / 100;
      setAspect((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return aspect;
}

function StaffLines({ yOf, width }) {
  return [0, 2, 4, 6, 8].map((position) => (
    <line
      key={position}
      className="action-staff__line"
      x1={-2000}
      x2={width + 2000}
      y1={yOf(position)}
      y2={yOf(position)}
      stroke={INK}
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    />
  ));
}

export function RimStaffRenderer({
  targetPitches = [], activeNotes = null, matched = false, accidental = undefined, extent = null, showClef = true,
}) {
  const pitches = targetPitches.filter(Number.isFinite);
  // Joined as a value key: hosts pass a fresh array literal every render.
  const pitchKey = pitches.join(',');
  const card = useMemo(
    () => layoutRimCard(pitches, accidental, { clef: showClef }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pitchKey, accidental, showClef],
  );
  const { lo, hi, width: minWidth } = extent ?? card;
  const height = (hi - lo) * STEP;
  const bottomLineY = hi * STEP;
  const yOf = (position) => bottomLineY - position * STEP;

  const svgRef = useRef(null);
  const aspect = useBoxAspect(svgRef);
  const width = aspect ? Math.max(minWidth, height * aspect) : minWidth;
  // Centred in the room after the clef (or across the card, with no clef).
  const room = width - RIGHT_AIR - card.leadX;
  const baseX = card.baseX + Math.max(0, (room - (card.inkRight - card.inkLeft)) / 2);

  const pressed = pressedPitches(activeNotes);
  const pressedKey = pressed.join(',');
  const { ghosts, beyond } = useMemo(() => {
    const targets = new Set(pitches);
    const found = [];
    const edges = { above: false, below: false };
    for (const pitch of pressed) {
      if (targets.has(pitch)) continue;
      const { position } = getStaffPositionOnClef(pitch, card.clef, accidental);
      if (position < GHOST_RANGE[0] || position > GHOST_RANGE[1]) continue;
      if (position - NOTE_REACH < lo) edges.below = true;
      else if (position + NOTE_REACH > hi) edges.above = true;
      else found.push({ pitch, position });
    }
    found.sort((a, b) => a.position - b.position);
    const columns = noteheadOffsets(found.map((ghost) => ghost.position), 'up');
    return { ghosts: found.map((ghost, i) => ({ ...ghost, column: columns[i] })), beyond: edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressedKey, pitchKey, card, accidental, lo, hi]);

  const anchor = clefSpec(card.clef).anchorSpacesAboveBottomLine;
  const cueSpacing = RIM_LINE_SPACING * RIM_CLEF_SCALE;
  // ClefGlyph hangs its clef off a bottom line at its own spacing; shift that
  // line so the clef's anchor still lands on the real staff's G or F line.
  const clefBottomLineY = bottomLineY - anchor * RIM_LINE_SPACING + anchor * cueSpacing;
  const ink = matched ? MATCHED_INK : INK;

  return (
    <svg
      ref={svgRef}
      className="action-staff__rim-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMinYMid meet"
      data-clef={card.clef}
      data-show-clef={showClef ? undefined : 'false'}
      aria-hidden="true"
      focusable="false"
    >
      <StaffLines yOf={yOf} width={width} />

      {showClef && <ClefGlyph clef={card.clef} lineSpacing={cueSpacing} bottomLineY={clefBottomLineY} />}

      {card.stem && (
        <line
          className={`action-staff__stem${matched ? ' action-staff__stem--matched' : ''}`}
          x1={baseX + card.stem.dx}
          x2={baseX + card.stem.dx}
          y1={yOf(card.stem.from)}
          y2={yOf(card.stem.to)}
          stroke={ink}
          strokeWidth={STEM_WIDTH}
        />
      )}

      {card.sorted.map((np, i) => {
        const noteY = yOf(np.position);
        const noteX = baseX + card.offsets[i];
        return (
          <g key={np.pitch}>
            {ledgerLineYs(np.position, bottomLineY, STEP).map((ly, li) => (
              <line
                key={`ledger-${li}`}
                x1={baseX - LEDGER_HALF}
                x2={baseX + LEDGER_HALF}
                y1={ly}
                y2={ly}
                stroke={INK}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <ellipse
              cx={noteX}
              cy={noteY}
              rx={NOTEHEAD_RX}
              ry={NOTEHEAD_RY}
              className={`action-staff__note${matched ? ' action-staff__note--matched' : ''}`}
              transform={`rotate(-12, ${noteX}, ${noteY})`}
            />
            {card.accDx[i] !== null && (
              <g
                className={`action-staff__accidental${matched ? ' action-staff__accidental--matched' : ''}`}
                data-kind={np.isSharp ? 'sharp' : 'flat'}
                transform={`translate(${baseX + card.accDx[i]}, ${noteY})`}
              >
                {np.isSharp ? <SharpShape /> : <FlatShape />}
              </g>
            )}
          </g>
        );
      })}

      {ghosts.map((ghost) => {
        const noteY = yOf(ghost.position);
        const noteX = baseX + ghost.column * 2 * NOTEHEAD_RX;
        return (
          <g key={`ghost-${ghost.pitch}`} className="action-staff__ghost">
            {ledgerLineYs(ghost.position, bottomLineY, STEP).map((ly, li) => (
              <line key={`ghost-ledger-${li}`} x1={baseX - LEDGER_HALF} x2={baseX + LEDGER_HALF} y1={ly} y2={ly} {...GHOST_INK.ledger} />
            ))}
            <ellipse cx={noteX} cy={noteY} rx={NOTEHEAD_RX} ry={NOTEHEAD_RY} transform={`rotate(-12, ${noteX}, ${noteY})`} {...GHOST_INK.head} />
          </g>
        );
      })}

      {beyond.above && (
        <path
          className="action-staff__ghost action-staff__ghost--beyond"
          data-direction="above"
          d={`M ${baseX - 7} 9 L ${baseX + 7} 9 L ${baseX} 1 Z`}
          {...GHOST_INK.head}
        />
      )}
      {beyond.below && (
        <path
          className="action-staff__ghost action-staff__ghost--beyond"
          data-direction="below"
          d={`M ${baseX - 7} ${height - 9} L ${baseX + 7} ${height - 9} L ${baseX} ${height - 1} Z`}
          {...GHOST_INK.head}
        />
      )}
    </svg>
  );
}

/**
 * The head of a rim axis: its clef, drawn once, on staff lines at exactly the
 * height and scale of the cards beside it (same `extent`, same card height), so
 * the row reads as one staff with one clef. A full-size clef — this one IS at
 * the head of the system — shrunk only as far as the axis's range needs to hold
 * it, and set against the right edge, next to the first card.
 *
 * @param {'treble'|'bass'} clef
 * @param {{lo: number, hi: number}} extent the axis extent its cards use
 */
export function RimClef({ clef = 'treble', extent }) {
  const { lo, hi } = extent;
  const spec = clefSpec(clef);
  const height = (hi - lo) * STEP;
  const bottomLineY = hi * STEP;
  const yOf = (position) => bottomLineY - position * STEP;
  const anchorPos = spec.anchorSpacesAboveBottomLine * 2;
  const scale = Math.min(
    1,
    (hi - anchorPos) / (spec.above * 2),
    (anchorPos - lo) / (spec.below * 2),
  );
  const spacing = RIM_LINE_SPACING * scale;
  const clefW = spec.width * spacing;
  const minWidth = CLEF_X + clefW + RIGHT_AIR;

  const svgRef = useRef(null);
  const aspect = useBoxAspect(svgRef);
  const width = aspect ? Math.max(minWidth, height * aspect) : minWidth;
  // ClefGlyph draws at CLEF_X; move it so its right edge sits RIGHT_AIR from ours.
  const dx = width - RIGHT_AIR - clefW - CLEF_X;
  const clefBottomLineY = bottomLineY - spec.anchorSpacesAboveBottomLine * (RIM_LINE_SPACING - spacing);

  return (
    <svg
      ref={svgRef}
      className="action-staff__rim-svg action-staff__rim-clef"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMaxYMid meet"
      data-clef={clef}
      aria-hidden="true"
      focusable="false"
    >
      <StaffLines yOf={yOf} width={width} />
      <g transform={`translate(${dx}, 0)`}>
        <ClefGlyph clef={clef} lineSpacing={spacing} bottomLineY={clefBottomLineY} />
      </g>
    </svg>
  );
}

export default RimStaffRenderer;
