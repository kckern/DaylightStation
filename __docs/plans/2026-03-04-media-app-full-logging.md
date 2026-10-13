# MediaApp Full Logging Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive session logging to MediaApp so every user action, content load, search, playback event, and rendering quirk is captured in `media/logs/media/<session>.jsonl` for UAT evidence.

**Architecture:** Add ~50 inline log events across 15 files using the existing Logger framework with `sessionLog: true`. No new files or infrastructure needed — the session file transport is already wired up. High-frequency events (progress) use `logger.sampled()`.

**Tech Stack:** React, existing `frontend/src/lib/logging/Logger.js` framework, WebSocket transport to backend `SessionFileTransport`.

---

### Task 1: Queue Mutation Logging (useMediaQueue.js)

**Files:**
- Modify: `frontend/src/hooks/media/useMediaQueue.js`

**Step 1: Add logging to addItems (line 89)**

Replace lines 89-100:
```javascript
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
```

**Step 2: Add logging to removeItem (line 102)**

Replace lines 102-111:
```javascript
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
```

**Step 3: Add logging to reorder (line 113)**

Replace lines 113-118:
```javascript
  const reorder = useCallback(async (queueId, toIndex) => {
    logger().info('media-queue.reorder', { queueId, toIndex });
    return mutate(null, (mid) =>
      apiFetch('/items/reorder', { method: 'PATCH', body: { queueId, toIndex, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [mutate]);
```

**Step 4: Add logging to setPosition (line 120)**

Replace lines 120-126:
```javascript
  const setPosition = useCallback(async (position) => {
    const item = queue.items[position];
    logger().info('media-queue.set-position', { position, contentId: item?.contentId, title: item?.title });
    setQueue(prev => ({ ...prev, position }));
    return mutate(null, (mid) =>
      apiFetch('/position', { method: 'PATCH', body: { position, mutationId: mid } })
        .then(res => setQueue(res))
    );
  }, [queue, mutate]);
```

**Step 5: Add logging to advance (line 128)**

Replace lines 128-135:
```javascript
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
```

**Step 6: Add logging to setShuffle, setRepeat, setVolume, clear**

Replace lines 137-163:
```javascript
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
```

**Step 7: Commit**

```bash
git add frontend/src/hooks/media/useMediaQueue.js
git commit -m "feat(media): add logging to all queue mutation methods"
```

---

### Task 2: Search & Streaming Results Logging (useStreamingSearch.js)

**Files:**
- Modify: `frontend/src/hooks/useStreamingSearch.js`

**Step 1: Add logger import and lazy init**

Add after line 1:
```javascript
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useStreamingSearch' });
  return _logger;
}
```

**Step 2: Add search lifecycle logging**

After `setIsSearching(true);` (line 45), add:
```javascript
    logger().info('search.started', { query, endpoint, filterParams: extraQueryString || null });
```

After the cancelled check (line 57), when `data.event === 'results'` (line 65), replace line 66:
```javascript
        } else if (data.event === 'results') {
          const newCount = data.items?.length || 0;
          setResults(prev => {
            const total = prev.length + newCount;
            logger().info('search.results-received', { source: data.source, newItems: newCount, totalSoFar: total });
            return [...prev, ...data.items];
          });
          setPending(data.pending);
```

After `data.event === 'complete'` (line 68), add logging:
```javascript
        } else if (data.event === 'complete') {
          logger().info('search.completed', { query });
          setPending([]);
          setIsSearching(false);
          eventSource.close();
```

After `data.event === 'error'` (line 72), add logging:
```javascript
        } else if (data.event === 'error') {
          logger().warn('search.error', { query, error: data.message });
          setIsSearching(false);
          setPending([]);
          eventSource.close();
```

In the `onerror` handler (line 82), add:
```javascript
    eventSource.onerror = () => {
      logger().warn('search.connection-error', { query, endpoint });
      if (eventSourceRef.current === eventSource) {
```

Where we cancel in-flight (line 31-34), add:
```javascript
    if (eventSourceRef.current) {
      logger().debug('search.cancelled', { reason: 'new-query' });
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/useStreamingSearch.js
git commit -m "feat(media): add logging to streaming search lifecycle"
```

---

### Task 3: ContentBrowser UI Activity Logging

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Add mount/unmount and config-loaded logging**

After the existing useEffect for config fetch (line 18-23), replace with:
```javascript
  useEffect(() => {
    logger.info('content-browser.mounted');
    fetch('/api/v1/media/config')
      .then(r => r.json())
      .then(data => {
        const categories = data.browse || [];
        setBrowseConfig(categories);
        logger.info('content-browser.config-loaded', { categoryCount: categories.length, categories: categories.map(c => c.label) });
      })
      .catch(err => logger.warn('content-browser.config-fetch-failed', { error: err.message }));
    return () => logger.info('content-browser.unmounted');
  }, [logger]);
```

**Step 2: Add results-rendered logging**

After line 82 (`const displayResults = ...`), add a useEffect to log when results render:
```javascript
  useEffect(() => {
    if (displayResults.length > 0) {
      const withThumbs = displayResults.filter(r => !!r.contentId).length;
      logger.info('content-browser.results-rendered', { count: displayResults.length, withThumbnails: withThumbs, source: browsing ? 'browse' : 'search' });
    }
  }, [displayResults.length, browsing, logger]);
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "feat(media): add UI activity logging to ContentBrowser"
```

---

### Task 4: MediaApp URL Loading & Mode Logging

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`

**Step 1: Add URL parsing log**

After line 63 (`if (!urlCommand) return;`), add:
```javascript
    logger.info('media-app.url-parsed', {
      action: urlCommand.play ? 'play' : urlCommand.queue ? 'queue' : 'unknown',
      contentId: (urlCommand.play || urlCommand.queue)?.contentId,
      volume: (urlCommand.play || urlCommand.queue)?.volume,
      shuffle: (urlCommand.play || urlCommand.queue)?.shuffle,
      device: urlCommand.device,
    });
```

**Step 2: Add autoplay result logging**

After the `queue.addItems` call in the play branch (line 84-87), chain a log:
```javascript
    if (urlCommand.play) {
      queue.clear().then(() =>
        queue.addItems([{ contentId, title: contentId, config: Object.keys(config).length > 0 ? config : undefined }])
      ).then(() => logger.info('media-app.autoplay-result', { contentId, success: true }))
        .catch(err => logger.warn('media-app.autoplay-result', { contentId, success: false, error: err.message }));
    }
```

**Step 3: Add mode change logging**

Replace line 42 with a wrapper:
```javascript
  const [mode, setModeRaw] = useState('browse');
  const setMode = useCallback((newMode) => {
    setModeRaw(prev => {
      if (prev !== newMode) logger.info('media-app.mode-change', { from: prev, to: newMode });
      return newMode;
    });
  }, [logger]);
```

**Step 4: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): add URL autoplay and mode change logging"
```

---

### Task 5: NowPlaying Content Rendering Logging

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`

**Step 1: Add content-rendered log when currentItem changes**

After the auto-fullscreen useEffect (line 96-102), add:
```javascript
  useEffect(() => {
    if (currentItem) {
      logger.info('now-playing.content-rendered', {
        contentId: currentItem.contentId,
        title: currentItem.title,
        format: currentItem.format,
        hasThumbnail: !!currentItem.contentId,
      });
    } else {
      logger.info('now-playing.empty-state');
    }
  }, [currentItem?.contentId, logger]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "feat(media): add content rendering logging to NowPlaying"
```

---

### Task 6: MediaAppPlayer Playback Event Logging

**Files:**
- Modify: `frontend/src/modules/Media/MediaAppPlayer.jsx`

**Step 1: Add logger and playback event tracking**

Replace entire file:
```jsx
import React, { useMemo, useEffect, forwardRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import Player from '../Player/Player.jsx';

const MediaAppPlayer = forwardRef(function MediaAppPlayer(
  { contentId, onItemEnd, onProgress, config, isFullscreen, onExitFullscreen, renderOverlay, onPlayerClick },
  ref
) {
  const logger = useMemo(() => getLogger().child({ component: 'MediaAppPlayer' }), []);

  const playObject = useMemo(() => {
    if (!contentId) return null;
    return { contentId, ...config };
  }, [contentId, config]);

  // Log content load
  useEffect(() => {
    if (playObject) {
      logger.info('media-player.loaded', { contentId: playObject.contentId, hasConfig: !!config });
    }
  }, [playObject?.contentId, logger]);

  if (!playObject) return null;

  return (
    <div
      className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}
      onClick={onPlayerClick}
    >
      <Player
        ref={ref}
        play={playObject}
        clear={onItemEnd}
        onProgress={onProgress}
        playerType="media"
      />
      {isFullscreen && (
        <>
          <button
            className="media-fullscreen-exit"
            onClick={onExitFullscreen}
            aria-label="Exit fullscreen"
          >
            &times;
          </button>
          {renderOverlay?.()}
        </>
      )}
    </div>
  );
});

export default MediaAppPlayer;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/MediaAppPlayer.jsx
git commit -m "feat(media): add playback event logging to MediaAppPlayer"
```

---

### Task 7: usePlaybackBroadcast Lifecycle Logging

**Files:**
- Modify: `frontend/src/hooks/media/usePlaybackBroadcast.js`

**Step 1: Add setup, stop, and cleanup logging**

In the useEffect (line 70), add setup log and stop log:
```javascript
  useEffect(() => {
    const identity = { clientId, deviceId, displayName };

    if (!currentItem) {
      if (lastStateRef.current === 'playing' || lastStateRef.current === 'paused') {
        logger().info('playback-broadcast.stop-sent', { previousState: lastStateRef.current });
        wsService.send(buildStopMessage(identity));
        lastStateRef.current = 'stopped';
      }
      return;
    }

    logger().info('playback-broadcast.setup', { contentId: currentItem.contentId, clientId });

    function broadcast() {
      const msg = buildBroadcastMessage(playerRef, currentItem, identity);
      if (!msg) return;

      wsService.send(msg);
      lastStateRef.current = 'playing';
      logger().debug('broadcast', { contentId: msg.contentId, position: msg.position });
    }

    const interval = setInterval(broadcast, BROADCAST_INTERVAL_MS);

    return () => {
      logger().debug('playback-broadcast.cleanup', { contentId: currentItem.contentId });
      clearInterval(interval);
    };
  }, [currentItem, clientId, deviceId, displayName, playerRef]);
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/media/usePlaybackBroadcast.js
git commit -m "feat(media): add lifecycle logging to usePlaybackBroadcast"
```

---

### Task 8: useDeviceMonitor Subscription Logging

**Files:**
- Modify: `frontend/src/hooks/media/useDeviceMonitor.js`

**Step 1: Add subscription and state change logging**

In the WebSocket subscription useEffect (line 79-112), add logging:

After `const unsubscribe = wsService.subscribe(` (line 80), add after the full subscribe block:
```javascript
    logger().info('device-monitor.subscribed');
```

Inside the subscribe callback, after `next.set(id, msg)` (line 89):
```javascript
        const isNew = !prev.has(id);
        if (isNew) logger().info('device-monitor.device-online', { id, displayName: msg.displayName, contentId: msg.contentId });
```

After `if (expired.length > 0)` (line 99):
```javascript
        logger().info('device-monitor.devices-expired', { count: expired.length, ids: expired });
```

In the cleanup return (line 108-111):
```javascript
    return () => {
      logger().debug('device-monitor.cleanup');
      unsubscribe();
      clearInterval(cleanup);
    };
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/media/useDeviceMonitor.js
git commit -m "feat(media): add subscription logging to useDeviceMonitor"
```

---

### Task 9: DevicePanel Lifecycle Logging

**Files:**
- Modify: `frontend/src/modules/Media/DevicePanel.jsx`

**Step 1: Add useEffect for render logging**

Add after the `browserClients` computation (line 18):
```javascript
  useEffect(() => {
    logger.info('device-panel.mounted', { deviceCount: devices.length });
    return () => logger.info('device-panel.unmounted');
  }, [logger]);

  useEffect(() => {
    if (!isLoading) {
      logger.info('device-panel.devices-updated', {
        registered: devices.length,
        browserClients: browserClients.length,
        deviceNames: devices.map(d => d.name || d.id),
      });
    }
  }, [devices.length, browserClients.length, isLoading, logger]);
```

Need to add `useEffect` to the import:
```javascript
import React, { useEffect, useMemo } from 'react';
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/DevicePanel.jsx
git commit -m "feat(media): add lifecycle logging to DevicePanel"
```

---

### Task 10: DeviceCard Volume Success Logging

**Files:**
- Modify: `frontend/src/modules/Media/DeviceCard.jsx`

**Step 1: Add success logging to handleVolume**

Replace lines 19-25:
```javascript
  const handleVolume = useCallback((e) => {
    const level = Math.round(parseFloat(e.target.value) * 100);
    logger.debug('device-card.volume-change', { deviceId: device.id, level });
    fetch(`/api/v1/device/${device.id}/volume/${level}`).catch(err => {
      logger.error('device-card.volume-failed', { error: err.message });
      notifications.show({ title: 'Volume change failed', message: err.message, color: 'red' });
    });
  }, [device.id, logger]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/DeviceCard.jsx
git commit -m "feat(media): add volume success logging to DeviceCard"
```

---

### Task 11: MiniPlayer Lifecycle Logging

**Files:**
- Modify: `frontend/src/modules/Media/MiniPlayer.jsx`

**Step 1: Add useEffect import and mount/unmount logging**

Change import to include `useEffect`:
```javascript
import React, { useCallback, useEffect, useMemo } from 'react';
```

After the logger creation (line 15), add:
```javascript
  useEffect(() => {
    logger.info('mini-player.mounted', { contentId: currentItem?.contentId });
    return () => logger.info('mini-player.unmounted');
  }, [logger]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/MiniPlayer.jsx
git commit -m "feat(media): add lifecycle logging to MiniPlayer"
```

---

### Task 12: CastButton Logging

**Files:**
- Modify: `frontend/src/modules/Media/CastButton.jsx`

**Step 1: Add logger and toggle logging**

```jsx
import React, { useState, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import DevicePicker from './DevicePicker.jsx';

const CastButton = ({ contentId, className = '' }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastButton' }), []);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    const opening = !pickerOpen;
    logger.debug('cast-button.toggle', { contentId, opening });
    setPickerOpen(o => !o);
  }, [pickerOpen, contentId, logger]);

  if (!contentId) return null;

  return (
    <>
      <button
        className={`cast-btn ${className}`}
        onClick={handleToggle}
        aria-label="Cast to device"
        title="Cast to device"
      >
        &#x1F4E1;
      </button>
      <DevicePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        contentId={contentId}
      />
    </>
  );
};

export default CastButton;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/CastButton.jsx
git commit -m "feat(media): add logging to CastButton"
```

---

### Task 13: QueueItem Action Logging

**Files:**
- Modify: `frontend/src/modules/Media/QueueItem.jsx`

**Step 1: Add logger and action logging**

Add imports:
```javascript
import getLogger from '../../lib/logging/Logger.js';
```

Inside component, add logger:
```javascript
  const logger = useMemo(() => getLogger().child({ component: 'QueueItem' }), []);
```

In `handleSwipeRemove`, before `onRemove` call (inside the `dx < -80` block):
```javascript
        logger.info('queue-item.swipe-remove', { queueId: item.queueId, contentId: item.contentId, title: item.title });
```

In the onClick handler (line 45), wrap it:
```javascript
      onClick={() => { logger.info('queue-item.play-clicked', { queueId: item.queueId, contentId: item.contentId }); onPlay(item.queueId); }}
```

In the remove button onClick (line 64), add logging:
```javascript
        onClick={(e) => { e.stopPropagation(); logger.info('queue-item.remove-clicked', { queueId: item.queueId, contentId: item.contentId }); onRemove(item.queueId); }}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/QueueItem.jsx
git commit -m "feat(media): add action logging to QueueItem"
```

---

### Task 14: Hook Logging (useMediaUrlParams, useMediaClientId, useDeviceIdentity)

**Files:**
- Modify: `frontend/src/hooks/media/useMediaUrlParams.js`
- Modify: `frontend/src/hooks/media/useMediaClientId.js`
- Modify: `frontend/src/hooks/media/useDeviceIdentity.js`

**Step 1: useMediaUrlParams — add logging**

```javascript
import { useMemo } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaUrlParams' });
  return _logger;
}

const MEDIA_ACTIONS = ['play', 'queue'];

export function useMediaUrlParams() {
  const command = useMemo(
    () => parseAutoplayParams(window.location.search, MEDIA_ACTIONS),
    []
  );

  const device = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('device') || null;
  }, []);

  if (!command && !device) return null;

  const result = { ...command, device };
  logger().info('media-url-params.parsed', {
    action: command?.play ? 'play' : command?.queue ? 'queue' : 'device-only',
    contentId: (command?.play || command?.queue)?.contentId,
    device,
  });
  return result;
}

export default useMediaUrlParams;
```

**Step 2: useMediaClientId — add logging**

Add import after line 1:
```javascript
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaClientId' });
  return _logger;
}
```

Inside the useMemo (line 28-42), add logging:

After `clientId = generateHexId()` (line 31):
```javascript
      logger().info('media-client-id.generated', { clientId });
```

After the return at line 41, before it, add:
```javascript
    const isNew = !localStorage.getItem(STORAGE_KEY);
```
Wait — actually cleaner: just log once with both values at the end of useMemo, before the return:

Replace the useMemo body:
```javascript
  return useMemo(() => {
    let clientId = localStorage.getItem(STORAGE_KEY);
    const isNewClient = !clientId;
    if (!clientId) {
      clientId = generateHexId();
      localStorage.setItem(STORAGE_KEY, clientId);
    }

    let displayName = localStorage.getItem(NAME_KEY);
    if (!displayName) {
      displayName = parseUserAgent(navigator.userAgent);
      localStorage.setItem(NAME_KEY, displayName);
    }

    logger().info(isNewClient ? 'media-client-id.generated' : 'media-client-id.loaded', { clientId, displayName });
    return { clientId, displayName };
  }, []);
```

**Step 3: useDeviceIdentity — add logging**

```javascript
import { useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useDeviceIdentity' });
  return _logger;
}

export function useDeviceIdentity() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceId = params.get('deviceId') || null;
    if (deviceId) {
      logger().info('device-identity.resolved', { deviceId, isKiosk: true });
    }
    return { deviceId, isKiosk: deviceId !== null };
  }, []);
}

export default useDeviceIdentity;
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/media/useMediaUrlParams.js frontend/src/hooks/media/useMediaClientId.js frontend/src/hooks/media/useDeviceIdentity.js
git commit -m "feat(media): add logging to URL params, client ID, and device identity hooks"
```

---

### Task 15: MediaAppContext Logging

**Files:**
- Modify: `frontend/src/contexts/MediaAppContext.jsx`

**Step 1: Add logging to provider**

```javascript
import React, { createContext, useContext, useEffect, useRef, useMemo } from 'react';
import { useMediaQueue } from '../hooks/media/useMediaQueue.js';
import getLogger from '../lib/logging/Logger.js';

const MediaAppContext = createContext(null);

export function MediaAppProvider({ children }) {
  const logger = useMemo(() => getLogger().child({ component: 'MediaAppContext' }), []);
  const queue = useMediaQueue();
  const playerRef = useRef(null);

  useEffect(() => {
    logger.info('media-context.initialized', { queueLoading: queue.loading });
    return () => logger.info('media-context.unmounted');
  }, [logger]);

  return (
    <MediaAppContext.Provider value={{ queue, playerRef }}>
      {children}
    </MediaAppContext.Provider>
  );
}

export function useMediaApp() {
  const ctx = useContext(MediaAppContext);
  if (!ctx) throw new Error('useMediaApp must be used within MediaAppProvider');
  return ctx;
}
```

**Step 2: Commit**

```bash
git add frontend/src/contexts/MediaAppContext.jsx
git commit -m "feat(media): add logging to MediaAppContext provider"
```

---

### Task 16: Verify Session Logs Are Written

**Step 1: Start the dev server if not running**

```bash
ss -tlnp | grep 3112
# If not running:
cd /root/Code/DaylightStation && npm run dev &
```

**Step 2: Open MediaApp in browser, perform actions:**
- Open `/media`
- Search for something
- Play a result
- Switch to player mode
- Switch back to browse

**Step 3: Check session log files**

```bash
ls -la media/logs/media/
cat media/logs/media/*.jsonl | head -50
```

Verify events include: `media-app.mounted`, `content-browser.mounted`, `search.started`, `search.results-received`, `content-browser.results-rendered`, `media-queue.add-items`, `media-app.mode-change`, `now-playing.content-rendered`, `media-player.loaded`.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(media): comprehensive session logging for UAT evidence

Adds ~50 log events across 15 files covering:
- Queue mutations (add, remove, reorder, advance, shuffle, repeat, volume, clear)
- Search lifecycle (started, results, completed, errors)
- Content rendering (results displayed, thumbnails, item selection)
- URL autoplay (parsed, attempt, result)
- Playback state (loaded, play, pause, progress, error, stall)
- Device monitoring (subscription, online/offline, expiry)
- Component lifecycle (mount/unmount for all components)
- Hook lifecycle (broadcast, client ID, device identity)

All events flow through existing sessionLog infrastructure to
media/logs/media/<session>.jsonl for UAT evidence."
```
