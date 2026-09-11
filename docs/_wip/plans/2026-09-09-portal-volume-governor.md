# Portal volume governor — a hardware cap with a time-boxed override

**Date:** 2026-09-09
**Branch:** `device/portal-volume-governor` (based on the homeserver deploy tree, not origin/main)

## The problem, as measured

Casting to the Portal works; adjusting the volume does nothing. Every software
layer is already saturated:

| Layer | Value at time of report |
|---|---|
| `<video>.volume` | 1.0 |
| SPA master (`localStorage['screen-volume-portal']`) | 1.0 (config default is 0.6) |
| Session volume | 100 (never set — no PUT was ever issued) |
| **Android `STREAM_MUSIC`** | **10 / 18** |

`portal` has no volume *capability*: `devices.yml` gives it only
`content_control` (fully-kiosk), so `Device#determineVolumeProvider()` returns
null and `GET /api/v1/device/portal/volume/:level` 400s. The only unsaturated
layer is the one nothing can reach.

### Two facts that constrain the design

1. **FKB is already the de-facto governor and it re-asserts.** `dumpsys audio`
   shows `de.ozerov.fully` writing every stream to index 10 in a burst at
   16:34:45–47 — exactly when the cast started playing. Anything that sets
   `STREAM_MUSIC` from outside FKB is overwritten on the next media start.
   Setting *through* FKB's own `setAudioVolume` updates the value FKB re-asserts,
   so FKB stops being an adversary and becomes the enforcement mechanism.
2. **The APK cannot write volume via its shell.** `media volume --set` returns
   `SecurityException … uid 10086 not allowed to perform AUDIO_MEDIA_VOLUME`.
   (Caveat: that test ran `com.android.commands.media` under our UID, so the
   app-op check saw a mismatched (uid, package) pair — it does **not** prove an
   in-process `AudioManager.setStreamVolume()` would fail. Unverified; `appops
   get` needs `INTERACT_ACROSS_USERS` and `dumpsys package` needs
   `PACKAGE_USAGE_STATS`, both denied.) Irrelevant either way: FKB REST works,
   verified live (`{"statustext":"Audio volume set to 56% for stream 3","status":"OK"}`).

## Shape

The backend owns policy; FKB actuates. `stream 3` is `STREAM_MUSIC`; its range is
**0..18**, so a 0–100 API is lossy (FKB rounds down: 55% → index 9, 56% → 10).
The API stays 0–100 for consistency with the existing route and reports the
index it actually landed on.

```
devices.yml portal.volume:
  provider: fully-kiosk
  stream: 3
  cap: 55         # normal ceiling — kids cannot exceed this
  boost_max: 85   # the highest a boost is ever allowed to reach
```

Two clamps, deliberately layered so no route can bypass the outer one:

- **`Device.setVolume()` clamps to `boost_max`.** Absolute. Applies to every
  caller, present and future, including anything that bypasses the fleet service.
- **`DeviceFleetControlService.volume()` clamps to `cap`**, or to the live boost
  ceiling while a boost window is open.

Boost windows live in `VolumeBoostService`, a `Map<deviceId,{ceiling,until}>` with
an injected clock — the same shape as the existing `ScreenOverrideService`.
Expiry re-applies the cap through an injected scheduler, so "auto-reverts" is
real rather than lazy.

## Work

**New**
- `3_applications/devices/ports/IVolumeControl.mjs` — port
- `1_adapters/devices/FullyKioskVolumeAdapter.mjs` (+ test) — `cmd=setAudioVolume`
- `3_applications/devices/services/VolumeBoostService.mjs` (+ test)
- `5_composition/modules/volumeBoost.mjs` — singleton

**Changed**
- `ConfigDeviceBlueprintFactory` — build volume control from `source.volume`; carry `cap`/`boostMax` on the descriptor
- `Device` — `volumeControl` capability, `'explicit'` provider, hard clamp, `getVolume()`
- `DeviceFleetControlService.volume()` — cap/boost clamp; move the deprecation warn *after* the capability check
- `4_api/v1/routers/device.mjs` — `GET /:id/volume` (read), `POST /:id/volume/boost`
- `bootstrap.mjs`, `deviceApi.mjs` — wiring
- `devices.yml` — the `portal.volume` block

## Observability, fixed in the same pass

The volume adjustment that prompted this left **zero** server-side trace. Four gaps:

1. `usePortalKeys` logs `key-received` at `debug`; prod ships `info`, so every
   physical press is invisible. `pkctl status` showed `keysSeen: 72` against zero
   events in the store. → raise to `info`.
2. `ScreenVolumeProvider` logs nothing on master change. → emit on change.
3. `SessionControlService.config()` has no success logging. → emit.
4. `DeviceFleetControlService.volume()` logs `device.volume.deprecated` *before*
   the capability check, so an unsupported device emits a deprecation warning and
   then nothing — which reads as "the volume was set (via a legacy route)" when
   in fact nothing happened. → move it after.

## Out of scope

- FKB's own `volumeLimits` / `volumeLevels` settings (both empty). A true
  below-everything cap, but the format is undocumented here and
  `volumeLicenseKey` is empty — unknown whether they work unlicensed. Worth
  settling separately; it would make the cap survive the backend being down.
- Repointing the physical keys at hardware volume within `[0, cap]`. Right now
  `consumeVolume=true` sends them only to the saturated SPA master. Worth doing
  once the governor exists, but it changes the feel of the panel and should be
  its own decision.
