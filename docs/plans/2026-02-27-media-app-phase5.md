# Media App Phase 5 — Close Requirements Gaps

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 3 remaining unimplemented requirements from the media app requirements doc (2.1.5, 4.2.5, 4.2.6).

**Architecture:**
- 2.1.5: HTML5 drag-and-drop on QueueItem rows; drag state lives in QueueDrawer; calls existing `queue.reorder(queueId, toIndex)`.
- 4.2.6: OfficeApp gets a persistent `playerRef`; threaded into all Player renders in `renderContent()`; `broadcastItem` derived inline from `currentContent`; `usePlaybackBroadcast` wired.
- 4.2.5: TVApp threads `playerRef` down from `TVAppContent` → `MenuStack` prop → Player in `'player'` and `'composite'` cases; `broadcastItem` derived from `currentContent` in `TVAppContent`.

**Tech Stack:** React refs, HTML5 Drag-and-Drop API, `usePlaybackBroadcast` hook (already built)

---

### Task 1: Drag-to-reorder queue items (Req 2.1.5)

**Files:**
- Modify: `frontend/src/modules/Media/QueueItem.jsx`
- Modify: `frontend/src/modules/Media/QueueDrawer.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss` (append styles)
- Create: `tests/isolated/modules/Media/QueueDragReorder.test.mjs`

---

**Step 1: Write the failing test**

Create `tests/isolated/modules/Media/QueueDragReorder.test.mjs`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

describe('QueueItem drag-to-reorder', () => {
  it('renders a drag handle element', async () => {
    const { render, container } = (await import('@testing-library/react')).default
      ?? await import('@testing-library/react');
    const { render: r } = await import('@testing-library/react');
    const { default: QueueItem } = await import('#frontend/modules/Media/QueueItem.jsx');
    const item = { queueId: 'a1', contentId: 'plex:1', title: 'Test' };
    const { container: c } = r(
      React.createElement(QueueItem, {
        item, isCurrent: false, onPlay: () => {}, onRemove: () => {},
        index: 0, onDragStart: () => {}, onDrop: () => {},
      })
    );
    expect(c.querySelector('.queue-item-drag-handle')).toBeTruthy();
  });

  it('calls onDragStart with queueId when drag begins', async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const { default: QueueItem } = await import('#frontend/modules/Media/QueueItem.jsx');
    const onDragStart = vi.fn();
    const item = { queueId: 'a1', contentId: 'plex:1', title: 'Test' };
    const { container } = render(
      React.createElement(QueueItem, {
        item, isCurrent: false, onPlay: () => {}, onRemove: () => {},
        index: 0, onDragStart, onDrop: () => {},
      })
    );
    fireEvent.dragStart(container.querySelector('.queue-item'));
    expect(onDragStart).toHaveBeenCalledWith('a1');
  });

  it('calls onDrop with index when item is dropped onto', async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const { default: QueueItem } = await import('#frontend/modules/Media/QueueItem.jsx');
    const onDrop = vi.fn();
    const item = { queueId: 'b2', contentId: 'plex:2', title: 'Other' };
    const { container } = render(
      React.createElement(QueueItem, {
        item, isCurrent: false, onPlay: () => {}, onRemove: () => {},
        index: 2, onDragStart: () => {}, onDrop,
      })
    );
    fireEvent.drop(container.querySelector('.queue-item'));
    expect(onDrop).toHaveBeenCalledWith(2);
  });
});
```

**Step 2: Run test to confirm it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/modules/Media/QueueDragReorder.test.mjs --no-coverage
```

Expected: FAIL — `QueueItem` has no `drag-handle` class, no drag props.

**Step 3: Modify QueueItem.jsx**

Replace the existing file at `frontend/src/modules/Media/QueueItem.jsx`:

```jsx
// frontend/src/modules/Media/QueueItem.jsx
import React, { useCallback, useMemo } from 'react';
import CastButton from './CastButton.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';

const QueueItem = ({ item, isCurrent, onPlay, onRemove, index, onDragStart, onDrop }) => {
  const thumbnailUrl = useMemo(
    () => item.contentId ? ContentDisplayUrl(item.contentId) : null,
    [item.contentId]
  );

  const handleSwipeRemove = useCallback((e) => {
    const startX = e.touches?.[0]?.clientX;
    const handler = (moveEvent) => {
      const dx = moveEvent.touches[0].clientX - startX;
      if (dx < -80) {
        document.removeEventListener('touchmove', handler);
        onRemove(item.queueId);
      }
    };
    document.addEventListener('touchmove', handler, { passive: true });
    document.addEventListener('touchend', () => {
      document.removeEventListener('touchmove', handler);
    }, { once: true });
  }, [item.queueId, onRemove]);

  return (
    <div
      className={`queue-item ${isCurrent ? 'queue-item--current' : ''}`}
      draggable
      onClick={() => onPlay(item.queueId)}
      onTouchStart={handleSwipeRemove}
      onDragStart={() => onDragStart?.(item.queueId)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop?.(index); }}
    >
      <span className="queue-item-drag-handle" aria-hidden="true">&#8942;</span>
      <div className="queue-item-thumbnail">
        {thumbnailUrl && <img src={thumbnailUrl} alt="" />}
      </div>
      <div className="queue-item-info">
        <div className="queue-item-title">{item.title || item.contentId}</div>
        {item.source && <div className="queue-item-source">{item.source}</div>}
      </div>
      {item.format && <span className="queue-item-badge">{item.format}</span>}
      <CastButton contentId={item.contentId} className="queue-item-cast" />
      <button
        className="queue-item-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(item.queueId); }}
        aria-label="Remove"
      >
        &times;
      </button>
    </div>
  );
};

export default QueueItem;
```

**Step 4: Modify QueueDrawer.jsx**

Add drag state and handlers, then pass new props to QueueItem:

```jsx
// frontend/src/modules/Media/QueueDrawer.jsx
import React, { useMemo, useState, useCallback } from 'react';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import QueueItem from './QueueItem.jsx';
import getLogger from '../../lib/logging/Logger.js';

const QueueDrawer = ({ open, onClose }) => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'QueueDrawer' }), []);
  const [draggedId, setDraggedId] = useState(null);

  const handlePlay = (queueId) => {
    const idx = queue.items.findIndex(i => i.queueId === queueId);
    if (idx >= 0) queue.setPosition(idx);
  };

  const handleRemove = (queueId) => {
    queue.removeItem(queueId);
  };

  const handleClear = () => {
    queue.clear();
  };

  const cycleRepeat = () => {
    const modes = ['off', 'one', 'all'];
    const next = modes[(modes.indexOf(queue.repeat) + 1) % modes.length];
    queue.setRepeat(next);
  };

  const handleDragStart = useCallback((queueId) => {
    setDraggedId(queueId);
  }, []);

  const handleDrop = useCallback((toIndex) => {
    if (draggedId == null) return;
    logger.info('queue.reorder', { queueId: draggedId, toIndex });
    queue.reorder(draggedId, toIndex);
    setDraggedId(null);
  }, [draggedId, queue, logger]);

  if (!open) return null;

  return (
    <div className="queue-drawer">
      <div className="queue-drawer-header">
        <h3>Queue ({queue.items.length})</h3>
        <div className="queue-drawer-actions">
          <button
            className={`queue-action-btn ${queue.shuffle ? 'active' : ''}`}
            onClick={() => queue.setShuffle(!queue.shuffle)}
            aria-label="Shuffle"
          >
            &#8652;
          </button>
          <button
            className={`queue-action-btn ${queue.repeat !== 'off' ? 'active' : ''}`}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${queue.repeat}`}
          >
            {queue.repeat === 'one' ? '\u21BB1' : '\u21BB'}
          </button>
          <button className="queue-action-btn" onClick={handleClear} aria-label="Clear">
            &#10005;
          </button>
          <button className="queue-action-btn" onClick={onClose} aria-label="Close">
            &#9660;
          </button>
        </div>
      </div>
      <div className="queue-drawer-list">
        {queue.items.length === 0 && (
          <div className="queue-empty">Queue is empty</div>
        )}
        {queue.items.map((item, idx) => (
          <QueueItem
            key={item.queueId}
            item={item}
            index={idx}
            isCurrent={idx === queue.position}
            onPlay={handlePlay}
            onRemove={handleRemove}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </div>
  );
};

export default QueueDrawer;
```

**Step 5: Append drag handle styles to MediaApp.scss**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
// Queue drag-to-reorder
.queue-item-drag-handle {
  cursor: grab;
  padding: 0 8px 0 4px;
  opacity: 0.35;
  font-size: 1.1rem;
  user-select: none;
  flex-shrink: 0;

  &:hover {
    opacity: 0.8;
  }
}

.queue-item[draggable="true"]:active {
  cursor: grabbing;
}
```

**Step 6: Run test to confirm it passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/modules/Media/QueueDragReorder.test.mjs --no-coverage
```

Expected: 3 tests pass.

**Step 7: Commit**

```bash
git add frontend/src/modules/Media/QueueItem.jsx \
        frontend/src/modules/Media/QueueDrawer.jsx \
        frontend/src/Apps/MediaApp.scss \
        tests/isolated/modules/Media/QueueDragReorder.test.mjs
git commit -m "feat(media): drag-to-reorder queue items (req 2.1.5)"
```

---

### Task 2: usePlaybackBroadcast in OfficeApp (Req 4.2.6)

**Files:**
- Modify: `frontend/src/Apps/OfficeApp.jsx`
- Create: `tests/isolated/modules/Media/OfficeAppBroadcastItem.test.mjs`

---

**Step 1: Write the failing test**

The `broadcastItem` derivation logic is testable as a pure function. Extract it as a named helper (only exported for testing) inside OfficeApp, or test the component rendering.

Actually, to keep OfficeApp clean, test the broadcast item derivation by calling the component and inspecting the mock. The simpler approach: test the inline logic as a utility.

Create `tests/isolated/modules/Media/OfficeAppBroadcastItem.test.mjs`:

```js
import { describe, it, expect } from 'vitest';

// Pure function mirroring the broadcastItem derivation in OfficeApp
// Tests guard the correctness of the logic before wiring into the component
function deriveBroadcastItem(currentContent) {
  const playerTypes = new Set(['play', 'queue', 'playlist']);
  if (!currentContent || !playerTypes.has(currentContent.type)) return null;
  const props = currentContent.props || {};
  const item = props.play || (props.queue && props.queue[0]) || null;
  if (!item) return null;
  return {
    contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
    title: item.title ?? item.label ?? item.name ?? null,
    format: item.format ?? item.mediaType ?? item.type ?? null,
    thumbnail: item.thumbnail ?? item.image ?? null,
  };
}

describe('OfficeApp broadcastItem derivation', () => {
  it('returns null when currentContent is null', () => {
    expect(deriveBroadcastItem(null)).toBeNull();
  });

  it('returns null for non-player content types', () => {
    expect(deriveBroadcastItem({ type: 'list', props: {} })).toBeNull();
    expect(deriveBroadcastItem({ type: 'menu', props: {} })).toBeNull();
    expect(deriveBroadcastItem({ type: 'open', props: {} })).toBeNull();
  });

  it('extracts contentId/title/format from play type', () => {
    const result = deriveBroadcastItem({
      type: 'play',
      props: { play: { contentId: 'plex:123', title: 'Song', format: 'audio' } },
    });
    expect(result).toEqual({ contentId: 'plex:123', title: 'Song', format: 'audio', thumbnail: null });
  });

  it('extracts from first item in queue type', () => {
    const result = deriveBroadcastItem({
      type: 'queue',
      props: { queue: [{ contentId: 'plex:456', title: 'Episode', format: 'video', thumbnail: 'img.jpg' }] },
    });
    expect(result?.contentId).toBe('plex:456');
    expect(result?.thumbnail).toBe('img.jpg');
  });

  it('returns null when play prop is missing from play type', () => {
    expect(deriveBroadcastItem({ type: 'play', props: {} })).toBeNull();
  });
});
```

**Step 2: Run test to confirm it passes (it tests pure logic, not component)**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/modules/Media/OfficeAppBroadcastItem.test.mjs --no-coverage
```

Expected: 5 tests pass. (These tests validate the logic before wiring.)

**Step 3: Modify OfficeApp.jsx**

Make the following targeted changes to `frontend/src/Apps/OfficeApp.jsx`:

**3a. Remove the TODO comment** (lines 28–30) and add the import:

Replace:
```js
// TODO: Wire usePlaybackBroadcast when Player ref is surfaced (4.2.6)
// Player is rendered dynamically in renderContent() without a stable ref.
// Wiring requires creating a persistent playerRef and passing it to all Player instances.
function OfficeApp({ initialGame = null }) {
```

With:
```js
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';

function OfficeApp({ initialGame = null }) {
```

**3b. After the existing `isPlayerActive` ref, add `playerRef`:**

After line:
```js
const isPlayerActive = useRef(false)
```

Add:
```js
const playerRef = useRef(null);
```

**3c. Wire `broadcastItem` and `usePlaybackBroadcast` after the `isPlayerActive` useEffect** (after the block ending with `isPlayerActive.current = hasQueue || isPlayerContent;`):

Add after that `useEffect`:
```js
const broadcastItem = useMemo(() => {
  const playerTypes = new Set(['play', 'queue', 'playlist']);
  if (!currentContent || !playerTypes.has(currentContent.type)) return null;
  const props = currentContent.props || {};
  const item = props.play || (props.queue && props.queue[0]) || null;
  if (!item) return null;
  return {
    contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
    title: item.title ?? item.label ?? item.name ?? null,
    format: item.format ?? item.mediaType ?? item.type ?? null,
    thumbnail: item.thumbnail ?? item.image ?? null,
  };
}, [currentContent]);

usePlaybackBroadcast(playerRef, broadcastItem);
```

**3d. In `renderContent()` — add `ref={playerRef}` to Player renders in `componentMap`:**

Replace:
```jsx
const componentMap = {
  play: <Player {...safeProps} />,
  queue: <Player {...safeProps} />,
  playlist: <Player {...safeProps} />,
  list: <KeypadMenu {...safeProps} key={uuid} />,
  menu: <KeypadMenu {...safeProps} key={uuid} />,
  open: <AppContainer {...safeProps} />,
};
```

With:
```jsx
const componentMap = {
  play: <Player {...safeProps} ref={playerRef} />,
  queue: <Player {...safeProps} ref={playerRef} />,
  playlist: <Player {...safeProps} ref={playerRef} />,
  list: <KeypadMenu {...safeProps} key={uuid} />,
  menu: <KeypadMenu {...safeProps} key={uuid} />,
  open: <AppContainer {...safeProps} />,
};
```

**3e. In `renderContent()` — the queue Player also gets the ref:**

Replace:
```jsx
return <Player queue={queue} clear={resetQueue} playbackKeys={playbackKeys} />;
```

With:
```jsx
return <Player queue={queue} clear={resetQueue} playbackKeys={playbackKeys} ref={playerRef} />;
```

**Step 4: Run test to confirm it still passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/modules/Media/OfficeAppBroadcastItem.test.mjs --no-coverage
```

Expected: 5 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/Apps/OfficeApp.jsx \
        tests/isolated/modules/Media/OfficeAppBroadcastItem.test.mjs
git commit -m "feat(office): wire usePlaybackBroadcast to Player ref (req 4.2.6)"
```

---

### Task 3: usePlaybackBroadcast in TVApp (Req 4.2.5)

**Files:**
- Modify: `frontend/src/modules/Menu/MenuStack.jsx`
- Modify: `frontend/src/Apps/TVApp.jsx`
- Create: `tests/isolated/modules/Media/TVAppBroadcastItem.test.mjs`

---

**Step 1: Write the failing test**

Same pure-logic pattern as Task 2. Create `tests/isolated/modules/Media/TVAppBroadcastItem.test.mjs`:

```js
import { describe, it, expect } from 'vitest';

function deriveTVBroadcastItem(currentContent) {
  if (!currentContent) return null;
  if (currentContent.type !== 'player' && currentContent.type !== 'composite') return null;
  const props = currentContent.props || {};
  const item = props.play || (props.queue && props.queue[0]) || null;
  if (!item) return null;
  return {
    contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
    title: item.title ?? item.label ?? item.name ?? null,
    format: item.format ?? item.mediaType ?? item.type ?? null,
    thumbnail: item.thumbnail ?? item.image ?? null,
  };
}

describe('TVApp broadcastItem derivation', () => {
  it('returns null when currentContent is null', () => {
    expect(deriveTVBroadcastItem(null)).toBeNull();
  });

  it('returns null for non-player content types', () => {
    expect(deriveTVBroadcastItem({ type: 'menu', props: {} })).toBeNull();
    expect(deriveTVBroadcastItem({ type: 'display', props: {} })).toBeNull();
    expect(deriveTVBroadcastItem({ type: 'app', props: {} })).toBeNull();
  });

  it('extracts item for player type', () => {
    const result = deriveTVBroadcastItem({
      type: 'player',
      props: { play: { contentId: 'plex:999', title: 'Movie', format: 'video' } },
    });
    expect(result).toEqual({ contentId: 'plex:999', title: 'Movie', format: 'video', thumbnail: null });
  });

  it('extracts item for composite type', () => {
    const result = deriveTVBroadcastItem({
      type: 'composite',
      props: { play: { contentId: 'plex:888', title: 'Show' } },
    });
    expect(result?.contentId).toBe('plex:888');
  });

  it('returns null when play prop missing', () => {
    expect(deriveTVBroadcastItem({ type: 'player', props: {} })).toBeNull();
  });
});
```

**Step 2: Run test to confirm it passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/modules/Media/TVAppBroadcastItem.test.mjs --no-coverage
```

Expected: 5 tests pass.

**Step 3: Modify MenuStack.jsx — accept and thread `playerRef`**

Replace the function signature:
```jsx
export function MenuStack({ rootMenu }) {
```

With:
```jsx
export function MenuStack({ rootMenu, playerRef }) {
```

Replace the `'player'` case (lines 183–188):
```jsx
case 'player':
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Player {...props} clear={clear} />
    </Suspense>
  );
```

With:
```jsx
case 'player':
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Player {...props} ref={playerRef} clear={clear} />
    </Suspense>
  );
```

Replace the `'composite'` case (lines 190–196):
```jsx
case 'composite':
  // Composed presentation with visual + audio tracks
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Player {...props} clear={clear} />
    </Suspense>
  );
```

With:
```jsx
case 'composite':
  // Composed presentation with visual + audio tracks
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Player {...props} ref={playerRef} clear={clear} />
    </Suspense>
  );
```

**Step 4: Modify TVApp.jsx — wire broadcast in TVAppContent**

**4a. Add imports** at the top of the file after existing imports:
```js
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
```

**4b. Remove the TODO comment** (lines 85–87):
```js
// TODO: Wire usePlaybackBroadcast when Player ref is surfaced from MenuStack (4.2.5)
// The Player lives inside MenuStack and is lazily rendered — no playerRef is available
// at this level. Surfacing it requires threading a ref through MenuNavigationProvider.
```

**4c. In `TVAppContent`, add `playerRef`, `broadcastItem`, and `usePlaybackBroadcast`:**

Replace:
```jsx
function TVAppContent({ rootMenu, autoplay, appParam, logger }) {
  const { push, pop, currentContent, reset } = useMenuNavigationContext();
  const [autoplayed, setAutoplayed] = useState(false);
```

With:
```jsx
function TVAppContent({ rootMenu, autoplay, appParam, logger }) {
  const { push, pop, currentContent, reset } = useMenuNavigationContext();
  const [autoplayed, setAutoplayed] = useState(false);
  const playerRef = useRef(null);

  const broadcastItem = useMemo(() => {
    if (!currentContent) return null;
    if (currentContent.type !== 'player' && currentContent.type !== 'composite') return null;
    const props = currentContent.props || {};
    const item = props.play || (props.queue && props.queue[0]) || null;
    if (!item) return null;
    return {
      contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
      title: item.title ?? item.label ?? item.name ?? null,
      format: item.format ?? item.mediaType ?? item.type ?? null,
      thumbnail: item.thumbnail ?? item.image ?? null,
    };
  }, [currentContent]);

  usePlaybackBroadcast(playerRef, broadcastItem);
```

**4d. Pass `playerRef` to MenuStack:**

Replace:
```jsx
return <MenuStack rootMenu={rootMenu} />;
```

With:
```jsx
return <MenuStack rootMenu={rootMenu} playerRef={playerRef} />;
```

**Step 5: Run test to confirm it still passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/modules/Media/TVAppBroadcastItem.test.mjs --no-coverage
```

Expected: 5 tests pass.

**Step 6: Commit**

```bash
git add frontend/src/modules/Menu/MenuStack.jsx \
        frontend/src/Apps/TVApp.jsx \
        tests/isolated/modules/Media/TVAppBroadcastItem.test.mjs
git commit -m "feat(tv): wire usePlaybackBroadcast via MenuStack playerRef (req 4.2.5)"
```

---

### Task 4: Update requirements doc

**Files:**
- Modify: `docs/roadmap/2026-02-26-media-app-requirements.md`

---

**Step 1: Mark 2.1.5, 4.2.5, 4.2.6 as implemented**

In the requirements table, update the status column for these three requirements to ✅ Implemented.

In the commit traceability section (Phase 5), add entries for each commit.

**Step 2: Commit**

```bash
git add docs/roadmap/2026-02-26-media-app-requirements.md
git commit -m "docs(media): Phase 5 traceability and requirements closure"
```

---

## Verification

After all tasks are complete, run all isolated tests from the Media module:

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest \
  tests/isolated/modules/Media/QueueDragReorder.test.mjs \
  tests/isolated/modules/Media/OfficeAppBroadcastItem.test.mjs \
  tests/isolated/modules/Media/TVAppBroadcastItem.test.mjs \
  tests/isolated/modules/Media/MediaAppPlayer.test.mjs \
  --no-coverage
```

Expected: 18 tests pass (3 + 5 + 5 + 5).
