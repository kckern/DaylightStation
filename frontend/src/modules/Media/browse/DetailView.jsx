import React from 'react';
import { useContentInfo } from './useContentInfo.js';
import { useSessionController } from '../session/useSessionController.js';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

export function DetailView({ contentId }) {
  const { info, loading, error } = useContentInfo(contentId);
  const { queue } = useSessionController('local');

  if (loading) return <div data-testid="detail-loading">Loading…</div>;
  if (error) return <div data-testid="detail-error">{error.message}</div>;
  if (!info) return null;

  const input = resultToQueueInput({ id: contentId, ...info }) ?? { contentId };

  return (
    <div data-testid="detail-view" className="detail-view">
      {info.thumbnail && <img src={info.thumbnail} alt={info.title ?? contentId} />}
      <h1>{info.title ?? contentId}</h1>
      {info.description && <p>{info.description}</p>}
      <div className="detail-actions">
        <button data-testid="detail-play-now" onClick={() => queue.playNow(input, { clearRest: true })}>
          Play Now
        </button>
        <button data-testid="detail-play-next" onClick={() => queue.playNext(input)}>Play Next</button>
        <button data-testid="detail-up-next" onClick={() => queue.addUpNext(input)}>Up Next</button>
        <button data-testid="detail-add" onClick={() => queue.add(input)}>Add to Queue</button>
      </div>
    </div>
  );
}

export default DetailView;
