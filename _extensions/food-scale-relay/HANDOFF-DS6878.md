# DS6878 food-scale relay handoff

Status as of 2026-07-20. The ESP32 side is believed correct and is no longer the
suspected blocker. The remaining step is a **physical scanner configuration
change** (see "What's left" below).

## What changed this session

### 1. The scanner MAC was never reaching the firmware (fixed)

`barcode.mac` was absent from the household SSOT, so `BARCODE_MAC` generated
empty and the firmware fell back to fuzzy name matching. Added to
`data/household/config/scales.yml`:

```yaml
    barcode:
      id: nutribot-upc
      route: nutribot
      name: "DS6878"
      mac: "00:23:68:c3:f1:70"   # Zebra DS6878 M1N65C85A, Classic BT HID
```

Regenerate + flash (do NOT hand-edit `include/config.h` — it is generated):

```sh
cd firmware
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale
/Users/kckern/.platformio/penv/bin/pio run -e m5-atom-idf5 -t upload \
  --upload-port /dev/cu.usbserial-7952C47E3B
```

### 2. A connect storm was masking the real behavior (fixed)

`ESP_HIDH_OPEN_EVT` fires twice — once interim with
`conn_status == CONNECTING, handle=255`, then once final. The old code treated
the interim event as a terminal failure, so it immediately restarted discovery
and issued a second `esp_bt_hid_host_connect()` on top of the in-flight one.
That produced the confusing `btc_hh_connect HH is connecting, ignore!` and
`OPEN status=15` (`ESP_HIDH_BUSY`) lines in the old logs — self-inflicted, not
scanner behavior.

Fixes in `firmware/src/main.cpp`:

- Interim `CONNECTING` open events are ignored; only final ones settle state.
- A `g_classicConnecting` latch prevents overlapping connect/discovery, with a
  20 s watchdog so a lost callback can't wedge the state machine.
- 20 s backoff after a close/failure instead of retrying every 12 s.
- The BLE scale scan is stopped while paging the scanner — a continuous BLE
  scan starves classic paging on the shared radio (that was the source of the
  intermittent `hcif conn complete: hdl 0xfff, st 0x4` page timeouts).
- Full event logging: `CLOSE` reason, `GET_DSCP`, `ADD_DEV`, `SET_PROTO`,
  `VC_UNPLUG`, ACL up/down, and bonded-device enumeration at boot.

### 3. HTTP control plane (new)

Ops without a serial cable, in the spirit of `pbctl`:

| Endpoint | Effect |
|---|---|
| `GET /status` | Adds `mode`, `connecting`, `open_count`, `close_count`, `bonds`, `last_event` |
| `GET /barcode/connect` | One-shot host-initiated page |
| `GET /barcode/disconnect` | Drop the HID link |
| `GET /barcode/unbond` | Remove stored link keys, force fresh pairing |
| `GET /barcode/mode?passive=0\|1` | Page the scanner (0, default) vs. listen (1) |

ESP is at **10.0.0.47** (DHCP).

## What the corrected logs actually show

The HID connection **fully succeeds** and the scanner then tears it down:

```
[classic-hid] found DS6878
[classic-hid] opening scanner
[classic-hid] OPEN status=0 conn=1 handle=255      <- interim, connecting
[classic-hid] ACL up stat=0
BT_SDP: process_service_attr_rsp                    <- SDP OK
BT_APPL: new conn_srvc id:23, app_id:2              <- HID service up
[classic-hid] OPEN status=0 conn=0 handle=0         <- CONNECTED
[classic-hid] GET_DSCP found=1 dl_len=65            <- report descriptor read!
[classic-hid] CLOSED: 0 reason=0 conn=2             <- ~16 ms later
BT_HCI: hcif disc complete: hdl 0x81, rsn 0x13      <- remote user terminated
```

This supersedes the old handoff's "SDP/open failure" theory. SDP succeeds, the
65-byte HID report descriptor is retrieved, and the close originates from the
peer (`bta_hh_close_act`, HCI reason 0x13 = remote user terminated). The ESP32
HID host stack is working.

## ROOT CAUSE FOUND: Just Works pairing → unauthenticated link key

The scanner is a HID **keyboard-class** device, so it requires an
**MITM-authenticated** link key and drops the HID channel ~16 ms after it opens
if it only got an unauthenticated one.

The firmware declared `ESP_BT_IO_CAP_NONE` (NoInputNoOutput). NoInputNoOutput on
either side forces SSP to the **"Just Works"** association model, which produces
exactly that unauthenticated key. Confirming evidence: across the entire session
there were **zero** SSP events — no `KEY_NOTIF`, no `CFM_REQ`, no `PIN_REQ` —
just a bare `auth status=0`. That silence *is* the Just Works signature.

**Fix:** declare `ESP_BT_IO_CAP_OUT` (DisplayOnly). SSP then negotiates
**Passkey Entry**, proven live:

```
[classic-hid] ENTER PASSKEY ON SCANNER: 421197
```

That passkey only gets generated because the scanner declares itself
KeyboardOnly — which independently confirms it wants an authenticated link.

Corroborated by the PRG (p.4-30): *"Typically, however, HID connections require
entering a Variable PIN Code."*

### Pairing procedure (one-time — the bond persists afterward)

On the scanner, once:
1. **Bluetooth Keyboard Emulation (HID Slave)** — `~/Downloads/DS6878-SCAN-THIS-hid-slave.png`
2. **Variable PIN Code** — `~/Downloads/DS6878-SCAN-THIS-variable-pin.png`

Then, with the digit pages open (`~/Downloads/DS6878-PASSKEY-DIGITS-476.png` =
0-5, `-477.png` = 6-9 + End of Message):

```sh
node firmware/tools/pair-scanner.mjs        # unbonds, connects, prints the passkey
```

Pull the scanner trigger to wake it if idle. When the passkey prints, scan the
six digits then **End of Message**. You have ~30 s (LMP timeout) — `auth
status=9` means you were too slow, just re-run. Success = `/status` shows
`connected: true` and it *stays* true.

### io-cap modes

`/barcode/iocap?mode=display|keyboard`. **DisplayOnly (`display`) is the default
and the proven path.** `keyboard` (KeyboardOnly + a fixed passkey from
`barcode.fixed_passkey`, default `000000`) was added so the digits can be
pre-staged instead of racing the timer, but it is **UNVERIFIED** — the one
attempt to test it coincided with the USB serial adapter dropping out and the
board power-cycling, so nothing was learned. Don't trust it until it's tested.

## Earlier hypothesis: the scanner's host type (done, not sufficient)

Per the DS6878 Product Reference Guide p.4-4/4-5, the scanner's **default host
type is "Cradle Host"**. In that mode it talks to a Zebra cradle, not a generic
Bluetooth HID host. To act as a Bluetooth keyboard it must be switched to
**"Bluetooth Keyboard Emulation (HID Slave)"**.

Supporting evidence that the scanner is still at defaults: its advertised name
is `DS6878 M1N65C85A`, which matches the PRG's documented default naming
(`DS6878` + serial number).

**Action:** scan this configuration barcode with the DS6878 —

`~/Downloads/DS6878-SCAN-THIS-hid-slave.png`
(cropped from PRG PDF page 67 / manual page 4-5; full page also rendered at
`~/Downloads/ds6878-hostcodes-067.png`)

Then power-cycle nothing — just re-check `http://10.0.0.47/status`. The firmware
retries on its own every ~20 s, or force one with
`curl http://10.0.0.47/barcode/connect`.

Note this is the leading hypothesis, not a proven fact — it has not been tested
because it needs physical access to the scanner. If the mode change alone
doesn't hold the link, the next things to try, in order:

1. `curl http://10.0.0.47/barcode/unbond`, then reconnect — the ESP holds a bond
   (`bonds: 1`) that the scanner may no longer have a matching link key for.
2. PRG p.4-20 "Auto-reconnect in Bluetooth Keyboard Emulation (HID Slave) Mode"
   — set **Auto-reconnect Immediately** (rendered at
   `~/Downloads/ds6878-autoreconnect-081.png`). Default is "on Bar Code Data",
   which means the scanner may intentionally drop an idle link.
3. PIN: the firmware replies with the DS6878 default static PIN `12345`
   (confirmed in PRG p.4-30). If the scanner asks for a *variable* PIN, that
   path needs different handling.

## Things ruled out

- **Pairing barcodes are irrelevant here.** PRG p.4-25: pairing bar codes
  (`<Fnc 3>Bxxxxxxxxxxxx`, Code 128) exist only to point an **SPP Master**
  scanner at a remote address. In HID the scanner is a *Slave* and the host
  initiates, so there is nothing to encode. An earlier plan to generate a
  pairing barcode for the ESP's MAC was wrong.
- **Host-initiated paging is correct**, not a bug. PRG p.4-4: "The digital
  scanner accepts incoming connection requested from a remote device and is the
  slave. Scan Bluetooth Keyboard Emulation (HID Slave) and wait for the incoming
  connection." A `passive=1` listening mode exists in the firmware but is NOT
  the right default for this scanner.
- **Contention with the Mac.** `system_profiler SPBluetoothDataType` shows no
  DS6878/DS2278 pairing on this machine.
- **`BTA_HH_DISC_BUF_SIZE=8192`** — kept, but the descriptor is only 65 bytes,
  so the original 4 KB default was never the constraint.

## Hardware identities

- ESP32 ATOM: WiFi/STA MAC `f0:16:1d:02:2a:88`, **Classic BT MAC
  `f0:16:1d:02:2a:8a`** (they differ — use the BT one for anything Bluetooth).
  Advertises as `DaylightScanHost`. IP 10.0.0.47.
- Nutrition scanner: Zebra DS6878, Classic Bluetooth HID, MAC
  `00:23:68:c3:f1:70`, name `DS6878 M1N65C85A`.
- Other scanner: DS2278 — do NOT use as the nutrition scanner.
- Scale: KitchenIQ 50797 / `SENSSUN FOOD`, BLE service `0000ffb0-…`, notify
  characteristic `0000ffb2-…`.

## Build environments

`m5-atom-idf5` (ESP-IDF 5.5.4) is the active environment and is what is flashed.
`m5-atom` is the older IDF 4.4 build, left in place but stale — it has not been
rebuilt with any of this session's changes.

## Success criteria (unchanged, still unmet)

Discovery alone is not success. Success requires `/status` to show
`barcode.connected: true` **and stay true**, then a test scan to increment
`scan_count`, emit a `[barcode] …` log, and deliver the WebSocket message with
`device=nutribot-upc` / `route=nutribot`.
