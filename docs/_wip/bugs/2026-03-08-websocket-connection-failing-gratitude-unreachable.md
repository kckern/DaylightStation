# WebSocket Connection Failing — Homebot Gratitude Messages Never Reach Frontend

**Date:** 2026-03-08
**Severity:** High
**Affected:** All real-time features (Gratitude live updates, playback sync, menu commands)

## Symptom

Gratitude items submitted via Telegram homebot are processed successfully by the backend (`AssignItemToUser` completes, data persisted) but never appear on the TV Gratitude app. The TV app only shows items on next bootstrap/reload.

## Root Cause

**The frontend WebSocket connection is broken in production.** Every client (Shield TV WebView, desktop Chrome, mobile Chrome) fails to connect to `/ws` and enters an infinite reconnect loop with exponential backoff.

### Evidence from Prod Logs

**Backend homebot — working fine:**
```
assignItemToUser.start  {username:"elizabeth", category:"hopes"}
assignItemToUser.complete {itemCount:1, username:"elizabeth", category:"hopes"}
assignItemToUser.start  {username:"kckern", category:"gratitude"}
assignItemToUser.complete {itemCount:1, username:"kckern", category:"gratitude"}
```

**Frontend WebSocket — continuous failures:**
```
[WebSocketService] Error: {"isTrusted":true}   (repeated every few seconds/minutes)
```

All errors come from `172.18.0.81` (Docker network gateway), affecting:
- Shield TV WebView (`Android 11; SHIELD Android TV`)
- Desktop Chrome (`X11; Linux x86_64`)
- Mobile Chrome (`Android 10; K`)

**No backend EventBus connection logs appear** — zero `eventbus.client_connected` or `eventbus.client_disconnected` events, meaning the WebSocket upgrade never reaches the `ws` library.

## Message Flow (What Should Happen)

```
Telegram → HomeBotInputRouter → ProcessGratitudeInput → (user confirms)
→ AssignItemToUser.execute()
  ├─ GratitudeService.addSelections()     ✅ Works
  ├─ websocketBroadcast({topic:'gratitude', action:'item_added', ...})
  │    └─ eventBus.broadcast('gratitude', payload)
  │         └─ ws.send() to subscribed clients  ❌ No clients connected
  └─ Update Telegram confirmation          ✅ Works

Frontend Gratitude.jsx:
  WebSocketProvider subscribes to ['office','playback','menu','system','gratitude']
  handleWebSocketPayload filters for topic:'gratitude', action:'item_added'
  → Auto-switches category/user, adds items to Selected column
  ❌ Never receives messages because WS never connects
```

## Likely Causes

1. **Reverse proxy not forwarding WebSocket upgrade** — If nginx/Caddy/Traefik sits in front of Docker, it needs explicit `Upgrade` and `Connection` header forwarding for `/ws`. The `{"isTrusted":true}` error (native browser ErrorEvent with no detail) is consistent with a failed HTTP upgrade.

2. **Docker port mapping** — The container exposes port 3111 for both HTTP and WS (same Express server). If the Docker network or host proxy doesn't forward the upgrade handshake, WS connections fail while HTTP API works fine.

3. **EventBus not started** — If `createEventBus()` in `bootstrap.mjs` failed silently or the HTTP server reference was wrong, the `WebSocketServer` wouldn't be listening. Check for `eventbus.started` in container startup logs.

## Diagnosis Steps

```bash
# 1. Check if EventBus initialized on startup
docker logs daylight-station 2>&1 | grep 'eventbus.started'

# 2. Test WS connectivity from the host
wscat -c ws://localhost:3111/ws

# 3. Check reverse proxy config for Upgrade headers
# nginx example needed:
#   proxy_http_version 1.1;
#   proxy_set_header Upgrade $http_upgrade;
#   proxy_set_header Connection "upgrade";

# 4. Check EventBus metrics via API (if exposed)
curl http://localhost:3111/api/v1/system/status
```

## Impact

- Gratitude items submitted via Telegram only appear after TV app reload
- Playback broadcast still works (uses HTTP POST logging, not WS)
- Any other feature relying on real-time WS push is also broken

## Files Involved

| Component | File |
|-----------|------|
| Backend WS server | `backend/src/0_system/eventbus/WebSocketEventBus.mjs` |
| Backend bootstrap | `backend/src/0_system/bootstrap.mjs` (`createEventBus()`) |
| Backend broadcast | `backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs:132-142` |
| Frontend WS client | `frontend/src/services/WebSocketService.js` |
| Frontend WS context | `frontend/src/contexts/WebSocketContext.jsx` |
| Frontend handler | `frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx:391-454` |
