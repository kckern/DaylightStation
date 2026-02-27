# MediaApp Phase 3 Implementation Plan — Device Monitoring, Casting & Cross-Device Sync

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add device monitoring, casting, and playback broadcast so MediaApp can see and control all household media devices.

**Architecture:** Playback broadcast hooks send state to the backend via WebSocket, which rebroadcasts on per-device topics. A device monitor hook aggregates all playback state for the DevicePanel UI. Casting leverages the existing WakeAndLoadService. Cross-device sync was implemented in Phase 2 and needs verification only.

**Tech Stack:** React hooks, WebSocket pub/sub, existing device REST API, existing WakeAndLoadService

**Design Doc:** `docs/plans/2026-02-27-media-app-phase3-design.md`
**Requirements Doc:** `docs/roadmap/2026-02-26-media-app-requirements.md` (sections 4, 5, 7)

---

## Task 1: useMediaClientId Hook

**Reqs:** 4.2.7
**Files:**
- Create: `frontend/src/hooks/media/useMediaClientId.js`
- Test: `tests/isolated/hooks/useMediaClientId.test.mjs`

**What it does:** Generates a persistent 8-char hex ID in localStorage. Auto-generates a display name from the user-agent (e.g., "Chrome on MacBook"). Returns `{ clientId, displayName }`.

**Step 1: Write the test**

```javascript
// tests/isolated/hooks/useMediaClientId.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store = {};
const mockLocalStorage = {
  getItem: vi.fn(k => store[k] ?? null),
  setItem: vi.fn((k, v) => { store[k] = v; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true });

// Mock navigator.userAgent
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/120.0' },
  writable: true,
});

describe('useMediaClientId', () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    vi.clearAllMocks();
  });

  it('generates a new clientId on first call', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useMediaClientId } = await import('#frontend/hooks/media/useMediaClientId.js');
    const { result } = renderHook(() => useMediaClientId());

    expect(result.current.clientId).toMatch(/^[0-9a-f]{8}$/);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'daylight_media_client_id',
      expect.stringMatching(/^[0-9a-f]{8}$/)
    );
  });

  it('reuses existing clientId from localStorage', async () => {
    store['daylight_media_client_id'] = 'abcd1234';
    const { renderHook } = await import('@testing-library/react');
    const { useMediaClientId } = await import('#frontend/hooks/media/useMediaClientId.js');
    const { result } = renderHook(() => useMediaClientId());

    expect(result.current.clientId).toBe('abcd1234');
  });

  it('generates displayName from user-agent', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useMediaClientId } = await import('#frontend/hooks/media/useMediaClientId.js');
    const { result } = renderHook(() => useMediaClientId());

    expect(result.current.displayName).toBe('Chrome on Mac');
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/isolated/hooks/useMediaClientId.test.mjs
```

**Step 3: Implement the hook**

```javascript
// frontend/src/hooks/media/useMediaClientId.js
import { useMemo } from 'react';

const STORAGE_KEY = 'daylight_media_client_id';
const NAME_KEY = 'daylight_media_client_name';

function generateHexId() {
  return Math.random().toString(16).slice(2, 10);
}

function parseUserAgent(ua) {
  const browser = /Edg/.test(ua) ? 'Edge'
    : /Chrome/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari'
    : /Firefox/.test(ua) ? 'Firefox'
    : 'Browser';

  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';

  return `${browser} on ${os}`;
}

export function useMediaClientId() {
  return useMemo(() => {
    let clientId = localStorage.getItem(STORAGE_KEY);
    if (!clientId) {
      clientId = generateHexId();
      localStorage.setItem(STORAGE_KEY, clientId);
    }

    let displayName = localStorage.getItem(NAME_KEY);
    if (!displayName) {
      displayName = parseUserAgent(navigator.userAgent);
      localStorage.setItem(NAME_KEY, displayName);
    }

    return { clientId, displayName };
  }, []);
}

export default useMediaClientId;
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add frontend/src/hooks/media/useMediaClientId.js tests/isolated/hooks/useMediaClientId.test.mjs
git commit -m "feat(media): 4.2.7 add useMediaClientId hook for persistent browser identity"
```

---

## Task 2: useDeviceIdentity Hook

**Reqs:** 4.2.3
**Files:**
- Create: `frontend/src/hooks/media/useDeviceIdentity.js`
- Test: `tests/isolated/hooks/useDeviceIdentity.test.mjs`

**What it does:** Reads `deviceId` from URL query params (injected by WakeAndLoadService when loading content onto kiosk devices). Returns `{ deviceId, isKiosk }`. For browser MediaApp clients, both are null/false.

**Step 1: Write the test**

```javascript
// tests/isolated/hooks/useDeviceIdentity.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';

describe('useDeviceIdentity', () => {
  beforeEach(() => {
    // Reset location.search
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  it('returns null deviceId when no query param', async () => {
    window.location.search = '';
    const { renderHook } = await import('@testing-library/react');
    const { useDeviceIdentity } = await import('#frontend/hooks/media/useDeviceIdentity.js');
    const { result } = renderHook(() => useDeviceIdentity());

    expect(result.current.deviceId).toBeNull();
    expect(result.current.isKiosk).toBe(false);
  });

  it('reads deviceId from query param', async () => {
    window.location.search = '?deviceId=living-room-tv&play=hymn:198';
    const { renderHook } = await import('@testing-library/react');
    const { useDeviceIdentity } = await import('#frontend/hooks/media/useDeviceIdentity.js');
    const { result } = renderHook(() => useDeviceIdentity());

    expect(result.current.deviceId).toBe('living-room-tv');
    expect(result.current.isKiosk).toBe(true);
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```javascript
// frontend/src/hooks/media/useDeviceIdentity.js
import { useMemo } from 'react';

export function useDeviceIdentity() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceId = params.get('deviceId') || null;
    return { deviceId, isKiosk: deviceId !== null };
  }, []);
}

export default useDeviceIdentity;
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add frontend/src/hooks/media/useDeviceIdentity.js tests/isolated/hooks/useDeviceIdentity.test.mjs
git commit -m "feat(media): 4.2.3 add useDeviceIdentity hook for kiosk device identification"
```

---

## Task 3: Backend playback_state WebSocket Handler

**Reqs:** 4.2.8
**Files:**
- Modify: `backend/src/app.mjs` (after line 651, the media command handler block)
- Test: `tests/isolated/api/eventbus/playbackState.test.mjs`

**What it does:** Catches incoming `playback_state` WebSocket messages and rebroadcasts on `playback:{id}` topic. Pure routing — no mutation.

**Step 1: Write the test**

```javascript
// tests/isolated/api/eventbus/playbackState.test.mjs
import { describe, it, expect, vi } from 'vitest';

describe('playback_state handler', () => {
  it('rebroadcasts playback_state on playback:{deviceId} topic', () => {
    const handlers = [];
    const broadcast = vi.fn();
    const eventBus = {
      onClientMessage: vi.fn(fn => handlers.push(fn)),
      broadcast,
    };

    // Simulate the handler registration pattern
    eventBus.onClientMessage((clientId, message) => {
      if (message.topic !== 'playback_state') return;
      const broadcastId = message.deviceId || message.clientId;
      if (!broadcastId) return;
      eventBus.broadcast(`playback:${broadcastId}`, message);
    });

    // Simulate a message from a kiosk device
    handlers[0]('ws-conn-1', {
      topic: 'playback_state',
      deviceId: 'living-room-tv',
      clientId: 'abc123',
      title: 'Test Song',
      state: 'playing',
    });

    expect(broadcast).toHaveBeenCalledWith('playback:living-room-tv', expect.objectContaining({
      title: 'Test Song',
      state: 'playing',
    }));
  });

  it('uses clientId when no deviceId', () => {
    const handlers = [];
    const broadcast = vi.fn();
    const eventBus = {
      onClientMessage: vi.fn(fn => handlers.push(fn)),
      broadcast,
    };

    eventBus.onClientMessage((clientId, message) => {
      if (message.topic !== 'playback_state') return;
      const broadcastId = message.deviceId || message.clientId;
      if (!broadcastId) return;
      eventBus.broadcast(`playback:${broadcastId}`, message);
    });

    handlers[0]('ws-conn-2', {
      topic: 'playback_state',
      clientId: 'browser42',
      title: 'Browser Song',
      state: 'paused',
    });

    expect(broadcast).toHaveBeenCalledWith('playback:browser42', expect.objectContaining({
      title: 'Browser Song',
    }));
  });

  it('ignores messages without topic playback_state', () => {
    const handlers = [];
    const broadcast = vi.fn();
    const eventBus = {
      onClientMessage: vi.fn(fn => handlers.push(fn)),
      broadcast,
    };

    eventBus.onClientMessage((clientId, message) => {
      if (message.topic !== 'playback_state') return;
      const broadcastId = message.deviceId || message.clientId;
      if (!broadcastId) return;
      eventBus.broadcast(`playback:${broadcastId}`, message);
    });

    handlers[0]('ws-conn-3', { topic: 'media:command', action: 'play' });

    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect PASS (this tests the pattern in isolation)**

**Step 3: Add handler to app.mjs**

Insert after line 651 (after the `media:command` handler block), before the routers section:

```javascript
  // Playback state broadcast relay — routes playback_state from any client
  // to playback:{deviceId|clientId} topic for device monitoring (4.2.8)
  eventBus.onClientMessage((clientId, message) => {
    if (message.topic !== 'playback_state') return;
    const broadcastId = message.deviceId || message.clientId;
    if (!broadcastId) return;
    rootLogger.debug?.('eventbus.playback_state.relay', { from: clientId, broadcastId, state: message.state });
    eventBus.broadcast(`playback:${broadcastId}`, message);
  });
```

**Step 4: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add backend/src/app.mjs tests/isolated/api/eventbus/playbackState.test.mjs
git commit -m "feat(media): 4.2.8 add playback_state WebSocket relay handler"
```

---

## Task 4: usePlaybackBroadcast Hook

**Reqs:** 4.2.1
**Files:**
- Create: `frontend/src/hooks/media/usePlaybackBroadcast.js`
- Test: `tests/isolated/hooks/usePlaybackBroadcast.test.mjs`

**What it does:** Reads Player imperative handle every 5s while playing + immediately on state change. Sends `playback_state` WebSocket message. No broadcast when idle.

**Dependencies:** useMediaClientId (Task 1), useDeviceIdentity (Task 2)

**Key reference:** The Player imperative handle pattern exposes:
- `getMediaElement()` → returns the HTMLMediaElement
- `toggle()`, `seek()` — control methods

The hook reads `el.currentTime`, `el.duration`, `el.paused`, `el.src` from the media element.

**Step 1: Write the test**

```javascript
// tests/isolated/hooks/usePlaybackBroadcast.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket send
const mockSend = vi.fn();
vi.mock('#frontend/services/WebSocketService.js', () => ({
  default: { send: (...args) => mockSend(...args) }
}));

// Mock localStorage
const store = { daylight_media_client_id: 'test1234', daylight_media_client_name: 'Test Browser' };
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: vi.fn(k => store[k] ?? null), setItem: vi.fn() },
  writable: true,
});

// Mock navigator
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'TestAgent' },
  writable: true,
});

// Mock window.location
Object.defineProperty(window, 'location', { value: { search: '' }, writable: true });

describe('usePlaybackBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends playback_state when playing', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { usePlaybackBroadcast } = await import('#frontend/hooks/media/usePlaybackBroadcast.js');

    const playerRef = {
      current: {
        getMediaElement: () => ({
          currentTime: 30,
          duration: 200,
          paused: false,
          src: 'http://localhost/api/v1/content/plex:123/stream',
        }),
      },
    };

    renderHook(() => usePlaybackBroadcast(playerRef, {
      contentId: 'plex:123',
      title: 'Test Song',
      format: 'audio',
      thumbnail: '/thumb.jpg',
    }));

    // Advance timer to trigger broadcast
    vi.advanceTimersByTime(5000);

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'playback_state',
      clientId: 'test1234',
      contentId: 'plex:123',
      title: 'Test Song',
      state: 'playing',
      position: 30,
      duration: 200,
    }));
  });

  it('does not broadcast when paused', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { usePlaybackBroadcast } = await import('#frontend/hooks/media/usePlaybackBroadcast.js');

    const playerRef = {
      current: {
        getMediaElement: () => ({
          currentTime: 0, duration: 0, paused: true, src: '',
        }),
      },
    };

    renderHook(() => usePlaybackBroadcast(playerRef, null));

    vi.advanceTimersByTime(5000);

    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```javascript
// frontend/src/hooks/media/usePlaybackBroadcast.js
import { useEffect, useRef } from 'react';
import { useMediaClientId } from './useMediaClientId.js';
import { useDeviceIdentity } from './useDeviceIdentity.js';
import wsService from '../../services/WebSocketService.js';
import getLogger from '../../lib/logging/Logger.js';

const BROADCAST_INTERVAL_MS = 5000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'usePlaybackBroadcast' });
  return _logger;
}

/**
 * Broadcasts playback state to backend every 5s while playing.
 * @param {React.RefObject} playerRef — Player imperative handle with getMediaElement()
 * @param {object|null} currentItem — { contentId, title, format, thumbnail } or null when idle
 */
export function usePlaybackBroadcast(playerRef, currentItem) {
  const { clientId, displayName } = useMediaClientId();
  const { deviceId } = useDeviceIdentity();
  const lastStateRef = useRef(null);

  useEffect(() => {
    if (!currentItem) {
      // Send stop broadcast if we were previously playing
      if (lastStateRef.current === 'playing' || lastStateRef.current === 'paused') {
        wsService.send({
          topic: 'playback_state',
          clientId,
          deviceId,
          displayName,
          contentId: null,
          title: null,
          format: null,
          position: 0,
          duration: 0,
          state: 'stopped',
          thumbnail: null,
        });
        lastStateRef.current = 'stopped';
      }
      return;
    }

    function broadcast() {
      const el = playerRef.current?.getMediaElement?.();
      if (!el || el.paused) return;

      const msg = {
        topic: 'playback_state',
        clientId,
        deviceId,
        displayName,
        contentId: currentItem.contentId,
        title: currentItem.title,
        format: currentItem.format,
        position: Math.round(el.currentTime),
        duration: Math.round(el.duration) || 0,
        state: 'playing',
        thumbnail: currentItem.thumbnail || null,
      };

      wsService.send(msg);
      lastStateRef.current = 'playing';
      logger().debug('broadcast', { contentId: msg.contentId, position: msg.position });
    }

    const interval = setInterval(broadcast, BROADCAST_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [currentItem?.contentId, clientId, deviceId, displayName, playerRef, currentItem]);

  return null;
}

export default usePlaybackBroadcast;
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add frontend/src/hooks/media/usePlaybackBroadcast.js tests/isolated/hooks/usePlaybackBroadcast.test.mjs
git commit -m "feat(media): 4.2.1 add usePlaybackBroadcast hook for 5s interval state broadcast"
```

---

## Task 5: Wire usePlaybackBroadcast into MediaApp, TVApp, OfficeApp

**Reqs:** 4.2.2, 4.2.5, 4.2.6
**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx` (~line 27, after `useMediaApp()`)
- Modify: `frontend/src/Apps/TVApp.jsx` (~line 85, in `TVApp` component)
- Modify: `frontend/src/Apps/OfficeApp.jsx` (in main component)
- Modify: `frontend/src/contexts/MediaAppContext.jsx` (export playerRef for broadcast)

**MediaApp wiring** (simplest — playerRef already exists in context):

In `MediaAppInner` component, after `const { queue, playerRef } = useMediaApp();`:

```javascript
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
// ... inside MediaAppInner:
usePlaybackBroadcast(playerRef, queue.currentItem);
```

**TVApp wiring:**

TVApp doesn't have a single playerRef accessible at the top level — its Player lives inside MenuStack. The simplest approach is to add a ref forwarding mechanism. However, to minimize production risk, we can create a lightweight wrapper:

In `TVApp`, add a top-level ref that gets set when the Player component mounts, then pass it to usePlaybackBroadcast. Since TVApp already has `autoplay` data with content info, we can derive the currentItem.

*Minimal change:* Add `usePlaybackBroadcast` at the TVApp top level, passing a ref that the Player can populate. The Player component likely already has an imperative handle — we just need to surface it.

**OfficeApp wiring:** Same pattern as TVApp — surface the Player ref and pass to the broadcast hook.

**Note:** TVApp and OfficeApp wiring may need exploration of their Player component integration. The subagent should read the Player component and MenuStack to understand how to surface the ref. If too complex, defer TVApp/OfficeApp to a follow-up and just wire MediaApp.

**Step 1: Wire MediaApp (always works — playerRef in context)**

Add import and hook call in `MediaAppInner`.

**Step 2: Wire TVApp**

Read the Player component in `frontend/src/modules/Player/Player.jsx` to understand how to surface a ref. Add `usePlaybackBroadcast` at the TVApp level.

**Step 3: Wire OfficeApp**

Same approach as TVApp.

**Step 4: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git commit -m "feat(media): 4.2.2, 4.2.5, 4.2.6 wire usePlaybackBroadcast into MediaApp, TVApp, OfficeApp"
```

---

## Task 6: useDeviceMonitor Hook

**Reqs:** 4.2.9, 4.1.1, 4.1.2, 4.1.3
**Files:**
- Create: `frontend/src/hooks/media/useDeviceMonitor.js`
- Test: `tests/isolated/hooks/useDeviceMonitor.test.mjs`

**What it does:** Fetches registered devices from `GET /api/v1/device` on mount. Subscribes to WebSocket with predicate `msg => msg.topic?.startsWith('playback:')`. Maintains a `Map` of live playback states that expire after 30s.

**Step 1: Write the test**

```javascript
// tests/isolated/hooks/useDeviceMonitor.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch
const mockDevices = [
  { id: 'living-room-tv', name: 'Living Room TV', capabilities: { contentControl: true, deviceControl: true } },
  { id: 'office-display', name: 'Office Display', capabilities: { contentControl: true, deviceControl: false } },
];

globalThis.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ devices: mockDevices }) })
);

// Mock WebSocket
const subscribers = [];
vi.mock('#frontend/services/WebSocketService.js', () => ({
  default: {
    subscribe: vi.fn((filter, cb) => {
      subscribers.push({ filter, cb });
      return () => {};
    }),
  },
}));

describe('useDeviceMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribers.length = 0;
  });

  it('fetches device list on mount', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useDeviceMonitor } = await import('#frontend/hooks/media/useDeviceMonitor.js');

    const { result } = renderHook(() => useDeviceMonitor());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.devices).toHaveLength(2);
    expect(result.current.devices[0].id).toBe('living-room-tv');
  });

  it('updates playback state from WebSocket messages', async () => {
    const { renderHook, waitFor, act } = await import('@testing-library/react');
    const { useDeviceMonitor } = await import('#frontend/hooks/media/useDeviceMonitor.js');

    const { result } = renderHook(() => useDeviceMonitor());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Simulate a playback state message
    act(() => {
      const sub = subscribers.find(s => typeof s.filter === 'function');
      sub?.cb({
        topic: 'playback:living-room-tv',
        deviceId: 'living-room-tv',
        title: 'Now Playing Song',
        state: 'playing',
        position: 45,
        duration: 180,
      });
    });

    expect(result.current.playbackStates.get('living-room-tv')).toEqual(
      expect.objectContaining({ title: 'Now Playing Song', state: 'playing' })
    );
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```javascript
// frontend/src/hooks/media/useDeviceMonitor.js
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import wsService from '../../services/WebSocketService.js';
import getLogger from '../../lib/logging/Logger.js';

const EXPIRY_MS = 30000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useDeviceMonitor' });
  return _logger;
}

export function useDeviceMonitor() {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackStates, setPlaybackStates] = useState(new Map());
  const timestampsRef = useRef(new Map());

  // Fetch registered devices
  useEffect(() => {
    fetch('/api/v1/device')
      .then(r => r.json())
      .then(data => {
        setDevices(data.devices || []);
        setIsLoading(false);
        logger().info('devices-loaded', { count: data.devices?.length });
      })
      .catch(err => {
        logger().error('devices-fetch-failed', { error: err.message });
        setIsLoading(false);
      });
  }, []);

  // Subscribe to playback state broadcasts
  useEffect(() => {
    const unsubscribe = wsService.subscribe(
      (msg) => msg.topic?.startsWith('playback:'),
      (msg) => {
        const id = msg.deviceId || msg.clientId;
        if (!id) return;

        timestampsRef.current.set(id, Date.now());
        setPlaybackStates(prev => {
          const next = new Map(prev);
          next.set(id, msg);
          return next;
        });
      }
    );

    // Expire stale entries
    const cleanup = setInterval(() => {
      const now = Date.now();
      let changed = false;
      timestampsRef.current.forEach((ts, id) => {
        if (now - ts > EXPIRY_MS) {
          timestampsRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) {
        setPlaybackStates(prev => {
          const next = new Map(prev);
          prev.forEach((_, id) => {
            if (!timestampsRef.current.has(id)) next.delete(id);
          });
          return next;
        });
      }
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(cleanup);
    };
  }, []);

  return { devices, playbackStates, isLoading };
}

export default useDeviceMonitor;
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add frontend/src/hooks/media/useDeviceMonitor.js tests/isolated/hooks/useDeviceMonitor.test.mjs
git commit -m "feat(media): 4.2.9 add useDeviceMonitor hook with device list and live playback aggregation"
```

---

## Task 7: DeviceCard Component

**Reqs:** 4.2.11, 4.1.4–4.1.10
**Files:**
- Create: `frontend/src/modules/Media/DeviceCard.jsx`
- Test: `tests/isolated/modules/Media/DeviceCard.test.mjs`

**What it does:** Renders a device card with two variants:
1. **Registered device** (full controls): name, online dot, now-playing info, transport buttons, volume, power, cast
2. **Browser client** (read-only): name, now-playing info only, "Browser" badge

**Step 1: Write the test**

```javascript
// tests/isolated/modules/Media/DeviceCard.test.mjs
import { describe, it, expect, vi } from 'vitest';

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

describe('DeviceCard', () => {
  it('renders registered device with controls', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { default: DeviceCard } = await import('#frontend/modules/Media/DeviceCard.jsx');

    render(<DeviceCard
      device={{ id: 'tv-1', name: 'Living Room TV', capabilities: { contentControl: true, deviceControl: true } }}
      playbackState={{ title: 'Test Song', state: 'playing', position: 30, duration: 180 }}
      isOnline={true}
      type="device"
    />);

    expect(screen.getByText('Living Room TV')).toBeTruthy();
    expect(screen.getByText('Test Song')).toBeTruthy();
    expect(screen.getByLabelText('Power')).toBeTruthy();
  });

  it('renders browser client as read-only', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { default: DeviceCard } = await import('#frontend/modules/Media/DeviceCard.jsx');

    render(<DeviceCard
      device={{ id: 'browser-1', name: 'Chrome on Mac' }}
      playbackState={{ title: 'Browser Song', state: 'playing' }}
      isOnline={true}
      type="browser"
    />);

    expect(screen.getByText('Chrome on Mac')).toBeTruthy();
    expect(screen.getByText('Browser')).toBeTruthy();
    expect(screen.queryByLabelText('Power')).toBeNull();
  });
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement**

```jsx
// frontend/src/modules/Media/DeviceCard.jsx
import React, { useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

const DeviceCard = ({ device, playbackState, isOnline, type, onCast }) => {
  const logger = useMemo(() => getLogger().child({ component: 'DeviceCard' }), []);
  const isDevice = type === 'device';

  const handlePower = useCallback(() => {
    const action = isOnline ? 'off' : 'on';
    logger.info('device-card.power', { deviceId: device.id, action });
    fetch(`/api/v1/device/${device.id}/${action}`).catch(err =>
      logger.error('device-card.power-failed', { error: err.message })
    );
  }, [device.id, isOnline, logger]);

  const handleVolume = useCallback((e) => {
    const level = Math.round(parseFloat(e.target.value) * 100);
    fetch(`/api/v1/device/${device.id}/volume/${level}`).catch(err =>
      logger.error('device-card.volume-failed', { error: err.message })
    );
  }, [device.id, logger]);

  const progress = playbackState?.duration > 0
    ? (playbackState.position / playbackState.duration) * 100
    : 0;

  return (
    <div className={`device-card ${!isOnline ? 'device-card--offline' : ''} ${!isDevice ? 'device-card--browser' : ''}`}>
      <div className="device-card-header">
        <span className={`device-card-status ${isOnline ? 'online' : 'offline'}`} />
        <span className="device-card-name">{device.name || device.id}</span>
        {!isDevice && <span className="device-card-badge">Browser</span>}
      </div>

      {playbackState && playbackState.state !== 'stopped' && (
        <div className="device-card-playing">
          <div className="device-card-title">{playbackState.title}</div>
          <div className="device-card-progress">
            <div className="device-card-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {!playbackState && isOnline && (
        <div className="device-card-idle">Idle</div>
      )}

      {isDevice && (
        <div className="device-card-controls">
          {device.capabilities?.deviceControl && (
            <button className="device-card-btn" onClick={handlePower} aria-label="Power">
              {isOnline ? '\u23FB' : '\u23FB'}
            </button>
          )}
          {isOnline && device.capabilities?.deviceControl && (
            <input
              type="range"
              min="0" max="1" step="0.05"
              className="device-card-volume"
              onChange={handleVolume}
              aria-label="Volume"
            />
          )}
          {isOnline && device.capabilities?.contentControl && onCast && (
            <button className="device-card-btn" onClick={() => onCast(device.id)} aria-label="Cast">
              &#x1F4E1;
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DeviceCard;
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add frontend/src/modules/Media/DeviceCard.jsx tests/isolated/modules/Media/DeviceCard.test.mjs
git commit -m "feat(media): 4.2.11, 4.1.4-4.1.10 add DeviceCard with controls and browser-client variant"
```

---

## Task 8: DevicePanel Component

**Reqs:** 4.2.10, 4.1.1, 4.1.8, 4.1.9
**Files:**
- Create: `frontend/src/modules/Media/DevicePanel.jsx`

**What it does:** Right-edge drawer (mirrors QueueDrawer pattern). Lists registered devices (always visible) + browser clients ("Also Playing" section). Consumes `useDeviceMonitor()`.

**Step 1: Implement**

```jsx
// frontend/src/modules/Media/DevicePanel.jsx
import React, { useMemo } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import DeviceCard from './DeviceCard.jsx';
import getLogger from '../../lib/logging/Logger.js';

const DevicePanel = ({ open, onClose, onCastToDevice }) => {
  const logger = useMemo(() => getLogger().child({ component: 'DevicePanel' }), []);
  const { devices, playbackStates, isLoading } = useDeviceMonitor();

  if (!open) return null;

  // Separate registered devices from browser-only clients
  const deviceIds = new Set(devices.map(d => d.id));
  const browserClients = [];
  playbackStates.forEach((state, id) => {
    if (!deviceIds.has(id) && !state.deviceId) {
      browserClients.push({ id, name: state.displayName || id, state });
    }
  });

  return (
    <div className="device-panel">
      <div className="device-panel-header">
        <h3>Devices</h3>
        <button className="device-panel-close" onClick={onClose}>&times;</button>
      </div>

      {isLoading && <div className="device-panel-loading">Loading devices...</div>}

      <div className="device-panel-list">
        {devices.map(device => (
          <DeviceCard
            key={device.id}
            device={device}
            playbackState={playbackStates.get(device.id)}
            isOnline={playbackStates.has(device.id)}
            type="device"
            onCast={onCastToDevice}
          />
        ))}

        {browserClients.length > 0 && (
          <>
            <div className="device-panel-divider">Also Playing</div>
            {browserClients.map(client => (
              <DeviceCard
                key={client.id}
                device={client}
                playbackState={client.state}
                isOnline={true}
                type="browser"
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default DevicePanel;
```

**Step 2: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/DevicePanel.jsx
git commit -m "feat(media): 4.2.10, 4.1.1, 4.1.8 add DevicePanel drawer with registered devices and browser clients"
```

---

## Task 9: DevicePicker + CastButton Components

**Reqs:** 5.1.4, 5.2.1, 5.1.1, 5.1.5, 5.1.6
**Files:**
- Create: `frontend/src/modules/Media/DevicePicker.jsx`
- Create: `frontend/src/modules/Media/CastButton.jsx`

**What it does:**
- **CastButton** — Small icon button. On tap opens DevicePicker.
- **DevicePicker** — Bottom sheet modal listing castable devices (those with `content_control`). Tapping a device triggers cast via `GET /api/v1/device/:id/load`.

**Step 1: Implement DevicePicker**

```jsx
// frontend/src/modules/Media/DevicePicker.jsx
import React, { useMemo } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import { useWakeProgress } from '../../modules/Input/hooks/useWakeProgress.js';
import getLogger from '../../lib/logging/Logger.js';

const DevicePicker = ({ open, onClose, contentId, onCastStarted }) => {
  const logger = useMemo(() => getLogger().child({ component: 'DevicePicker' }), []);
  const { devices, playbackStates } = useDeviceMonitor();

  const castableDevices = useMemo(
    () => devices.filter(d => d.capabilities?.contentControl),
    [devices]
  );

  const handleCast = async (deviceId) => {
    logger.info('cast.start', { deviceId, contentId });
    onCastStarted?.(deviceId);
    try {
      const params = new URLSearchParams({ open: '/media', play: contentId });
      const res = await fetch(`/api/v1/device/${deviceId}/load?${params}`);
      const result = await res.json();
      if (result.ok) {
        logger.info('cast.success', { deviceId, totalElapsedMs: result.totalElapsedMs });
      } else {
        logger.warn('cast.failed', { deviceId, error: result.error, failedStep: result.failedStep });
      }
    } catch (err) {
      logger.error('cast.error', { deviceId, error: err.message });
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="device-picker-overlay" onClick={onClose}>
      <div className="device-picker" onClick={e => e.stopPropagation()}>
        <div className="device-picker-header">
          <h3>Cast to device</h3>
        </div>
        <div className="device-picker-list">
          {castableDevices.map(device => {
            const state = playbackStates.get(device.id);
            const isOnline = playbackStates.has(device.id);
            return (
              <button
                key={device.id}
                className={`device-picker-item ${!isOnline ? 'device-picker-item--offline' : ''}`}
                onClick={() => handleCast(device.id)}
              >
                <span className={`device-card-status ${isOnline ? 'online' : 'offline'}`} />
                <span className="device-picker-name">{device.name || device.id}</span>
                {state && state.state !== 'stopped' && (
                  <span className="device-picker-playing">{state.title}</span>
                )}
              </button>
            );
          })}
          {castableDevices.length === 0 && (
            <div className="device-picker-empty">No castable devices found</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DevicePicker;
```

**Step 2: Implement CastButton**

```jsx
// frontend/src/modules/Media/CastButton.jsx
import React, { useState, useCallback } from 'react';
import DevicePicker from './DevicePicker.jsx';

const CastButton = ({ contentId, className = '' }) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    setPickerOpen(o => !o);
  }, []);

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

**Step 3: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/DevicePicker.jsx frontend/src/modules/Media/CastButton.jsx
git commit -m "feat(media): 5.2.1, 5.1.4, 5.1.1, 5.1.5 add CastButton and DevicePicker bottom sheet"
```

---

## Task 10: Wire DevicePanel + CastButton into MediaApp

**Reqs:** 4.2.2, 5.1.2, 5.1.3, 5.2.1
**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx` — Add DevicePanel, device toggle button, CastButton
- Modify: `frontend/src/modules/Media/NowPlaying.jsx` — Add CastButton and device toggle to transport
- Modify: `frontend/src/modules/Media/QueueItem.jsx` — Add CastButton per item
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx` — Add Cast action per result

**Step 1: Wire MediaApp**

Add imports for `DevicePanel`. Add `devicePanelOpen` state. Add `DevicePanel` component to JSX. Pass `onDeviceToggle` prop to NowPlaying.

```jsx
// In MediaApp.jsx, add to imports:
import DevicePanel from '../modules/Media/DevicePanel.jsx';

// Add state:
const [devicePanelOpen, setDevicePanelOpen] = useState(false);

// Add to JSX (after ContentBrowser):
<DevicePanel
  open={devicePanelOpen}
  onClose={() => setDevicePanelOpen(false)}
/>

// Add prop to NowPlaying:
onDeviceToggle={() => setDevicePanelOpen(o => !o)}
```

**Step 2: Wire NowPlaying transport**

Add `onDeviceToggle` prop. Add device button next to queue toggle. Add `CastButton` for current item.

```jsx
// In NowPlaying.jsx, add import:
import CastButton from './CastButton.jsx';

// Add prop: onDeviceToggle
// Add to transport controls (before queue toggle):
{currentItem && <CastButton contentId={currentItem.contentId} className="media-transport-btn" />}
{onDeviceToggle && (
  <button className="media-transport-btn" onClick={onDeviceToggle} aria-label="Devices">
    &#x1F4F1;
  </button>
)}
```

**Step 3: Wire QueueItem**

Add `CastButton` to each queue item:

```jsx
// In QueueItem.jsx, add import:
import CastButton from './CastButton.jsx';

// Add before the remove button:
<CastButton contentId={item.contentId} className="queue-item-cast" />
```

**Step 4: Wire ContentBrowser**

Add cast action to search result actions:

```jsx
// In ContentBrowser.jsx, add import:
import CastButton from './CastButton.jsx';

// Add to search-result-actions div (after Add to Queue button):
<CastButton contentId={item.contentId} className="search-action-cast" />
```

**Step 5: Verify build**

```bash
cd frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 6: Commit**

```bash
git commit -m "feat(media): wire DevicePanel and CastButton into MediaApp, NowPlaying, QueueItem, ContentBrowser"
```

---

## Task 11: SCSS for DevicePanel, DeviceCard, CastButton, DevicePicker

**Reqs:** styling for sections 4 and 5
**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss` — Append new styles

**Key styles to add:**

```scss
// Device Panel (right-edge drawer)
.device-panel { ... }

// Device Card (registered + browser variants)
.device-card { ... }
.device-card--offline { ... }
.device-card--browser { ... }

// Device Picker (bottom sheet modal)
.device-picker-overlay { ... }
.device-picker { ... }

// Cast Button
.cast-btn { ... }
```

Follow the existing SCSS patterns in MediaApp.scss (dark theme, #1db954 accent, mobile-first). The DevicePanel should mirror QueueDrawer but slide from the right instead of left/bottom.

**Step 1: Write SCSS**

Append to end of `MediaApp.scss`. Follow existing patterns:
- Dark backgrounds (#121212, #181818, #282828)
- Green accent (#1db954)
- Responsive breakpoints matching existing media queries

**Step 2: Verify build**

**Step 3: Commit**

```bash
git commit -m "style(media): add SCSS for DevicePanel, DeviceCard, CastButton, DevicePicker"
```

---

## Task 12: ?device= URL Parameter for Targeted Cast

**Reqs:** 5.2.3, 5.1.7
**Files:**
- Modify: `frontend/src/hooks/media/useMediaUrlParams.js`
- Modify: `frontend/src/Apps/MediaApp.jsx` (handle device param)

**What it does:** When `?device=living-room-tv` is in the URL, content is sent to that device instead of playing locally. Combined with `?play=` or alias params.

**Step 1: Extend useMediaUrlParams**

The hook currently returns `{ play: {...} }` or `{ queue: {...} }`. Add a `device` field:

```javascript
// In useMediaUrlParams.js
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
  return { ...command, device };
}
```

**Step 2: Handle in MediaApp**

In the URL command effect, check for `device`:

```javascript
if (urlCommand?.device && playCommand?.contentId) {
  // Cast to device instead of playing locally
  const params = new URLSearchParams({ open: '/media', play: contentId });
  fetch(`/api/v1/device/${urlCommand.device}/load?${params}`);
  return;
}
```

**Step 3: Verify build**

**Step 4: Commit**

```bash
git commit -m "feat(media): 5.2.3, 5.1.7 add ?device= URL param for targeted device cast"
```

---

## Task 13: Fix Phase 2 Deferred Items

**Reqs:** 6.1.4, 6.2.2, 6.1.12, 3.1.13
**Files:**
- Modify: `backend/src/app.mjs` (media:command handler, ~line 609)
- Modify: `frontend/src/Apps/MediaApp.jsx` (URL command handler)

**6.1.4 + 6.2.2 — WebSocket `queue` command + content resolution:**

The `media:command` handler in app.mjs (line 609) needs `contentIdResolver` in scope to resolve container contents for the `queue` action. The `contentIdResolver` is available via `contentServices.contentQueryService` which is in scope at the handler location.

Add `queue` action:

```javascript
} else if (action === 'queue') {
  // Replace entire queue with container contents
  await mediaQueueService.clear(householdId);
  // Resolve container (e.g., album, playlist)
  const resolved = await contentServices.contentQueryService.resolveContainer(contentId);
  const items = (resolved || [{ contentId }]).map(i => ({ ...i, addedFrom: 'WEBSOCKET' }));
  await mediaQueueService.addItems(items, 'end', householdId);
  await mediaQueueService.setPosition(0, householdId);
  const updated = await mediaQueueService.load(householdId);
  eventBus.broadcast('media:queue', updated.toJSON());
}
```

**Note:** Check if `contentQueryService.resolveContainer()` exists. If not, use the simpler approach of adding the single contentId. The subagent should read `ContentQueryService.mjs` to verify the available methods.

**6.1.12 — URL `?shuffle=true`:**

In MediaApp.jsx URL command handler, add after volume handling:

```javascript
if (playCommand.shuffle) queue.setShuffle(true);
```

**3.1.13 — Cast from search result:**

Already done — CastButton was added to ContentBrowser in Task 10.

**Commit:**

```bash
git commit -m "feat(media): 6.1.4, 6.2.2, 6.1.12 fix deferred WS queue command and URL shuffle param"
```

---

## Task 14: Section 7 Verification + Requirements Doc Update

**Reqs:** 7.1.1–7.1.11, all Phase 3
**Files:**
- Modify: `docs/roadmap/2026-02-26-media-app-requirements.md`

**What it does:** Mark Section 7 requirements as Done (they were implemented in Phase 2 via useMediaQueue). Update Phase 3 commit traceability. Change status to "Phase 3 Implemented."

**Section 7 status updates:**

| ID | Status | Notes |
|----|--------|-------|
| 7.1.1 | Done | useMediaQueue fetches on mount, WebSocket sync |
| 7.1.2 | Done | media:queue broadcast after addItems |
| 7.1.3 | Done | media:queue broadcast after removeItem |
| 7.1.4 | Done | media:queue broadcast after reorder |
| 7.1.5 | Done | media:queue broadcast includes position |
| 7.1.6 | Done | Optimistic updates in useMediaQueue |
| 7.1.7 | Done | Rollback + toast on failure |
| 7.1.8 | Done | Auto-retry after 2s |
| 7.1.9 | Done | Player only needs currentItem in memory |
| 7.1.10 | Done | Node event loop serialization |
| 7.1.11 | Done | mutationId self-echo suppression |

**Add Phase 3 commits table** with all commits from Tasks 1–13.

**Commit:**

```bash
git commit -m "docs(media): update requirements doc with Phase 3 traceability and Section 7 verification"
```

---

## Parallelism Map

```
Tasks 1, 2, 3  →  independent (run in parallel)
Task 4          →  depends on 1, 2
Task 5          →  depends on 3, 4
Task 6          →  depends on 3 (can start after Task 3)
Tasks 7, 9      →  depend on 6 (can run in parallel with each other)
Task 8          →  depends on 7
Task 10         →  depends on 8, 9
Task 11         →  depends on 10 (or run in parallel)
Task 12         →  depends on 9
Task 13         →  independent (can run anytime after Task 5)
Task 14         →  last (after all commits)
```

---

## Summary

| Task | Component | Reqs | Dependencies |
|------|-----------|------|-------------|
| 1 | useMediaClientId | 4.2.7 | — |
| 2 | useDeviceIdentity | 4.2.3 | — |
| 3 | Backend playback_state handler | 4.2.8 | — |
| 4 | usePlaybackBroadcast | 4.2.1 | 1, 2 |
| 5 | Wire broadcast (MediaApp, TVApp, OfficeApp) | 4.2.2, 4.2.5, 4.2.6 | 3, 4 |
| 6 | useDeviceMonitor | 4.2.9, 4.1.1-4.1.3 | 3 |
| 7 | DeviceCard | 4.2.11, 4.1.4-4.1.10 | 6 |
| 8 | DevicePanel | 4.2.10, 4.1.1, 4.1.8 | 7 |
| 9 | DevicePicker + CastButton | 5.2.1, 5.1.4, 5.1.1, 5.1.5 | 6 |
| 10 | Wire DevicePanel + CastButton into MediaApp | 5.1.2, 5.1.3 | 8, 9 |
| 11 | SCSS styles | styling | 10 |
| 12 | ?device= URL param | 5.2.3, 5.1.7 | 9 |
| 13 | Fix Phase 2 deferred items | 6.1.4, 6.2.2, 6.1.12 | 5 |
| 14 | Section 7 verification + docs | 7.1.1-7.1.11 | all |
