import React from 'react';
import PropTypes from 'prop-types';

/**
 * Close / add-memo / delete for the detail header's right box — one copy for
 * every variant (recap thumb, Strava stats, rider summary, empty).
 *
 * All three are always visible: the kiosk is a touchscreen, and a control that
 * only appears on :hover is a control nobody can find. Delete is the quiet one
 * and takes two taps — the first arms it ("Delete?"), see `deleteArmed`.
 */
export default function DetailActions({ onClose, onDelete, deleting = false, deleteArmed = false, onAddMemo }) {
  return (
    <>
      <button className="session-detail__close" onClick={onClose} title="Close">&times;</button>
      <button
        className={`session-detail__delete${deleteArmed ? ' session-detail__delete--armed' : ''}`}
        onClick={onDelete}
        disabled={deleting}
        title={deleteArmed ? 'Tap again to delete this session' : 'Delete session'}
        aria-label={deleteArmed ? 'Confirm delete' : 'Delete session'}
      >{deleting ? '…' : (deleteArmed ? 'Delete?' : '✕')}</button>
      <button
        className="session-detail__add-memo"
        onPointerDown={(e) => { e.preventDefault(); onAddMemo?.(); }}
        title="Add voice memo to this session"
        aria-label="Add voice memo"
      >{'🎙'}</button>
    </>
  );
}

DetailActions.propTypes = {
  onClose: PropTypes.func,
  onDelete: PropTypes.func,
  deleting: PropTypes.bool,
  deleteArmed: PropTypes.bool,
  onAddMemo: PropTypes.func,
};
