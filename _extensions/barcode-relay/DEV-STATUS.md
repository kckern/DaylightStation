# barcode-relay — dev status (WIP, NOT working yet)

**Date:** 2026-07-11 (overnight session)
**State:** Pivoted from SSI-BLE (proprietary dead end) to **HID-BLE**. The ESP now runs a
**BLE HID-host** firmware (compiles + flashed) that reads standard keyboard reports and
assembles the barcode. **Remaining gap = physical only:** switch the gun to HID-BLE mode +
pull the trigger; then verify/debug the (untested) HID decode path.

### RESUME for the HID-BLE path (current firmware) ← DO THIS
1. Scan the **"HID Bluetooth Low Energy (Discoverable)"** host barcode on the gun
   (`.../c-param-desc-hid-bluetooth-low-energy-discoverable.html` — the page KC first linked).
2. `blueutil --unpair <gun-mac>` if macOS grabs it; start `udp_listen.py`.
3. Pull the trigger → watch UDP log for `found ... hidSvc=1 → bonded OK → subscribed N HID report char(s)`.
4. Scan a barcode → expect `>>> SCAN "<value>"`. If chars are wrong/missing, tune the HID
   report offset / usage table in `firmware/src/main.cpp` (`onReport`, `hidChar`).
5. Once decode works, add the WS relay (marked `TODO` in `emitBarcode`) → backend `barcode` pipeline.

Fill real WiFi creds in `main.cpp` before flashing (committed with placeholders).

---
### (Historical) SSI-BLE attempt — ABANDONED, kept for reference

## Goal
M5Stack ATOM Lite (ESP32-PICO-D4) BLE-bridges a **Zebra DS2278** in **SSI Bluetooth
Low Energy** mode and relays scanned barcodes to DaylightStation (like food-scale-relay).

## What WORKS (verified)
- Gun config: SSI-BLE host mode + "Do Not Pair on Contacts" (scanned from Zebra DS8 PRG).
- ESP (NimBLE) finds gun by name `DS2278`, connects, **BONDS** (LE Secure Connections,
  Just Works, MTU 247), subscribes to all 3 notify chars. Connection **holds indefinitely**
  (a 4s soft-trigger `START_SESSION 0xE4` keeps the gun awake).
- **macOS/bleak CANNOT do this** — it can't bond the notify/write-only chars; the ESP is required.
- **Reliable logging via WiFi UDP broadcast :9999** (the FTDI serial link is flaky — see gotchas).
- **Live command channel via UDP broadcast :9998** — send SSI commands without reflashing.

## GATT map (DS2278, BLE MAC `c8:1c:fe:fd:ce:90`)
```
service a2f0037b-4e26-4981-8a2d-eda9e1689868   (Zebra SSI-over-BLE, proprietary/undocumented)
  notify[0] 256a0615-...   notify[1] f3ae6f04-...   notify[2] 4b0e1f59-...
  write[0]  21f9e2b9-... (write, ACKNOWLEDGED)   write[1] 89ae8d0b-... (no-resp)   write[2] 91a765f5-... (no-resp)
```

## The BLOCKER
- On connect the gun emits exactly **one** packet: `[NOTIFY 256a0615] 4b 01 14 00 00 00 01 00`, then silence.
- It responds to **NO** command I send (REQUEST_REVISION 0xA3, START_SESSION 0xE4, SCAN_ENABLE
  0xE9, CAPABILITIES 0xD4, PARAM_REQUEST 0xC7, echo of its own hello) — every write reports
  `ok=1` at the BLE layer, zero notify responses.
- Physical scans produce **no decode notify** on any char (historically gun beeps 4-low = transmit error).
- The assumed SSI framing `[len][op][0x04 src][0x00 status][data][cksum16 2's-comp MSB-first]`
  appears NOT to match this transport (no replies to well-formed SSI queries).

## LEADING UNTESTED HYPOTHESIS  ← resume here
`write[0]` (21f9e2b9) is type **`write` (acknowledged)** but all commands so far used
**write-WITHOUT-response**. Devices often only process commands via **acknowledged** writes.
Firmware now supports this: command **`W<idx>`** (uppercase) does an acknowledged write.
**NOT YET TESTED** — the reflash to add it lost the gun connection (gun slept during the 70s flash).

First test on resume: `zcmd.py W0 04a30400ff55` (REQUEST_REVISION, acknowledged) → watch for a reply notify.

## ⭐ RECOMMENDED PIVOT — abandon SSI-BLE, use HID-BLE (2026-07-11 research conclusion)

Research (dayjaby/zebra-scanner + Zebra Scanner SDK) shows **SSI-over-BLE is Zebra's
proprietary RSM attribute protocol** (`datatype/id/permission/value`), reachable **only via
Zebra's closed CoreScanner/Scanner SDK**. The `4b01140000000100` packet is part of it. It is
**not replicable blind on an ESP** — this is why nothing we sent got a reply. **Stop pursuing
SSI-BLE from scratch.**

Instead switch the gun to **HID Bluetooth Low Energy** (the barcode KC originally linked:
`...r-param-desc-hid-bluetooth-low-energy-discoverable.html`). That's the **standard HID-over-
GATT (HOGP)** profile — documented and implementable. Two paths:

1. **ESP as BLE HID host (keeps the untethered relay pattern):** ESP connects to the gun's HID
   service `0x1812`, bonds, subscribes to Report characteristics `0x2A4D`, decodes standard
   USB-HID keyboard reports → barcode string → relay over WS. More firmware work (HOGP central
   is less common than HID-device examples, e.g. olegos76/nimble_kbdhid_example is a device),
   but STANDARD. Reuse the keycode→char table already in `_extensions/barcode-scanner`.
2. **Least-effort / proven:** pair the gun (HID-BLE) directly to an always-on Linux host (garage
   box / playback-hub / a Pi) — it becomes a BLE keyboard, and the EXISTING `_extensions/
   barcode-scanner` evdev→MQTT service reads it with near-zero new code. Loses the ESP pattern
   but works today.

The SSI acknowledged-write test below is worth ~5 min IF you want to exhaust SSI, but the pivot
above is the real path. Escalating SSI to Zebra developer support would also work but is slow.

## Other SSI hypotheses (low priority — see pivot above)
- Decode the `4b01140000000100` packet; try `f3ae6f04` with indications vs notifications;
  gun may need an SSI packet-format/host-capability handshake. All likely moot vs the RSM finding.

## RESUME STEPS (when the gun is awake)
1. `blueutil --unpair c8-1c-fe-fd-ce-90` (macOS steals the bond otherwise); `blueutil --power 0` optional.
2. Start listener: `blevenv/bin/python <scratchpad>/udp_listen.py 1800 &`
3. **Pull the gun trigger** → ESP reconnects (watch UDP log for `bonded OK` / `subscribed 3/3`).
4. `python <scratchpad>/zcmd.py W0 04a30400ff55` → look for a reply notify in the UDP log.
5. Iterate via the live command channel. **Do NOT reflash while unattended** — see gotcha.

## Tooling (session scratchpad, port to repo later)
- `zcmd.py` — send command to ESP. **MUST broadcast** (unicast blocked by AP client isolation).
- `exp.sh` — send + print new non-heartbeat log lines.
- `udp_listen.py` — capture ESP UDP logs (:9999). `mon.py` — flaky serial fallback.
- Firmware: `firmware/` — `pio run -e m5-atom -t upload` at **upload_speed=115200** (link marginal).
  Free the port first: `kill $(lsof -t /dev/cu.usbserial-*)`.

## Hard-won gotchas
- **FTDI serial is flaky** → corrupts flash/monitor at high baud. Use `upload_speed=115200` + WiFi UDP for logs.
- **Reflashing disconnects the gun**; if it sleeps during the ~70s flash it won't re-advertise without a
  **physical trigger**. NEVER reflash when no human is present — iterate via the live UDP command channel.
- **macOS bonds/steals the gun** (blueutil shows it paired) → unpair + optionally Mac BT off.
- **UDP unicast Mac→ESP is blocked** by AP client isolation (ICMP/ping works!) → commands MUST be broadcast.
- Gun sleeps fast when idle/disconnected → the 4s soft-trigger is what keeps a live session alive.
