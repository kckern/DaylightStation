import { useCallback, useEffect, useRef, useState } from 'react';

function queueIdentity(queue) {
  if (!queue) return '';
  const items = (queue.items ?? []).map((item) => `${item.queueItemId ?? ''}:${item.contentId ?? ''}`).join('|');
  return `${queue.currentIndex ?? -1}/${items}/${(queue.executionOrder ?? []).join('|')}`;
}

// A remote command acknowledgement proves delivery, not playback state. Keep
// the receipt only when that acknowledgement is followed by the same target's
// ready, detached owner snapshot with its exact queue still intact.
export function useRemoteStopFeedback(deviceId, snapshot, entry) {
  const pendingRef = useRef(null);
  const [ackEpoch, setAckEpoch] = useState(0);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    pendingRef.current = null;
    setReceipt(null);
  }, [deviceId]);

  const noteStop = useCallback((result) => {
    const request = {
      deviceId,
      count: snapshot?.queue?.items?.length ?? 0,
      queueIdentity: queueIdentity(snapshot?.queue),
      acknowledged: false,
    };
    pendingRef.current = request;
    setReceipt(null);
    Promise.resolve(result).then(() => {
      if (pendingRef.current === request) {
        request.acknowledged = true;
        setAckEpoch((epoch) => epoch + 1);
      }
    }, () => {
      if (pendingRef.current === request) pendingRef.current = null;
    });
    return result;
  }, [deviceId, snapshot]);

  const unavailable = entry?.offline === true || entry?.isStale === true;
  const currentQueueIdentity = queueIdentity(snapshot?.queue);
  const currentCount = snapshot?.queue?.items?.length ?? 0;
  useEffect(() => {
    const request = pendingRef.current;
    const confirmed = request?.acknowledged === true
      && !unavailable
      && request.deviceId === deviceId
      && snapshot?.state === 'ready'
      && !snapshot?.currentItem
      && currentCount > 0
      && currentCount === request.count
      && currentQueueIdentity === request.queueIdentity;
    if (confirmed) {
      setReceipt({ deviceId, count: currentCount, queueIdentity: currentQueueIdentity });
      pendingRef.current = null;
      return;
    }
    if (unavailable || (receipt && (snapshot?.state !== 'ready' || snapshot?.currentItem
      || currentCount !== receipt.count || currentQueueIdentity !== receipt.queueIdentity))) {
      setReceipt(null);
    }
  }, [ackEpoch, currentCount, currentQueueIdentity, deviceId, receipt, snapshot?.currentItem, snapshot?.state, unavailable]);

  return { queueKeptCount: receipt?.deviceId === deviceId ? receipt.count : null, noteStop };
}

export default useRemoteStopFeedback;
