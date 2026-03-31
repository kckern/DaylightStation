# Barcode WS Delivery Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix barcode WS broadcasts not reaching any screen's browser.

**Architecture:** The EventBus WS server is alive (manual WS test connects and gets ack), backend pipeline works (barcode parsed, approved, display powered on), but `broadcast()` sends to 0 clients. Root cause: all browsers show "Connection stale (no data in 45s), forcing reconnect" in a loop. Add diagnostic logging to the broadcast path and eventbus client tracking to pinpoint where delivery fails, then fix.

**Tech Stack:** Node.js backend EventBus, frontend WebSocketService

---

### Task 1: Add broadcast diagnostic logging

**Files:**
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs`

The `broadcast()` method logs at debug level. Promote client count and sent count to info level so we can see if broadcasts reach clients.

- [ ] **Step 1: Add info-level logging to broadcast**

In `backend/src/0_system/eventbus/WebSocketEventBus.mjs`, find the broadcast method's debug log (around line 247):

```javascript
    this.#logger.debug?.('eventbus.broadcast', {
      topic,
      sentCount,
      clientCount: this.#clients.size
    });
```

Change `debug` to `info`:

```javascript
    this.#logger.info?.('eventbus.broadcast', {
      topic,
      sentCount,
      clientCount: this.#clients.size
    });
```

- [ ] **Step 2: Add info-level logging to client connection/disconnection**

Find `#handleConnection` (around line 413) and promote the connected log:

```javascript
    this.#logger.debug?.('eventbus.client_connected', { clientId, ip: meta.ip });
```

Change to:

```javascript
    this.#logger.info?.('eventbus.client_connected', { clientId, ip: meta.ip, userAgent: meta.userAgent });
```

Find `#handleDisconnection` (search for `eventbus.client_disconnected`) and promote similarly.

- [ ] **Step 3: Add info-level logging to bus_command subscribe**

Find `#handleBusCommand` where it processes subscribe actions. Add logging for the subscription result:

After `this.subscribeClient(clientId, targetTopics);` add:

```javascript
    this.#logger.info?.('eventbus.client_subscribed', { clientId, topics: targetTopics });
```

- [ ] **Step 4: Build, deploy, test**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Wait 10s for startup, then simulate a barcode scan:

```bash
python3 -c "
import paho.mqtt.publish as pub
pub.single('daylight/scanner/barcode',
  '{\"barcode\":\"office:queue:plex:595103+shuffle\",\"timestamp\":\"2026-03-31T20:00:00Z\",\"device\":\"symbol-scanner\"}',
  hostname='localhost', port=1883)
"
```

Check logs:

```bash
sudo docker logs daylight-station --since 30s 2>&1 | grep -E "eventbus\.(broadcast|client)" | tail -10
```

Expected output reveals whether:
- `clientCount: 0` → clients aren't connecting to the EventBus
- `clientCount: N, sentCount: 0` → clients connected but not subscribed to the right topics
- `clientCount: N, sentCount: N` → messages sent but frontend not processing them

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/eventbus/WebSocketEventBus.mjs
git commit -m "diag(eventbus): promote broadcast and client logs to info level"
```

---

### Task 2: Fix based on diagnostic results

This task depends on what Task 1 reveals. The three scenarios:

**If clientCount is 0:** The EventBus WSS isn't receiving connections from browsers. Check if the HTTP server is the same instance passed to `eventbus.start(server)`. Check Nginx Proxy Manager websocket passthrough for `wss://daylightlocal.kckern.net/ws`.

**If sentCount is 0 but clientCount > 0:** Clients connect but their subscriptions don't match the broadcast topic. The barcode broadcasts to topic `"office"`. Check that client subscriptions include `"office"` or `"*"`. Log `meta.subscriptions` for each client in the broadcast loop.

**If sentCount > 0 but frontend doesn't process:** The message is delivered to WebSocket but the frontend drops it. Check the frontend predicate filter, guardrails, and message handling. Check if `REJECT_ALL` on the office screen's `useScreenCommands` is somehow interfering with the `WebSocketContext` subscription (they share the same `wsService` singleton — could the REJECT_ALL subscriber's wildcard subscription be overriding the topic subscription via `_syncSubscriptions`?).

- [ ] **Step 1: Read diagnostic logs from Task 1**
- [ ] **Step 2: Implement targeted fix based on findings**
- [ ] **Step 3: Test, verify, commit**
- [ ] **Step 4: Remove diagnostic logging promotion (revert to debug level)**
- [ ] **Step 5: Build, deploy, verify end-to-end**
