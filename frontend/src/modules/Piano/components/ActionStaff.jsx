import { SvgStaffRenderer } from '../../MusicNotation/renderers/SvgStaffRenderer.jsx';
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

// Staff rendering (clef/notehead/stem/ledger math) now lives in the shared
// MusicNotation framework's SvgStaffRenderer; ActionStaff keeps the action-icon
// chrome + matched/fired state and delegates the staff itself.

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
 * The staff itself (clef/notes/ghosts) is delegated to the shared
 * MusicNotation SvgStaffRenderer.
 *
 * @param {string} action - 'moveLeft' | 'moveRight' | 'rotateCCW' | 'rotateCW'
 * @param {number[]} targetPitches - MIDI notes to display on staff
 * @param {boolean} matched - Whether the player is currently matching this staff
 * @param {boolean} fired - Brief pulse when action fires
 */
export function ActionStaff({ action, targetPitches = [], matched = false, fired = false, disabled = false, heldPiece = null, activeNotes = null }) {
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

      <SvgStaffRenderer
        targetPitches={targetPitches}
        activeNotes={activeNotes}
        matched={matched}
      />
    </div>
  );
}
