# content-barcode-relay

The content barcode use case: a Zebra scanner event is relayed over WiFi/WebSocket to
the DaylightStation event bus (topic **`barcode-relay`**). The firmware now lives in
[`../food-scale-relay`](../food-scale-relay) because one ATOM can maintain both the
food-scale BLE connection and the scanner HID connection.

```
DS2278 (HID-BLE keyboard) ─┐
KitchenIQ scale ───────────┴─BLE──▶ shared ATOM Lite ──WiFi WS──▶ backend event bus
```

Scan payload: `{source:'barcode-relay', type:'scan', device, route, code, ts}` →
handled by `backend/src/3_applications/hardware/barcodeRelay.mjs`.

For the scanner protocol gotchas and one-time setup, see
[`DEV-STATUS.md`](./DEV-STATUS.md).

Configure the scanner beside the scale under the same `scales.yml` entry:

```yaml
scales:
  kitchen-food-scale:
    barcode:
      id: content-barcode
      route: content
      mac: "c8:1c:fe:fd:ce:90"
      name: DS2278
```

Flash the shared firmware from `food-scale-relay/firmware`; the selected scale
instance owns the ATOM and both BLE peripherals.

---

## Health endpoint — ping it from anywhere on the LAN

The device runs a small HTTP server on **port 80**. `GET /` or `GET /status` returns a JSON
snapshot: is it up, is it listening (WS + BLE), and what/when was the last barcode.

```bash
curl http://10.0.0.153/status      # or open it in a browser
```

```json
{
  "device": "barcode-relay",
  "up_s": 51,                       // seconds since boot
  "now": "2026-07-12T02:30:43Z",    // device wall-clock (UTC, via NTP); absent until NTP syncs
  "wifi": { "connected": true, "ip": "10.0.0.153", "rssi": -36 },
  "ws":   { "connected": true, "host": "daylightlocal.kckern.net", "port": 3111 },
  "ble":  { "connected": true, "scanner": "c8:1c:fe:fd:ce:90", "streams": 2, "rssi": -37 },
  "scan_count": 0,                  // scans since boot
  "last_scan": null                 // null until the first scan; then an object (below)
}
```

Once it has scanned at least once, `last_scan` populates:

```json
"last_scan": {
  "code": "living-room:plex:594036+shuffle",
  "ago_s": 37,                      // seconds since that scan
  "at": "2026-07-12T02:45:10Z"      // wall-clock of the scan (omitted if NTP hadn't synced yet)
}
```

**Reading the answers:**

| Question | Field |
|----------|-------|
| Are you on? | reachable at all + `up_s` |
| Are you listening (to the backend)? | `ws.connected` |
| Is BLE connected now? | `ble.connected` (+ `ble.rssi` for link quality) |
| What was the most recent barcode? | `last_scan.code` |
| When? | `last_scan.at` (wall-clock) / `last_scan.ago_s` (relative) |

The IP is whatever DHCP assigns (currently **`10.0.0.153`**). It's logged on boot in the UDP
diagnostics stream (`[wifi] <ip> -> ...`) and is in `wifi.ip` of the response itself.
Headers include `Access-Control-Allow-Origin: *` so a browser admin page can fetch it.

---

## Flashing (config-driven — do NOT hand-edit `main.cpp`)

Wi-Fi creds, backend WS host/port/path, and the scanner BLE identity all come from the
household SSOT (`data/household/config/barcode-relay.yml`). That file is a registry of
relay instances. Generate the gitignored `firmware/include/config.h` from one instance,
then build/upload:

```bash
cd firmware
node tools/gen-config.mjs <data>/household/config/barcode-relay.yml <relay-id>   # -> include/config.h
~/.platformio/penv/bin/pio run -t upload --upload-port /dev/cu.usbserial-XXXX
```

`config.example.yml` documents the instance registry shape and `config.example.h`
documents the generated macros. The backend host is a stable **hostname**
(`daylightlocal.kckern.net`), never a raw IP, so the relay survives a server address change.
`upload_speed=115200` (the FTDI link is marginal), `huge_app.csv` partitions,
`espressif32@6.5.0` (NimBLE 1.4.x needs Arduino core 2.x). Free the port first if held:
`kill $(lsof -t /dev/cu.usbserial-*)`.

---

## Diagnostics

Two out-of-band views, no USB cable needed:

- **HTTP `/status`** (above) — point-in-time health, pull on demand.
- **UDP log broadcast on :9999** — every log line + a 5-second heartbeat
  (`[hb] up <s>s ws=<0|1> ble=<0|1>`) is broadcast to the LAN subnet. Watch it with any UDP
  listener bound to `0.0.0.0:9999`. `[hid] h=<handle> len=8 <hex>` = raw HID report;
  `[barcode] <code>` = a completed decode. The heartbeat is one ~25-byte packet / 5 s —
  negligible on the air.

Serial (`115200`) also carries the same logs, but the FTDI link is flaky — prefer the two above.
