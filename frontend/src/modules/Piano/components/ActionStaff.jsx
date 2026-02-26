import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { getNoteName } from '../noteUtils.js';
import {
  IconCaretLeftFilled,
  IconCaretRightFilled,
  IconRotate,
  IconRotateClockwise,
  IconArrowBigDownLine,
  IconArrowBigUpLine,
  IconReplace,
} from '@tabler/icons-react';
import './ActionStaff.scss';

// Staff line positions (from bottom): E4=0, G4=1, B4=2, D5=3, F5=4 (treble)
// Bass: G2=0, B2=1, D3=2, F3=3, A3=4
const TREBLE_BOTTOM = 64; // E4
const BASS_BOTTOM = 43;   // G2

// Map MIDI note to staff position (number of half-steps from bottom line)
// Returns { staffY, needsLedger, clef }
function getNoteStaffPosition(midiNote) {
  // Note names in chromatic order with staff positions
  // C D E F G A B map to positions 0 1 2 3 4 5 6 (diatonic)
  const NOTE_TO_DIATONIC = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  const isSharp = ![0, 2, 4, 5, 7, 9, 11].includes(midiNote % 12);
  const baseMidi = isSharp ? midiNote - 1 : midiNote;
  const octave = Math.floor(baseMidi / 12) - 1;
  const noteInOctave = baseMidi % 12;
  const diatonic = NOTE_TO_DIATONIC[noteInOctave] ?? 0;

  // Absolute diatonic position (C4 = 28)
  const absDiatonic = octave * 7 + diatonic;

  // Treble clef: bottom line = E4 (diatonic 30), top line = F5 (diatonic 34)
  // Bass clef: bottom line = G2 (diatonic 18), top line = A3 (diatonic 22)
  const trebleBottom = 30; // E4
  const bassTop = 22;      // A3

  const useTreeble = absDiatonic >= 28; // C4 and above -> treble
  const clef = useTreeble ? 'treble' : 'bass';

  // Position relative to bottom staff line
  const bottomLineDiatonic = useTreeble ? trebleBottom : 18; // G2 for bass
  const position = absDiatonic - bottomLineDiatonic;

  return { position, clef, isSharp };
}

// Tabler action icons
const ACTION_ICONS = {
  moveLeft: <IconCaretLeftFilled className="action-icon" />,
  moveRight: <IconCaretRightFilled className="action-icon" />,
  rotateCCW: <IconRotate className="action-icon" />,
  rotateCW: <IconRotateClockwise className="action-icon" />,
  hardDrop: <IconArrowBigDownLine className="action-icon" />,
  hold: <IconReplace className="action-icon" />,
  jump: <IconArrowBigUpLine className="action-icon" />,
  duck: <IconArrowBigDownLine className="action-icon" />,
};

/**
 * Renders a single action staff with clef, target notes, and action icon.
 *
 * @param {string} action - 'moveLeft' | 'moveRight' | 'rotateCCW' | 'rotateCW'
 * @param {number[]} targetPitches - MIDI notes to display on staff
 * @param {boolean} matched - Whether the player is currently matching this staff
 * @param {boolean} fired - Brief pulse when action fires
 */
export function ActionStaff({ action, targetPitches = [], matched = false, fired = false, disabled = false, heldPiece = null, activeNotes = null }) {
  // Guard: filter out any undefined/null pitches
  const validPitches = targetPitches.filter(p => p != null);

  const notePositions = useMemo(() =>
    validPitches.map(pitch => ({
      pitch,
      name: getNoteName(pitch),
      ...getNoteStaffPosition(pitch),
    })),
    [validPitches.join(',')]
  );

  // Determine clef from first note (all notes in a staff should share clef)
  const clef = notePositions[0]?.clef ?? 'treble';

  // Ghost notes: currently pressed notes shown at 50% opacity for orientation
  // Exclude notes that match a target pitch (don't show duplicates)
  const targetSet = useMemo(() => new Set(validPitches), [validPitches.join(',')]);
  const ghostNotes = useMemo(() => {
    if (!activeNotes || activeNotes.size === 0) return [];
    const ghosts = [];
    for (const [pitch] of activeNotes) {
      if (targetSet.has(pitch)) continue; // skip — already shown as target note
      const pos = getNoteStaffPosition(pitch);
      // Only show if within visible staff bounds (position -3 to 11)
      if (pos.position < -3 || pos.position > 11) continue;
      ghosts.push({ pitch, ...pos });
    }
    return ghosts;
  }, [activeNotes, targetSet]);

  // Staff line Y positions — viewBox height tightened so staff fills most of the space
  // 2 spaces padding above top line, 2 spaces below bottom line
  const lineSpacing = 14;
  const topPad = lineSpacing * 2;
  const bottomLineY = topPad + lineSpacing * 4; // top line at topPad, bottom line 4 spaces down
  const viewBoxH = bottomLineY + lineSpacing * 2; // 2 spaces below bottom line
  const staffLineYs = [0, 1, 2, 3, 4].map(i => bottomLineY - i * lineSpacing);

  // Dynamically scale clef glyph to fit staff area via getBBox()
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

  // Re-measure if clef type changes
  useEffect(() => {
    if (clefRef.current) measureClef(clefRef.current);
  }, [clef, measureClef]);

  const cls = [
    'action-staff',
    matched && 'action-staff--matched',
    fired && 'action-staff--fired',
    disabled && 'action-staff--disabled',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      {action && (
        <div className="action-staff__icon">
          {ACTION_ICONS[action]}
          {action === 'hold' && heldPiece && (
            <span className="action-staff__held-type">{heldPiece}</span>
          )}
        </div>
      )}

      <div className="action-staff__staff-area">
        {/* Staff lines — separate SVG with preserveAspectRatio="none" so lines stretch to full width */}
        <svg className="action-staff__lines-svg" viewBox={`0 0 100 ${viewBoxH}`} preserveAspectRatio="none">
          {staffLineYs.map((y, i) => (
            <line key={i} x1="0" y1={y} x2="100" y2={y} stroke="rgba(0,0,0,1)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>

        {/* Notation (clef + note) — proportional scaling */}
        <svg className="action-staff__notation-svg" viewBox={`0 0 100 ${viewBoxH}`} preserveAspectRatio="xMidYMid meet">
        {/* Clef — rendered large, then JS-scaled via getBBox() to fit staff */}
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

        {/* Notes with shared stem — proper dyad/chord formatting */}
        {(() => {
          if (notePositions.length === 0) return null;

          const stepSize = lineSpacing / 2;
          const baseX = 65;

          // Sort by position (lowest first)
          const sorted = [...notePositions].sort((a, b) => a.position - b.position);

          // Stem direction: based on average position relative to middle line (pos 4)
          const avgPos = sorted.reduce((s, n) => s + n.position, 0) / sorted.length;
          const stemUp = avgPos <= 4;

          // Compute Y positions
          const noteYs = sorted.map(np => bottomLineY - np.position * stepSize);
          const lowestY = noteYs[noteYs.length - 1]; // visually highest (smallest Y) = highest pitch
          const highestY = noteYs[0]; // visually lowest (largest Y) = lowest pitch

          // Stem: single line connecting all noteheads + extension
          const stemLen = lineSpacing * 3.5;
          const stemX = stemUp ? baseX + 8 : baseX - 8;
          const stemTop = stemUp ? Math.min(...noteYs) - stemLen : Math.min(...noteYs);
          const stemBottom = stemUp ? Math.max(...noteYs) : Math.max(...noteYs) + stemLen;

          // Determine which noteheads need side-offset (seconds / adjacent notes)
          const offsets = sorted.map(() => 0);
          for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].position - sorted[i - 1].position;
            if (gap <= 1) {
              // Adjacent notes: offset the one further from the stem
              // Stem up: offset the lower note (index i-1) to the left
              // Stem down: offset the upper note (index i) to the right
              if (stemUp) {
                offsets[i - 1] = -18;
              } else {
                offsets[i] = 18;
              }
            }
          }

          // Stagger sharp positions to avoid overlap
          let sharpIdx = 0;

          return (
            <g>
              {/* Single shared stem */}
              <line x1={stemX} y1={stemTop} x2={stemX} y2={stemBottom}
                className={`action-staff__stem${matched ? ' action-staff__stem--matched' : ''}`}
              />

              {sorted.map((np, i) => {
                const noteY = noteYs[i];
                const noteX = baseX + offsets[i];

                // Ledger lines
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

                // Stagger sharps horizontally to avoid overlap — place well left of any offset noteheads
                const sharpBaseX = Math.min(baseX, noteX) - 18;
                const sharpX = np.isSharp ? sharpBaseX - (sharpIdx++ % 2) * 12 : 0;

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
                    {np.isSharp && (
                      <text x={sharpX} y={noteY + 5} fontSize="18" fill="rgba(0,0,0,1)" fontFamily="serif">{'\u266F'}</text>
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

    </div>
  );
}
