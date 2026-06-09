import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };

export function QueuePanel({ target = 'local' }) {
  const { snapshot, queue, config } = useSessionController(target);
  const q = snapshot?.queue;
  if (!q || !Array.isArray(q.items) || q.items.length === 0) {
    return <div data-testid="queue-empty" className="queue-empty">Queue is empty</div>;
  }
  const shuffle = !!snapshot.config?.shuffle;
  const repeat = snapshot.config?.repeat ?? 'off';

  return (
    <div data-testid="queue-panel" className="queue-panel">
      <div className="queue-toolbar">
        <span className="queue-count">{q.items.length} item{q.items.length === 1 ? '' : 's'}</span>
        <button data-testid="queue-shuffle" aria-pressed={shuffle}
                onClick={() => config.setShuffle?.(!shuffle)}>
          Shuffle{shuffle ? ' ✓' : ''}
        </button>
        <button data-testid="queue-repeat" onClick={() => config.setRepeat?.(REPEAT_NEXT[repeat])}>
          Repeat: {repeat}
        </button>
        <button data-testid="queue-clear" className="queue-clear" onClick={() => queue.clear?.()}>Clear</button>
      </div>
      <ul className="queue-items">
        {q.items.map((it, idx) => {
          const isCurrent = idx === q.currentIndex;
          const cls = [
            'queue-item',
            isCurrent ? 'queue-item--current' : '',
            it.priority === 'upNext' ? 'queue-item--upnext' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={it.queueItemId} data-testid={`queue-item-${it.queueItemId}`} className={cls}>
              <button className="queue-item-title" data-testid={`queue-jump-${it.queueItemId}`}
                      onClick={() => queue.jump?.(it.queueItemId)} disabled={isCurrent}>
                {it.title ?? it.contentId}
              </button>
              {it.priority === 'upNext' && <span className="queue-badge">up next</span>}
              <button className="queue-item-remove" aria-label="Remove from queue"
                      data-testid={`queue-remove-${it.queueItemId}`}
                      onClick={() => queue.remove?.(it.queueItemId)}>×</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default QueuePanel;
