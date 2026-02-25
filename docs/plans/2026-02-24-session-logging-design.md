# Session Logging — Design & Implementation Plan

## Problem

Debugging app-specific issues requires correlating logs to specific user sessions. Currently all frontend logs flow through the same pipeline with no per-session file output. We need an opt-in mechanism where flagged apps get their logs written to timestamped session files alongside normal logging.

## Design

### Concept

- Frontend loggers opt in via `sessionLog: true` in `child()` context
- Logs flow through the existing WebSocket pipeline — no frontend transport changes
- Backend ingestion detects `context.sessionLog` and writes events to a session file in addition to normal dispatch
- Session files live in `media/logs/{app}/{timestamp}.jsonl`
- 3-day retention, pruned on backend startup

### File Structure

```
media/logs/
  fitness/
    2026-02-24T16-54-50.jsonl
    2026-02-24T17-30-12.jsonl
  admin/
    2026-02-24T18-05-33.jsonl
```

### Data Flow

```
Frontend: child({ app: 'fitness', sessionLog: true })
  → auto-emits session-log.start event
  → all subsequent events include context.sessionLog: true
  → WebSocket to backend (unchanged)

Backend ingestion:
  → dispatcher.dispatch(event)              ← normal path (unchanged)
  → sessionFileTransport.write(event)       ← new parallel path
```

### Session Boundaries

- `session-log.start` event triggers new file creation
- Subsequent events with matching `app` + `sessionLog: true` append to active file
- Next `session-log.start` for same app closes previous stream, opens new file

---

## Implementation Plan

### Step 1: Session File Transport (new file)

**File:** `backend/src/0_system/logging/transports/sessionFile.mjs`

Create a new transport module following the dispatcher singleton pattern:

```js
// Module state
let instance = null;

export function initSessionFileTransport({ baseDir, maxAgeDays }) { ... }
export function getSessionFileTransport() { ... }
```

**Internal state:**
- `activeSessions` map: `{ [app]: { filePath, writeStream } }`
- `baseDir`: resolved media/logs path
- `maxAgeDays`: retention threshold (3)

**Methods:**
- `write(event)` — if event is `session-log.start`, open new file; otherwise append to active stream for that app
- `pruneOldFiles()` — walk `baseDir/*/*.jsonl`, delete files with mtime > maxAgeDays
- `flush()` — close all active write streams

**File naming:** `{app}/{ISO timestamp with colons replaced}.jsonl`

**Format:** One JSON object per line (same structure as existing log events).

### Step 2: Wire into backend startup

**File:** `backend/src/server.mjs`

After existing transport initialization:

```js
import { initSessionFileTransport } from './0_system/logging/transports/sessionFile.mjs';

const mediaDir = configService.getMediaDir();
initSessionFileTransport({
  baseDir: join(mediaDir, 'logs'),
  maxAgeDays: 3
});
```

This also triggers retention cleanup on startup.

### Step 3: Hook into ingestion

**File:** `backend/src/0_system/logging/ingestion.mjs`

After normal dispatch, add session file write:

```js
import { getSessionFileTransport } from './transports/sessionFile.mjs';

// Inside ingestFrontendLogs, after dispatcher.dispatch(normalized):
if (normalized.context?.sessionLog) {
  const sft = getSessionFileTransport();
  if (sft) sft.write(normalized);
}
```

Guarded with null check — if session file transport isn't initialized (e.g., missing media path), silently skip.

### Step 4: Frontend auto-emit on child()

**File:** `frontend/src/lib/logging/Logger.js`

In the `child()` method, after creating the child logger object, if `childContext.sessionLog` is truthy, emit the start signal:

```js
const child = (childContext = {}) => {
  const parentContext = { ...config.context };
  const childLogger = { /* existing logger methods */ };

  // Auto-emit session start signal
  if (childContext.sessionLog) {
    childLogger.info('session-log.start', {
      app: childContext.app || parentContext.app
    });
  }

  return childLogger;
};
```

### Step 5: Opt in apps

**Files:** Whichever apps need it (e.g., `FitnessApp.jsx`, `AdminApp.jsx`)

Change:
```js
const logger = useMemo(() => getLogger().child({ app: 'fitness' }), []);
```
To:
```js
const logger = useMemo(() => getLogger().child({ app: 'fitness', sessionLog: true }), []);
```

---

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `backend/src/0_system/logging/transports/sessionFile.mjs` | New | Session file transport with singleton, file management, retention |
| `backend/src/server.mjs` | Edit | Initialize session file transport after existing transports |
| `backend/src/0_system/logging/ingestion.mjs` | Edit | Add parallel write to session file transport |
| `frontend/src/lib/logging/Logger.js` | Edit | Auto-emit `session-log.start` in `child()` when `sessionLog: true` |

## Not Changed

- Dispatcher, existing transports, WebSocket layer, frontend transports, singleton, sharedTransport
- All existing logging behavior is preserved
