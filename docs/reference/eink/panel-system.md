# E-ink Panel Subsystem

The e-ink panel subsystem drives physical e-paper displays as **fully-local clients
of DaylightStation**. A panel is a low-power, battery-capable ESP32-S3 device with
its radio off most of the time: it wakes on a timer or a button, asks the backend
"what should I show, and has it changed?", and either draws a freshly rendered image
or goes straight back to sleep. All layout, data, and scheduling live on the server,
so the firmware stays tiny and every behavioural change is a config edit and
redeploy — never a reflash.

This is a **hardware screen class**, distinct from the browser-based dashboard
screens (office, living-room). Those render in a browser; an e-ink panel is served a
server-side image and pushes it to e-paper.

**Depends on:** the household screen config (`screens/<id>.yml`), the server-side
canvas renderer, the household data feeds (calendar, todos, weather, gallery photo),
and household state storage for telemetry.

---

## What the system is for

A panel is a passive, glanceable surface — a kitchen calendar, a focal date, a held
gallery photo, the day's weather. E-paper is bistable: it holds an image with zero
power and only spends energy on a refresh, which takes a second or two and flashes.
That shapes everything here. The design goal is to refresh **as rarely as possible**
while still looking current: render only when the content actually changed, ship the
smallest possible image, and let the device sleep the rest of the time.

Two hardware families are supported from one renderer and one endpoint:

| Family | Display | Output |
|--------|---------|--------|
| Mono | 16-level grayscale e-paper | 8-bit grayscale PNG (colour-type 0) |
| Colour | Spectra-6 (six-colour) e-paper | 24-bit RGB PNG (colour-type 2) |

Which one a given panel is is a fixed hardware fact, declared once in its config
(`hardware.display.color`). Mono is the default: an unset value, or anything
matching `gray`/`grey`/`mono`, yields grayscale output; a colour mode (e.g.
`spectra-6`) yields RGB. The renderer never needs to know anything else about the
device.

---

## How it fits

```
panel wakes (timer or button)
   │
   ├─ (button) GET /action/<next|prev|select|refresh>   → page/refresh view state
   │
   ├─ GET /config   ── cheap text snapshot, NO pixels
   │     ├─ records the telemetry the panel piggybacks as query params
   │     ├─ resolves the current view's data feeds
   │     ├─ fingerprints every pixel-affecting input → image_hash
   │     └─ returns: rotation, button map, next_wake, image URL, image_hash
   │
   ├─ image_hash == cached?  → skip download + refresh, sleep
   │
   ├─ image_hash changed?    → GET /panel  → full render → PNG → on-device dither → refresh
   │
   └─ deep sleep for next_wake seconds (wake on any button or the timer)
```

The crucial split is **change detection lives on `/config`, not `/panel`**.
`/config` is a render of the blueprint's *now-state* that stops short of drawing
pixels: it resolves the same data the renderer would and hashes it, but never touches
the canvas. The expensive `/panel` render is a pure on-demand path the panel only
reaches once the hash told it something changed — so there is no conditional-GET /
ETag / 304 dance on `/panel` at all. Most wakes on a short cadence never download an
image, which is what makes a frequent refresh interval affordable on battery.

---

## Endpoints

The panel id is a path segment (matching the rest of the v1 API). The device is on
the trusted LAN, so no token is required.

| Route | Returns | Purpose |
|-------|---------|---------|
| `GET …/<id>/config` | `text/plain` key=value lines | The wake-time poll: runtime config, cadence, image URL, and the change-detection hash. Lib-free key=value so the firmware parses it without a JSON library. |
| `GET …/<id>/panel` | `image/png` | The on-demand render of the current view, sized and oriented for the panel. Pulled only when the hash changed. |
| `GET …/<id>/action/<action>` | JSON view state | Apply a button action (page views / force a redraw); the panel then re-polls `/config`. |
| `GET …/<id>/status` | JSON | Latest device telemetry, for the always-on server / a dashboard. The panel itself never reads this — it is asleep. |

`/config` carries these fields: `id`, `rotation`, `btn_green`, `btn_right`,
`btn_left`, `next_wake`, `image`, `image_hash`.

---

## The content blueprint

A panel's config is the single source of truth for everything but its Wi-Fi
credentials and host/port (which are the only values burned into the firmware). It
declares the hardware (size, colour mode, rotation), a button-to-action map, a
refresh schedule, and a `content` block holding one or more **views**. Each view has
a layout tree, optional per-view data sources and theme, and an id.

A panel shows one view at a time. View state is per-panel and in-memory by design —
a reboot simply returns to the first view, which is harmless for a glanceable
surface. Paging between views is driven entirely by button actions.

### Layout

A view's layout is a recursive flexbox tree resolved into absolute pixel regions.
Each node is either a container (with `direction` row/column, `children`, `gap`,
`padding`, and flex `grow`/`basis` sizing) or a leaf naming a widget plus its props.
The resolver walks the tree once, assigns boxes, and hands each leaf its region.

### Widgets

Widgets are draw functions addressed by name from the layout. Each is handed its
clipped region, the resolved data, and the theme, and paints onto the shared canvas.

| Widget | Role |
|--------|------|
| `photo` | Full-bleed gallery photo, cover-fit, with a caption placard (headline + capture date). Reads a preloaded image. |
| `weather` | Current conditions plus an hourly forecast chart (temperature line, gridlines, precipitation bars, condition dots). |
| `date` | Large focal day-of-month with weekday and month/year. No live clock — a clock would be stale between refreshes. |
| `header` | Title-and-date bar. |
| `calendar`, `schedule`, `todos` | List-card widgets (titled card + rows). They render live data when their feed is wired, and labelled sample content otherwise so a layout can be designed before the feeds exist. |
| `placeholder` | Fallback for an unknown widget name, so a typo degrades to a visible marker rather than a blank region. |

Widgets address the base typeface (Roboto Condensed) by name through a font helper
rather than hardcoding family strings; missing faces degrade to synthetic bold.
Card-style widgets share chrome helpers so their look stays consistent.

### Theme

Widgets paint against a theme of named tones. On a mono panel the colour-named keys
(red/blue/green/yellow) are **tonal aliases** — a dark-to-light grey ramp — so a
widget that asks for "red, severe" lands on a dark grey, not a hue, with no rewrite.
On a colour panel those keys carry real colour. E-paper reads crispest at the tonal
extremes, so static chrome favours pure black/white; the theme is overridable per
panel and per view.

---

## Data resolution

A view's data sources are a map of `{ key: { source, image? } }`. The resolver
fetches every source in parallel and returns a keyed object the widgets read. A
relative source is prefixed with the backend base URL (injected from household
config — never hardcoded); an absolute URL is used as-is. A failed source is simply
omitted, so one dead feed never takes down the whole panel.

A source may declare `image: '<field>'`, meaning the URL at that field should be
fetched and decoded into ready-to-draw pixels. This image preload is the **expensive
path**, and it is taken only on the actual render. The cheap `/config` snapshot
resolves the same data **without** images, so its battery-saving hash check never
downloads a photo.

The household feeds a panel typically draws from are the gallery photo, weather, and
(when wired) calendar/todos. The photo feed is the key one for battery: the server
picks a random gallery image and **holds** it for a configurable window, so the
panel's content hash stays stable across many wakes and it only pays the e-ink
refresh cost once per hold period.

### Per-device photo hold

Every data source URL is automatically scoped to the requesting panel by appending a
`hold_key` of the panel id. Feeds that hold (the gallery photo) bucket their hold per
device, so each panel cycles its **own** held photo; feeds that don't hold simply
ignore the param. Without this, every panel would share one global pick and a kitchen
and an upstairs display would always show the same photo.

---

## Change detection

`/config` computes `image_hash` as a hash of every input that can affect the
rendered pixels: the local date, the current view id and index, the canvas
size, the theme, the layout tree, the fully resolved data, the colour-vs-grayscale
mode, a manual-refresh counter, and a **renderer version** constant. Inputs are
serialized deterministically (object keys sorted at every depth) so a feed
reordering its JSON keys can never spuriously bust the hash.

Folding the renderer version into the hash means a change to the rendering code that
would alter pixels for identical inputs invalidates every panel's cached hash and
forces one fresh pull — bump it whenever a renderer or widget edit changes output.
The local date being in the hash is why a date-only panel refreshes exactly once a
day, at midnight, and is otherwise stable.

### Manual refresh

The `refresh` button action keeps the current view but bumps a per-panel counter
that feeds into the hash. The next `/config` poll therefore reports a new hash, and
the panel redraws the *same* content on demand — a full e-ink refresh without
waiting for the next timer wake. `next`/`prev` page through the views; `select` is
reserved for per-view behaviour. Each button's semantic action is itself remappable
via the panel's button map.

---

## Wake scheduling

Because a deep-sleeping panel has its radio off, the server cannot push a wake.
Instead the panel asks "when should I wake next?" on every poll: `/config` returns
`next_wake` (seconds), which the firmware loads into its RTC timer before sleeping.
The whole schedule is therefore server-side and edited in config.

The cadence is expressed in **local time** — the panel has no clock of its own, so
the server is the timekeeper. A panel may declare either a flat interval or a list of
time-of-day windows (`from`/`to`/`every`); whichever window contains "now" sets the
cadence, with windows allowed to wrap midnight. The result is also clamped so the
panel never sleeps **past** the end of its current window: late in a daytime window
it wakes exactly at the boundary and picks up the next window's (e.g. overnight)
cadence on that wake, rather than overshooting. Durations accept human forms
(`15min`, `4h`, `30s`, or a bare number meaning minutes), and every result is clamped
to a sane band so a malformed config can never brick a panel into a hot loop or a
half-year sleep.

---

## Output encoding

The canvas is always RGBA internally, but neither panel family wants RGBA over its
battery-powered Wi-Fi link, so the renderer re-encodes to the device's own colour
space before shipping. The encoders are hand-rolled (the bundled canvas only emits
RGBA PNGs) and share the PNG container framing.

- **Mono panels** get the whole canvas reduced once to a single luma byte per pixel
  (Rec. 601), shipped as a grayscale PNG. This is roughly a third the size of the
  RGBA PNG and already in the panel's colour space.
- **Colour panels** get the alpha plane dropped and the RGB shipped as a colour-type-2
  PNG with adaptive per-scanline filtering (the standard predictor set chosen per row),
  which is lossless, drops the wasted alpha bytes, and compresses a continuous-tone
  photo noticeably smaller than the RGBA default.

The single most important rule of this subsystem: **the server never dithers or
palette-quantises.** The panel firmware runs its own error-diffusion dither (to 16
grey tones, or to the six Spectra colours) on whatever smooth image it receives.
Dithering server-side would inject high-frequency noise that PNG/deflate cannot
compress — bloating the download for no benefit — and pre-quantising to the device
palette would starve the firmware's dither of the gradients it needs to do its job
well. So the renderer ships a **smooth** image and lets the device do the dither it
already does best. The whole-canvas reduction (rather than per-widget) ensures every
tone — chrome and photos alike — lands in the panel's colour space consistently.

---

## Telemetry

A deep-sleep battery panel is unreachable almost all the time, so it can't host its
own status server. Instead it **reports on each wake**: it piggybacks its device
status as query params on the `/config` poll — battery millivolts, Wi-Fi signal,
what woke it (a specific button, the timer, or boot), uptime, free heap and PSRAM,
and the reset reason — at zero extra wake cost.

The server captures this before rendering the snapshot, guarded so it can never break
the wake path. It keeps only the **latest** reading per panel and persists it to
household state, so the last-known status survives a server redeploy (a panel that
only wakes every few hours would otherwise read "unknown" for hours after a deploy).
A poll carrying none of the known fields (a manual probe, or pre-telemetry firmware)
is ignored so it can't clobber a real reading. Battery millivolts are converted to a
charge percentage against a single-cell envelope and flagged low past a threshold,
which also emits a warning log. The `/status` endpoint surfaces the latest reading
for the always-on server or a dashboard.

> Note on battery sense: the millivolt reading comes from an ADC pin behind a divider
> and differs per board. A device whose battery-sense pin is unread simply reports
> zero, which the server treats as "battery unavailable" rather than a real reading.

---

## Firmware contract (device side)

The firmware is intentionally minimal — a remote control for the server. On each
wake it: reads its wake cause and battery before bringing up Wi-Fi; if a button woke
it, fires the corresponding action; polls `/config` (telemetry attached) and parses
the key=value lines into rotation, button map, cadence, and the advertised hash;
compares that hash to the one it cached in RTC memory (which survives deep sleep);
and only on a mismatch fetches `/panel`, decodes the PNG, dithers it to the device
palette, and pushes it to the display. Then it arms a button wake plus a timer wake
for `next_wake` seconds and deep-sleeps. A cold power-cut zeroes the cached hash, so
the first wake after a power loss always redraws.

---

## Source map

- Server-side rendering (renderer, layout resolver, widgets, encoders, data
  resolver): `backend/src/1_rendering/eink/`
- Application orchestration (per-panel view state, snapshot/fingerprint, telemetry,
  wake schedule): `backend/src/3_applications/eink/`
- HTTP endpoints: `backend/src/4_api/v1/routers/eink.mjs`
- Household feeds the panels consume (held gallery photo, weather, calendar, todos):
  `backend/src/4_api/v1/routers/homeAutomation.mjs`
- Device firmware, build tooling, and the device-side contract:
  `_extensions/eink-panel/`
- Per-panel blueprint: `data/household/screens/<id>.yml`; persisted telemetry:
  household state.
