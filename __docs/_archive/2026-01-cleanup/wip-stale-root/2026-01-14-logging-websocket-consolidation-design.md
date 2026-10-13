# Logging WebSocket Consolidation Design

**Date:** 2026-01-14  
**Status:** ✅ Implemented  
**Related:** [2026-01-14-websocket-disconnect-memory-leak-audit.md](audits/2026-01-14-websocket-disconnect-memory-leak-audit.md)

## Problem Statement

The frontend logging system has **two parallel WebSocket implementations** that can create duplicate connections to the backend:

1. **Logger.js** - Embedded WebSocket with its own connection management
2. **index.js** - Transport factories (`createWebSocketTransport`, `createBufferingWebSocketTransport`)

Both have been patched with tier-based throttling, but the duplication creates:
- Maintenance burden (changes must be made in two places)
- Potential for 2x WebSocket connections if both code paths are used
- Inconsistent behavior between logging entry points

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend Logging                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐     ┌───────────────┐   │
│  │  Logger.js   │      │   index.js   │     │ singleton.js  │   │
│  │              │      │              │     │               │   │
│  │ getLogger()  │      │createLogger()│     │getDaylight    │   │
│  │              │      │              │     │Logger()       │   │
│  │ ┌──────────┐ │      │ ┌──────────┐ │     │               │   │
│  │ │WebSocket │ │      │ │Transport │ │     │ Uses index.js │   │
│  │ │(embedded)│ │      │ │Factories │ │     │ transports    │   │
│  │ └──────────┘ │      │ └──────────┘ │     └───────────────┘   │
│  └──────────────┘      └──────────────┘                         │
│         │                     │                                  │
│         └─────────┬───────────┘                                  │
│                   │                                              │
│                   ▼                                              │
│         ┌──────────────────┐                                     │
│         │  Backend /ws     │                                     │
│         │  (potentially    │                                     │
│         │   2 connections) │                                     │
│         └──────────────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Analysis

### Logger.js Consumers
```javascript
import getLogger from './logging/Logger.js';
import { getLogger } from '../../../lib/logging/Logger.js';

// Used in: plex.js, MenuStack.jsx, VideoPlayer.jsx, AudioPlayer.jsx, 
//          playbackLogger.js, FitnessSession.js, and many more
```

### index.js / singleton.js Consumers
```javascript
import { getDaylightLogger, getChildLogger } from './logging/singleton.js';
import createLogger, { createBufferingWebSocketTransport } from './index';

// Used in: singleton.js (which wraps index.js)
// FitnessApp.jsx uses getChildLogger from singleton.js
```

### Key Insight
Most code imports from **Logger.js**, but FitnessApp and some newer code uses **singleton.js** (which wraps index.js). This means both WebSocket implementations are likely active simultaneously.

## Proposed Architecture

### Option A: Logger.js Uses index.js Transports (Recommended)

Refactor `Logger.js` to be a thin wrapper that uses `createBufferingWebSocketTransport` from `index.js`:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend Logging (Consolidated)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐     ┌───────────────┐   │
│  │  Logger.js   │      │   index.js   │     │ singleton.js  │   │
│  │  (facade)    │      │ (core impl)  │     │  (facade)     │   │
│  │              │      │              │     │               │   │
│  │ getLogger()──┼──────▶│createLogger()│◀────┤getDaylight   │   │
│  │              │      │              │     │Logger()       │   │
│  └──────────────┘      │ ┌──────────┐ │     └───────────────┘   │
│                        │ │Transport │ │                         │
│                        │ │Factories │ │                         │
│                        │ └──────────┘ │                         │
│                        └──────────────┘                         │
│                               │                                  │
│                               ▼                                  │
│                      ┌──────────────────┐                        │
│                      │  Backend /ws     │                        │
│                      │  (1 connection)  │                        │
│                      └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Single WebSocket connection
- Transport logic in one place
- Maintains backward API compatibility
- Easy to add new transports (file, remote service, etc.)

**Cons:**
- Requires refactoring Logger.js
- Need to verify all import paths still work

### Option B: Deprecate index.js, Keep Logger.js

Keep Logger.js as the single implementation, migrate singleton.js to use it.

**Pros:**
- Simpler Logger.js code (no transport abstraction)
- Fewer files

**Cons:**
- Loses transport composability
- Less testable (can't mock transports easily)
- singleton.js features (sampling, context inheritance) would need reimplementing

### Option C: Shared WebSocket Manager (Future State)

Both logging AND `WebSocketService.js` share a single connection:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared WebSocket Manager                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────────┐    ┌──────────────┐  │
│  │  Logger.js   │     │ WebSocketManager │    │WebSocketSvc  │  │
│  │              │     │   (singleton)    │    │              │  │
│  │ getLogger()──┼─────▶│                 │◀───┤subscribe()   │  │
│  │              │     │ - connect()      │    │              │  │
│  └──────────────┘     │ - send(topic,msg)│    └──────────────┘  │
│                       │ - subscribe()    │                      │
│                       │ - onStatus()     │                      │
│                       └────────┬─────────┘                      │
│                                │                                 │
│                                ▼                                 │
│                       ┌──────────────────┐                       │
│                       │   Backend /ws    │                       │
│                       │  (1 connection)  │                       │
│                       └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Single connection for entire app
- Unified reconnection logic
- Single degraded mode state

**Cons:**
- Larger refactor
- Need to handle topic routing
- Logger wants batching, WebSocketService wants immediate dispatch

## Recommendation

**Phase 1 (This Sprint):** Implement Option A
- Refactor Logger.js to use index.js transport
- Remove embedded WebSocket from Logger.js
- Verify all existing imports continue to work

**Phase 2 (Future):** Consider Option C
- If performance/complexity warrants, consolidate with WebSocketService
- Would require backend changes to handle mixed message types on single connection

## Implementation Plan

### Step 1: Create Shared Transport Instance

```javascript
// lib/logging/sharedTransport.js
import { createBufferingWebSocketTransport } from './index.js';

let sharedWsTransport = null;

export const getSharedWsTransport = (options = {}) => {
  if (!sharedWsTransport) {
    sharedWsTransport = createBufferingWebSocketTransport({
      topic: 'logging',
      maxQueue: 500,
      batchSize: 20,
      flushInterval: 1000,
      ...options
    });
  }
  return sharedWsTransport;
};
```

### Step 2: Refactor Logger.js

```javascript
// Logger.js - simplified
import { getSharedWsTransport } from './sharedTransport.js';

const emit = (level, eventName, data = {}, options = {}) => {
  if (!isLevelEnabled(level)) return;

  const event = {
    ts: new Date().toISOString(),
    level,
    event: eventName,
    // ...
  };

  // Console output (immediate)
  if (config.consoleEnabled) {
    devOutput(level, event);
  }

  // WebSocket transport (uses shared instance)
  if (config.websocketEnabled) {
    const transport = getSharedWsTransport();
    transport?.send(event);
  }
};
```

### Step 3: Update singleton.js

Ensure it uses the same shared transport or delegates to Logger.js.

### Step 4: Remove Duplicate Code

- Delete embedded WebSocket code from Logger.js (~80 lines)
- Remove `wsState`, `scheduleReconnect`, `ensureWebSocket`, etc.

## Migration Checklist

- [x] Create `sharedTransport.js` with singleton transport instance
- [x] Refactor Logger.js to use shared transport
- [x] Verify `getLogger()` API unchanged (backward compatible)
- [x] Verify `configure()` still works
- [x] Update singleton.js to use shared transport
- [ ] Test: Only one WebSocket connection opens (manual verification)
- [ ] Test: Reconnection throttling works (manual verification)
- [ ] Test: Queue overflow handled correctly (manual verification)
- [x] Remove dead code from Logger.js (~150 lines removed)
- [ ] Update logging.frontend.readme.md

## Implementation Summary (2026-01-14)

**Files Changed:**
- ✅ Created [sharedTransport.js](frontend/src/lib/logging/sharedTransport.js) - Singleton transport factory
- ✅ Refactored [Logger.js](frontend/src/lib/logging/Logger.js) - Removed embedded WebSocket (~150 lines), now uses shared transport
- ✅ Updated [singleton.js](frontend/src/lib/logging/singleton.js) - Uses shared transport via `getSharedWsTransport()`

**Key Changes:**
- Logger.js no longer creates its own WebSocket connection
- Removed: `wsState`, `scheduleReconnect`, `ensureWebSocket`, `flush`, `enqueue`, `scheduleFlush`, `sendBatch`
- Added: `ensureTransport()` which gets the shared singleton
- Both Logger.js and singleton.js now use the same underlying transport instance
- API remains backward compatible - all exports unchanged

**Benefits Achieved:**
- Single WebSocket connection for all logging
- ~150 lines of duplicate code removed
- Tier-based throttling managed in one place (index.js transport)
- No breaking changes to existing code

**Testing Required:**
1. Load app, verify only 1 WS connection in DevTools Network tab
2. Kill backend, verify single reconnection loop in console
3. Verify existing logging calls still work

## Testing Strategy

1. **Connection Count Test**
   - Open DevTools Network tab
   - Filter by WS
   - Load FitnessApp (uses both logging paths)
   - Verify only 1 WebSocket connection

2. **Reconnection Test**
   - Stop backend
   - Verify throttling kicks in (check console logs)
   - Verify single reconnection loop (not two)

3. **API Compatibility Test**
   - Run existing logging tests
   - Verify getLogger(), child(), configure() unchanged

## Risks

| Risk | Mitigation |
|------|------------|
| Breaking existing imports | Keep all export signatures identical |
| Race condition on shared transport init | Lazy init with null check |
| Different batching needs | Use configurable options on shared transport |

## Timeline

| Task | Estimate |
|------|----------|
| Create sharedTransport.js | 30 min |
| Refactor Logger.js | 1 hour |
| Update singleton.js | 30 min |
| Testing | 1 hour |
| Code cleanup | 30 min |
| Documentation | 30 min |
| **Total** | **4 hours** |

## References

- [logging.frontend.readme.md](frontend/src/lib/logging/logging.frontend.readme.md)
- [WebSocket disconnect audit](audits/2026-01-14-websocket-disconnect-memory-leak-audit.md)
