# Barcode Scanning (BLE relay → scan vocabulary → domain)

How a physical scan reaches the DaylightStation backend and reaches the domain that owns it.

The ingest path is a **Zebra DS2278 bridged over Bluetooth LE by an ESP32**
(`_extensions/content-barcode-relay`, firmware shared with `_extensions/food-scale-relay`) that streams scans into the **WebSocket event bus**. The previous
**USB HID → MQTT** path (`_extensions/barcode-scanner` + `scanner.py` + Mosquitto) has been
**retired** (commit `f9418c018`). The old integration docs are kept but marked superseded:
[`integrations/barcode-scanner.md`](../integrations/barcode-scanner.md),
[`integrations/barcode-processing.md`](../integrations/barcode-processing.md),
[`integrations/barcode-screen-pipeline.md`](../integrations/barcode-screen-pipeline.md).

**Any reader can be handed any sticker.** What a code means is decided by the CODE, through a
house-wide scan vocabulary, not by which reader read it. The reader's configured `route` is now a
last resort for codes that say nothing about themselves. Design rationale and the forks that were
settled to get here: [`docs/plans/2026-07-28-universal-scan-vocabulary-design.md`](../../plans/2026-07-28-universal-scan-vocabulary-design.md).

---

## End-to-end flow

```
Zebra DS2278  (HID Bluetooth Low Energy, Discoverable)
     │  BLE HID keyboard reports (service 0x1812)
     ▼
ESP32  M5Stack ATOM Lite  — NimBLE HID *central*        [_extensions/food-scale-relay/firmware]
     │  claims the HID service, bonds, decodes keystrokes, flushes on a 150ms idle gap
     │  WS: { source:'barcode-relay', type:'scan', device, route:'content|nutribot', code, ts }
     ▼
WebSocketEventBus  (/ws)  .onClientMessage
     ▼
createBarcodeRelay()                       [3_applications/hardware/barcodeRelay.mjs]
     ├─ broadcast('barcode-relay', payload)  → live subscribers
     ├─ PERSIST → household/history/barcode/<device>/<YYYY-MM-DD>.yml
     └─ onScan(payload)                      (wired in app.mjs)
            ▼
        scanDispatch.handleScan(relay)     [5_composition/modules/scanDispatch.mjs]
            ▼
        parseScanCode(code) → { namespace, body, raw, form }   [2_domains/scan/ScanCode.mjs]
            ▼
        ScanDispatcher.dispatch()          [3_applications/scan/ScanDispatcher.mjs]
            │  namespace, or the reader's route, or `unknown`
            ├─ content ─┐
            ├─ command ─┴→ TriggerEvent(source:'barcode') → TriggerDispatchService.handleEvent()
            │                  → BarcodeResolver → BarcodePayload.parse → Response
            │                  → ContentDispatcher: broadcast to the screen topic,
            │                    HA display on_script, 2s ack, else loadFallback
            ├─ school ────→ schoolLifecycle.handleScan({ code: raw })   (raw, not body)
            ├─ nutrition ─→ routeNutribotScan → ApplyScanToComposition, then an ACK
            │                  edit on the live scale prompt
            ├─ product ───→ LogFoodFromUPC (nutribot Telegram reply)
            └─ (no handler / nothing claimed) → an Outcome saying so
```

`BarcodeScanService` and `BarcodeGatekeeper` are **retired** — content now goes through the
trigger pipeline (`TriggerDispatchService` + `ContentDispatcher`), which is where the gatekeeper,
the screen broadcast, the ack timeout and the TV-wake `on_script` live.

A scan whose `device` id is not registered in `devices.yml` as `type: barcode-scanner` is
broadcast on the `barcode-relay` topic but dropped by the pipeline.

---

## The scan vocabulary

Four grammars (content, playback commands, nutrition, school) share one physical namespace. A
prefix names the OWNER and then gets out of the way — the body stays in the owning domain's own
grammar, unchanged and unvalidated by the registry.

| Prefix | Owner | Body | Example |
|---|---|---|---|
| `go:` | Content | `[screen:][action:]source:id[+opts]` | `go:living-room:plex:594036+shuffle` |
| `cmd:` | Playback control | `[screen:]command[:arg]` | `cmd:office:volume:30` |
| `nut:` | Nutrition (fridge sheet) | `dl:` / `ct:` / `rs:` | `nut:dl:4` |
| `sch:` | School | opaque token | `sch:a7f3k2` |

The registry is **closed and case-sensitive**: `NUT:dl:4` is not a nutrition code. The encoders
control every printed string, so nothing needs to be lenient and case folding would only widen the
collision surface. A tag must be non-empty and contain no colon — the parse is a single split at
the first colon.

### Resolution order

First match wins.

| Step | Form | Claims | Where |
|---|---|---|---|
| 1 | `prefixed` | a registered tag above | `ScanCode` |
| 2 | `legacy-prefixed` | bare `dl:` `ct:` `rs:` → nutrition | `ScanCode` |
| 3 | `legacy-positional` | anything else with a non-empty segment before its first colon → content | `ScanCode` |
| 4 | `shape` | **ISBN-13 only** — 13 digits behind `978`/`979` → book | `ScanCode` |
| 5 | reader `route` | `nutribot` → product, `content` → content | `ScanDispatcher` |
| 6 | `unknown` | an explicit outcome, never a fall-through | `ScanDispatcher` |

**Steps 2 and 3 are a deprecation shelf.** Printed artifacts still in circulation carry
un-prefixed forms, so they stay recognised; the whole shelf is deleted once those are reprinted.
Nothing in steps 1, 4 or 6 depends on it. Prefer the prefixed grammar for anything printed from
now on.

**Step 5 is the only thing the reader's route still decides,** and it is consumed before any
handler runs. `ScanCode` deliberately knows nothing about readers — it imports nothing and cannot
read config — so step 5 lives in the dispatcher.

**A bare UPC/EAN is deliberately unclaimed.** A product barcode does not say what it is for: the
same tin at the fridge means "log this food" and at a content reader means nothing. So it means
whatever its reader is configured for, which is a step-5 question. `product` is a route-fallback
target and never a parse result. ISBN is different because 978/979 makes a book identifiable from
the code itself.

### Claim is not success

Once a handler is reached, dispatch is over — the route fallback is **not** retried behind a
refusal. A typo'd `ct:teapot` is unmistakably a fridge-sheet code, so it is refused rather than
passed to a product lookup that would answer a typo with a nonsense food. One printed code means
one thing on every reader in the house.

The visible consequence: a malformed fridge code (`dl:99`) dead-ends in nutrition instead of
falling through to the UPC lookup, which is what it used to do.

### Body convention

`body` is the payload in the owning domain's grammar, whichever form carried it — `nut:dl:4` and
bare `dl:4` both hand nutrition `dl:4`. It is **not trimmed**, because trimming in the parser
would change what `go:` means for every domain at once: `go: living-room:plex:1` yields a body
with a leading space. A handler that splits on `:` trims its own segments. (School gets `raw`, not
`body` — its token registry looks tokens up by the full `sch:<token>` string.)

### One naming constraint, checked at boot

A legacy positional code splits at its first colon, so **no screen name and no command name may
equal a scan tag** — `go`, `cmd`, `nut`, `sch`, `dl`, `ct`, `rs`. A screen named `dl` would have
`dl:plex:1` claimed by nutrition at step 2 and swallowed.

Composition is the first place both lists exist at once, so it checks them there and logs
`scan.leading_segment.shadows_tag` at **error** level. It reports rather than throws: the
collision breaks barcodes for one screen, and refusing to boot the house over a name in
`devices.yml` would cost everything else. There is no collision today. The constraint expires with
the deprecation shelf.

---

## Content body grammar

Behind `go:` (and in the legacy positional form) the content string is parsed by
`BarcodePayload.parse`, reached through `BarcodeResolver` in the trigger pipeline. Delimiters are
forgiving — **colon, semicolon, or space** all work; **dashes are NOT delimiters** (they appear in
screen names like `living-room`). Options are appended with `+`.

**Command bodies** (1–3 segments, checked first against `KNOWN_COMMANDS`):

| Form | Example | Effect |
|------|---------|--------|
| `command` | `pause` | bare command |
| `command:arg` | `volume:30` | parameterized command |
| `screen:command` | `living-room:pause` | command on a specific screen |
| `screen:command:arg` | `living-room:volume:30` | parameterized, specific screen |

Known commands (`BarcodeCommandMap.mjs`): `pause`, `play`, `next`, `prev`, `ffw`, `rew`, `stop`,
`off`, `blackout`, `volume:<n>`, `speed:<n>`.

**Content bodies** (2–4 segments, if no command match):

| Form | Example |
|------|---------|
| `source:id` | `plex:594036` |
| `action:source:id` | `play:plex:594036` |
| `screen:source:id` | `living-room:plex:594036` |
| `screen:action:source:id` | `living-room:play:plex:594036` |

**Content options** (appended with `+`): `plex:594036+shuffle` → `{ shuffle: true }`;
`plex:594036+shader=dark` → `{ shader: 'dark' }`; combine with more `+`.
Actions come from `barcode.yml` (`actions`, default `queue`/`play`/`open`; `default_action`
when none is given).

Note that `go:` and `cmd:` share one handler. The two legacy grammars share one parser, so
splitting them would mean two copies of a grammar with one implementation; the content/command
distinction exists only in the prefixed forms.

---

## History persistence

Every scan is appended to an append-only day log — same shape as the food-scale history under
`household/history/nutrition/<scale>/`:

```
{dataDir}/household/history/barcode/<device>/<YYYY-MM-DD>.yml
```

```yaml
- ts: '2026-07-12T01:02:38.704Z'
  code: living-room:plex:594036+shuffle
- ts: '2026-07-12T01:03:12.115Z'
  code: kitchen:menu:breakfast
```

- Written by the PERSIST subscriber in `barcodeRelay.mjs` (subscribes to the `barcode-relay`
  topic). Appends are **serialized** through one promise chain (read-modify-write safety).
- `<device>` is the relay's `device` field. Day boundary is **UTC**.
- Persistence is active only when the relay is given a `dataDir` (unit tests omit it → no disk).
- Root dir override: `barcode.yml` → `persistence.dir` (default `household/history/barcode`).

Persistence records what was scanned, before any routing. It is unaffected by the vocabulary.

---

## Configuration

| File | Keys | Purpose |
|------|------|---------|
| `data/household/config/devices.yml` | `type: barcode-scanner`, `target_screen`, `policy_group`, `content_control.topic`, `device_control.displays.*.on_script` | Registers the scanner **by device id** (must match the relay's `device`) → pipeline acts on it. `on_script` wakes the TV via Home Assistant on approved content. Screen-path slugs and `content_control.topic` values are also the screen-name list the collision check runs against. |
| `data/household/config/barcode.yml` | `default_action`, `actions`, `persistence.dir` | Content actions + history root. |
| `data/household/config/barcode-relay.yml` | `relays.<device>.route` (`content`\|`nutribot`), `relays.<device>.scale_id`, `relays.<device>.nutribot.*`, `nutribot.*` | Per-reader step-5 route, the scale a fridge-sheet scan applies to, and the nutribot user/conversation used for UPC lookups. |

The relay coerces anything other than `content` or `nutribot` to its default route, so step 5 is
total over the routes that can actually arrive.

> Household app config is loaded once at startup and cached — edit + restart the backend for
> changes to take effect (see `docs/reference/core/configuration.md`).

---

## Hardware / firmware

Full detail: [`_extensions/content-barcode-relay/`](../../../_extensions/content-barcode-relay/README.md)
and its `DEV-STATUS.md`. **The firmware itself lives in
[`_extensions/food-scale-relay/firmware`](../../../_extensions/food-scale-relay/firmware)** — one
M5Stack ATOM Lite maintains both the scanner's HID link and the kitchen scale's BLE link, because
both radios are LE and do not contend the way the retired Classic-SPP path did.

- **One-time scanner setup:** scan the **"HID Bluetooth Low Energy (Discoverable)"** barcode from
  the DS2278 Product Reference Guide (p.6-6 — the *Low Energy* one, not Classic). The scanner then
  advertises as a BLE HID keyboard: name `DS2278 <serial>`, appearance `0x03C1`, service `0x1812`.
- **Matching** is by HID service `0x1812`, by advertised name (`BARCODE_NAME`), or by an optional
  pinned `BARCODE_MAC` — so a replacement scanner is found without a firmware edit. Holding the
  ATOM's button for 3 s clears BLE bonds so a replacement can pair with no laptop.
- **ESP32** runs a NimBLE HID central: bonds (LE SC, Just Works), reads keyboard reports, and
  relays each barcode over WiFi/WS. Fill real WiFi creds before flashing (committed with
  placeholders); repoint `WS_HOST`/`WS_PORT`/`WS_PATH` at the real backend for production.
- **Coexistence:** the scanner also charges in its USB cradle and stays USB-enumerated; the BLE
  and USB interfaces run simultaneously. Do **not** unplug the cradle to "force BLE" — BLE works
  while cabled.

### Firmware decode gotchas (why it "connected but got nothing" for hours)
- The DS2278 streams on the **BOOT keyboard input report `0x2A22`**, not the Report characteristic
  `0x2A4D`, even in Report protocol mode → **subscribe to both**.
- **No CR/Enter terminator** over BLE HID → flush on a **~150 ms idle gap** (matches the old USB
  service's `timeout=150ms`), not on Enter.

---

## Component reference

| Concern | File |
|---------|------|
| Relay ingest + broadcast + persist | `backend/src/3_applications/hardware/barcodeRelay.mjs` |
| Prefix registry + resolution order (pure, imports nothing) | `backend/src/2_domains/scan/ScanCode.mjs` |
| Handler registry, step 5, Outcome, never-reject invariant | `backend/src/3_applications/scan/ScanDispatcher.mjs` |
| Handler wiring + boot-time checks | `backend/src/5_composition/modules/scanDispatch.mjs` |
| Pipeline wiring (`onScan` → `scanDispatch.handleScan`) | `backend/src/app.mjs` |
| Content/command body grammar | `backend/src/2_domains/barcode/BarcodePayload.mjs` |
| Command map | `backend/src/2_domains/barcode/BarcodeCommandMap.mjs` |
| Content grammar → trigger Response | `backend/src/2_domains/trigger/services/BarcodeResolver.mjs` |
| Content dispatch (screen broadcast, ack, fallback) | `backend/src/3_applications/trigger/ContentDispatcher.mjs` |
| Nutrition routing decision | `backend/src/3_applications/nutribot/lib/routeNutribotScan.mjs` |
| Event bus | `backend/src/0_system/eventbus/` |
| Firmware (shared with the food scale) | `_extensions/food-scale-relay/firmware/src/main.cpp` |

Tests: `tests/unit/domains/scan/ScanCode.test.mjs`,
`tests/unit/applications/scan/ScanDispatcher.test.mjs`,
`tests/unit/composition/scanDispatch.test.mjs`.

---

## Known gap: an unclaimed scan is silent

`ScanDispatcher` guarantees an Outcome for every scan — `{ status, ok, domain, message, physical,
printed, effect }`, never a fall-through and never a rejection — but `onScan` currently
**discards** it. So a code nobody claims, or a namespace with no handler registered (an ISBN-13
today, which parses to `book` with no book handler), does nothing visible at the scanner.

That matters because a scanner that appears to do nothing is indistinguishable from a broken one.
Whoever adds the next handler should give the Outcome's `message` somewhere to go as well.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Scan beeps (good decode) but nothing happens | Is the relay's `device` id registered in `devices.yml` as `type: barcode-scanner`? Unknown ids are dropped after broadcast. Then check for `scan-unclaimed` / `scan-no-handler` on the `scan-dispatch` logger — the code may have resolved to a namespace with nothing behind it. |
| One screen's barcodes stopped working, everything else is fine | Look for `scan.leading_segment.shadows_tag` at boot. A screen or command named `go`/`cmd`/`nut`/`sch`/`dl`/`ct`/`rs` loses its leading segment to the tag. Rename it. |
| A fridge-sheet code reaches a product lookup, or vice versa | It should not: claim is not success. Check `form` in the `scan-handled` debug event to see which resolution step claimed the code. |
| A UPC does nothing on a content reader | Working as designed — a bare UPC is unclaimed by shape and falls to the reader's route. Set that reader's `route: nutribot` in `barcode-relay.yml`, or print a prefixed code. |
| Backend refuses to boot with `scanDispatch: bad dependencies` | A wiring bug in `app.mjs`'s `createScanDispatch({...})` call, not a config problem. The message names every missing, malformed and unrecognised argument. |
| No scans reach the backend at all | ESP UDP log on `:9999` — is `ble=1` (bonded) and `ws=1` (bus connected)? Is `WS_HOST` pointed at the backend? |
| History file not written | Persistence needs `dataDir` (it's passed in `app.mjs`); check `barcode_relay.persist.failed` logs and dir permissions. |
| Content approved but screen doesn't change | TV off / FKB down → the 2 s ack times out and `loadFallback` runs; verify the screen's `on_script` in `devices.yml`. |
