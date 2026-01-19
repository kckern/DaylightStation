# Frontend Logging & Debugging

Frontend logs are relayed to the backend via WebSocket and written to different destinations based on environment.

## Log Destinations

| Environment | Destination | Access |
|-------------|-------------|--------|
| **Development** | `dev.log` file | `tail -f dev.log` or `grep` |
| **Production** | Docker stdout/stderr | `docker logs <container>` |

## Log Sources

Frontend logging captures three types of events:

### 1. Explicit Logger Calls

Application code using the Logger framework:

```javascript
import { getLogger } from '../lib/logging/Logger.js';
const logger = getLogger();

logger.info('playback.started', { title, mediaKey });
logger.warn('playback.stalled', { currentTime, duration });
logger.error('playback.failed', { error: err.message });
```

### 2. Console Interception

All `console.log/warn/error` calls are captured and forwarded, including from third-party libraries:

- `console.log` → `console.log` event (debug level)
- `console.warn` → `console.warn` event (warn level)
- `console.error` → `console.error` event (error level)

Rate-limited to prevent spam (50-200 events/second per level).

### 3. Global Error Handlers

Uncaught errors are automatically captured:

- `window.onerror` → JavaScript runtime errors
- `unhandledrejection` → Unhandled Promise rejections
- Error events → Global error events

## Checking Logs

### Development

```bash
# All frontend logs
grep '"source":"frontend"' dev.log

# Errors only
grep '"level":"error"' dev.log | grep '"source":"frontend"'

# Specific event type
grep '"event":"blackout.dimensions"' dev.log

# Real-time monitoring
tail -f dev.log | grep --line-buffered '"source":"frontend"'

# Count by event type
grep '"source":"frontend"' dev.log | jq -r '.event' | sort | uniq -c | sort -rn
```

### Production (Docker)

```bash
# Recent logs (last 100 lines)
docker logs daylight-station --tail 100 | grep '"source":"frontend"'

# Follow logs in real-time
docker logs daylight-station -f | grep --line-buffered '"source":"frontend"'

# Count frontend logs
docker logs daylight-station 2>&1 | grep -c '"source":"frontend"'

# Frontend errors only
docker logs daylight-station 2>&1 | grep '"source":"frontend"' | grep '"level":"error"'
```

## Common Events

| Event | Level | Source | Purpose |
|-------|-------|--------|---------|
| `frontend-start` | info | Logger | App initialization |
| `playback.started` | info | Logger | Media playback began |
| `playback.stalled` | warn | Logger | Media playback stalled |
| `blackout.dimensions` | warn | Logger | Shader coverage debugging |
| `playback.cover-loaded` | info | Logger | Album art loaded |
| `console.error` | error | Interceptor | Captured console.error calls |
| `console.warn` | warn | Interceptor | Captured console.warn calls |
| `window.onerror` | error | Error handler | Uncaught JavaScript errors |
| `unhandledrejection` | error | Error handler | Unhandled Promise rejections |
| `error-handlers.initialized` | info | Error handler | Confirms handlers are active |
| `console-interceptor.initialized` | info | Interceptor | Confirms interception is active |

## Log Structure

All logs follow this JSON structure:

```json
{
  "ts": "2026-01-19T07:30:57.253Z",
  "level": "info",
  "event": "playback.started",
  "data": {
    "title": "Song Name",
    "mediaKey": "123456"
  },
  "context": {
    "source": "frontend",
    "app": "frontend",
    "ip": "172.18.0.53",
    "userAgent": "Mozilla/5.0..."
  },
  "tags": []
}
```

## Troubleshooting

### Logs Not Appearing

1. **Check WebSocket connection** - Open browser devtools → Network → WS tab. Look for active WebSocket connection.

2. **Verify backend is running** - Frontend logs relay through WebSocket to backend. Backend must be running.

3. **Check browser console** - Look for errors about `WebSocketService` or connection failures.

4. **Verify initialization** - Search for `error-handlers.initialized` and `console-interceptor.initialized` events. If missing, logging framework didn't start.

### Missing Specific Logs

1. **Rate limiting** - Console interception has rate limits. If > 50 logs/second for a level, extras are dropped. Check `console-interceptor.initialized` event for configured limits.

2. **Sampling** - Some logs may be sampled. Check if the log call uses `sampleRate` option.

3. **Level filtering** - Logger may be configured to filter low-level logs. Default level is `info`.

### Debugging Playback Issues

```bash
# Find stalls for specific media
grep '"event":"playback.stalled"' dev.log | grep '"mediaKey":"123456"'

# Track a playback session
grep '"mediaKey":"123456"' dev.log | jq -r '[.ts, .event] | @tsv'
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Browser)                   │
├─────────────────────────────────────────────────────────┤
│  Logger.info()  │  console.warn()  │  window.onerror   │
│        ↓        │        ↓         │        ↓          │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Buffering WebSocket Transport           │  │
│  │  (batch 20 events, flush every 1s)               │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                              │
│              WebSocketService.send()                    │
└─────────────────────────────────────────────────────────┘
                           ↓ WebSocket
┌─────────────────────────────────────────────────────────┐
│                     Backend (Node.js)                    │
├─────────────────────────────────────────────────────────┤
│  WebSocket handler receives { topic: 'logging', ... }   │
│                          ↓                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Environment Check                    │  │
│  │  Dev → write to dev.log                          │  │
│  │  Prod → write to stdout (Docker captures)        │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Related Files

| File | Purpose |
|------|---------|
| `frontend/src/lib/logging/index.js` | Logger factory, transports |
| `frontend/src/lib/logging/Logger.js` | Singleton logger instance |
| `frontend/src/lib/logging/errorHandlers.js` | Global error capture |
| `frontend/src/lib/logging/consoleInterceptor.js` | Console method interception |
| `frontend/src/main.jsx` | Logging initialization |
| `backend/lib/websocket.mjs` | WebSocket log ingestion |
