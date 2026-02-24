import { useMemo } from 'react';
import { getNoteName } from '../../noteUtils.js';
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

// SVG action icons
const ACTION_ICONS = {
  moveLeft: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M28 8 L12 20 L28 32" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  moveRight: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M12 8 L28 20 L12 32" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  rotateCCW: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M12 14 A12 12 0 1 0 20 8" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M16 6 L12 14 L20 14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  rotateCW: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M28 14 A12 12 0 1 1 20 8" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M24 6 L28 14 L20 14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

/**
 * Renders a single action staff with clef, target notes, and action icon.
 *
 * @param {string} action - 'moveLeft' | 'moveRight' | 'rotateCCW' | 'rotateCW'
 * @param {number[]} targetPitches - MIDI notes to display on staff
 * @param {boolean} matched - Whether the player is currently matching this staff
 * @param {boolean} fired - Brief pulse when action fires
 */
export function ActionStaff({ action, targetPitches = [], matched = false, fired = false }) {
  const notePositions = useMemo(() =>
    targetPitches.map(pitch => ({
      pitch,
      name: getNoteName(pitch),
      ...getNoteStaffPosition(pitch),
    })),
    [targetPitches]
  );

  // Determine clef from first note (all notes in a staff should share clef)
  const clef = notePositions[0]?.clef ?? 'treble';

  // Staff line Y positions (SVG coords, 5 lines spaced 8px apart)
  // Bottom line at y=48, top line at y=16
  const staffLineYs = [48, 40, 32, 24, 16];

  return (
    <div className={`action-staff${matched ? ' action-staff--matched' : ''}${fired ? ' action-staff--fired' : ''}`}>
      <div className="action-staff__icon">
        {ACTION_ICONS[action]}
      </div>

      <svg className="action-staff__svg" viewBox="0 0 120 64" preserveAspectRatio="xMidYMid meet">
        {/* Staff lines */}
        {staffLineYs.map((y, i) => (
          <line key={i} x1="10" y1={y} x2="110" y2={y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        ))}

        {/* Clef symbol (simplified text) */}
        <text x="14" y={clef === 'treble' ? 42 : 36} fontSize="28" fill="rgba(255,255,255,0.6)" fontFamily="serif">
          {clef === 'treble' ? '\u{1D11E}' : '\u{1D122}'}
        </text>

        {/* Note heads */}
        {notePositions.map((np, i) => {
          // Y position: bottom line (pos=0) = y48, each diatonic step = -4px
          const noteY = 48 - np.position * 4;
          const noteX = 70 + i * 20; // Space multiple notes

          // Ledger lines for notes above/below staff
          const ledgerLines = [];
          if (np.position < 0) {
            for (let p = -2; p >= np.position; p -= 2) {
              ledgerLines.push(48 - p * 4);
            }
          }
          if (np.position > 8) {
            for (let p = 10; p <= np.position; p += 2) {
              ledgerLines.push(48 - p * 4);
            }
          }

          return (
            <g key={np.pitch}>
              {/* Ledger lines */}
              {ledgerLines.map((ly, li) => (
                <line key={`ledger-${li}`} x1={noteX - 10} y1={ly} x2={noteX + 10} y2={ly}
                  stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
              ))}
              {/* Note head — filled ellipse */}
              <ellipse cx={noteX} cy={noteY} rx="6" ry="4.5"
                className={`action-staff__note${matched ? ' action-staff__note--matched' : ''}`}
                transform={`rotate(-10, ${noteX}, ${noteY})`}
              />
              {/* Sharp sign */}
              {np.isSharp && (
                <text x={noteX - 14} y={noteY + 4} fontSize="14" fill="rgba(255,255,255,0.7)" fontFamily="serif">{'\u266F'}</text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="action-staff__label">
        {targetPitches.map(p => getNoteName(p)).join(' ')}
      </div>
    </div>
  );
}
