# Audit: Living Room TV Wake — `power.unverified` Burns 25s, Then 45s Retry Burns Another 45s

**Date:** 2026-05-23
**Severity:** High (every cold dispatch to `livingroom-tv` incurs ~70s of avoidable latency)
**Status:** Root cause confirmed; one-line config fix + one architectural recommendation
**Production evidence:** dispatchId `220c26ac-64a2-442f-a6aa-51c93b816822` (failed attempt) → `84b1ea84-0b92-4587-acb0-7fc16b44d450` (45s-deferred retry, succeeded), kitchen button 4 (Slow TV), 2026-05-23 15:37 UTC

---

## 1. Executive Summary

A kitchen button press triggers `wake-and-load` for `livingroom-tv` from a cold state (LG TV unplugged, drawing 0W). The orchestrator's first power step polls `binary_sensor.living_room_tv_power` for **at most 24.8 seconds**, then declares `verifyFailed`, schedules a **45-second** retry, and only on the retry does anything actually load.

The polling can never succeed on a cold dispatch. The sensor it polls is a **threshold filter on a Zigbee plug power meter** (verified by reading the HA configs directly; see §2 for the chain). The plug itself reports promptly — Zigbee `electricalMeasurement` cluster fired **five readings in 73 seconds** during the incident. The bottleneck is the LG TV itself: it sits at 8-13W standby for ~70 seconds while WebOS boots, then jumps to 35W when the backlight ignites. The 30W threshold deliberately selects "screen is lit" over "TV is powered", which is the wrong question to be asking during wake-and-load.

In the recorded trigger, that ground-truth flip happened at **+72.5s** after the plug turned on. The adapter polls for 8s × 2 attempts ≈ 16-25s. **It is mathematically impossible for the first dispatch to succeed on a cold TV.**

Net waste: ~70s (25s of doomed polling + 45s retry delay) on every cold trigger.

Compare: the same workflow on `office-tv` has an explicit `powerOnWaitOptions: {timeoutMs: 20000}` override in its device config. `livingroom-tv` doesn't, so it uses the 8s default.

**Fixes proposed (all are tractable; first two stand alone, the others are bonus):**

| # | Where | Scope | Effect |
|---|---|---|---|
| **R1** | DaylightStation `devices.yml` | One-line config | Stops false `power.unverified`; eliminates the 45s retry path |
| **R2** | DaylightStation `WakeAndLoadService.mjs` | Modest refactor | Content load runs in parallel with power-on; ~70s faster cold dispatches |
| R3 | HA template sensor + DaylightStation `devices.yml` | One new HA file + one-line edit | Earlier readiness signal via `media_player.living_room_tv` state (~+30s vs +73s) |
| R4 | DaylightStation `devices.yml` | Cross-check | Verify no other devices have the same default-vs-reality mismatch |
| R5 | HA architecture doc | Hygiene | Sync the doc to current `script.living_room_tv_on` (the doc is stale) |

---

## 2. HA-Side Architecture (Verified Empirically)

This audit's analysis only holds if we're accurate about how the HA side actually behaves. After reading the HA configs from inside the `homeassistant` container's `/config` volume, the chain is:

```
  switch.living_room_tv_plug              ── Zigbee2MQTT, IEEE 0x282c02bfffe6f6fb
  └─ sensor.living_room_tv_plug_power     ── Zigbee electricalMeasurement cluster (Watts)
     └─ binary_sensor.living_room_tv_power   ── threshold platform, upper: 30W, hysteresis: 2W
        └─ binary_sensor.living_room_tv_state ── template platform, mirrors the threshold sensor
```

Two corrections to common mental models:

1. **`binary_sensor.living_room_tv_state` is not an independent signal.** Its template (`_includes/templates/living_room_tv_state.yaml`) is literally `{{ is_state('binary_sensor.living_room_tv_power', 'on') }}`. It carries no new information; reading either tells you the same thing. The `_state` name suggests "richer TV state" but in practice it's an alias.

2. **The HA architecture doc (`<HA>/docs/living_room_tv_architecture.md`) is stale.** It describes `script.living_room_tv_on` as "Repeat up to 5 times … 7s wait … 8s wait …" The current `_includes/scripts/living_room_tv_on.yaml` is a different sequence (plug-on → Shield plug-on → Shield wake → 2× ADB WAKEUP+HOME with 10s `wait_template`). Maximum on-paper runtime ~47s; observed runtime in this incident 28.6s. Anyone reading the doc to understand the wake behavior is currently looking at a description that doesn't match the code.

### 2.1 Plug-power telemetry during the incident

Source: HA `/api/history` for `sensor.living_room_tv_plug_power` in the trigger window. The plug is a Zigbee2MQTT device reporting via the standard `haElectricalMeasurement` cluster — readings come every few seconds, not on a 60s polling cadence.

| Elapsed | Wall time (UTC) | `sensor.living_room_tv_plug_power` | Inferred TV state |
|---:|---|---:|---|
| **0s** | 15:37:13.975 | 0 W | Plug just flipped on (HA event) |
| +3.0s | 15:37:16.017 | 8.1 W | TV controller booting, standby pull |
| +5.2s | 15:37:18.220 | 9.9 W | WebOS USB/network enum |
| +10.1s | 15:37:23.094 | 12.1 W | WebOS up, network stack alive |
| +32.2s | 15:37:45.199 | 10.7 W | Steady-state "powered standby" |
| **+73.5s** | **15:38:26.510** | **35.6 W** | **Backlight ignited — threshold crossed** |

Five reports in 73s — the plug isn't slow to report; **the LG TV stays in <30W standby for the first ~70 seconds, then jumps to 35W when the backlight fires**. That's a TV-internal latency, not an HA-side latency.

### 2.2 Why 30W?

The threshold isn't arbitrary. From the data:
- TV plugged in, screen off (powered standby): 8-13W
- TV plugged in, screen on, normal content: 35-60W
- TV unplugged: 0W

A 30W threshold therefore answers the question **"is the screen actually showing pixels?"** That's a useful question for the Zombie Wake Guard (`_includes/automations/living_room_tv_zombie_wake_guard.yaml`) which uses `binary_sensor.living_room_tv_state` to detect unexpected backlight ignition. It's the *wrong* question for wake-and-load, which only needs to know "is the Shield reachable so I can hand it a URL?"

Compare `office-tv`: same threshold sensor pattern but `upper: 15W` (`_includes/binary_sensors/threshold/office_tv_power.yaml`). The office monitor's standby draw is presumably much lower, so 15W cleanly separates "off" from "on" without the long lag. The living room TV's design didn't have that headroom: WebOS' standby is too close to 30W to allow a lower threshold without false positives.

---

## 3. Ground-Truth Timeline

All times UTC. Source: backend `wake-and-load.*` events, HA `/api/history` for entity state changes, HA logbook for script and automation lifecycle.

| Time | Source | Event | Notes |
|------|--------|-------|-------|
| 15:37:13.834 | HA | `automation.kitchen_button_4_slow_tv` triggered | MQTT button press |
| 15:37:13.834 | HA | `script.livingroom_tv_sequence` started | Calls DaylightStation `/api/v1/device/livingroom-tv/load?queue=slow-tv&shader=minimal&volume=10&shuffle=1` |
| 15:37:13.842 | backend | `wake-and-load.power.start` (dispatchId `220c26ac…`) | — |
| 15:37:13.847 | HA | `script.living_room_tv_on` started (attempt 1) | adapter `runScript()` returned immediately after dispatch |
| 15:37:13.975 | HA | `switch.living_room_tv_plug` → on | wall power restored, TV begins cold boot |
| ~15:37:21.8 | backend | first `waitForState` poll times out (8s budget) | sensor still `off` |
| 15:37:22.868 | HA | `script.living_room_tv_on` started (attempt 2) | adapter retry, same 8s polling budget |
| ~15:37:30.8 | backend | second `waitForState` poll times out (8s budget) | sensor still `off` |
| **15:37:38.682** | backend | **`wake-and-load.power.unverified`** | `elapsedMs: 24839` — both attempts exhausted |
| 15:37:38.685 | backend | `wake-and-load.verify.failed reason:"display_off"` | redundant readiness re-check immediately after `power.unverified`; sensor obviously still off |
| 15:37:38.686 | backend | `wake-and-load.retry.start delayMs:45000` scheduled | — |
| 15:37:42.469 | HA | `script.living_room_tv_on` finished (attempt 2) | — |
| 15:37:44.191 | HA | `media_player.living_room_tv` → `off` | WebOS network stack alive, but display not yet "on" |
| 15:38:23.687 | backend | `wake-and-load.power.start` (dispatchId `84b1ea84…`) | retry fires 45s after the schedule |
| **15:38:26.511** | HA | **`binary_sensor.living_room_tv_power` → `on`** | first ground-truth "TV powered" signal — **72.5s after plug-on** |
| 15:38:26.698 | backend | `wake-and-load.power.done verified:true elapsedMs:3010` | retry caught the flip ~2.8s into its first poll |
| 15:38:27.437 | HA | `media_player.living_room_tv` → `on` | — |
| 15:38:30.857 | backend | `wake-and-load.load.start` | content load begins — only 4s after sensor flipped |
| 15:38:35.373 | backend | `wake-and-load.complete totalElapsedMs:11687` | retry succeeded |

**Total user-perceived latency (button press → content load complete): 81.5 seconds.**
**Ground-truth "TV ready" point: +72.5 seconds.**
**Adapter's effective head start in productive work after that: 4 seconds.**

Roughly **45 seconds of pure dead time** between when the dispatch could have completed and when the retry chose to start.

---

## 4. Root Causes

### RC1 — `livingroom-tv` lacks the timeout/retry override that `office-tv` has

**File:** `data/household/config/devices.yml`

```yaml
livingroom-tv:
  device_control:
    displays:
      tv:
        provider: homeassistant
        on_script: script.living_room_tv_on
        off_script: script.living_room_tv_off
        volume_script: script.living_room_tv_volume
        state_sensor: binary_sensor.living_room_tv_power
        # ❌ no powerOnWaitOptions, no powerOnRetries — falls back to adapter defaults
```

Compare to `office-tv` (same file):

```yaml
office-tv:
  device_control:
    powerOnWaitOptions:
      timeoutMs: 20000
      pollIntervalMs: 1500
    displays:
      tv:
        powerOnRetries: 3
```

The defaults in `HomeAssistantDeviceAdapter` (`backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:50-53`) are `timeoutMs: 8000, pollIntervalMs: 1500, maxAttempts: 2`. That's ~16s of polling under ideal conditions — usable for the office TV (which has explicit overrides anyway) but **catastrophically short for the living room TV's actual readiness profile** described in RC2.

### RC2 — The sensor being polled measures "backlight on", not "TV reachable"

**File:** `<HA>/_includes/binary_sensors/threshold/living_room_tv_power.yaml` (verified by container read)

```yaml
- platform: threshold
  name: "Living Room TV Power"
  entity_id: sensor.living_room_tv_plug_power
  upper: 30
  hysteresis: 2
  device_class: power
```

This is a threshold filter on a Zigbee plug's power meter (see §2 for the verified chain). It flips when wall-draw crosses 30W. From the telemetry in §2.1, the LG TV sits at 8-13W from +3s through +32s before jumping to 35W at +73s when the backlight ignites. **The 30W threshold can never resolve "TV powered" any faster than the backlight; that's the whole point of choosing 30W**, which separates "lit screen" from "powered standby".

For wake-and-load, "TV in powered standby with WebOS booted" is what matters — the Shield is the content host, and the FKB WebView can load a URL well before the LG panel finishes igniting its backlight. The sensor we're polling answers the wrong question.

Cross-reference: `office-tv`'s equivalent sensor uses `upper: 15` because the office monitor's standby is low enough to allow a lower threshold without false positives. Living room TV's WebOS standby is too close to 30W to allow the same trick — a low threshold here would chronically read "on" while the screen is dark.

### RC3 — The HA `script.living_room_tv_on` itself can take ~30s, and the adapter `runScript()` doesn't wait for it

**File:** `<HA>/_includes/scripts/living_room_tv_on.yaml`

The script is a multi-stage sequence (plug-on → 3s delay → Shield plug-on → 15s delay → Shield wake → ADB WAKEUP+HOME → 10s wait_template → retry → 10s wait_template). End-to-end worst case ~47s; in the captured incident, 28.6s.

But `HomeAssistantDeviceAdapter.#powerOnDisplay` only awaits the HTTP call to *start* the script (HA's `/api/services/script/<name>` returns when the dispatch is accepted, not when the sequence finishes). It then independently polls the state sensor.

So we end up with two parallel timers that don't know about each other:
- HA-side: 28s script doing real work (WoL, CEC, ADB)
- Adapter-side: 8s × 2 ≈ 16-25s of polling, decoupled from the script's progress

The adapter declares failure mid-script. Then `wake-and-load` immediately re-runs `DisplayReadinessPolicy.isReady()` (`WakeAndLoadService.mjs:197`) — which polls the *same* sensor it just gave up on — and naturally fails again with `display_off`.

### RC4 — 45-second retry delay is conservatively wrong for this device

**File:** `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:643`

```js
#scheduleRetry(deviceId, query, options) {
  const RETRY_DELAY_MS = 45_000;
  const timer = setTimeout(async () => { … }, RETRY_DELAY_MS);
  …
}
```

In this incident the retry fired at +45s from schedule = +69s from button press. The sensor flipped at +72.5s. The retry's first poll caught the flip in 2.8s. **The retry would have worked just as well at +20s** — the adapter's polling loop would have absorbed the remaining ~50s of "still warming up" because each `waitForState` would just keep polling until the sensor flips (assuming a sufficient `timeoutMs`).

The 45s constant was likely chosen as "much more than 8s × 2" to give the TV "time to wake up." But it's a fixed delay before *starting work*, not a polling window — so it strictly serialises after the failed first attempt instead of running in parallel with it.

### RC5 — Display verification gates content load, but Shield-served content doesn't need the display

**Sequencing evidence from the retry:**
- 15:38:26.69 — `power.done verified:true`
- 15:38:26.70 — `verify.skipped reason:power_on_verified`
- 15:38:26.70 — `volume.start`/`volume.done` (7ms)
- 15:38:26.70 — `prepare.start` (skipCameraCheck:true)
- 15:38:30.76 — `prepare.done` (4s)
- 15:38:30.86 — `load.start`
- 15:38:34.86 — `load.ws-failed` (4s ack timeout; cf. the separate WS-fast-path audit dated 2026-04-25)
- 15:38:35.37 — `device.loadContent.done`

The productive work after `power.done` was 8.7s — and **none of it required the LG TV display to be on**. The Shield TV runs FKB regardless of HDMI signal acceptance on the panel. The WebView was reachable, content loaded, DASH started. The display turning on at +72s is a UX precondition (the user has to see the screen), not a *technical* precondition for any of the wake-and-load steps.

The current architecture treats `binary_sensor.living_room_tv_power` as a gate, but it's really a *signal* — useful for telling the user "your TV isn't responding," not for blocking content delivery.

---

## 5. Why the Retry "Worked" Anyway

It looks like the system self-healed, which masks how broken it is:
- First attempt declared failure at +25s
- Retry scheduled for +70s
- Sensor flipped at +72.5s
- Retry started at +70s, first poll at +71.5s, second at +73s (after 1.5s poll interval) — caught the flip at +73s → `power.done verified:true`

The retry succeeded because **45s was juuust long enough** that the sensor had a fair chance of flipping during the retry's polling window. Change any of (plug brand, TV brand, ambient power draw threshold, HA polling cadence) and this falls apart.

This is fragile. The next dispatch where it takes 80s for the sensor to flip will hit `wake-and-load.retry.failed` and `notifyPowerFailure` will send a push notification telling the user the TV failed to turn on — when it actually turned on fine and the system just gave up too early. Twice.

---

## 6. Recommendations

### R1 — Immediate (config-only): match `livingroom-tv` polling to its actual readiness floor

In `data/household/config/devices.yml`:

```yaml
livingroom-tv:
  device_control:
    powerOnWaitOptions:
      timeoutMs: 80000          # accommodates 72.5s sensor floor + headroom
      pollIntervalMs: 2000      # plug reports on ~few-second cadence; 1.5s vs 2s is noise
    displays:
      tv:
        provider: homeassistant
        on_script: script.living_room_tv_on
        off_script: script.living_room_tv_off
        volume_script: script.living_room_tv_volume
        state_sensor: binary_sensor.living_room_tv_power
        powerOnRetries: 1       # one long poll is structurally better than two short polls here
```

Effect on the captured incident:
- Single `powerOn` attempt polls for up to 80s
- Catches sensor flip at +72.5s
- `power.done verified:true` at ~+73s
- Total dispatch latency: ~85s (vs. 82s currently — about the same)
- **No retry delay, no false `power.unverified`, no risk of the +80s tail blowing through the retry**

Latency is similar in the captured incident but the *failure mode* is gone — and on the unlucky next dispatch where the plug reports a few seconds slower, we no longer log a false negative and fire a spurious "TV failed to turn on" push notification.

### R2 — Near-term (architectural): proceed in parallel; don't block content load on the display sensor

In `WakeAndLoadService.#executeInner`:

- Fire HA `on_script` (non-blocking acknowledgement is fine)
- Proceed *immediately* to `prepare` and `load` against the Shield via FKB/WebSocket
- Run display verification **in the background** as a watchdog: if the sensor hasn't flipped by some envelope (60-90s), emit a `wake-progress.power.timeout` and trigger `notifyPowerFailure` — but don't block or retry the dispatch itself.

The Shield + FKB + content delivery path is already idempotent and resilient (see `2026-04-22-shield-wake-and-load-failure-audit.md`); it doesn't need the display state to make progress. Decoupling these halves the wake-up latency on cold dispatches and removes the entire retry-window fragility class.

Implementation sketch:

```js
// In #executeInner, after constructing dispatchId:
const powerPromise = device.powerOn();        // background; do not await yet
this.#armDisplayWatchdog(deviceId, dispatchId, powerPromise, { timeoutMs: 90_000 });

// Continue to volume/prepare/load using only the Shield-reachable paths.
// At the end of the function, optionally await powerPromise to surface a status
// in the result, but do not gate `canProceed` on it.
```

This also gives the user a much better experience: content starts loading in the WebView while the panel is still warming up, so by the time the backlight is on, the video is already mid-playback rather than just beginning to fetch metadata.

### R3 — Add a HA-side "TV reachable" sensor that fires earlier (HA-side, optional)

Correction to my earlier analysis: `binary_sensor.living_room_tv_state` is not an independent signal — it's a template alias of `binary_sensor.living_room_tv_power` (verified by reading `<HA>/_includes/templates/living_room_tv_state.yaml`). It carries no extra information. Using it as a "faster" signal is not an option.

What *does* exist as an earlier signal is the WebOS-side device entity `media_player.living_room_tv`. From §2.1 telemetry and entity history, its transitions during this incident were:

| Wall time | Transition | Meaning |
|---|---|---|
| 15:37:13.975 | (unavailable, no change) | Plug just flipped on |
| **15:37:44.191** | `unavailable` → `off` | **WebOS network stack is alive and responding to SSDP/webos polling** |
| 15:38:27.437 | `off` → `on` | Backlight ignited |

The `unavailable` → `off` transition at **+30 seconds** is the earliest "TV reachable" signal in this data. That's ~42 seconds earlier than the 30W threshold.

A new HA template binary sensor could expose this directly:

```yaml
# <HA>/_includes/templates/living_room_tv_reachable.yaml
- binary_sensor:
    - name: "Living Room TV Reachable"
      unique_id: living_room_tv_reachable_template
      state: >-
        {{ states('media_player.living_room_tv') not in ['unavailable', 'unknown'] }}
```

Then `livingroom-tv.device_control.displays.tv.state_sensor` would point at `binary_sensor.living_room_tv_reachable` instead of `binary_sensor.living_room_tv_power`. The existing 30W threshold sensor stays in place for the Zombie Wake Guard (which legitimately wants "is the screen actually lit").

**Caveat:** the `media_player.living_room_tv` integration's own polling cadence may add small lag — typically a few seconds, not minutes. Worth measuring before committing to this signal as the only readiness gate. R1 + R2 are sufficient on their own; R3 is just a latency optimisation.

This recommendation is **HA-side** — one new template sensor in `<HA>/_includes/templates/`, plus a one-line YAML change on the DaylightStation side to point `state_sensor` at the new entity.

### R4 — Audit the other devices for the same default-vs-reality mismatch

`HomeAssistantDeviceAdapter` defaults: `timeoutMs: 8000, pollIntervalMs: 1500, maxAttempts: 2`. Any device whose `state_sensor` takes longer than ~20s to flip after `on_script` dispatch will hit this same failure mode. Worth one cross-check pass against every `displays.*.state_sensor` in `devices.yml`:

| Device | Display | State sensor | Sensor type | Default-adequate? |
|--------|---------|--------------|-------------|--------------------|
| `livingroom-tv` | `tv` | `binary_sensor.living_room_tv_power` | plug-power threshold | **No** (see this audit) |
| `office-tv` | `tv` | `binary_sensor.office_tv_power` | (TBD — likely same pattern) | Override in place |
| `office-tv` | `monitor` | (no state_sensor) | n/a | n/a |

If the office TV's `binary_sensor.office_tv_power` is also a plug-threshold sensor, its 20s override is also too short; check against actual cold-boot histories.

---

### R5 — Refresh the stale HA architecture doc (HA-side, hygiene)

`<HA>/docs/living_room_tv_architecture.md` describes `script.living_room_tv_on` as a 5-iteration loop (`Repeat up to 5 times … 7s wait … 8s wait …`). The current script is structured very differently (plug-on → Shield plug-on → Shield wake → 2× ADB WAKEUP+HOME via `remote.shield_android_tv`). Anyone reading the doc to reason about wake timing is looking at a description that doesn't match reality.

Update the "Logic Flow" section of `script.living_room_tv_on` and `script.living_room_tv_off` in that doc to match the current YAML, and note the worst-case ~47s runtime.

---

## 7. Postmortem — diagnosis & fix landed (2026-05-23, same day)

After this audit was written, a full diagnosis session ran (spec: `docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md`, plan: `docs/superpowers/plans/2026-05-23-livingroom-tv-wake-latency-diagnosis-plan.md`). The audit's hypotheses were partly right, partly wrong, and the actual root cause was richer than either.

### What the diagnosis found

- **Variant A** (`media_player.turn_off` alone): TV dropped from 38W → 31W in ~14s, then sat at 31W indefinitely.
- **Variant B** (full `script.living_room_tv_off`, 4× `media_player.turn_off` + `remote.turn_off` with 15s waits, plug-kill bypassed): identical to Variant A. The retries and `remote.turn_off` to the Shield added nothing measurable.
- **But ~6 minutes after Variant B ended** (unobserved during the test), HA history showed the TV transition 31W → 11.8W → 0W in ~5 seconds. **The TV reaches 0W with plug still on, just slowly.**
- 24-hour band histogram confirmed three distinct low-power states: **0W (deep off), 8-14W (Quick Start standby), 27-31W (post-off-command plateau)**. The 27-31W band was never observed during normal use — only after CEC-off events.

### Actual root cause

The off-script's CEC chain (`media_player.turn_off` + `remote.turn_off` × 4 with 15s waits) **does initiate the TV's power-down sequence**, but the script's while-loop only allows ~75 seconds before checking the plug-kill condition. At t+75s the TV is reliably in the MID band (31W), well above the 5W threshold, so the script kills the plug every time. This forces every subsequent wake to be a 73s cold boot from plug-off.

The 5W threshold isn't wrong (LG OLED true standby is <1W and the LOW Quick Start band is 8-14W). The **timing** is wrong: the script doesn't give the TV enough time to complete its CEC-driven descent.

### Fix landed

**Layer 1 (HA-side)** — `_includes/scripts/living_room_tv_off.yaml`:
Added a `wait_template` for `sensor.living_room_tv_plug_power < 5` with a 7-minute timeout, placed AFTER the existing while-loop and BEFORE the plug-kill check. Threshold preserved at 5W.

**Layer 2 (DaylightStation-side)** — `data/household/config/devices.yml`:
Added `powerOnWaitOptions: {timeoutMs: 80000, pollIntervalMs: 2000}` and `powerOnRetries: 1` to `livingroom-tv.device_control`. This makes wake-and-load tolerate the cold-boot path gracefully on the rare occasions Layer 1 doesn't work (Shield wakes the TV mid-descent, true stuck-on, power outage).

### Verified outcomes (live test, 2026-05-23 17:34-17:37 UTC)

| Metric | Before | After |
|---|---:|---:|
| Off → plug state | Plug killed every cycle | Plug **stays on** |
| TV settled state | 0W (forced via plug-cut) | 0W (natural) |
| Off-script completion time | ~75 s (then plug-cut) | 139 s (this run; up to 7 min) |
| Wake-and-load total elapsed | ~82 000 ms | **13 845 ms** |
| TV backlight-on delay | ~73 s | **~9 s** |
| `wake-and-load.power.unverified` | Every cold dispatch | None |
| `wake-and-load.retry.start` | Every cold dispatch | Not fired |
| WS fast-path | Failed (4s ack timeout) | Succeeded (1294 ms ack) — incidental win |

### Status of original recommendations

- **R1 (longer polling timeout in DaylightStation):** ✅ landed as Layer 2 of the fix. Now a safety belt for genuinely-cold paths (power outage etc.); previously it would have been a daily-firing workaround.
- **R2 (parallel content load):** deferred. With wakes at 14 s, orchestration overhead is no longer the bottleneck. Revisit only if measurements change.
- **R3 (reachable template sensor based on `media_player.living_room_tv`):** deferred. The threshold sensor flips fast enough in the new state-of-the-world.
- **R4 (cross-check other devices for default-vs-reality mismatch):** still valid; orthogonal cleanup.
- **R5 (refresh stale HA arch doc):** still valid; the doc describes a script structure that no longer exists. HA-side hygiene.

### Followups (not blocking)

- **Why does the TV plateau at 31W for several minutes after CEC-off?** Unknown. Likely an LG WebOS-side internal timer (the user confirmed no "Auto Power Off" / "No Signal Off" setting is visible in the TV's menu). Possibly related to HDMI signal state — when Shield went idle in our test it shaved the plateau to ~2.3 min vs Variant B's ~6.5 min.
- **Spontaneous Shield wakeups bouncing the TV back to ON during the descent.** Observed once in our 24h sample (16:56:32 wake with no deliberate trigger from our system). Could intermittently cause the plug-kill safety net to fire. Worth investigating Shield's idle behavior.
- **Test `remote.send_command POWER` as a direct off-mechanism.** Confirmed it works for ON (woke the TV in ~5 s from 0W); not yet tested as an OFF-trigger. If it bypasses the MID plateau, could shorten the off-script.

Reference: `docs/superpowers/specs/2026-05-23-livingroom-tv-wake-latency-diagnosis-design.md`, `docs/superpowers/plans/2026-05-23-livingroom-tv-wake-latency-diagnosis-plan.md`.

---

## 8. Related Audits

- `2026-04-22-shield-wake-and-load-failure-audit.md` — FKB `loadURL` HTTP-200 ≠ "page loaded"; the content-load half of the same workflow.
- `2026-04-25-wake-and-load-ws-fast-path-disabled-audit.md` — explains the `ws-failed: waitForMessage timed out after 4000ms` log line in this audit's retry timeline. Out of scope here but relevant if the WS-first path is ever re-enabled and this audit's R2 is implemented together.
- `2026-04-25-nfc-to-playback-trigger-sequence-audit.md` — adjacent end-to-end trigger latency analysis.

---

## 9. Verification Checklist (superseded — see §7 for the live result)

- [ ] Apply R1 config change; redeploy.
- [ ] Power-cycle living-room TV plug from a cold state (no draw).
- [ ] Press kitchen button 4. Watch `wake-and-load.*` logs.
- [ ] Confirm: no `wake-and-load.power.unverified`, no `wake-and-load.retry.start`, single `power.done verified:true` with `elapsedMs` matching the actual sensor-flip latency (60-80s range).
- [ ] Confirm `wake-and-load.complete totalElapsedMs` is roughly equal to "time until TV display lit + 5-10s for content load" — not "time until TV display lit + 45s + content load".
- [ ] Confirm `binary_sensor.living_room_tv_power` history shows the flip *during* the single `power.start` window, not after a retry boundary.

If R2 is implemented: also confirm `wake-and-load.load.start` fires within ~5s of `wake-and-load.power.start` regardless of sensor state, and the watchdog only logs a `power.timeout` event (no failed dispatch) when the sensor genuinely never flips.
