# Barcode WebSocket Broadcast Not Reaching Screens

**Date:** 2026-03-31
**Severity:** High — barcode scanning pipeline broken end-to-end
**Status:** Open

## Symptom

Scanning a QR code (e.g., `office:queue:plex:595103+shuffle`) completes the entire backend pipeline — MQTT receive, BarcodePayload parse, gatekeeper approval, display power-on — but the content command never reaches the target screen's browser. The screen does not play content.

## What Works

- Scanner → MQTT: `journalctl -u barcode-scanner` shows scans arriving
- MQTT → Backend: `docker logs daylight-station | grep barcode.mqtt.scan` shows correct parsing
- Gatekeeper: `barcode.approved` events logged with correct contentId, action, options, targetScreen
- Display power-on: Home Assistant scripts fire (office TV and monitor turn on)
- Manual MQTT pub via `mosquitto_pub` also triggers the full backend pipeline

## What Fails

- `BarcodeScanService.#handleContent()` calls `this.#broadcastEvent(targetScreen, payload)` (line 123 of `BarcodeScanService.mjs`)
- This resolves to `broadcastEvent({ topic: 'office', action: 'queue', contentId: 'plex:595103', shuffle: true, source: 'barcode', ... })` via the wiring in `app.mjs:1261`
- No dispatch/send/emit log events appear after the broadcast call
- The office screen browser (confirmed open at `https://daylightlocal.kckern.net/screen/office` via Brave debug port on 9222) does NOT receive the WebSocket message
- Frontend logs show repeated `[WebSocketService] Connection stale (no data in 45s), forcing reconnect` from all connected browsers (Shield TV, office Firefox, office Chrome)

## Evidence

### Scanner logs (working)
```
INFO Scan: office;queue;plex;595103+shuffle (mid=1)
```

### Backend logs (working through approval, then silent)
```json
{"event":"barcode.mqtt.scan","data":{"type":"content","contentId":"plex:595103","action":"queue","options":{"shuffle":true},"targetScreen":"office"}}
{"event":"barcode.approved","data":{"contentId":"plex:595103","targetScreen":"office","action":"queue","options":{"shuffle":true}}}
{"event":"barcode.display.on","data":{"targetScreen":"office","scriptId":"script.office_tv_on"}}
{"event":"barcode.display.on","data":{"targetScreen":"office","scriptId":"script.office_monitor_on"}}
// NO broadcast/dispatch/ws.send event follows
```

### WebSocket stale warnings (all screens)
```
[WebSocketService] Connection stale (no data in 45s), forcing reconnect
```
Source IPs: all from 172.18.0.54. Affects Shield TV (Chrome 146), office Firefox (149), office Chrome (145).

### Office browser confirmed alive
- Brave debug port `localhost:9222` responds
- Page at `/screen/office` renders (clock, weather, todos visible)
- `frontend-start` event logged at page load

## Timeline

This was working before 2026-03-31. Changes deployed today:

1. **`backend/src/2_domains/content/ContentExpression.mjs`** — new file (unified parser)
2. **`backend/src/2_domains/barcode/BarcodePayload.mjs`** — refactored to delegate content parsing to ContentExpression.fromString (commit `3f7e5ada`)
3. **`backend/src/4_api/v1/routers/qrcode.mjs`** — replaced `parseActionParams` with ContentExpression
4. **`backend/src/4_api/v1/routers/catalog.mjs`** — new catalog PDF router (imports pdfkit, svg-to-pdfkit, @resvg/resvg-js)
5. **`backend/src/4_api/v1/routers/queue.mjs`** — replaced `parseQueueQuery` with ContentExpression
6. **`backend/src/app.mjs`** — added catalog router wiring, added `/catalog` to route map
7. **`backend/src/4_api/v1/routers/api.mjs`** — added `/catalog` to routeMap

Docker container was restarted during debugging. Container built from commit `a2cc76df` which includes all above changes.

## Likely Cause

The barcode parsing refactor itself is NOT the issue — logs confirm correct parse output. The broadcast call fires but the WebSocket delivery fails. Possible causes:

1. **EventBus WebSocket connections are stale.** All screens report stale connections. The eventbus (`/ws`) may not be maintaining client subscriptions correctly after container restart. Check `backend/src/0_system/eventbus/` for connection tracking.

2. **Topic mismatch.** The barcode broadcasts to topic `"office"` but the office screen browser may subscribe to a different topic format (e.g., `"screen:office"` or `"/screen/office"`). Check what topic the frontend's `useScreenCommands.js` subscribes to vs what `broadcastEvent` publishes.

3. **New imports crashing silently.** The catalog router imports `pdfkit`, `svg-to-pdfkit`, and `@resvg/resvg-js`. If these aren't installed in the Docker image, the dynamic import in `app.mjs` could fail and break downstream wiring. Check `docker exec daylight-station node -e "require('pdfkit')"`.

4. **app.mjs bootstrap order.** The catalog router was inserted between the QR code router and the nutribot renderer. If the catalog import throws, everything after it (including barcode scan service wiring) may not execute.

## Reproduction

```bash
# 1. Publish a barcode event
docker exec mosquitto mosquitto_pub -t "daylight/scanner/barcode" \
  -m '{"barcode":"office:queue:plex:595103+shuffle","timestamp":"2026-03-31T00:00:00Z","device":"symbol-scanner"}'

# 2. Check backend processed it
docker logs daylight-station 2>&1 | grep barcode | tail -5

# 3. Check if office screen received anything
# Open Brave debug: http://localhost:9222
# Or check frontend logs for any barcode/queue/content events
docker logs daylight-station 2>&1 | grep -E "office.*(queue|play|content|barcode)" | grep "source.*frontend" | tail -5
```

## Investigation Checklist

- [ ] Check what topic the frontend WebSocket subscribes to (grep `useScreenCommands` or `WebSocketService` for subscribe/topic logic)
- [ ] Check eventbus client list: are any WS clients actually connected? (`eventbus.mjs` — does it log connections?)
- [ ] Check if catalog router import fails in Docker: `docker exec daylight-station node -e "import('pdfkit').then(() => console.log('ok')).catch(e => console.log('FAIL', e.message))"`
- [ ] Check if BarcodeScanService is even instantiated: `docker logs daylight-station | grep "barcode.*init\|barcode.*ready\|BarcodeScan"`
- [ ] Verify broadcastEvent is wired: add temporary `console.log` to `app.mjs:1261` to confirm the function is called
- [ ] Test with a simple command barcode (e.g., `office:pause`) — commands use the same broadcastEvent path but skip gatekeeper
- [ ] Compare working living-room screen (Shield TV IS receiving content — Bluey playing) vs broken office screen

## Related

- `docs/_wip/bugs/2026-03-08-websocket-connection-failing-gratitude-unreachable.md` — prior WebSocket connectivity issue
- `docs/_wip/bugs/2026-03-22-screen-queue-autoplay-broken.md` — prior screen queue issue
- `backend/src/3_applications/barcode/BarcodeScanService.mjs:123` — the broadcastEvent call
- `backend/src/app.mjs:1261` — broadcastEvent wiring for barcode
- `frontend/src/screen-framework/commands/useScreenCommands.js` — frontend WS consumer
