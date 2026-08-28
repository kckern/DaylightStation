import { useMemo } from 'react';
import { getStaffPosition } from '../model/pitch.js';
import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';
import {
  ACCIDENTAL_WIDTH,
  ACCIDENTAL_GAP,
  NOTEHEAD_RX,
  SharpShape,
  FlatShape,
  ledgerLineYs,
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
 * @param {Map|null} activeNotes - currently pressed notes (shown as ghosts)
 * @param {boolean} matched - whether the player is currently matching
 */
/**
 * Width-to-height ratio a host box must have for the noteheads to sit on the
 * staff lines. See the geometry note inside the component.
 */
export const STAFF_ASPECT = 100 / 112;

export function SvgStaffRenderer({ targetPitches = [], activeNotes = null, matched = false }) {
  const validPitches = targetPitches.filter((p) => p != null);

  // validPitches.join(',') is a deliberate value-key: a stable string proxy for array
  // *content*, avoiding recompute on every render when targetPitches is a fresh array literal.
  const notePositions = useMemo(
    () => validPitches.map((pitch) => ({ pitch, ...getStaffPosition(pitch) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validPitches.join(',')]
  );

  // Determine clef from first note (all notes in a staff should share clef).
  const clef = notePositions[0]?.clef ?? 'treble';

  // Ghost notes: currently pressed notes at 50% opacity, excluding targets.
  // validPitches.join(',') is a deliberate value-key: a stable string proxy for array
  // *content*, avoiding recompute on every render when targetPitches is a fresh array literal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targetSet = useMemo(() => new Set(validPitches), [validPitches.join(',')]);
  const ghostNotes = useMemo(() => {
    if (!activeNotes || activeNotes.size === 0) return [];
    const ghosts = [];
    for (const [pitch] of activeNotes) {
      if (targetSet.has(pitch)) continue;
      const pos = getStaffPosition(pitch);
      if (pos.position < -3 || pos.position > 11) continue;
      ghosts.push({ pitch, ...pos });
    }
    return ghosts;
  }, [activeNotes, targetSet]);

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
  const staffLineYs = [0, 1, 2, 3, 4].map((i) => bottomLineY - i * lineSpacing);

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

        {(() => {
          if (notePositions.length === 0) return null;

          const stepSize = lineSpacing / 2;
          const baseX = 65;

          const sorted = [...notePositions].sort((a, b) => a.position - b.position);
          // Shared engraving rules (model/stems.js): the notehead farthest from
          // the middle line decides the group; the outer notehead (the one the
          // stem extends beyond) sets the length, far-ledger extension included.
          const dir = stemDirectionFor(sorted.map((n) => n.position));
          const stemUp = dir === 'up';
          const outerPos = stemUp ? sorted[sorted.length - 1].position : sorted[0].position;

          const noteYs = sorted.map((np) => bottomLineY - np.position * stepSize);

          const stemLen = lineSpacing * stemLengthUnits(outerPos, dir);
          const stemX = stemUp ? baseX + 8 : baseX - 8;
          const stemTop = stemUp ? Math.min(...noteYs) - stemLen : Math.min(...noteYs);
          const stemBottom = stemUp ? Math.max(...noteYs) : Math.max(...noteYs) + stemLen;

          const offsets = sorted.map(() => 0);
          for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].position - sorted[i - 1].position;
            if (gap <= 1) {
              if (stemUp) offsets[i - 1] = -18;
              else offsets[i] = 18;
            }
          }

          let sharpIdx = 0;

          return (
            <g>
              <line x1={stemX} y1={stemTop} x2={stemX} y2={stemBottom}
                className={`action-staff__stem${matched ? ' action-staff__stem--matched' : ''}`}
              />

              {sorted.map((np, i) => {
                const noteY = noteYs[i];
                const noteX = baseX + offsets[i];

                const ledgerLines = ledgerLineYs(np.position, bottomLineY, stepSize);

                // Accidental column: left of ALL noteheads in the chord, with
                // guaranteed air before the leftmost head; chords stagger
                // alternate accidentals one column further left.
                const hasAccidental = np.isSharp || np.isFlat;
                const accColX = Math.min(baseX, noteX) - NOTEHEAD_RX - ACCIDENTAL_GAP - ACCIDENTAL_WIDTH / 2;
                const accX = hasAccidental ? accColX - (sharpIdx++ % 2) * (ACCIDENTAL_WIDTH + 2) : 0;

                return (
                  <g key={np.pitch}>
                    {ledgerLines.map((ly, li) => (
                      <line key={`ledger-${li}`} x1={baseX - 14} y1={ly} x2={baseX + 14} y2={ly}
                        stroke="rgba(0,0,0,1)" strokeWidth="1" />
                    ))}
                    <ellipse cx={noteX} cy={noteY} rx="9" ry="6.5"
                      className={`action-staff__note${matched ? ' action-staff__note--matched' : ''}`}
                      transform={`rotate(-12, ${noteX}, ${noteY})`}
                    />
                    {hasAccidental && (
                      <g
                        className={`action-staff__accidental${matched ? ' action-staff__accidental--matched' : ''}`}
                        data-kind={np.isSharp ? 'sharp' : 'flat'}
                        transform={`translate(${accX}, ${noteY})`}
                      >
                        {np.isSharp ? <SharpShape /> : <FlatShape />}
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Ghost notes — currently pressed notes at 50% opacity for reference */}
        {ghostNotes.map((gn) => {
          const stepSize = lineSpacing / 2;
          const noteY = bottomLineY - gn.position * stepSize;
          const noteX = 65;
          return (
            <ellipse key={`ghost-${gn.pitch}`} cx={noteX} cy={noteY} rx="9" ry="6.5"
              fill="rgba(0,0,0,0.15)" stroke="rgba(0,0,0,0.1)" strokeWidth="0.5"
              transform={`rotate(-12, ${noteX}, ${noteY})`}
              opacity="0.5"
            />
          );
        })}
      </svg>
    </div>
  );
}

export default SvgStaffRenderer;
