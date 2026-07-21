# eink-panel — local-only e-paper displays for DaylightStation

Drives Seeed **reTerminal E-series** e-paper panels as **fully-local clients of
DaylightStation**. No SenseCraft, no cloud, no Home Assistant — the panel only
ever talks HTTP to the DaylightStation backend on the LAN, and can be firewalled
to LAN-only.

This is a **hardware screen class** (physical e-ink), distinct from the
software-only browser dashboards (`screens/office.yml`, `screens/living-room.yml`).
Those render in a browser; this renders a server-side image shipped to a
low-power ESP32-S3 panel.

> **Building this, or porting to another device?** See [BUILD.md](BUILD.md) —
> the reproducible build process, gotchas, and the device-agnostic abstraction.

## Devices

| IP | Model | Display | Controller |
|----|-------|---------|------------|
| 10.0.0.63 | reTerminal **E1003** | 10.3" mono, 16-grayscale, 1872×1404 | **IT8951** |
| 10.0.0.88 | reTerminal (E10xx — confirm model) | TBD | TBD |

Both are ESP32-S3 (MAC prefix `44:1b:f6` = Espressif). In stock SenseCraft
firmware they expose no local ports (outbound-only cloud clients) — which is why
we reflash with our own firmware.

## Why Arduino (not ESPHome) for the E1003

The E1003's display uses an **IT8951** controller. Stock ESPHome does **not**
support it yet (open PR [esphome#15346](https://github.com/esphome/esphome/pull/15346));
the only ESPHome route today is a third-party AI-generated external component.
Seeed, by contrast, ships an **official Arduino library** (`Seeed_GFX`) with a
tested IT8951 Gray16 pipeline for this exact panel. We use that — more auditable,
no vibe-coded dependency.

## Architecture — "remote control for your own server"

```
button press / timer
  -> ESP wakes from deep sleep
  -> WiFi
  -> [if a button] GET /api/v1/eink/<panel>/action/<next|prev|select>
  -> GET /api/v1/eink/<panel>/config     (cheap key=value snapshot, no pixels)
       -> read next_wake, btn map, rotation, image path, image_hash
       -> image_hash == stored hash?  -> skip download + refresh, straight back to sleep
       -> image_hash changed?         -> GET <image> -> pngle decode -> dither Gray16 -> IT8951 -> refresh
  -> deep sleep for next_wake seconds (wake on any button via ext1, or timer)
```

The panel is a dumb client: each wake just asks DaylightStation "what should I
show now, and has it changed?". Layout/content live on the server (reusing its
rendering layer), keeping the firmware tiny. E-paper refresh is ~1–3 s with the
characteristic flash — great for discrete menus/paging, not live UI.

**State snapshot (battery saver).** Instead of conditionally fetching the
expensive PNG, the panel first polls `/config` — a cheap text snapshot the server
computes **without rendering any pixels**. It resolves the current view's data
feeds and fingerprints every pixel-affecting input (date, view, layout, theme,
resolved data, `RENDERER_VERSION`) into `image_hash`. The firmware stores that
hash in RTC memory (survives deep sleep) and compares it on the next wake; an
unchanged hash means the panel skips the `/panel` download and the ~1–3 s e-ink
refresh entirely. This is what makes a short cadence (e.g. 15 min) affordable on
battery — most wakes never touch `/panel`. `/config` also carries `next_wake`
(server-driven deep-sleep duration) and the runtime button/rotation map, so cadence
and config are SSOT edits, never reflashes. A button action just pages the server's
view state; the next `/config` poll reflects the freshly-selected view's hash.

## Config-driven (no secrets, no instance values in this public repo)

Single source of truth is household data (private, outside this repo):
`data/household/screens/kitchen-eink.yml` — provisioning (Wi-Fi/OTA), hardware,
button map, and content. Two generated artifacts are **gitignored**:

- `firmware/include/config.h` — generated from the SSOT (`tools/gen-config.mjs`)
- `firmware/lib/seeed/` — Seeed's render pipeline, fetched on demand (`tools/fetch-deps.mjs`)

## Backend contract (DaylightStation side — implemented)

Served at `/api/v1/eink/*` (router: `backend/src/4_api/v1/routers/eink.mjs`,
orchestration: `backend/src/3_applications/eink/EinkPanelService.mjs`).

The panel `id` is a **path segment** (the v1 API convention — `/sessions/:id`,
`/:deviceId/load`); query strings are reserved for filters/options.

| Route | Returns | Purpose |
|-------|---------|---------|
| `GET /api/v1/eink/<id>/config` | **text/plain** key=value snapshot: `id`, `rotation`, `btn_green/right/left`, `next_wake`, `image`, `image_hash`. `Cache-Control: no-cache`. Computed **without rendering** (resolves data, fingerprints inputs). | the cheap wake-time poll: what to show, cadence, and whether the image changed |
| `GET /api/v1/eink/<id>/panel` | **PNG** sized to the panel (1872×1404, or 1404×1872 if `rotation: 270`); dithered on-device. `Cache-Control: no-cache`. Pure on-demand render — **no ETag/304** (change detection lives on `/config`). | the expensive render — pulled only when `image_hash` changed |
| `GET /api/v1/eink/<id>/action/<next\|prev\|select>` | `{ ok, action, index, view, viewCount }` | advance per-panel view state; firmware then re-polls `/config` |

Rendered server-side in `backend/src/1_rendering/eink/`, keyed by `id`, from the
`content` block of `screens/<id>.yml`. `image_hash` is the SHA-1 of every
pixel-affecting input (date, view, layout, theme, resolved data feeds, and the
`RENDERER_VERSION` constant in `1_rendering/eink/index.mjs`) — so it changes when
the content changes **or** when a renderer/widget code change would alter pixels
for identical inputs (bump `RENDERER_VERSION` to force a refresh).

## Build & flash

```bash
cd firmware

# 1) generate config.h from the household SSOT (gitignored output)
node tools/gen-config.mjs "<data>/household/screens/kitchen-eink.yml"

# 2) vendor Seeed's render pipeline into lib/seeed/ (gitignored)
node tools/fetch-deps.mjs

# 3) build + flash (panel must be AWAKE — tap Refresh if upload won't start)
pio run -t upload --upload-port /dev/cu.wchusbserial1120
pio device monitor -b 115200
```

Requires PlatformIO and the CH34x USB-serial driver (the panel enumerates as
`/dev/cu.wchusbserial*`).

## Files

```
eink-panel/
├── README.md
└── firmware/
    ├── platformio.ini                 # XIAO-ESP32-S3 / 16MB / OPI PSRAM / Setup522
    ├── src/main.cpp                   # WiFi + HTTP + decode/dither/push + buttons + deep sleep
    ├── include/
    │   ├── config.example.h           # template (committed)
    │   └── config.h                   # GENERATED from SSOT (gitignored)
    ├── tools/
    │   ├── gen-config.mjs             # SSOT yaml -> config.h
    │   └── fetch-deps.mjs             # vendor Seeed pipeline -> lib/seeed/
    └── lib/seeed/                     # fetched: Setup522 + dither + pngle + miniz (gitignored)
```

## Status

Working end-to-end on the kitchen E1003 (2026-06-18):
- ✅ Backend `/api/v1/eink/<id>/{config,panel,action}` implemented (DDD:
  `EinkPanelService` in 3_applications + `eink.mjs` router in 4_api, reusing
  `1_rendering/eink`), reads the SSOT via `dataService.household.read`.
  `stateSnapshot` fingerprints inputs for `/config` without rendering. Renders
  verified (1872×1404).
- ✅ Firmware compiles, flashes, and runs: device wakes → WiFi → polls `/config`
  → on hash change fetches PNG → pngle decode → on-device Floyd-Steinberg Gray16
  dither → IT8951 push → deep sleep for `next_wake`. Confirmed via serial
  (`[eink] rendered 1872x1404`) + backend fetch.

Notes / not-yet-verified:
- **Serial logging** is on `Serial1` (GPIO44/43), the reTerminal's CH340 UART —
  `Serial` (USB CDC) is dark on this board.
- **Memory:** decode is 1 byte/pixel luma (~2.6MB) + the 1.32MB Gray16 sprite.
  The full RGB888 buffer Seeed's `dither_image` wants (~7.9MB) does NOT fit in
  8MB PSRAM beside the sprite — that's why dithering is done in `main.cpp`.
- **Visual confirmation** of the physical panel (rotation/mirroring, dither
  quality) is by eye — flip `hardware.display.rotation` in the SSOT if needed.
- **Button presses** wake the device (ext1 on GPIO3/4/5) and POST an action,
  but a physical press hasn't been bench-tested yet.
- Deep-sleep power can be cut further (SD/touch controller leakage) per
  community findings — optimization, not required for a USB-powered panel.

## References

- Seeed Arduino cookbook (E10xx): https://wiki.seeedstudio.com/reterminal_e10xx_with_arduino/
- Seeed_GFX library + E1003 Gray16 example: https://github.com/Seeed-Studio/Seeed_GFX
- E1003 getting started: https://wiki.seeedstudio.com/getting_started_with_reterminal_e1003/
