# Piano Tablet Screen ↔ Piano Power Sync (+ manual off)

**Date:** 2026-07-01
**Status:** design, pending implementation
**Repos:** DaylightStation (primary), Home Assistant `_includes` (sensor only — no new automation required)

## Problem

The yellow-room piano tablet (Galaxy Tab A, FKB kiosk at `10.0.0.245`) should track the
piano's actual power: **piano off → tablet screen off; piano on → tablet screen on.** Today the
only screen control is the in-browser screensaver (idle/MIDI), which can't tie to piano power and
leaves the tablet lit when the piano is off. Because the tablet is kiosk-locked there is **no
on-screen button** to wake a dark screen — so waking must come from a physical/edge signal.

## Wattage data (48h, `sensor.yellow_room_piano_plug_power`)

- **off = 0 W**, **on = ~18–29 W** (median 20). The 2–5 W flap band had **0 samples** — a clean gap.
- ⇒ The existing threshold sensor `binary_sensor.yellow_room_piano_power` (upper 5 W, hysteresis 2 W)
  is **safe**; no sensor-level flap risk.
- **BUT** transient single-sample dips to 0 W occur mid-session (`18.6 → 0 → 18.6` within seconds).
  ⇒ an **off-edge debounce (~15 s) is mandatory**, or a metering glitch blanks the tablet mid-song.

## Core architecture: DS is the single writer

The screen has two would-be masters (the in-browser screensaver, and piano-power). To avoid the
two-writer fight (cf. HA `garage_switch_manual_off_action` caveat), **DS backend is the single
authority for the FKB screen.** It survives a dead WebView and can revive it (`loadStartUrl`), reads
real screen state (defeats the FKB 200/login silent-success), and already holds the FKB auth + adapter.

### The one invariant DS continuously enforces (key simplification)

DS does **not** continuously force the screen on while the piano is on. It enforces exactly:

```
piano OFF  ⇒  screen OFF            (continuous — reconciled)
piano OFF→ON edge  ⇒  pulse screen ON   (the "flip the piano on" wake)
```

While the piano is **on**, the screen's on/off is owned by the **browser screensaver** (idle-dim +
wake). That means:
- Idle-dimming still works while the piano is on (screensaver not replaced). ✓
- **Manual-off needs no override flag** — it's just an immediate browser-side sleep. DS won't undo it,
  because DS never force-ONs while the piano is on. Any wake source brings it back.

Fail-safe: if piano power is unknown / HA unreachable, treat as **ON** (leave tablet usable).

## The three wake paths (no physical button; kiosk-locked)

1. **Flip the piano on** → HA power sensor flips → DS reads it → `loadStartUrl`-verified `screenOn`.
   Works even if the WebView is dead. Primary, always-available path.
2. **Touch the screen** → browser screensaver `pointerdown` → `screenOn`. *May not deliver while
   backlight is off — assume it doesn't, but wire it anyway (harmless if it no-ops).* [VERIFY]
3. **A MIDI note (BLE)** → browser screensaver note-on → `screenOn`. Expected to work because the
   tablet is kept awake + listening (CPU wakelock via `fkb.cli keepawake`), so the WebView + Web MIDI
   stay live with the backlight off. [VERIFY Web-MIDI delivers while backlight off]
   - **Optional hardening:** the always-on background helper APK (BLE-MIDI) can also nudge FKB
     `screenOn` via localhost REST, as a backup for when the WebView isn't receiving Web MIDI while
     asleep or the page is dead. Depends on helper-APK state (BLE-MIDI currently relay/unpaired —
     see `project_piano_voice_bridge`).

## Manual-off UX

- Button in **`PianoSettingsSheet`** (deliberate, behind a menu — preferred over the connect screen).
- Action: immediate `screenOff` (via the existing DS `/api/v1/device/yellow-room-tablet/screen/off`,
  which the browser already talks to). No HA involved, as required.
- Recovery: any of the three wake paths above (piano power-cycle, MIDI, or touch-if-it-works).
- Because DS only force-ONs on the piano power-on **edge** (not continuously), a manual-off sticks
  until a real wake event — no override state required.

## Components

### DS backend
- **HA read:** `haGateway.getState('binary_sensor.yellow_room_piano_power')` — extends the existing
  `HaSensorDisplayPowerCheck` / `DisplayReadinessPolicy` pattern. Poll every ~3–5 s (detect edges) and
  accept an optional HA push for latency (see below). Poll is source of truth.
- **Screen authority service** (new, small): holds last-known piano power; on OFF→ON edge → `screenOn`;
  on ON→OFF edge (debounced ~15 s) → `screenOff`; continuous reconcile (~30–60 s): if `piano==off` and
  FKB `deviceInfo.screenOn==true` → `screenOff`.
- **Verify + retry + escalate:** after any command, read `deviceInfo.screenOn`; if ≠ desired, retry N
  with backoff; still wrong → `loadStartUrl` (revive) → retry; still wrong → log + notify. Idempotent.
- Reuse the `/api/v1/device/:id/screen/:state` endpoint (verified working) as the actuator.

### DS frontend
- **Screensaver** already hoisted above the connect gate (shipped `6a665ddc4`) — keeps idle-dim + MIDI/
  touch wake while the piano is on.
- **Manual-off button** in `PianoSettingsSheet` → DS `screen/off`.

### Home Assistant
- `binary_sensor.yellow_room_piano_power` already exists and is loaded. **No new automation needed** for
  the DS-reads model.
- *Optional:* a tiny edge automation pushing power changes to a DS trigger endpoint for lower latency
  than the 3–5 s poll. Wire both; DS-read remains authoritative.

## Guardrails / retry summary

| Concern | Guardrail |
|---|---|
| Dropped command / DS or FKB restart | continuous reconcile re-asserts; commands idempotent |
| FKB 200/login silent-success | verify against real `deviceInfo.screenOn`, not the ack |
| Transient 0 W metering blip | off-edge debounce ~15 s |
| Momentary spike | on-edge debounce short/none (18 W = real on) |
| Missed edge / HA or DS down | DS poll self-heals; fail-safe to ON |
| Dead kiosk page | escalate to `loadStartUrl` (recovery already shipped) |
| Two-writer fight | DS only force-OFFs (piano off) + pulses ON (edge); browser owns on-state while piano on |

## Open items to verify (empirically, on the device)
1. Does FKB `screenOff` still deliver **touch** events to the WebView? (assume no; wire anyway)
2. Does **Web MIDI** deliver to the WebView while the backlight is off? (drives whether the helper-APK
   backup is needed)
3. Confirm `haGateway.getState` returns the threshold binary sensor cleanly from the DS container.

## Implementation slices
1. **DS backend** screen-authority service (HA read + edge/reconcile + verify/retry/escalate).
2. **DS frontend** manual-off button in `PianoSettingsSheet`.
3. **HA (optional)** low-latency push automation.
4. **Verify** the three open items on-device; add the helper-APK MIDI→screenOn backup if (2) fails.

## Test plan
- Unit: edge logic (off/on/manual), debounce, reconcile divergence, fail-safe-on when HA unreachable.
- On-device: piano off→screen off; piano on→screen on; manual-off→dark; wake via power-cycle; wake via
  MIDI; verify no flicker war with the browser screensaver; kill the page and confirm power-on still
  wakes (loadStartUrl escalation).
