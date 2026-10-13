import React from 'react';
import PropTypes from 'prop-types';

/**
 * Right-box panel for a merged "group" (race-block) session detail. Fills the slot that
 * holds a video thumbnail for media sessions — for a stitched race group there's no thumb,
 * so we show who rode and how many blocks were sandwiched together. Carries the same
 * close / delete / add-memo affordances as the other right-box variants.
 */
export default function GroupSummaryPanel({
  riders = [],
  segmentCount = 0,
  elapsedMs = 0,
  sessionId,
  onClose,
  onDelete,
  deleting = false,
  onAddMemo,
}) {
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));
  const elapsedLabel = elapsedMinutes >= 60
    ? `${Math.floor(elapsedMinutes / 60)}h${elapsedMinutes % 60 ? ` ${elapsedMinutes % 60}m` : ''} elapsed`
    : (elapsedMinutes ? `${elapsedMinutes}m elapsed` : null);
  return (
    <div className="session-detail__thumb session-detail__thumb--summary">
      <button className="session-detail__close" onClick={onClose} title="Close">&times;</button>
      <button className="session-detail__delete" onClick={onDelete} disabled={deleting} title="Delete session">
        {deleting ? '...' : '✕'}
      </button>
      <button
        className="session-detail__add-memo"
        onPointerDown={(e) => { e.preventDefault(); onAddMemo?.(); }}
        title="Add voice memo to this session"
        aria-label="Add voice memo"
      >{'🎙'}</button>

      <div className="session-detail__summary">
        {elapsedLabel && <div className="session-detail__summary-elapsed">{elapsedLabel}</div>}
        <div className="session-detail__summary-label">Riders</div>
        <div className="session-detail__summary-riders">
          {riders.map((r) => (
            <div key={r.id} className="session-detail__summary-rider" title={r.name}>
              <img
                src={`/api/v1/static/img/users/${r.id}`}
                alt=""
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
              <span>{r.name}</span>
              {r.measuredDurationMs > 0 && (
                <small>{Math.max(1, Math.round(r.measuredDurationMs / 60000))}m measured</small>
              )}
            </div>
          ))}
        </div>
        {segmentCount > 1 && (
          <div className="session-detail__summary-foot">{segmentCount} blocks · sandwiched</div>
        )}
      </div>

      {sessionId && (
        <code
          className="session-detail__session-id"
          onClick={() => navigator.clipboard?.writeText(sessionId)}
          title="Click to copy session ID"
        >{sessionId}</code>
      )}
    </div>
  );
}

GroupSummaryPanel.propTypes = {
  riders: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, name: PropTypes.string, measuredDurationMs: PropTypes.number })),
  segmentCount: PropTypes.number,
  elapsedMs: PropTypes.number,
  sessionId: PropTypes.string,
  onClose: PropTypes.func,
  onDelete: PropTypes.func,
  deleting: PropTypes.bool,
  onAddMemo: PropTypes.func,
};
