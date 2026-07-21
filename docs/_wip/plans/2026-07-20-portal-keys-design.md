# Portal Keys — Design

> **STATUS (2026-07-21): BUILT, PARTLY VERIFIED. The design below is SUPERSEDED in one major
> respect — the camera button cannot be used at all.** See `_extensions/portal-keys/README.md`
> for the authoritative current state; this document is kept for the reasoning trail.
>
> What Milestone 1 actually answered:
> - Volume keys ARE delivered to an `AccessibilityService`. ✅ (confirmed working end-to-end:
>   volume buttons drive the SPA master volume)
> - The **camera button is NEVER delivered** — it is wired to Portal's privacy HAL, below key
>   dispatch, and its state is behind a Facebook signature permission. The core premise of this
>   design ("camera button toggles the backlight") is **dead**.
> - **Long presses are never delivered either** — firmware converts a held VOLUME_DOWN into a
>   power-menu global action. Replacement gesture: **double-press VOLUME_DOWN** to sleep.
> - **Display off drops WiFi**, taking FKB REST / pkctl / ADB with it. `keepawake` is a
>   PREREQUISITE, not a cleanup item — see the postmortem at the end.
>
> Still unverified: that the double-press sleep + volume-key wake round-trip works (the panel went
> off-network mid-test), and that `ws://localhost` is reachable from the `https://` production
> origin.

**Date:** 2026-07-20
**Package:** `net.kckern.portalkeys`
**Target:** Facebook Portal 10" (sideloaded Android 9 / API 28), device `portal` in `devices.yml`
**Precedent:** `_extensions/piano-bridge/` — same Gradle layout and control-plane pattern, minus
all native/JNI/audio machinery.

---

## Context

The Portal is a 1280x800 touch panel running FullyKiosk with the DaylightStation SPA at
`/screens/portal`. It has three physical buttons that currently do stock Android things
(volume ±, camera/mic privacy mute) with no relation to what's on screen.

Goal: repurpose them.

- **Camera button** → toggle the display off/on
- **Volume buttons** → drive the SPA's existing software master volume

The SPA already owns a full volume model (`ScreenVolumeProvider`: `master [0,1]`, `step()`,
`toggleMute()`, `volumeCurve`, `outputCeiling`, localStorage persistence, HUD toast). This design
adds no volume logic — it only routes physical key presses into that existing API.

---

## Measured facts (verified on hardware 2026-07-20)

Captured with `getevent -lq` over ADB. **These are observed presses, not datasheet claims.**

| Button | Keycode | Input node |
|--------|---------|------------|
| Camera / privacy | `KEY_MUTE` | `/dev/input/event0` (qpnp_pon) |
| Volume down | `KEY_VOLUMEDOWN` | `/dev/input/event0` (qpnp_pon) |
| Volume up | `KEY_VOLUMEUP` | `/dev/input/event2` (gpio-keys) |

There is **no distinct camera keycode** — the camera button is the privacy toggle and emits
`KEY_MUTE`. This was originally inferred from `getevent -pl` capability advertisement, then
confirmed by observed press.

**With the display off** (`mWakefulness=Dozing`, `Display Power: state=OFF`):

- `KEY_MUTE` **still emits** at the kernel input layer.
- It **does not wake the display** — wakefulness stayed `Dozing`. `KEY_MUTE` is not a wake key on
  this hardware.

The non-wake behavior is desirable: nothing accidentally wakes the panel, and the wake transition
is ours to control explicitly.

### Explicitly NOT verified

- Whether an `AccessibilityService` **receives** `onKeyEvent` while dozing. `getevent` proves the
  *kernel* sees the key; framework dispatch during doze is a layer above and only the real APK
  settles it. **This is Milestone 1.**
- Whether FKB's kiosk mode consumes volume keys before accessibility filtering. Accessibility key
  filtering sits early in the input pipeline and should win, but this is untested against FKB.
- Whether the button physically labeled **+** emits `VOLUMEUP`. The capture order didn't match the
  requested press order, so the labels may be inverted. Confirm before shipping.

---

## Architecture

```
   ┌──────────────────────────────────────────────┐
   │ PortalKeysService (AccessibilityService)     │
   │   onKeyEvent: VOLUMEUP / VOLUMEDOWN / MUTE   │
   │     → return true (consume)                  │
   │   MUTE → toggle display via FKB REST         │
   │                                              │
   │   ControlServer (NanoWSD, port per config)   │
   │     out: {key, action, ts}                   │
   │     in:  ping, config.get/set                │
   └────────────────────┬─────────────────────────┘
                        │ ws://localhost:<port>
                        ▼
   Portal SPA — usePortalKeys.js
     VOLUMEUP/DOWN → step(±) from ScreenVolumeContext
     MUTE          → observe only (screen handled natively)
```

Pure Kotlin. No NDK, no JNI, no native audio. One service, one WebSocket.

### Why the screen toggle lives in the APK, not the SPA

The screen-off path must work when the WebView is dozing or wedged — exactly when the SPA cannot
be trusted to respond. Volume has no such constraint, so it routes to the browser where the curve,
HUD, and persistence already exist.

Consequence: all *behavior* except the screen toggle lives in the SPA, so remapping later never
means reflashing.

---

## Android side

### Lifecycle

Simpler than piano-bridge. An `AccessibilityService` is bound by the system, so:

- no `startForeground()`
- no Android-11 background-service restrictions
- **no `BootReceiver`** — the system rebinds automatically after reboot

This deletes the class of bugs piano-bridge hit calling `startForegroundService()` from
`BOOT_COMPLETED`.

### Required declarations

All three are needed; missing any one fails **silently**:

```xml
<!-- accessibility_service_config.xml -->
android:canRequestFilterKeyEvents="true"
android:accessibilityFlags="flagRequestFilterKeyEvents"
```

plus `BIND_ACCESSIBILITY_SERVICE` permission on the service declaration.

`onKeyEvent` returning `true` **consumes** the key — this is what stops Android moving
`STREAM_MUSIC` underneath the SPA.

### The permission is the fragility

The service must be enabled once in Settings → Accessibility. This grant is the kind of thing an
OS update or factory reset silently drops. It is settable headlessly:

```
adb shell settings put secure enabled_accessibility_services \
  net.kckern.portalkeys/.PortalKeysService
```

**That runs as the `shell` uid.** Per the piano-bridge design doc, the `settings` shell command is
denied to `untrusted_app`, so **the APK cannot self-enable**. Recovery requires ADB or a human at
the device — never the app itself. Write this into the runbook.

### Wake path — symmetric via FKB

If we blank via FKB `screenOff`, restore via FKB `screenOn` rather than a `PowerManager` wakelock,
so we aren't fighting FKB's own display state machine.

Cost: the APK needs the FKB password on-device. Piano-bridge already precedents this
(`fkbPassword` in its config). **The password lives in `devices.yml` / the auth ref — never in
this or any other doc.**

### Control plane

`pkctl.mjs`, mirroring `pbctl.mjs`: LAN HTTP, no ADB required.

`pkctl status` must report **service-bound: yes/no as its first line**, so a dead panel is one
command to diagnose rather than a mystery.

---

## SPA side

`usePortalKeys.js` — module-level lazy logger per the project logging rules, subscribes to the
local WebSocket, reconnects with backoff.

```js
VOLUMEUP   → step(+stepSize)
VOLUMEDOWN → step(-stepSize)
MUTE       → observe only (screen handled natively)
```

### Logging from the start

When this breaks it breaks **silently** — the buttons just stop working. Logs are the only way to
distinguish "service unbound" from "WebSocket dead" from "SPA not listening".

- `portal-keys-connected` / `portal-keys-disconnected` (warn)
- `key-received` (debug)

### Decision: screen-off does NOT stop audio

`MUTE` is purely a display operation and never touches the player. A read-along continuing with
the display dark is the bedtime case, and is likely the most valuable thing this button does.

### STREAM_MUSIC pinning

Pin once to a fixed level so the SPA gain is the only dial. Same guard concept as the piano
tablet's audio guard, inverted — pinned high rather than at 0.

Rationale: two cascaded gains produce "it's at 100% but quiet", which becomes a permanent support
burden. The portal is also a cast target, so volume is settable remotely; physical buttons and
remote control must converge on one authority.

---

## Configuration

Key map, WebSocket port, and `fkbPassword` ref belong in the **existing `portal:` block in
`devices.yml`**, beside `content_control` — already the SSOT for this panel, already carries an
`auth_ref`. Not a new config file.

Volume feel is tunable without touching the APK, via `ScreenVolumeProvider` props: `stepSize`,
`curve`, `outputCeiling`, `defaultMaster`.

Starting point: `stepSize: 0.05` with a knee curve. Android's ~15 coarse `STREAM_MUSIC` steps are
too blunt for quiet-range control; a knee at `{in:0.5, out:0.1}` gives the bottom half of the dial
the 0–10% range. Tune by ear on the actual panel.

---

## Milestones

1. **Spike — prove framework key delivery during doze.** Minimal APK: `AccessibilityService` +
   one logcat line. No WebSocket, no SPA, no screen control. Enable via ADB, blank the screen,
   press the camera button, read logcat. Binary go/no-go. **Everything else is wasted if this is
   no.**
2. Consume keys + FKB screen toggle. Still no SPA.
3. `ControlServer` WebSocket + `pkctl` (`status` / `log` / `config`).
4. SPA hook, volume wiring, `STREAM_MUSIC` pin.
5. Tune step size and curve by ear.

---

## Risks

**A — framework swallows the key during doze.** Retired by Milestone 1 running first. Fallback is
an SPA-rendered black overlay instead of true backlight off, which changes the design materially.
Know this on day one.

**B — ADB persistence.** `devices.yml` records "No ADB fallback configured" for portal. ADB-over-
WiFi worked on 2026-07-20, but **survival across reboot is unverified**, and `CLAUDE.md` warns it
often fails on the piano tablet. This matters more than it appears: re-enabling a dropped
accessibility grant *requires* ADB and the app cannot self-heal. If ADB doesn't persist, one
reboot could mean physically touching Settings.

**C — FKB consumes volume keys first.** Unproven against FKB kiosk mode specifically.

**D — accessibility grant dropped** by OS update. Mitigated by `pkctl status` surfacing bound
state.

---

## Out of scope

This design does **not** address the V8 JS-heap OOM crash loop observed on this panel on
2026-07-20 (renderer OOM → `MyWebViewClient: Restarting app`, ~every 8 min under evening use).
That remains undiagnosed and is expected to recur. Tracked separately.

---

## Postmortem (2026-07-21)

### What the milestone ordering bought

Milestone 1 was a throwaway spike whose only job was to test the load-bearing assumption before
anything was built on it. That was correct and it paid: the camera button turned out to be
unreachable, so every line of WebSocket / pkctl / SPA code would otherwise have been written
against a trigger that cannot exist.

Two of my own bugs also surfaced only on real hardware:

- `NetworkOnMainThreadException` — the WebSocket send ran inline on the accessibility service's
  main thread. I had carefully moved the FKB HTTP call to a worker and missed the socket write
  three lines away. Crashed the process on the very first button press.
- A latent `ConcurrentModificationException` — iterating a `WeakHashMap`-backed set whose entries
  GC can clear mid-iteration. Would have been an intermittent crash on a key press.

Neither is reachable by unit tests; both needed the device.

### What I got wrong

**`keepawake` should have come first.** The Portal drops WiFi when the display sleeps, so the
first successful sleep took the panel off the network — no FKB REST, no pkctl, no ADB — and ended
the session's ability to verify anything. The `keepawake` command was already in `fkb.cli.mjs`,
and the missing recovery settings had been noticed hours earlier while investigating the OOM.
They were filed as a separate cleanup item rather than recognised as a prerequisite of the very
feature being built.

Correct order, now documented in the README:

1. `fkb.cli.mjs keepawake` (wake locks so sleep can't strand the panel)
2. `pkctl config set screenToggleEnabled true` (only once the wake path is proven)

The general lesson: when a feature's failure mode is "the device becomes unreachable", the
recovery path has to be in place *before* the feature is switched on, not after.

### Inference vs. measurement

`getevent` showed `KEY_MUTE` emitting at the kernel layer, including during doze. That was
correctly labelled at the time as necessary-but-not-sufficient — kernel emission says nothing
about framework delivery. That caveat turned out to be the whole story: the key emits and is
never delivered. The habit of labelling measured-vs-inferred is what kept this from becoming a
false "verified" claim in the design doc.
