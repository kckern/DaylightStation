# Session Logging

**Last Updated:** 2026-02-25

---

## Overview

Session logging is an opt-in mechanism that persists frontend log events to per-app JSONL files on the backend. It runs alongside the normal logging pipeline (console, Loggly) — events flagged with `sessionLog: true` are additionally written to disk for post-hoc debugging and replay.

```
Frontend (browser)                        Backend
┌──────────────────┐                     ┌──────────────────────────────┐
│ getLogger().child │──WebSocket──────►  │ ingestion.mjs                │
│ { app, sessionLog│                     │  ├─► dispatcher (normal)     │
│   : true }       │                     │  └─► sessionFile transport   │
└──────────────────┘                     │       └─► media/logs/{app}/  │
                                         └──────────────────────────────┘
```

---

## How It Works

### 1. Frontend: Flag the Logger

An app opts in by setting `sessionLog: true` and an `app` name in the logger context. All events emitted by that logger (and its children) carry these fields.

```javascript
// In the app root component
const logger = useMemo(() => getLogger().child({ app: 'fitness', sessionLog: true }), []);
```

To propagate session logging to child components that call `getLogger()` directly (without receiving the parent logger), also configure the root logger:

```javascript
useEffect(() => {
  configureLogger({ context: { app: 'fitness', sessionLog: true } });
  return () => configureLogger({ context: { sessionLog: false } });
}, []);
```

When `sessionLog: true` is set on a child logger, the frontend automatically emits a `session-log.start` event (`Logger.js` line 187–189). This signals the backend to open a new session file.

### 2. WebSocket Transport

The frontend logger sends events over a shared WebSocket connection to the backend. Each event carries its full `context` object, including `app` and `sessionLog`.

### 3. Backend: Ingestion

`backend/src/0_system/logging/ingestion.mjs` processes incoming events:

1. Normalizes the payload and dispatches to the standard logging pipeline (console, Loggly, etc.)
2. Checks `normalized.context?.sessionLog` — if truthy, writes the event to the session file transport

```javascript
// ingestion.mjs (simplified)
dispatcher.dispatch(normalized);

const sft = getSessionFileTransport();
if (sft && normalized.context?.sessionLog) {
  sft.write(normalized);
}
```

### 4. Backend: Session File Transport

`backend/src/0_system/logging/transports/sessionFile.mjs` writes JSONL files:

- **Directory:** `media/logs/{app}/` (e.g., `media/logs/fitness/`, `media/logs/admin/`)
- **File name:** ISO timestamp of session start (e.g., `2026-02-25T14-30-00.jsonl`)
- **Session boundary:** A `session-log.start` event opens a new file; subsequent events append to it
- **Pruning:** Files older than `maxAgeDays` (default: 3) are deleted on transport initialization

The transport is **not** registered with the dispatcher. It is invoked directly from `ingestion.mjs`, which means it receives all frontend events regardless of the dispatcher's level filter.

---

## Currently Enabled Apps

| App | File | Logger Init |
|-----|------|-------------|
| Fitness | `frontend/src/Apps/FitnessApp.jsx` | `child({ app: 'fitness', sessionLog: true })` + `configureLogger()` |
| Admin | `frontend/src/Apps/AdminApp.jsx` | `child({ app: 'admin', sessionLog: true })` |

---

## Adding Session Logging to a New App

1. In the app's root component, create a child logger with `sessionLog: true`:

```javascript
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';

const logger = useMemo(() => getLogger().child({ app: 'my-app', sessionLog: true }), []);
```

2. If child components use `getLogger()` directly, propagate via `configureLogger`:

```javascript
useEffect(() => {
  configureLogger({ context: { app: 'my-app', sessionLog: true } });
  return () => configureLogger({ context: { sessionLog: false } });
}, []);
```

3. No backend changes are needed. The `app` context value determines the subdirectory automatically.

---

## File Format

Each line is a JSON object:

```jsonl
{"ts":"2026-02-25T14:30:00.123Z","level":"info","event":"session-log.start","data":{"app":"fitness"},"context":{"app":"fitness","sessionLog":true,"source":"frontend"},"tags":[]}
{"ts":"2026-02-25T14:30:01.456Z","level":"info","event":"fitness-config-loaded","data":{"navItems":5,"users":2},"context":{"app":"fitness","sessionLog":true,"source":"frontend"},"tags":[]}
```

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/lib/logging/Logger.js` | Frontend logger; emits `session-log.start` on child creation |
| `backend/src/0_system/logging/ingestion.mjs` | Routes `sessionLog` events to session file transport |
| `backend/src/0_system/logging/transports/sessionFile.mjs` | Writes per-app JSONL files, manages sessions, prunes old files |

---

## Related

- [Coding Standards](./coding-standards.md) — General backend conventions
- [Backend Architecture](./backend-architecture.md) — Layer overview including `0_system/logging/`
- CLAUDE.md **Logging** section — Frontend logger usage patterns and rules
