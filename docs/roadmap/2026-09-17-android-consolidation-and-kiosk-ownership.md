# Android Consolidation and Kiosk Ownership

> One device app instead of three, and a path to owning the kiosk surface
> rather than renting it.

**Last Updated:** 2026-09-17
**Status:** Direction agreed, not scheduled. Fully Kiosk Browser stays for now.

---

## Decision

1. **Consolidate the Android extensions into a single configurable device app.**
   Worth doing on maintenance grounds alone, independent of everything below.
2. **Aim to replace Fully Kiosk Browser with our own kiosk surface — eventually,
   in stages, and without ripping out the FKB path.** FKB remains supported and
   remains the default until a replacement has proven itself on real hardware.
3. **Keep the phone companion as a separate app.** It has the opposite
   permission profile and a different distribution channel.

Nothing here is scheduled. It competes with onboarding, the channel, and the
subscription work, all of which come first.

---

## Current state

Three Android codebases, each with its own signing key, control plane and
release path:

| Extension | Package | Exists because |
|---|---|---|
| `audio-bridge` | `net.kckern.audiobridge` | Room audio capture to the backend |
| `portal-keys` | `net.kckern.portalkeys` | Physical key events do not reach the page through the kiosk WebView |
| `piano-bridge` | `net.kckern.pianobridge` | BLE MIDI transport, effect SysEx, kiosk supervision |

`piano-bridge`'s payload already contains roughly 2,100 lines of kiosk
supervisor:

```
KioskSettingsGuard.java   516   keeps FKB settings from drifting back
KioskWatchdog.java        459   detects and heals a dead kiosk page
Heartbeat.java            333
FkbRest.java              235   REST client for the third-party kiosk app
SystemDiagnostics.java    148
A11y.java                 140
ScreenWaker.java          138
```

`KioskSettingsGuard` exists solely to stop a third-party app from undoing our
configuration. That is overhead, not capability.

**Coupling:** 366 files reference Fully Kiosk. 199 are documentation; the real
code surface is roughly 160 files across frontend, backend, tests and
extensions. **Audit that surface before committing to a migration, not during
one.**

---

## Why move off it

Most of our Android extensions are workarounds for kiosk-host limitations:

| Symptom | Cause |
|---|---|
| Audio bridge runs as a plain started service, not a foreground service | Kiosk mode kills any activity we launch within ~28ms, so `startForeground()` always runs from a background context |
| Motion detection and acoustic screen-on must be disabled over REST on every device | Those features hold the mic and camera |
| A separate key-handling app exists at all | Physical key events do not reach the page |
| System media volume is the only remaining headroom and no code path reaches it | No API surface for it from the page |
| Hangul is composed by a JavaScript automaton | No IME works for physical keys in the WebView |
| Web MIDI SysEx is unavailable | WebView limitation |

There is also a product reason. Fully Kiosk is a paid third-party product. A
self-hosted platform whose multi-screen story starts with "buy and configure
someone else's app on every display" carries an onboarding tax we neither
control nor can fix — see
[Business Model](../marketing/business-model.md) on the onboarding cliff.

**Counterweight:** a new user's first fifteen minutes happen in a laptop
browser, not on a wall-mounted tablet. The FKB dependency sits on the *second*
screen. It is not on the critical path for first-run experience, which is
precisely why it must not jump the queue.

---

## Replacement surface

Every FKB command currently used in the tree, and what replaces it:

| Command | Replacement |
|---|---|
| `loadURL`, `loadStartURL` | `WebView.loadUrl()` |
| `screenOn` | `PowerManager` / `KeyguardManager` — `ScreenWaker` already implements this |
| `startApplication` | `PackageManager` launch intent |
| `setAudioVolume` | `AudioManager` — reaches the stream nothing currently can |
| `getDeviceInfo`, `listSettings` | Our own status surface; `SystemDiagnostics` already exists |
| `setBooleanSetting` | Moot — those settings exist only to disable features we never wanted |
| `rebootDevice` | Requires Device Owner |

Nine commands. The REST surface is not the hard part.

### What is hard

**The WebView host.** Error-page recovery, certificate handling, cookie and
service-worker behavior, downloads, printing, and `onPermissionRequest` for
`getUserMedia` — which video calling depends on. FKB's real value is years of
hardening against OEM quirks. Taking that in-house means owning Android version
churn across every device class we run, permanently.

**Android TV.** The TV device runs FKB's TV activity. Leanback handling and a
different input model make it a different port. It migrates last, not first.

### What makes it worth it: Device Owner

Provisioning our app as Device Owner (`dpm set-device-owner`, which requires a
device with no accounts and therefore a factory reset — a real but one-time
cost per device) grants capabilities FKB itself cannot have:

- **Lock task mode** — true kiosk containment instead of overlay and
  accessibility tricks
- **`setPermissionGrantState`** — auto-grant mic and camera, ending the
  foreground-service mic problem permanently
- **Status bar disable, default launcher, silent self-update**
- **`setMediaPlaybackRequiresUserGesture(false)`** — removes an entire class of
  autoplay defect

The goal is not to reimplement FKB. It is to stop working around the platform
and own the device instead.

---

## Staging

| Phase | Work | Risk |
|---|---|---|
| **1. Consolidate** | One app, feature modules selected by config, one control plane, one signing key. Continues to drive FKB over `FkbRest`. | None — pure maintenance win |
| **2. Prove a WebView surface** | Add our own WebView activity behind config. Run it on one low-stakes display while every other device stays on FKB. | Contained to one screen |
| **3. Device Owner** | Provision that one device. Lock task, permission grants, volume, autoplay, keys. | Factory reset on one device |
| **4. Migrate** | Device by device, TV last. Keep the FKB adapter as a supported alternative. | Reversible per device |

`FullyKioskContentAdapter` already provides the seam: a `DaylightKioskAdapter`
behind the same port means the backend barely notices the change.

Each phase must pay for itself on its own. Writing a kiosk browser is a project
capable of consuming a year; this is only worth doing as a series of small bets.

---

## Distribution constraints (why the companion app is separate)

The union of the three manifests cannot ship on Google Play:

| Permission / behavior | Status on Play |
|---|---|
| `WRITE_SECURE_SETTINGS`, `READ_LOGS`, `DUMP` | `signature\|privileged` — grantable only over ADB. A Play install can never activate them. |
| `REQUEST_INSTALL_PACKAGES` | Restricted to apps whose core purpose is installing apps |
| `QUERY_ALL_PACKAGES` | Restricted; requires declaration and an approved use case |
| Hot-swappable payload `.jar` | Play prohibits downloading and executing code from outside Play. This is categorical. |
| `targetSdk` 28–33 | Below the current submission floor; needs raising, then raising annually forever |

Therefore two products, permanently:

- **Device app** — privileged permissions, payload hot-swap, ADB-assisted
  setup. Distributed as a direct APK and via F-Droid. Free and open source.
  Never on Play, and does not need to be: everyone installing it already has an
  ADB shell open on dedicated hardware.
- **Phone companion** — a separate, clean app: internet, notifications, camera
  for QR pairing. Notifications, quick logging, remote control, PWA
  replacement. Ships on Play without difficulty. **Must not use the payload
  mechanism.**

Android Auto is covered separately in
[Android Auto Support](2026-09-17-android-auto-media-support.md). Note that its
sideload exemption covers media and messaging but **not** Car App Library
categories, which is why IoT templates depend on the companion being listed.

---

## Non-goals

- Reimplementing Fully Kiosk feature-for-feature. We need nine commands and a
  hardened WebView, not motion detection or a PDF viewer.
- Removing the FKB code path. It stays supported.
- Doing any of this before onboarding, the channel and the subscription work.

---

## Open questions

1. What exactly is in the ~160 code files touching FKB? The audit is a
   prerequisite for phase 2, not part of it.
2. Does Device Owner provisioning survive OEM update channels on the tablets we
   run, or does an OS update drop it?
3. Is the TV device worth migrating at all, or does FKB remain the permanent
   answer there?
4. Does the consolidated device app keep per-role feature modules at build time
   or at runtime? Runtime is friendlier to a single published APK; build time
   keeps privileged permissions off devices that do not need them.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-17 | Initial direction: consolidate the three device apps, stage a move to an in-house kiosk surface, keep FKB supported, split the phone companion into its own Play-eligible app |
