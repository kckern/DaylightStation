// frontend/src/modules/Media/search/ResultRow.jsx
// One search result: thumbnail, title + context line, the full queue action
// set, and Cast — all inline, none requiring navigation. Queue actions other
// than Play Now keep the dropdown open and flash confirmation on the button;
// the title toggles an inline metadata peek.
import React, { useState, useRef, useEffect } from 'react';
import { useSessionController } from '../controller/useSessionController.js';
import { resultToQueueInput } from './resultToQueueInput.js';
import { CastButton } from '../cast/CastButton.jsx';
import { TIMING } from '../constants.js';

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
  const [flash, setFlash] = useState(null); // op key that just succeeded
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const id = row.id ?? row.itemId;
  if (!id) return null;
  const thumb = thumbnailSrc(row);

  const fire = (op, { closes = false } = {}) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (op === 'playNow') queue.playNow(input, { clearRest: true });
    else if (op === 'playNext') queue.playNext(input);
    else if (op === 'addUpNext') queue.addUpNext(input);
    else if (op === 'add') queue.add(input);
    if (closes) { onAction?.(); return; }
    setFlash(op);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), TIMING.ACTION_FLASH_MS * 2);
  };

  const type = row.type ?? row.metadata?.type ?? row.mediaType;
  const subtitle = [
    type, row.source,
    typeof row.duration === 'number' ? `${Math.round(row.duration / 60)} min` : null,
  ].filter(Boolean).join(' • ');

  return (
    <li data-testid={`result-row-${id}`} className={`result-row ${peekOpen ? 'result-row--open' : ''}`}>
      <div className="result-row-main">
        {thumb && (
          <img className="media-result-thumb" src={thumb} alt="" loading="lazy"
               onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        )}
        <span className="media-result-text">
          <button
            data-testid={`result-open-${id}`}
            className="media-result-title"
            onClick={() => setPeekOpen((v) => !v)}
          >
            {row.title ?? id}
          </button>
          {subtitle && <span className="media-result-subtitle">{subtitle}</span>}
        </span>
        <span className="media-result-actions">
          <button data-testid={`result-play-now-${id}`} className="result-action result-action--primary"
                  onClick={fire('playNow', { closes: true })}>Play Now</button>
          <button data-testid={`result-play-next-${id}`} onClick={fire('playNext')}
                  className={`result-action ${flash === 'playNext' ? 'action-flash' : ''}`}>
            {flash === 'playNext' ? '✓ Next' : 'Play Next'}
          </button>
          <button data-testid={`result-upnext-${id}`} onClick={fire('addUpNext')}
                  className={`result-action ${flash === 'addUpNext' ? 'action-flash' : ''}`}>
            {flash === 'addUpNext' ? '✓ Queued' : 'Up Next'}
          </button>
          <button data-testid={`result-add-${id}`} onClick={fire('add')}
                  className={`result-action ${flash === 'add' ? 'action-flash' : ''}`}>
            {flash === 'add' ? '✓ Added' : 'Add'}
          </button>
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
