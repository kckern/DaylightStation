# Build & Porting Guide — DaylightStation hardware panels

How the eink-panel firmware was built, the gotchas that cost time, and how to
port this pattern to **other display devices** (other Seeed e-paper panels, or any
ESP32/e-ink/LCD device). Read alongside [README.md](README.md) (the overview).

The reference implementation is the **Seeed reTerminal E1003** (10.3" mono,
16-gray, IT8951 controller, ESP32-S3 / 16MB flash / 8MB OPI PSRAM).

---

## 1. The architecture, in one idea

**The server renders; the device blits.** Two halves connected by a dumb HTTP
contract — this is the part that ports to *any* device.

```
DaylightStation backend                          Hardware panel
─────────────────────                            ──────────────
screens/<id>.yml  ──►  1_rendering/eink  ──► PNG  ──HTTP──►  fetch ─► decode ─►
(SSOT: layout,         (canvas renderer)   (sized              dither ─► push ─► sleep
 data, theme,                               to panel)
 hardware, buttons)
        ▲                                                         │
        └───────────  GET /action?...  ◄──── button press ────────┘
```

**The contract (device-agnostic):**

| Endpoint | Returns | Notes |
|----------|---------|-------|
| `GET /api/v1/eink/panel?id=<panel>` | `image/png` sized to the panel | server renders; any PNG type is fine |
| `GET /api/v1/eink/action?id=<panel>&action=<next\|prev\|select>` | `200 JSON` | advances per-panel view state |

Everything on the **server** side is already device-agnostic: it renders a PNG at
whatever `width`/`height` the panel's SSOT declares. Porting to a new device is
almost entirely a **firmware** exercise.

---

## 2. Reproducible build process

What actually worked, in order. Commands assume `cd _extensions/eink-panel/firmware`.

### 2.1 Identify the hardware (don't guess)
```bash
# With the device on USB, read the chip back — gives SoC, PSRAM, flash, MAC.
esptool --port /dev/cu.wchusbserial1120 chip-id
# E1003 → ESP32-S3, 8MB embedded PSRAM (octal), MAC 44:1b:f6:... (Espressif)
```
The MAC also lets you correlate the USB device with its LAN IP (`arp -n <ip>`).

### 2.2 Host toolchain
- **PlatformIO**: `brew install platformio` (the `pio` CLI).
- **USB-serial driver**: the reTerminal enumerates via a WCH **CH34x** bridge
  (VID `0x1a86`). macOS needs the WCH driver before `/dev/cu.wchusbserial*`
  appears (`brew install --cask wch-ch34x-usb-serial-driver`, then approve in
  System Settings → Privacy & Security and replug).

### 2.3 Generate firmware config from the household SSOT
Credentials/instance values never live in this public repo. They come from
`data/household/screens/<panel>.yml` and are generated into a gitignored header:
```bash
node tools/gen-config.mjs "<data>/household/screens/kitchen-eink.yml"   # -> include/config.h
```

### 2.4 Vendor the device's decode dependency
```bash
node tools/fetch-deps.mjs    # -> lib/seeed/ (pngle + miniz; gitignored)
```

### 2.5 Build, flash, monitor
```bash
pio run                                                   # compile
pio run -t upload --upload-port /dev/cu.wchusbserial1120  # flash (device must be AWAKE)
```
The panel must be awake to flash — tap its Refresh button if upload won't start.

### 2.6 Read serial (headless-safe)
`pio device monitor` needs an interactive TTY and **fails when backgrounded**.
Read the port with pyserial instead — opening it toggles DTR/RTS, resetting the
ESP so you catch a fresh boot:
```bash
"$HOME/.platformio/penv/bin/python" - <<'PY'
import serial, time
p = serial.Serial(); p.port="/dev/cu.wchusbserial1120"; p.baudrate=115200; p.timeout=1
p.dtr=False; p.rts=True; p.open(); time.sleep(0.25); p.rts=False
end=time.time()+25
while time.time()<end:
    line=p.readline().decode(errors="replace").rstrip()
    if line: print(line)
p.close()
PY
```

### 2.7 Verify the loop without looking at the panel
Count backend renders, reset the device, and confirm the count rises with **no
request from you** — proof the *device* fetched:
```bash
before=$(grep -c eink.panel.rendered /tmp/eink-backend.log)
# ...reset device (pyserial DTR toggle)...; sleep 18
after=$(grep -c eink.panel.rendered /tmp/eink-backend.log)   # after > before == device fetched
```
Confirm the rendered image itself by reading the PNG the endpoint returns (a
vision-capable tool, or just open it) — don't rely on eyeballing the panel.

---

## 3. Hard-won gotchas (the time sinks)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `esphome` ignores `-s` subs | `-s` is a **global** flag | put it before the subcommand |
| `epaper_spi` has no E1003 model | stock ESPHome doesn't support IT8951 yet | use Arduino + Seeed_GFX (official IT8951 driver) |
| `XIAO_SPI_Frequency.h: No such file` / `Wire.h` in C files | force-`-include`ing Setup522 pulls non-self-contained headers into plain-C files | don't `-include` it; use `-DBOARD_SCREEN_COMBO=522` and let the lib include its own setup |
| `tconWake`/`setTconTemp` not declared | `TCON_ENABLE` only set by `Dynamic_Setup.h`, which is skipped under `USER_SETUP_LOADED` | use `BOARD_SCREEN_COMBO` (not `USER_SETUP_LOADED`) so Dynamic_Setup runs |
| No serial output at all | board logs to `Serial1`/CH340 (GPIO44/43); `Serial` is USB-CDC and dark | `Serial1.begin(115200, SERIAL_8N1, 44, 43)` |
| `OOM` spam, never renders | full RGB888 buffer (~7.9MB) won't fit beside the 1.32MB Gray16 sprite in 8MB PSRAM | decode to 1 byte/px luma + dither in-place (don't keep RGB888) |
| Every "restart" had no effect | 3 zombie `node backend/index.js` held port 3112 | kill by PID (`pgrep -f`), `pkill` had missed them |
| Device can't reach backend | pointed at a laptop dev server, or server bound to localhost | ensure backend binds `*:PORT`; for permanent installs point at the prod host |

---

## 4. What's device-specific vs reusable

| Layer | Reusable across devices? | Notes |
|-------|--------------------------|-------|
| `1_rendering/eink` (canvas → PNG) | ✅ fully | renders at any resolution/theme |
| `3_applications/eink/EinkPanelService` | ✅ fully | view paging + SSOT load, panel-agnostic |
| `4_api/v1/routers/eink.mjs` | ✅ fully | the HTTP contract |
| `screens/<panel>.yml` SSOT | ◑ per-panel | same schema; values differ (size, pins, content) |
| `tools/gen-config.mjs` / `fetch-deps.mjs` | ◑ mostly | tweak per firmware framework |
| `firmware/src/main.cpp` | ✗ per-device | display driver, pins, decode/dither, sleep/wake |
| `platformio.ini` build flags | ✗ per-device | board, PSRAM, panel select, pins |

**Rule of thumb:** if you keep the PNG contract, the entire server side is free.

---

## 5. Porting recipe → a new device

1. **Identify the SoC + display controller** (`esptool chip-id`, vendor wiki,
   datasheet). The controller decides the firmware driver and color depth.
2. **Pick the firmware path:**
   - **ESPHome** if the panel has a stock driver — least code, OTA, no C. Omit
     the `api:` block to stay fully local (no Home Assistant). Use `online_image`
     pointed at `/api/v1/eink/panel`.
   - **Arduino/PlatformIO** if there's no ESPHome driver (the E1003/IT8951 case).
     Use the vendor's official display library.
3. **Create the SSOT** `data/household/screens/<panel>.yml`. Reuse the existing
   schema: `hardware.display` (controller/size/rotation/color), `provisioning`
   (wifi/ota/node), `backend` (host/port), `buttons`, and a `content` block of
   renderer `views` (`layout`/`data`/`theme`).
4. **Set the render size/format.** The server renders `content.width × height`.
   Match the panel's native resolution (and `rotation`). PNG output suits any
   panel; the device handles color reduction.
5. **Decide where dithering happens — by PSRAM budget.** This is the key
   per-device call:
   - Plenty of RAM / color panel → decode + dither on device, or let ESPHome do it.
   - Tight RAM (E1003: sprite + buffers must fit 8MB) → decode to **1 byte/px**
     and dither in-place, or move dithering **server-side** and ship a packed
     buffer. Never hold a full RGB888 frame on a memory-constrained device.
6. **Map inputs & power.** Buttons → `esp_sleep_enable_ext1_wakeup(mask, ANY_LOW)`
   on RTC-capable GPIOs; choose a wake pin; set `sleep_duration` for periodic
   refresh. Find the board's **debug UART** for logs (don't assume `Serial`).
7. **Auth:** LAN devices get `sysadmin` via `networkTrustResolver`, so no token
   is needed on the same subnet. Keep the panel firewall-able to LAN-only.
8. **Flash & verify** with §2.5–2.7. First confirm the *fetch* (backend count
   delta), then the *image* (read the PNG), then the *panel* (by eye: rotation,
   mirroring, dither quality → adjust `rotation` / dither).

---

## 6. File map (this extension)

```
_extensions/eink-panel/
├── README.md                 # overview, devices, usage, status
├── BUILD.md                  # this file
└── firmware/
    ├── platformio.ini        # board / PSRAM / -DBOARD_SCREEN_COMBO=522 / lib_deps
    ├── src/main.cpp          # wake → wifi → fetch → decode → dither → push → sleep
    ├── include/config.example.h   # template (committed)
    ├── include/config.h           # generated from SSOT (gitignored)
    ├── tools/gen-config.mjs       # SSOT yaml → config.h
    ├── tools/fetch-deps.mjs       # vendor pngle+miniz → lib/seeed (gitignored)
    └── lib/seeed/                 # fetched decoder (gitignored)
```

Backend counterparts: `backend/src/3_applications/eink/`, `.../4_api/v1/routers/eink.mjs`,
`.../1_rendering/eink/`, SSOT at `data/household/screens/<panel>.yml`.
