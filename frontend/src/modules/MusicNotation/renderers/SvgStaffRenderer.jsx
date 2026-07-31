import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { getStaffPosition } from '../model/pitch.js';
import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';

// Accidental glyph box (viewBox units), centered on the notehead's y. Drawn as
// SVG shapes — never a Unicode <text>: font glyphs render thin, small, and
// with unpredictable metrics on the kiosk WebView, and overlapped the
// notehead. 26 units ≈ 1.9 staff spaces tall — reads as part of the note.
export const ACCIDENTAL_WIDTH = 11;
export const ACCIDENTAL_HEIGHT = 26;
// Clear air between the accidental's right edge and the notehead's left edge.
const ACCIDENTAL_GAP = 3;
const NOTEHEAD_RX = 9;

/** Engraved sharp: two verticals + two thick bars slanting up to the right. */
function SharpShape() {
  return (
    <>
      <line x1="-2.6" y1="-10.5" x2="-2.6" y2="13" stroke="currentColor" strokeWidth="2" />
      <line x1="2.6" y1="-13" x2="2.6" y2="10.5" stroke="currentColor" strokeWidth="2" />
      {/* Bars as filled parallelograms — the thick strokes that make the glyph read at a glance. */}
      <path d="M -5.5 -1.9 L 5.5 -4.9 L 5.5 -8.9 L -5.5 -5.9 Z" fill="currentColor" />
      <path d="M -5.5 6.6 L 5.5 3.6 L 5.5 -0.4 L -5.5 2.6 Z" fill="currentColor" />
    </>
  );
}

/** Engraved flat: tall stem + a bold solid bowl sitting on the notehead's line. */
function FlatShape() {
  return (
    <>
      <line x1="-4.5" y1="-13" x2="-4.5" y2="8.5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M -4.5 -4 C 4.5 -7.5, 8.5 2.5, -4.5 9.5 Z" fill="currentColor" />
    </>
  );
}

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
export function SvgStaffRenderer({ targetPitches = [], activeNotes = null, matched = false }) {
  const validPitches = targetPitches.filter((p) => p != null);

  const notePositions = useMemo(
    () => validPitches.map((pitch) => ({ pitch, ...getStaffPosition(pitch) })),
    [validPitches.join(',')]
  );

  // Determine clef from first note (all notes in a staff should share clef).
  const clef = notePositions[0]?.clef ?? 'treble';

  // Ghost notes: currently pressed notes at 50% opacity, excluding targets.
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

  // Staff geometry.
  const lineSpacing = 14;
  const topPad = lineSpacing * 2;
  const bottomLineY = topPad + lineSpacing * 4;
  const viewBoxH = bottomLineY + lineSpacing * 2;
  const staffLineYs = [0, 1, 2, 3, 4].map((i) => bottomLineY - i * lineSpacing);

  // Dynamically scale clef glyph to fit staff area via getBBox().
  const clefRef = useRef(null);
  const [clefTransform, setClefTransform] = useState('');
  const [clefReady, setClefReady] = useState(false);

  const targetW = lineSpacing * 3;
  const targetH = lineSpacing * 6;
  const targetX = 2;
  const targetY = bottomLineY - lineSpacing * 5;

  const measureClef = useCallback((node) => {
    if (!node) return;
    clefRef.current = node;
    try {
      const bbox = node.getBBox();
      if (bbox.width === 0 || bbox.height === 0) return;
      const scale = Math.min(targetW / bbox.width, targetH / bbox.height);
      const tx = targetX - bbox.x * scale;
      const ty = targetY - bbox.y * scale;
      setClefTransform(`translate(${tx}, ${ty}) scale(${scale})`);
      setClefReady(true);
    } catch (e) { /* getBBox can throw if not rendered */ }
  }, [targetW, targetH, targetX, targetY]);

  useEffect(() => {
    if (clefRef.current) measureClef(clefRef.current);
  }, [clef, measureClef]);

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
        <text
          ref={measureClef}
          fontSize="200"
          fill="rgba(0,0,0,0.5)"
          fontFamily="serif"
          transform={clefTransform}
          opacity={clefReady ? 1 : 0}
        >
          {clef === 'treble' ? '\u{1D11E}' : '\u{1D122}'}
        </text>

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

                const ledgerLines = [];
                if (np.position < 0) {
                  for (let p = -2; p >= np.position; p -= 2) {
                    ledgerLines.push(bottomLineY - p * stepSize);
                  }
                }
                if (np.position > 8) {
                  for (let p = 10; p <= np.position; p += 2) {
                    ledgerLines.push(bottomLineY - p * stepSize);
                  }
                }

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
