# barcode-relay — WORKING (BLE HID central)

**Date:** 2026-07-11
**State:** ✅ **End-to-end working.** A Zebra DS2278 in **HID Bluetooth Low Energy (Discoverable)**
mode is read directly by an M5Stack ATOM Lite (ESP32) acting as a **BLE HID central**. The ESP
bonds to the scanner, decodes its HID keyboard reports into the barcode string, and relays each
scan over WiFi/WebSocket to the DaylightStation event bus as
`{source:'barcode-relay', type:'scan', device:'ds2278', code, ts}` → broadcast on the
**`barcode-relay`** topic (handler: `backend/src/3_applications/hardware/barcodeRelay.mjs`).

Verified live: scan → `[barcode] living-room:plex:594036+shuffle` on the ESP →
`✅ BARCODE RELAYED THROUGH BACKEND … device="ds2278"` at the backend subscriber.

## Architecture
```
DS2278 (HID-BLE keyboard)  --BLE HID/HOGP-->  ESP32 ATOM Lite  --WiFi WS-->  backend event bus
                                              (BLE central + WS client)      topic: barcode-relay
```
No host computer in the path. The scanner also stays plugged into its USB cradle for **charging**;
that USB keyboard interface still feeds the **separate, pre-existing `barcode-scanner`→MQTT service
on homeserver** (which the docker container depends on) — the two data paths coexist, so **do not
unplug the cradle** expecting to "force BLE"; BLE works while cabled.

## One-time scanner setup (physical)
Scan the **"HID Bluetooth Low Energy (Discoverable)"** host barcode from the DS2278 Product
Reference Guide (p.6-6, "Human Interface Device (HID) Keyboard Emulation" — the **Low Energy**
one, not Classic). The scanner then advertises as a standard BLE HID keyboard:
- Name `DS2278 <serial>`, MAC **`C8:1C:FE:FD:CE:90`**, appearance `0x03C1` (keyboard), service `0x1812`.
That MAC is the `TARGET_MAC` in `firmware/src/main.cpp`.

## Firmware (`firmware/src/main.cpp`)
- NimBLE central: scans, matches the scanner by MAC / HID-service `0x1812` / name, connects, and
  **bonds** (LE Secure Connections, Just Works, IO cap NONE).
- Reads Report Map (`0x2A4B`), forces Protocol Mode = Report (`0x2A4E`=1), subscribes to the
  keyboard input reports.
- Init order is **BLE before WiFi** and no `WiFi.setSleep(false)` (WiFi/BLE coexistence).
- Notifications are copied out of the NimBLE task via a FreeRTOS queue and decoded in `loop()`
  (never touch WS/UDP from the notify callback).

### Key gotchas discovered (this is why earlier attempts "connected but got nothing")
1. **SSI-BLE is a dead end** — Zebra's proprietary RSM/CoreScanner protocol; not replicable on an
   ESP. Use **HID-BLE**, which is standard HOGP. (History preserved in git.)
2. **The scanner streams on the BOOT keyboard input report (`0x2A22`, our handle 88), NOT the
   Report characteristic (`0x2A4D`)** — even with Protocol Mode = Report. **Subscribe to both**
   `0x2A22` and `0x2A4D`, or you receive only the connect-time "keys-up" frame and nothing else.
3. **No terminator** — the DS2278 sends **no Enter/CR** at the end of a barcode over BLE HID.
   Flushing on Enter never fires. Fix = **idle-gap flush**: emit the accumulated code after
   `CODE_GAP_MS` (150 ms) with no new keystroke (same approach the USB service uses).
4. Scanning is host-gated in USB **SNAPI** mode; irrelevant once in HID-BLE.

## Flashing
Fill real WiFi creds in `main.cpp` before flashing (committed with placeholders `YOUR_SSID` /
`YOUR_WIFI_PASS`). Then:
```
cd firmware && ~/.platformio/penv/bin/pio run -t upload --upload-port /dev/cu.usbserial-XXXX
```
`upload_speed=115200` (FTDI link marginal), `huge_app.csv` partitions, `espressif32@6.5.0`
(NimBLE 1.4.x needs Arduino core 2.x). Free the port first if held:
`kill $(lsof -t /dev/cu.usbserial-*)`.

## Diagnostics
Firmware logs over **WiFi UDP broadcast :9999** (serial is flaky). Watch with a UDP listener on
:9999. `[hid] h=<handle> len=8 <hex>` shows raw reports; `[barcode] <code>` shows a completed
decode; heartbeats show `ws=` / `ble=` state.

## Relationship to food-scale-relay
`_extensions/barcode-relay` and `_extensions/food-scale-relay` are **independent PlatformIO
projects → independent firmware images → independent ESP32 devices.** No shared binary, no
conflict. Each backend ingest handler lives in `backend/src/3_applications/hardware/`.
