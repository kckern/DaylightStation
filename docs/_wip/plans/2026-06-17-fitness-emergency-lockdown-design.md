# Fitness Emergency Lockdown — Design

**Date:** 2026-06-17
**Status:** Implemented (2026-06-17) — see `docs/runbooks/fitness-emergency-lockdown.md`. Backend (domain VO, port, YAML datastore, use cases, candidate policy, foreground arbiter, detector loop, bootstrap wiring, 4 API endpoints) + frontend (`useEmergencyLockdown` hook, `EmergencyLockdownOverlay` DEFCON screen) + config + e2e all landed on branch `feature/fitness-emergency-lockdown`. No deviations from this design. Open: live-garage re-arm verification (see runbook caveat); optional inter-arm idle gap / active-hours gating not built (YAGNI until hardware says otherwise).
**Scope:** `frontend/src/Apps/FitnessApp.jsx` (Firefox kiosk on garage box) + fitness backend (DDD layers)

---

## Purpose

Give a parent/admin a **zero-fiddle emergency shutoff**: press their fingerprint on the
garage reader in any normal context (no unlock modal open) and the garage shuts down —
TV, speaker, fan, LEDs, heater (via the existing `garage_deactivate` Home Assistant
script) — accompanied by a deliberately dramatic ("DEFCON 1") on-screen lockdown. The
lockdown is **reversible** (admin fingerprint releases it early) but **significant**:
it persists for a configurable duration (default 30 min) and **survives reboot**.

This is the parent override: no menus, no buttons — just a fingerprint.

---

## Key mechanical constraint (drives the whole design)

The garage fingerprint reader has **no passive "who just touched it" event**. It only
matches when an unlock *request* arms it with a candidate UUID list (the existing
`fitness.unlock.request` → `fitness.unlock.result` round trip, ~15s armed window). The
always-on websocket the FitnessApp holds carries **HR data** and **unlock results**, but
a fingerprint result only arrives if a scan is currently armed.

**Consequence:** "admin presses in any context → bam" requires the system to **keep an
emergency scan armed in the background** whenever idle, re-arming on each timeout, and to
**yield the reader** while a normal unlock modal owns it.

---

## State machine (one overlay inside FitnessApp)

| State | Behavior | Background emergency scan |
|-------|----------|---------------------------|
| `normal` | App works as today. | **Armed** (only while idle AND no unlock modal open). Admin match → `triggering`. |
| `triggering` | Scary black/red DEFCON screen; `powerdown.mp3` plays. **Cancel** affordance visible *only while audio plays*; Cancel → second admin scan confirms → abort to `normal` (no HA fire, no lock). MP3 finishes uncancelled → commit → `locked`. | Paused (reader free for the cancel-confirm scan). |
| `locked` | Lockdown screen, inert to normal interaction. Persisted server-side with `lockedUntil`. Press-and-hold anywhere **3s** summons the unlock modal; admin scan releases early → `normal`. Auto-releases when `lockedUntil` passes. | Paused (reader free for the release scan). |

---

## Detection architecture — backend-driven (Option B)

The **backend** owns the armed emergency detector (survives frontend reloads, centralizes
reader contention). It keeps the `emergency` lock armed against the garage box and, on an
admin match, **broadcasts `fitness.emergency.detected{userId}`** on the websocket. The
frontend subscribes always (rides the existing HR channel) and reacts. **No garage-bridge
changes** — the bridge already answers `fitness.unlock.request` with a candidate list.

Reader contention: the backend pauses the emergency arm whenever a normal unlock request
is in flight (both go through `unlockService`), then re-arms.

### Detect → ceremony → commit split

Detection and the HA fire are **separated by the browser ceremony** (the mp3 + cancel
window live in Firefox):

1. **Detect** — backend match → broadcast `fitness.emergency.detected{userId}`.
   **No HA fire, no persistence yet.** Just "ceremony, begin."
2. **Ceremony** — frontend → `triggering`, plays mp3, shows cancel window.
   - Cancel → admin re-scan → `POST …/emergency/abort` → backend logs, re-arms.
   - Browser crash mid-ceremony → nothing committed → no lockdown (admin re-presses).
3. **Commit** — mp3 finishes uncancelled → frontend `POST …/emergency/commit` → backend
   **fires `garage_deactivate`**, persists `{lockedUntil, lockedBy, lockedAt}`, broadcasts
   `fitness.emergency.locked`.
4. **Release** — deliberate gesture → unlock modal → admin scan → `POST …/emergency/release`
   (clears state). Or backend treats the lock expired once `now ≥ lockedUntil`.

---

## DDD layer map (fitness bounded context)

- **2_domains/fitness** — `LockdownState` value object: `{ lockedUntil, lockedBy, lockedAt }`,
  `isActive(now)`, immutable (`Object.freeze`), self-validating. Pure, no I/O.
- **3_applications/fitness** — use cases `TriggerEmergencyLockdown`, `ReleaseEmergencyLockdown`,
  `GetLockdownState`, plus the arming/detection loop service. New port
  `IEmergencyLockRepository`. Reuse existing HA gateway port + `unlockService`.
- **1_adapters** — `YamlEmergencyLockDatastore` (FileIO `history/fitness/emergency_lock.yml`)
  implementing the port; existing `HomeAssistantAdapter` for the script.
- **4_api/v1/routers/fitness.mjs** — `GET /fitness/emergency`, `POST /fitness/emergency/{commit,abort,release}`.

Dependencies point inward; domain stays pure; persistence + HA are adapters behind ports.

---

## Persistence

Server-side source of truth: `history/fitness/emergency_lock.yml` →
`{ lockedUntil: <epoch>, lockedBy: <username>, lockedAt: <epoch> }`. On FitnessApp mount,
`GET /fitness/emergency` returns current state; if active, the app drops straight into
`locked`. Survives full Firefox/garage reboot; cannot be cleared by wiping the browser.
Backend reports a lock as expired once `now ≥ lockedUntil`.

---

## Screens / UX

- **Triggering (DEFCON):** full-bleed black, deep-red radial vignette, power-off glyph
  (from provided SVG) centered + large, pulsing red glow (`drop-shadow` + breathing
  `@keyframes` — lives in the player content area, NOT inside `.menu-items-container`,
  so CSS animation is allowed). Stark status line ("SYSTEM LOCKDOWN INITIATED"), thin
  progress bar tracking the mp3. Audio plays through the **shared unlock-on-gesture audio
  element** (`installCueAudioUnlock`) so the garage Firefox autoplay gate doesn't swallow
  it. Low-contrast **Cancel** button bottom-corner, present only while audio plays →
  swaps to "Scan to confirm cancel" and arms a one-shot admin scan.
- **Locked:** same black/red aesthetic, calmer — glyph dimmed, message "LOCKED — back at
  H:MM" showing release time. Inert to normal taps/keys/navigation. Press-and-hold
  anywhere **3s** summons the unlock modal; admin scan releases early.

---

## Config-driven knobs (`fitness.yml`)

- `locks.emergency`: admin usernames authorized to trigger/release.
- Lockdown duration: default `1800` s.
- HA script id: `garage_deactivate`.
- MP3 path: `apps/fitness/ux/powerdown.mp3`.

---

## Assets

- **SVG:** power-off glyph — https://www.svgrepo.com/download/352368/power-off.svg
- **MP3:** `…/media/apps/fitness/ux/powerdown.mp3` (~7s, 231 KB) — already in place.
- **HA script:** `garage_deactivate.yaml` — already in place (kills garage TV/speaker/
  fan/LED/heater/heater-timer; sets LEDs blue when inactive).

---

## Logging (structured, per framework)

`emergency.armed`, `emergency.detected{userId}`, `emergency.triggering`,
`emergency.cancelled{userId}`, `emergency.committed`, `emergency.ha_fired`,
`emergency.locked{until}`, `emergency.released{by:'admin'|'timeout'}`.

---

## Open questions / deferred

- Minimum on-screen ceremony duration is the natural mp3 length (~7s); no separate floor.
- Exact reader-contention pause/re-arm semantics in `unlockService` to be confirmed during
  implementation (whether concurrent requests to the bridge are safe or must be serialized).
