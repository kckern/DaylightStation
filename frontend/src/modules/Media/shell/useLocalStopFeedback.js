import { useEffect, useState } from 'react';

const INVALIDATING_ACTIONS = new Set(['LOAD_ITEM', 'SET_CURRENT_ITEM', 'ADOPT_SNAPSHOT', 'RESET']);

// Counts alone are vulnerable to queue ABA: remove A, add B, and the receipt
// for A would otherwise reappear when the count returns to one. Queue item
// ids are allocated identities; include their order, content, and execution
// cursor so a receipt describes the exact retained queue, while config and
// metadata-only updates retain it.
function queueIdentity(queue) {
  if (!queue) return '';
  const items = (queue.items ?? []).map((item) => `${item.queueItemId ?? ''}:${item.contentId ?? ''}`).join('|');
  const execution = (queue.executionOrder ?? []).join('|');
  return `${queue.currentIndex ?? -1}/${items}/${execution}`;
}

// A ready queue is not, by itself, proof that someone stopped playback: a held
// Add or adopted snapshot can look identical. Keep a short-lived receipt only
// when the local controller's authoritative store committed STOP.
export function useLocalStopFeedback(controller, snapshot) {
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    setReceipt(null);
    if (!controller?.store?.onTransition) return undefined;
    return controller.store.onTransition((_previous, next, action) => {
      if (action?.type === 'STOP') {
        const count = next?.queue?.items?.length ?? 0;
        setReceipt(next?.state === 'ready' && !next?.currentItem && count > 0
          ? { sessionId: next.sessionId, count, queueIdentity: queueIdentity(next.queue) }
          : null);
      } else if (INVALIDATING_ACTIONS.has(action?.type)
        || queueIdentity(_previous?.queue) !== queueIdentity(next?.queue)) {
        setReceipt(null);
      }
    });
  }, [controller]);

  const count = snapshot?.queue?.items?.length ?? 0;
  if (!receipt
    || snapshot?.sessionId !== receipt.sessionId
    || snapshot?.state !== 'ready'
    || snapshot?.currentItem
    || count !== receipt.count
    || queueIdentity(snapshot?.queue) !== receipt.queueIdentity) return null;
  return count;
}

export default useLocalStopFeedback;
