// frontend/src/hooks/media/useMediaQueue.js
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useWebSocketSubscription } from '../useWebSocket.js';
import { notifications } from '@mantine/notifications';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaQueue' });
  return _logger;
}

const randomHex = () => Math.random().toString(16).slice(2, 10);

const API_BASE = '/api/v1/media/queue';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function useMediaQueue() {
  const [queue, setQueue] = useState({
    items: [], position: 0, shuffle: false, repeat: 'off', volume: 1.0, shuffleOrder: null,
  });
  const [loading, setLoading] = useState(true);
  const lastMutationId = useRef(null);
  const rollbackState = useRef(null);

  // Fetch on mount
  useEffect(() => {
    apiFetch('')
      .then(data => setQueue(data))
      .catch(err => logger().error('media-queue.fetch-failed', { error: err.message }))
      .finally(() => setLoading(false));
  }, []);

  // WebSocket sync — replace local state on broadcast (suppress self-echo)
  // Stable callback: empty dep array is intentional — reads only refs and setQueue (both stable).
  const handleQueueBroadcast = useCallback((data) => {
    if (data.mutationId && data.mutationId === lastMutationId.current) {
      logger().debug('media-queue.self-echo-suppressed', { mutationId: data.mutationId });
      return;
    }
    logger().info('media-queue.sync-received', { items: data.items?.length });
    setQueue(prev => ({
      items: data.items ?? prev.items,
      position: data.position ?? prev.position,
      shuffle: data.shuffle ?? prev.shuffle,
      repeat: data.repeat ?? prev.repeat,
      volume: data.volume ?? prev.volume,
      shuffleOrder: data.shuffleOrder ?? prev.shuffleOrder,
    }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads only refs and stable setQueue

  useWebSocketSubscription('media:queue', handleQueueBroadcast, []);

  // Optimistic mutation helper
  const mutate = useCallback(async (optimisticUpdate, apiCall) => {
    const mutationId = randomHex();
    lastMutationId.current = mutationId;
    rollbackState.current = { ...queue, items: [...queue.items] };

    if (optimisticUpdate) setQueue(optimisticUpdate);

    try {
      return await apiCall(mutationId);
    } catch (err) {
      logger().warn('media-queue.optimistic-rollback', { error: err.message });
      setQueue(rollbackState.current);
      notifications.show({ title: "Couldn't save queue", message: 'Retrying...', color: 'orange' });
      // Retry once after 2s
      try {
        await new Promise(r => setTimeout(r, 2000));
        return await apiCall(mutationId);
      } catch (retryErr) {
        logger().error('media-queue.backend-unreachable', { error: retryErr.message });
        notifications.show({ title: 'Queue sync failed', message: 'Changes may not persist', color: 'red' });
      }
    }
  }, [queue]);

  // Mutation methods
  const addItems = useCallback(async (items, placement = 'end') => {
    const contentIds = items.map(i => i.contentId);
    logger().info('media-queue.add-items', { count: items.length, contentIds, placement });
    const optimistic = {
      ...queue,
      items: placement === 'next'
        ? [...queue.items.slice(0, queue.position + 1), ...items, ...queue.items.slice(queue.position + 1)]
        : [...queue.items, ...items],
    };
    return mutate(optimistic, (mid) =>
      apiFetch('/items', { method: 'POST', body: { items, placement, mutationId: mid } })
        .then(res => { setQueue(res.queue); return res.added; })
    );
  }, [queue, mutate]);

  const playNow = useCallback(async (items) => {
    const nextPosition = queue.position + 1;
    const contentIds = items.map(i => i.contentId);
    logger().info('media-queue.play-now', { count: items.length, contentIds, position: nextPosition });

    // Atomic optimistic update: insert items AND advance position in one state change
    const optimistic = {
      ...queue,
      items: [...queue.items.slice(0, nextPosition), ...items, ...queue.items.slice(nextPosition)],
      position: nextPosition,
    };

    return mutate(optimistic, async (mid) => {
      const res = await apiFetch('/items', { method: 'POST', body: { items, placement: 'next', mutationId: mid } });
      setQueue(res.queue);
      const posRes = await apiFetch('/position', { method: 'PATCH', body: { position: nextPosition, mutationId: mid } });
      setQueue(posRes);
      return res.added;
    });
  }, [queue, mutate]);

  const removeItem = useCallback(async (queueId) => {
    const item = queue.items.find(i => i.queueId === queueId);
    logger().info('media-queue.remove-item', { queueId, contentId: item?.contentId, title: item?.title });
    const optimistic = {
      ...queue,
      items: queue.items.filter(i => i.queueId !== queueId),
    };
    return mutate(optimistic, (mid) =>
      apiFetch(`/items/${queueId}?mutationId=${mid}`, { method: 'DELETE' })
        .then(res => setQueue(res))
    );
  }, [queue, mutate]);

  const reorder = useCallback(async (queueId, toIndex) => {
    logger().info('media-queue.reorder', { queueId, toIndex });
    return mutate(null, (mid) =>
      apiFetch('/items/reorder', { method: 'PATCH', body: { queueId, toIndex, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const setPosition = useCallback(async (position) => {
    const item = queue.items[position];
    logger().info('media-queue.set-position', { position, contentId: item?.contentId, title: item?.title });
    setQueue(prev => ({ ...prev, position }));
    return mutate(null, (mid) =>
      apiFetch('/position', { method: 'PATCH', body: { position, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [queue, mutate]);

  const advance = useCallback(async (step = 1, { auto = false } = {}) => {
    const optimisticPosition = queue.position + step;
    const nextItem = queue.items[optimisticPosition];
    logger().info('media-queue.advance', { step, auto, fromPosition: queue.position, toPosition: optimisticPosition, nextContentId: nextItem?.contentId });
    const optimistic = { ...queue, position: optimisticPosition };
    return mutate(optimistic, (mid) =>
      apiFetch('/advance', { method: 'POST', body: { step, auto, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [queue, mutate]);

  const setShuffle = useCallback(async (enabled) => {
    logger().info('media-queue.set-shuffle', { enabled });
    return mutate(null, (mid) =>
      apiFetch('/state', { method: 'PATCH', body: { shuffle: enabled, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const setRepeat = useCallback(async (mode) => {
    logger().info('media-queue.set-repeat', { mode });
    return mutate(null, (mid) =>
      apiFetch('/state', { method: 'PATCH', body: { repeat: mode, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);

  const setVolume = useCallback(async (vol) => {
    logger().debug('media-queue.set-volume', { volume: vol });
    setQueue(prev => ({ ...prev, volume: vol }));
    return mutate(null, (mid) =>
      apiFetch('/state', { method: 'PATCH', body: { volume: vol, mutationId: mid } })
    );
  }, [mutate]);

  const clear = useCallback(async () => {
    logger().info('media-queue.clear', { previousCount: queue.items.length });
    setQueue({ items: [], position: 0, shuffle: false, repeat: 'off', volume: queue.volume });
    return mutate(null, (mid) =>
      apiFetch('', { method: 'DELETE' }).then(res => setQueue(res))
    );
  }, [queue.volume, queue.items.length, mutate]);

  const currentItem = useMemo(() => {
    if (queue.items.length === 0) return null;
    if (queue.shuffle && queue.shuffleOrder?.length > 0) {
      const itemIndex = queue.shuffleOrder[queue.position];
      return queue.items[itemIndex] ?? null;
    }
    return queue.items[queue.position] ?? null;
  }, [queue.items, queue.position, queue.shuffle, queue.shuffleOrder]);

  return {
    items: queue.items,
    position: queue.position,
    shuffle: queue.shuffle,
    repeat: queue.repeat,
    volume: queue.volume,
    currentItem,
    loading,
    addItems,
    playNow,
    removeItem,
    reorder,
    setPosition,
    advance,
    setShuffle,
    setRepeat,
    setVolume,
    clear,
  };
}
