# DS6878 food-scale relay handoff

## Current state

The M5Stack ATOM Lite at `/dev/cu.usbserial-7952C47E3B` was flashed on 2026-07-20 with the `m5-atom-idf5` PlatformIO environment. The upload and SHA verification succeeded, and the ESP reset via RTS.

The flashed image is experimental. It contains:

- KitchenIQ/SENSSUN FOOD BLE scale support.
- GPIO39 physical button support.
- Event-only RGB lighting; no ambient light loop.
- HTTP status server on port 80 (`/` and `/status`).
- Classic Bluetooth HID host code intended for the Zebra DS6878.
- WebSocket barcode messages with `device=nutribot-upc` and `route=nutribot`.

It has **not** been proven to connect to the DS6878 or decode a scan. The previous known failure was a Classic HID SDP/open failure.

## Hardware identities

- ESP32 ATOM MAC: `f0:16:1d:02:2a:88`
- Nutrition scanner: Zebra DS6878, Classic Bluetooth HID, observed MAC `00:23:68:c3:f1:70`, observed name `DS6878 M1N65C85A`.
- Other scanner: DS2278; do not use it as the nutrition scanner.
- Scale: KitchenIQ 50797 / `SENSSUN FOOD`, BLE service `0000ffb0-0000-1000-8000-00805f9b34fb`, notify characteristic `0000ffb2-0000-1000-8000-00805f9b34fb`.

## Important configuration problem

`firmware/include/config.h` is generated and currently has:

```c
#define BARCODE_ID         "nutribot-upc"
#define BARCODE_ROUTE      "nutribot"
#define BARCODE_MAC        ""
#define BARCODE_NAME       "DS6878"
```

The MAC is empty, so the firmware falls back to name matching during Classic Bluetooth discovery. The next agent should set the MAC through the household/config generation path (rather than editing generated `config.h`) and verify that the generated name/MAC are the DS6878 values above.

## Build and flash

From `firmware/`:

```sh
/Users/kckern/.platformio/penv/bin/pio run -e m5-atom-idf5 -t upload \
  --upload-port /dev/cu.usbserial-7952C47E3B
```

This environment uses a local ESP32 platform at:

```text
/Users/kckern/.platformio/platforms/espressif32@src-596c9938872833461cb0fe93e12b1b9f
```

The normal `m5-atom` environment remains the older IDF 4.4 build. Do not overwrite the experimental environment until Classic HID behavior is understood.

## Immediate test procedure

1. Put the DS6878 in Classic Bluetooth HID mode and make sure it is not connected to the Mac.
2. Power/reset the ESP.
3. Determine its IP from the serial log or DHCP table.
4. Fetch `http://ESP_IP/status`.
5. Inspect `barcode.connected`, `barcode.bound_mac`, `barcode.discovery_active`, `barcode.scan_count`, and `recent_logs`.
6. Trigger a scan and fetch `/status` again.

Useful log lines are:

```text
[classic-hid] found ...
[classic-hid] opening scanner
[classic-hid] OPEN status=... handle=...
[classic-hid] CLOSED: ...
[hid] h=... len=... ...
[barcode] ...
```

## Known failure evidence

With the older IDF 4.4 firmware, the scanner was discovered but did not complete the HID connection. Representative output:

```text
[classic-hid] OPEN status=0 handle=255
BT_SDP: SDP - Rcvd conn cnf with error: 0x4 CID ...
BT_HCI: hcif conn complete: hdl 0xfff, st 0x4
[classic-hid] OPEN status=7 handle=255
```

No HID reports followed. The DS6878 emitted the standard four low beeps indicating it was not paired/connected.

## Likely next debugging work

The current code calls `esp_bt_hid_host_connect()` after discovery and handles SSP confirmation, PIN requests, and a default PIN of `12345`. This may be insufficient for the DS6878’s Classic HID profile. Compare the DS6878 product reference guide’s pairing/authentication sequence with the ESP-IDF 5.5 `esp_hidh` Classic HID host API. In particular, verify:

- Whether the scanner must be explicitly bonded using the scanner’s “Bluetooth discover” and/or “pairing” barcodes.
- Whether the DS6878 requires a different PIN or legacy PIN behavior.
- Whether HID host SDP needs a larger discovery buffer or a specific HID descriptor/report protocol negotiation.
- Whether Wi-Fi/BLE coexistence and simultaneous NimBLE scale operation are destabilizing the Classic controller.
- Whether `esp_bt_hid_host_connect()` must be called only after a completed SDP discovery callback.

Do not claim success based on discovery alone. Success requires `/status` to show `barcode.connected: true`, then a test scan to increment `scan_count` and produce a `[barcode]` log plus the expected WebSocket message.

## Files changed for this attempt

- `firmware/platformio.ini` — added the experimental IDF 5 environment and Classic HID build configuration.
- `firmware/src/main.cpp` — shared scale/button/HTTP/status/Classic HID implementation.
- `firmware/sdkconfig.defaults` and generated PlatformIO sdkconfig/CMake files — Bluetooth HID host and ESP-IDF 5 configuration.

Generated files and `include/config.h` should be treated as build artifacts unless the project’s normal configuration workflow explicitly tracks them.
