import React, { useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { resultToQueueInput } from './resultToQueueInput.js';
import { CastButton } from '../cast/CastButton.jsx';

function thumbnailSrc(row) {
  if (row.thumbnail && typeof row.thumbnail === 'string' && row.thumbnail.length > 0) return row.thumbnail;
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const [source, ...rest] = String(id).split(':');
  if (!source || rest.length === 0) return null;
  const localId = rest.join(':');
  return `/api/v1/display/${encodeURIComponent(source)}/${localId}`;
}

export function ResultRow({ row, onAction }) {
  const { queue } = useSessionController('local');
  const [peekOpen, setPeekOpen] = useState(false);
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const thumb = thumbnailSrc(row);

  const fire = (op) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (op === 'playNow') queue.playNow(input, { clearRest: true });
    else if (op === 'playNext') queue.playNext(input);
    else if (op === 'addUpNext') queue.addUpNext(input);
    else if (op === 'add') queue.add(input);
    onAction?.();
  };

  return (
    <li data-testid={`result-row-${id}`} className={`result-row ${peekOpen ? 'result-row--open' : ''}`}>
      <div className="result-row-main">
        {thumb && (
          <img className="media-result-thumb" src={thumb} alt="" loading="lazy"
               onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        )}
        <button
          data-testid={`result-open-${id}`}
          className="media-result-title"
          onClick={() => setPeekOpen((v) => !v)}
        >
          {row.title ?? id}
        </button>
        <span className="media-result-actions">
          <button data-testid={`result-play-now-${id}`} onClick={fire('playNow')}>Play Now</button>
          <button data-testid={`result-play-next-${id}`} onClick={fire('playNext')}>Play Next</button>
          <button data-testid={`result-upnext-${id}`} onClick={fire('addUpNext')}>Up Next</button>
          <button data-testid={`result-add-${id}`} onClick={fire('add')}>Add</button>
          <CastButton contentId={id} onAction={onAction} />
        </span>
      </div>
      {peekOpen && (
        <div data-testid={`result-peek-${id}`} className="result-peek">
          {thumb && <img className="result-peek-thumb" src={thumb} alt="" />}
          <div className="result-peek-meta">
            <div className="result-peek-title">{row.title ?? id}</div>
            <div className="result-peek-id"><code>{id}</code></div>
            {row.source && <div className="result-peek-source">Source: {row.source}</div>}
            {row.mediaType && <div className="result-peek-mediatype">{row.mediaType}</div>}
            {typeof row.duration === 'number' && (
              <div className="result-peek-duration">{Math.round(row.duration / 60)} min</div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default ResultRow;
