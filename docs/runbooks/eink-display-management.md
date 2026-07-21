# E-Ink Display Management

**Created:** 2026-06-18
**Class:** `epaper` (hardware e-ink) — distinct from the browser-based kiosk screens (`office.yml`, `living-room.yml`)
**Reference device:** Seeed reTerminal **E1003** (10.3" mono, 16-gray, IT8951 controller, ESP32-S3)
**Extension:** `_extensions/eink-panel/` (firmware + build/porting docs)

---

## Overview

An e-ink panel is a **dumb LAN client of DaylightStation**. It has no UI logic of its
own: it wakes (on a button or a timer), asks the backend "what should I show?", draws the
PNG we return, and goes back to deep sleep. **All layout, data, and theming live on the
server** — keyed by panel `id`, read from `data/household/screens/<id>.yml`, rendered by
the `1_rendering/eink` framework (a server-side canvas analogue of the browser
`frontend/src/screen-framework/`).

```
button press / timer
  → ESP wakes from deep sleep → WiFi
  → [if a button] GET /api/v1/eink/<panel>/action/<next|prev|select>
  → GET /api/v1/eink/<panel>/config            (cheap key=value snapshot)
       • read next_wake (sleep cadence), rotation, button map
       • compare image_hash to the one cached in RTC memory
  → if image_hash UNCHANGED: skip straight to deep sleep   ← the common case
  → if CHANGED (or first boot): GET /api/v1/eink/<panel>/panel   (PNG, sized to the panel)
       → pngle decode → Floyd-Steinberg dither → push to panel → refresh → store new hash
  → deep sleep for next_wake seconds (wake on any button via ext1, or on timer)
```

**Change detection lives on `/config`, not `/panel`.** `/config` is a cheap render of the
SSOT blueprint's *now-state*: it resolves the current view's data and fingerprints every
pixel-affecting input into `image_hash` **without drawing the PNG**. The panel polls
`/config` on every wake and pulls the expensive `/panel` PNG **only when the hash changed**.
That's what makes a short poll interval viable on battery — most wakes skip both the
download and the ~3 s e-ink refresh.

E-ink refresh is ~1–3 s with the characteristic flash — great for discrete menus/paging,
**not** for live UI. The whole design assumes infrequent, deliberate redraws.

> **This runbook covers operating and extending the *server* side** (configs, views,
> widgets, verification). For building/flashing/porting *firmware*, see
> `_extensions/eink-panel/BUILD.md` and `README.md`.

---

## The HTTP contract (device-agnostic)

The panel `id` is a **path segment** (matches the rest of the v1 API — `/sessions/:id`,
`/budgets/:id`, `/info/plex/:id`; query strings are reserved for filters, never identity).

| Endpoint | Returns | Purpose |
|----------|---------|---------|
| `GET /api/v1/eink/<id>/config` | `text/plain` `key=value` snapshot (`Cache-Control: no-cache`) | the wake-time **state snapshot** — runtime config + cadence + change gate (below) |
| `GET /api/v1/eink/<id>/panel` | `image/png` sized to the panel (`Cache-Control: no-cache`) | render the panel's **current** view (pure on-demand render — no ETag/304) |
| `GET /api/v1/eink/<id>/action/<next\|prev\|select>` | `200` JSON `{ ok, action, index, view, viewCount }` | advance per-panel view state; the panel re-fetches `/config` after |

**`/config` body** (lib-free `key=value` lines so the firmware needs no JSON parser):

```
id=kitchen-eink
rotation=0                              # display rotation (degrees) — SSOT, not flashed
btn_green=select                        # physical button → action map (SSOT, not flashed)
btn_right=next
btn_left=prev
next_wake=900                           # seconds to deep-sleep before the next timer wake
image=/api/v1/eink/kitchen-eink/panel   # PNG path to pull when the hash changed
image_hash=<sha1>                       # fingerprint of every pixel-affecting input
```

- **`image_hash`** = SHA-1 of `{ date, view id, view index, width, height, theme, layout,
  resolved data feeds, RENDERER_VERSION }` — computed by `EinkPanelService.stateSnapshot`
  **without rendering**. The panel stores it in RTC memory and only pulls `/panel` when it
  differs. Bump **`RENDERER_VERSION`** (`backend/src/1_rendering/eink/index.mjs`) whenever a
  renderer/widget change would alter pixels for identical inputs — it's folded into the
  hash, so the bump forces every panel to pull one fresh frame.
- **`next_wake`** is computed server-side from the SSOT `refresh` block (`schedule` windows +
  `interval` fallback) — see *Refresh cadence* below. A schedule edit takes effect within one
  wake cycle, no reflash.
- **Auth:** none required. The panel is on the LAN, where `networkTrustResolver` grants
  `sysadmin`. Keep the panel firewall-able to LAN-only.
- `next`/`prev` page through `content.views`; `select` is reserved (currently a no-op that
  keeps the current view — per-view behavior is a future widget concern).
- **View state is in-memory and ephemeral** (`EinkPanelService.#viewIndex`, a
  `panelId → index` Map). A backend restart or panel reboot resets every panel to view 0.
  This is by design — there is no persistence to manage.

---

## File map

**Server (DDD layers):**

| Path | Responsibility |
|------|----------------|
| `backend/src/4_api/v1/routers/eink.mjs` | HTTP layer — `/:id/config`, `/:id/panel`, `/:id/action/:action` routes |
| `backend/src/3_applications/eink/EinkPanelService.mjs` | Orchestration — load SSOT, track view index, build the render config, call the renderer; `stateSnapshot` (cheap fingerprint, no render) backs `/config` |
| `backend/src/3_applications/eink/wakeSchedule.mjs` | Pure `computeNextWakeSeconds(refresh, now)` — schedule windows + interval fallback → `next_wake` |
| `backend/src/1_rendering/eink/EinkRenderer.mjs` | `config + data → PNG buffer` (canvas equivalent of `ScreenRenderer.jsx`) |
| `backend/src/1_rendering/eink/PanelRenderer.mjs` | Recursive flexbox layout → absolute widget boxes (equivalent of the framework's `PanelRenderer.jsx`) |
| `backend/src/1_rendering/eink/providers/DataResolver.mjs` | Fetch all `data` sources before render (equivalent of `ScreenDataProvider.jsx`) |
| `backend/src/1_rendering/eink/widgets/registry.mjs` | name → draw-fn map |
| `backend/src/1_rendering/eink/widgets/builtins.mjs` | registers `header`, `weather`, `placeholder`, `date`, `calendar`, `schedule`, `todos` |
| `backend/src/1_rendering/eink/widgets/*Widget.mjs` | individual draw functions `(ctx, box, data, theme) => void` |
| `backend/src/1_rendering/eink/widgets/lib/fonts.mjs` | base font (Roboto Condensed) + `font(size, {bold})` helper + `FONT_FACES` the renderer registers |
| `backend/src/1_rendering/eink/widgets/lib/card.mjs` | shared `drawCard` (titled section + accent rule) / `drawRows` (list) chrome for list-style widgets |
| `backend/src/0_system/canvas/CanvasRenderer.mjs` | low-level node-canvas wrapper (fonts, context); `registerFont(path, family, {weight,style})` |

**Wiring:** `backend/src/app.mjs` (~line 1287) constructs `EinkPanelService` and mounts the
router; `backend/src/4_api/v1/routers/api.mjs` (~line 101) maps `/eink → eink`.

**Config SSOT (household data, private):** `data/household/screens/<panelId>.yml`

**Firmware extension:** `_extensions/eink-panel/` (`firmware/`, `README.md`, `BUILD.md`).

---

## The config SSOT — `screens/<panelId>.yml`

One file is the single source of truth for a panel: provisioning (Wi-Fi/OTA — read by the
flash tool only), hardware, button map, **and** content (read by the render endpoint).
Reference: `data/household/screens/kitchen-eink.yml`.

```yaml
screen: kitchen-eink
class: epaper                  # marks this a hardware panel, not a browser screen
route: /api/eink/panel         # informational; the live routes are /api/v1/eink/<id>/{config,panel,action}

hardware:
  device: seeed-reterminal-e1003
  display:
    controller: IT8951
    width: 1872                 # native landscape
    height: 1404
    color: grayscale-16
    rotation: 0                 # 0 = 1872x1404 landscape, 270 = 1404x1872 portrait

network: { mode: dhcp, mac: "44:1b:f6:..." }
provisioning: { node_name: kitchen-eink, wifi_ssid: ..., ota_password: ... }  # flash tool only
backend:  { host: daylightlocal.kckern.net, port: 3111 }                      # firmware target

buttons:                        # physical button → action string
  green: select                 # GPIO3
  right: next                   # GPIO4 (also the deep-sleep wake pin)
  left:  prev                   # GPIO5

refresh:
  redraw_on_wake: true
  interval: 15min               # flat fallback cadence (used when no schedule window matches now)
  schedule:                     # time-of-day windows (LOCAL); the one containing "now" sets next_wake
    - { from: "06:00", to: "22:00", every: 15min }   # active hours: frequent
    - { from: "22:00", to: "06:00", every: 4h }      # overnight: sparse (saves battery)
  idle_sleep_after: 8s          # awake window after a press before sleeping

# What the panel renders. `next`/`prev` page through `views`.
content:
  width: 1872                   # MUST match hardware.display (rotation 0 = landscape)
  height: 1404
  theme:                        # merged over DEFAULT_THEME, then per-view theme on top
    bg: "#FFFFFF"               # pure black/white reads crispest on mono e-ink
    fg: "#000000"
    headerBg: "#000000"
    headerFg: "#FFFFFF"
  views:
    - id: home
      layout:                   # recursive flexbox tree (see "Layout model" below)
        direction: column
        children:
          - { widget: header, basis: 180, props: { title: "Kitchen" } }
          - { widget: weather, grow: 1 }
      data:                     # fetched before render, keyed for the widgets
        weather: { source: /api/v1/home/weather }
    - id: info
      layout:
        direction: column
        children:
          - { widget: header, basis: 180, props: { title: "Page 2" } }
          - { widget: placeholder, grow: 1, props: { label: "More widgets coming" } }
```

### Layout model (`PanelRenderer.resolveLayout`)

A layout node is either a **leaf** (`{ widget, props }`) or a **container**:

| Field | Default | Meaning |
|-------|---------|---------|
| `direction` | `column` | `row` or `column` (main axis) |
| `children` | — | array of child nodes |
| `basis` | — | fixed size in px along the main axis (overrides `grow`) |
| `grow` | `1` | flex-grow share of leftover space |
| `padding` | `0` | px, applied inside the container box |
| `gap` | `0` | px between children |

Each leaf widget is drawn into its computed box, clipped to that box. There is **no
absolute positioning** — everything is flex. (This mirrors the browser framework's panel
layout, deliberately.)

### Theme keys

`DEFAULT_THEME` (in `EinkRenderer.mjs`): `bg, fg, muted, headerBg, headerFg, red, yellow,
blue, green`. Per-screen `content.theme` overrides these; a per-view `theme` overrides
again on top. **On mono panels, prefer pure black/white** — grays dither unpredictably.
Color widgets (e.g. weather) restrict themselves to the Spectra-6 palette
(black/white/red/yellow/blue/green) for the same reason.

**Base font: Roboto Condensed.** `widgets/lib/fonts.mjs` is the single source of truth
(`BASE_FONT` + `FONT_FACES`); `EinkRenderer` registers the faces (Regular as normal,
SemiBold as bold) on every render before drawing — node-canvas resolves a family by name
only after registration, so this is required (unlike system fonts like DejaVu, which
fontconfig finds automatically). Widgets address it via `font(size, { bold })`. If the
SemiBold face is absent on a host, bold degrades to synthetic bold (non-fatal). To change
the whole panel's typeface, swap `BASE_FONT`/`FONT_FACES` in one place.

### Data model (`DataResolver`)

`view.data` (falling back to `content.data`) is a map of `{ key: { source: '/api/...' } }`.
Before render, every source is fetched (relative paths are prefixed with the service
`baseUrl`), and the results are passed to **every** widget as `data[key]`. Widgets read the
keys they care about (the weather widget reads `data.weather`). **Failed fetches are
swallowed** (`Promise.allSettled`, only fulfilled results kept) — a down source yields a
widget with no data, not a render error. See the `baseUrl` gotcha below: this is why a
broken data URL shows up as "No weather data" rather than a 500.

### Refresh cadence (`refresh` → `next_wake`)

The `refresh` block is the SSOT for how long the panel deep-sleeps between wakes.
`wakeSchedule.computeNextWakeSeconds(refresh, now)` resolves it server-side and ships the
result as `next_wake` (seconds) in every `/config` response — so cadence is a YAML edit, not
a reflash.

| Field | Meaning |
|-------|---------|
| `interval` | Flat fallback cadence (e.g. `15min`). Used whenever no `schedule` window contains *now*. |
| `schedule` | Ordered time-of-day windows (LOCAL). The first window whose `[from, to)` contains *now* sets the cadence via its `every`. Windows may wrap midnight (`22:00`→`06:00`). |
| `redraw_on_wake` | Whether the panel re-evaluates content on a timer wake (vs. only on a button press). |
| `idle_sleep_after` | How long the panel stays awake after a button press before sleeping again. |

Durations accept `s`/`min`/`h` suffixes (`15min`, `4h`, `8s`). With the example block above,
a wake at 14:00 returns `next_wake=900` (15 min); a wake at 02:00 returns `next_wake=14400`
(4 h overnight). A schedule edit takes effect on the **next** wake — the panel is asleep
until then, so there's a one-cycle lag, no reflash.

---

## Current state (inventory)

| Panel `id` | IP | Model | Status |
|-----------|-----|-------|--------|
| `kitchen-eink` | 10.0.0.63 | reTerminal E1003 (1872×1404 mono) | Working end-to-end (firmware flashed; fetch + dither + push verified) |
| _(second unit)_ | 10.0.0.88 | reTerminal E10xx — model TBD | Hardware present, not yet provisioned |

**Available widgets:**

| Widget | Kind | Data | Notes |
|--------|------|------|-------|
| `header` | real | `props.title` | date + title bar |
| `weather` | real | `/api/v1/home/weather` → `data.weather` | current conditions + hourly chart |
| `date` | real | none (server date) | big focal date (weekday / day / month-year); **no live clock** — a ticking time would be stale on a cadence-refreshed panel, and date-only content keeps the `image_hash` stable (changes ~once/day), so the panel skips the `/panel` pull on most wakes |
| `calendar` | **stub** | `data.calendar.events: [{time,title}]` | sample events until a feed is wired; tagged `STUB` |
| `schedule` | **stub** | `data.schedule.blocks: [{time,title}]` | sample time blocks; tagged `STUB` |
| `todos` | **stub** | `data.todos.items: [{text,done}]` | sample checklist; tagged `STUB` |
| `placeholder` | fallback | — | dashed box; auto-used for any unknown widget name |

The **stub** widgets are skeleton renderables: they draw sample content (with a small `STUB`
tag) when no data source is present, so a layout can be designed and previewed before the
real feed exists. Wire a real source in the view's `data` and they switch to live content
(and drop the tag). This is the config-driven layout skeleton — the roadmap below covers
turning the stubs into real data widgets and the remaining gaps vs the browser framework.

---

## Operating tasks

### Preview a panel without hardware

The endpoint returns a plain PNG — render and open it (or `Read` it with a vision tool).
No device needed.

```bash
# Wake-time snapshot (what the device actually polls first): config + next_wake + image_hash
curl -s "http://localhost:3111/api/v1/eink/kitchen-eink/config"

# Current view of a panel
curl -s "http://localhost:3111/api/v1/eink/kitchen-eink/panel" -o /tmp/eink.png \
  -w 'http=%{http_code} bytes=%{size_download}\n'

# Page forward, then re-render (mimics a 'next' button press)
curl -s "http://localhost:3111/api/v1/eink/kitchen-eink/action/next"
curl -s "http://localhost:3111/api/v1/eink/kitchen-eink/panel" -o /tmp/eink.png
```

On a dev machine, swap the port for your backend (`3112` on kckern-macbook, `3113` on
kckern-server dev). In prod it's `3111`.

### Edit a view / theme / layout (no rebuild)

Configs are **read fresh on every `/panel` request** — `EinkPanelService.#loadScreen` reads
the YAML each time. So editing content is a pure data change:

1. Edit `data/household/screens/<panelId>.yml` (on kckern-server, write via
   `sudo docker exec daylight-station sh -c "cat > data/household/screens/<id>.yml << 'EOF' … EOF"`
   — **never `sed -i`** on YAML; write the whole file).
2. Re-fetch `/panel` to preview. **No Docker rebuild, no backend restart needed.**
3. On the physical panel, press any button (or wait for the `refresh.interval`) to pull the
   new render.

> View **state** (which page is showing) is in-memory; editing the config does not reset it,
> but a backend restart does.

### Add a new widget

Widgets are pure draw functions — `(ctx, box, data, theme) => void` — registered by name.

1. Create `backend/src/1_rendering/eink/widgets/MyWidget.mjs` exporting `draw`. Use the
   `box` (`{x, y, w, h}`) you're given; read `data.<key>` for fetched data and `props` you
   passed in the layout (merged into `data`); use `theme` colors. Keep to pure
   black/white/Spectra-6. Model it on `HeaderWidget.mjs` (simple) or `WeatherWidget.mjs`
   (data + chart).
2. Register it in `backend/src/1_rendering/eink/widgets/builtins.mjs`:
   ```js
   import { draw as drawMyWidget } from './MyWidget.mjs';
   // inside registerBuiltins():
   register('mywidget', drawMyWidget);
   ```
3. Reference it from a view's `layout`: `{ widget: mywidget, grow: 1, props: { … } }`.
4. This is **code** — it requires a Docker rebuild + redeploy to reach prod (see below).
   An unknown widget name renders the dashed `placeholder` box instead of crashing, so a
   typo is visible, not fatal.

### Add a new panel / device

1. Create `data/household/screens/<newid>.yml` from the schema above (match `content.width/
   height` to the device's native resolution and `rotation`).
2. Preview server-side immediately (`/api/v1/eink/<newid>/panel`) — the server side is fully
   device-agnostic and needs no firmware to render.
3. Provision/flash the firmware per `_extensions/eink-panel/BUILD.md` (§5 "Porting recipe"
   covers non-E1003 devices).

### Reload / redeploy after **code** changes

Widget or framework changes need a rebuild (config changes do not). On kckern-server:

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

---

## Verification

Prove the **device** (not you) fetched, then confirm the **image**, then the **panel**:

```bash
# 1) Fetch happened: render-count delta with no request from you
before=$(sudo docker logs daylight-station 2>&1 | grep -c eink.panel.rendered)
#   …reset/wake the device…; sleep 18
after=$(sudo docker logs daylight-station 2>&1 | grep -c eink.panel.rendered)
#   after > before  ⇒  the device pulled a frame

# 2) Image is correct: read the PNG the endpoint returns
curl -s "http://localhost:3111/api/v1/eink/kitchen-eink/panel" -o /tmp/eink.png
#   open /tmp/eink.png (or Read it) — check layout, data, rotation

# 3) Panel is correct: by eye (rotation/mirroring/dither). Adjust hardware.display.rotation.
```

Structured log events (module `eink`):
- `eink.panel.snapshot` — `{ panelId, view, index, imageHash, nextWakeSec }` (every `/config` poll)
- `eink.panel.rendered` — `{ panelId, view, index, bytes, size }` (only when the hash changed → `/panel` pulled)
- `eink.panel.action` — `{ panelId, action, from, to, view }`

A wake that polls `/config` and finds the hash unchanged logs **only** `eink.panel.snapshot`
(no `rendered`) — that's the battery-saving common case, not a stuck panel.

```bash
sudo docker logs daylight-station 2>&1 | grep '"module":"eink"' | tail -10
```

---

## Known issues & gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| Weather (any data widget) shows "No weather data" / empty | The self-fetch base URL for panel data sources is unreachable, so `DataResolver` fetches fail and are silently swallowed (`Promise.allSettled`). Widgets that need no fetch (header, placeholder) render fine, masking it. | The base URL is injected from household config — `devices.yml` → `daylightHostInternal` (e.g. `http://daylight-station:3111`), with `daylightHost` as fallback (resolved in `app.mjs`, the same source MediaBundle uses). If data widgets are blank, confirm `daylightHostInternal` is set and resolvable from inside the container. **(Was previously broken by a hardcoded `localhost:3112` in `app.mjs` — fixed 2026-06-18.)** |
| Config edit didn't show on the panel | Panel only re-evaluates on wake (button press, or the `refresh` schedule/`interval` cadence — 15 min in active hours, 4 h overnight by default) | Press any button to force a `/config` poll; or shorten the `refresh` window |
| Panel woke but the image didn't change | `/config`'s `image_hash` matched the cached one, so the panel skipped `/panel` by design (no pixel-affecting input changed) | Expected. To force a redraw of identical content, bump `RENDERER_VERSION` (`backend/src/1_rendering/eink/index.mjs`) and redeploy |
| All panels reset to page 1 after a deploy | View index is in-memory (`#viewIndex`), wiped on backend restart | Expected — ephemeral by design |
| Grays look blotchy / banded on the panel | Mono e-ink dithers non-pure colors unpredictably | Use pure `#000`/`#FFF` (or Spectra-6) in `theme` and widgets |
| Unknown widget shows a dashed box | Widget name not registered in `builtins.mjs` | Register it, or fix the typo in the view's `layout` |
| `/api/v1/eink/panel` (no id segment) 404s | The panel `id` is a **path segment**, not a query param | Use `/api/v1/eink/<id>/config` and `/api/v1/eink/<id>/panel`; the bare `/eink/panel` mount has no handler |
| `/:id/config` or `/:id/panel` 404 | No `screens/<id>.yml` for that `id` | Create the SSOT file |

---

## Roadmap — full config-driven parity with `screen-framework`

The end goal (per the project owner) is for e-ink rendering to be as **fully config-driven
as the browser `frontend/src/screen-framework/`** — today's server framework is a
deliberate minimal slice of that. The architecture already mirrors it
(`EinkRenderer ≈ ScreenRenderer`, `PanelRenderer ≈ PanelRenderer`,
`DataResolver ≈ ScreenDataProvider`, `widgets/registry ≈ widgets/registry`), which makes
the gaps tractable. Known gaps, roughly in priority order:

1. **Widget breadth → real data.** The skeleton stubs (`calendar`, `schedule`,
   `todos`) plus `header`/`weather`/`date` exist; `date`/`weather` are live, the rest draw sample
   content. Next: give each stub a real data source (calendar feed, agenda/schedule service,
   chores/todos) and add the remaining static-friendly widgets (finance summary, fitness
   streak, headlines) as canvas draw functions. Skip anything needing motion or interaction.
2. **Shared layout/theme vocabulary.** The two `PanelRenderer`s drifted from one schema;
   converge the YAML so a view authored for one class is legible to the other (where it
   makes sense). Document one layout/theme spec, not two.
3. **`select` semantics.** Wire the `select` action to per-view behavior (drill-in,
   toggle) instead of the current no-op, so panels can be more than linear paging.
4. **Persisted / scheduled views.** Optionally let the active view be time-driven (morning
   agenda → evening summary) rather than only button-paged, and survive restarts.
5. **Multi-panel scaling.** Provision the second unit (10.0.0.88) and confirm the SSOT
   schema is genuinely panel-agnostic across different resolutions/controllers.

Until then, treat e-ink as a **static, paged, config-driven image surface**: configs are
hot (no rebuild), widgets are code (rebuild), and the device is a thin PNG client.

---

## References

- `_extensions/eink-panel/README.md` — extension overview, devices, firmware build/flash
- `_extensions/eink-panel/BUILD.md` — reproducible build, hard-won gotchas, **porting recipe** for new devices
- `data/household/screens/kitchen-eink.yml` — reference SSOT
- `frontend/src/screen-framework/` — the browser-screen framework this server framework parallels
- `docs/runbooks/kiosk-monitoring.md` — the *browser* kiosk class (different system; for contrast)
