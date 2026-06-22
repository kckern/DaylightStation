# Ambient TV Schedule — Design

> Schedule passive ambient (ArtMode) windows on the living-room TV: turn the TV on
> to a chosen art preset at scheduled times, and turn it back off at the end of the
> window — always yielding to anything actively playing.

- **Date:** 2026-06-21
- **Status:** Approved (brainstorm); pending implementation plan
- **Target screen:** living-room TV (`livingroom-tv`)

---

## Purpose

Define a place to schedule "ambient windows" for the living-room TV. Each window says:
on these days, between this start and end time, show this art preset. At the start the
TV is woken and loaded with the preset; at the end it is powered off and the scene reset
to default. The whole mechanism is *passive-only*: it must never interrupt or override
anything actively playing on that TV.

### Concrete examples

- Mon–Fri 07:00–09:00 → `impressionism`
- Sun 08:00–11:00 → `religious`
- Some days have no window at all.

---

## Decisions (from brainstorming)

1. **Turn-off behavior:** at a window's end, **power the TV off** (HA smart plug, via the
   device's `powerOff()`). "Reset to default" is a *consequence* of the power-off, not a
   separate action: the next wake loads the screen's configured default screensaver
   (`showOnLoad` → `gallery-silent`), so the window's preset does not linger. No explicit
   reset/load call is needed at end. (If verification shows the preset *does* persist
   across a power cycle, the plan adds an explicit `load(art:<default>)` before power-off.)
2. **Start-time suppression:** if active content is playing when a window's start arrives,
   **skip the whole window for that day** (no later retry, even if the content finishes
   mid-window).
3. **End-off ownership:** the end-of-window power-off acts **only if the ambient window
   itself turned the TV on**. A TV the user turned on manually is left alone.
4. **Schedule location:** a new `schedule:` block in `artmode.yml`, co-located with the
   presets it references.
5. **Home Assistant:** out of scope. HA already invokes ambient scenes directly via the
   existing load URL, e.g. `…/api/v1/device/livingroom-tv/load?display=art:july-4th`. No
   new trigger endpoints are built.
6. **Mechanism:** a dedicated `AmbientSchedulerService` (Approach A) that ticks every 60s
   and reconciles desired state, with the decision logic isolated as a pure domain
   function. Not built on the data-harvest cron scheduler.

### Scope clarifications

- **"The screen" = the living-room TV only.** Fitness sessions belong to the *garage*
  display and are irrelevant here. "Active content" is strictly "is this TV playing a
  video."
- Windows for a single device are assumed **non-overlapping**. If they overlap, the
  later-starting window wins and a warning is logged at config load.

---

## Existing building blocks (reused, not rebuilt)

- **Turn-on / load a preset:** `GET /api/v1/device/livingroom-tv/load?display=art:<preset>`
  performs the full wake → prepare → load. `art:<preset>` resolves any `artmode.yml`
  preset *or* collection through the existing `presetResolver` / `ArtContentSource`.
- **Active-content check:** `GET /api/v1/device/:id/session` returns **204** when idle
  (ArtMode screensaver / nothing playing = *passive*) and **200** with a `currentItem`
  when a video is playing (*active*). This is the suppression signal — no log-scraping.
- **Power off:** the device adapter exposes `powerOff()` (already refuses during an active
  video call).
- The `AmbientSchedulerService` calls these via the **same internal services the device
  router injects** (session snapshot service, wake-and-load service, the device object),
  not via HTTP self-calls.

### Implementation risk to verify in the plan

Confirm `livingroom-tv` actually populates session snapshots (some FKB screens may not).
If it does not, fall back to the player render telemetry the deploy-gate already relies
on (`playback.render_fps` / `videoState`) as the idle signal. The pure evaluator takes a
boolean `sessionIdle`, so the detection source is swappable without touching the logic.

---

## Architecture

```
artmode.yml (schedule:)  ──read──►  AmbientSchedulerService (3_applications/ambient/)
                                       │  ticks every 60s
                                       ├─ evaluateAmbientSchedule()  (2_domains/ambient/) — PURE
                                       ├─ deviceController port  → load / powerOff / isIdle
                                       └─ ambientStateStore port → data/system/state/ambient-runtime.yml
```

### Components

| Unit | Layer | Responsibility | Depends on |
|------|-------|----------------|------------|
| `evaluateAmbientSchedule` | `2_domains/ambient/` | Pure decision function. Given windows + now + persisted state + `sessionIdle`, return the actions to take and the next state. No I/O. | nothing |
| `AmbientSchedulerService` | `3_applications/ambient/` | 60s tick loop. Gathers inputs, calls the evaluator, executes returned actions via ports, persists next state, logs decisions. | evaluator + ports |
| `deviceController` port | `3_applications/ambient/ports/` | `isIdle(deviceId)`, `load(deviceId, { display })`, `powerOff(deviceId)`. Wired to existing device services. | existing device/session/load services |
| `ambientStateStore` port | `3_applications/ambient/ports/` | Read/write `ambient-runtime.yml`. | YAML persistence |
| bootstrap wiring | `app.mjs` / system | Construct the service with real ports and start the tick. | all of the above |

Each unit is independently understandable and testable: the evaluator is pure; the
service is driven by injectable ports (fake clock, fake session, recording load/power).

---

## Config schema (`artmode.yml`)

A new top-level `schedule:` list:

```yaml
schedule:
  - name: weekday-morning        # optional; used for logs + state key
    days: [mon,tue,wed,thu,fri]  # weekday abbreviations mon..sun
    start: "07:00"               # 24h local time HH:MM
    end:   "09:00"
    preset: impressionism        # any artmode preset or collection (→ art:<preset>)
    device: livingroom-tv        # optional; defaults to livingroom-tv
  - days: [sun]
    start: "08:00"
    end:   "11:00"
    preset: religious
```

- `days` — list of `mon|tue|wed|thu|fri|sat|sun`.
- `start` / `end` — `"HH:MM"` 24-hour **local** time.
- `preset` — resolved as `art:<preset>` (a preset name or a bare collection name both
  work, per the existing resolver).
- `device` — optional; defaults to `livingroom-tv`.
- `name` — optional; if absent, a stable key is derived from
  `${device}|${start}|${end}|${preset}`.

---

## Reconciliation logic (pure evaluator)

Inputs: `windows`, `now` (local Date), `state` (persisted), `sessionIdle` (bool per
device), plus a `firstTickAfterBoot` flag.

For each window scheduled for **today** (today's weekday ∈ `days`):

1. **Boot catch-up (no retroactive actions):** on the first tick after boot, if the
   window's start time already passed today **and** there is no persisted handled-state
   for it, mark `startHandled = true` **without acting**. Prevents surprise power-ons /
   loads after a midday restart.
2. **START edge** — `now ≥ start(today)` and not yet `startHandled`:
   - mark `startHandled = true`
   - `sessionIdle` (idle *or* offline) → emit `load(device, art:preset)`; set
     `state.owned = { key, device, preset, startedAt: now }`.
   - playing → emit `skip` (logged); no ownership.
3. **END edge** — `now ≥ end(today)` and not yet `endHandled`:
   - mark `endHandled = true`
   - if `state.owned?.key === key`:
     - `sessionIdle` → emit `powerOff(device)` (default scene returns on next wake); clear `owned`.
     - playing (user took over) → emit `release`; clear `owned`; **do not** power off.
   - not owned → emit `none`.

**Day rollover:** `handled` is keyed by local date (`YYYY-MM-DD`); entries older than
today are pruned.

**Offline mapping:** session `200` (playing) ⇒ active ⇒ suppress; session `204` (idle) or
`503` (offline) ⇒ safe. For START, "safe" means proceed with `load` (which wakes the TV);
for END, an offline TV is already off so `powerOff` is a harmless no-op.

**Overlap:** if two windows for the same device are active simultaneously, the
later-starting one's `load` wins and it becomes the owner; logged as a warning at config
load.

---

## State file (`data/system/state/ambient-runtime.yml`)

Mirrors the `cron-runtime.yml` pattern.

```yaml
owned:
  key: weekday-morning
  device: livingroom-tv
  preset: impressionism
  startedAt: "2026-06-21T07:00:14-07:00"
# or: owned: null
handled:
  "2026-06-21":
    weekday-morning: { startHandled: true, endHandled: false }
```

Ownership persists across restarts so an end-of-window power-off still fires after a
restart. If the state file is lost, the conservative outcome is: missed starts are not
fired and an in-flight window won't auto-power-off (acceptable).

---

## Error handling

- **Load / power-off failure** → log error; still mark the edge handled (don't retry every
  tick). Ownership is set **only on a successful load**.
- **Device offline** → treated as "safe to turn on" for START; for END it's already off, so
  nothing to do.
- **Malformed window** (bad time, unknown preset) → skip + warn at evaluation; never crash
  the tick.
- All decisions and errors emit structured logs (backend logger), so each tick's behavior
  is answerable from logs.

---

## Testing

- **Unit — pure evaluator** (table-driven):
  - start idle → `load`
  - start active → `skip`
  - end owned + idle → `powerOff`
  - end owned + active → `release` (no power off)
  - end not owned → `none`
  - first-tick-after-boot with passed start → handled, no action
  - day rollover prunes old `handled`
  - overlap resolution (later start wins)
- **Integration — service + fake ports:** fake clock, fake session signal, recording
  `load`/`powerOff` ports; drive a simulated day and assert the action sequence and
  persisted state.
- No live-device tests; all device I/O is faked through ports.

---

## Out of scope

- Home Assistant trigger endpoints (HA uses the existing load URL directly).
- Fitness-session gating (garage display, not this TV).
- An admin UI for editing the schedule (config is hand-edited YAML for now).
- Deferring/retrying a window after active content ends (start-suppression skips the day).
