import React from 'react';
import PropTypes from 'prop-types';

/**
 * Right-box panel for a merged "group" (race-block) session detail. Fills the slot that
 * holds a video thumbnail for media sessions — for a stitched race group there's no thumb,
 * so we show who rode and how many blocks were sandwiched together. Also used for any
 * session with riders but no video. The close / delete / add-memo controls come in as
 * `actions` (DetailActions), shared with the other right-box variants.
 */
export default function GroupSummaryPanel({
  riders = [],
  segmentCount = 0,
  elapsedMs = 0,
  actions = null,
}) {
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));
  const elapsedLabel = elapsedMinutes >= 60
    ? `${Math.floor(elapsedMinutes / 60)}h${elapsedMinutes % 60 ? ` ${elapsedMinutes % 60}m` : ''} elapsed`
    : (elapsedMinutes ? `${elapsedMinutes}m elapsed` : null);
  return (
    <div className="session-detail__thumb session-detail__thumb--summary">
      {actions}

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

    </div>
  );
}

GroupSummaryPanel.propTypes = {
  riders: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, name: PropTypes.string, measuredDurationMs: PropTypes.number })),
  segmentCount: PropTypes.number,
  elapsedMs: PropTypes.number,
  actions: PropTypes.node,
};
