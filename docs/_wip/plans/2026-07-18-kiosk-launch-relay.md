# Kiosk Launch Relay — Admin → PianoKiosk

**Date:** 2026-07-18
**Goal:** Let a parent launch a specific RetroArch title on the piano tablet from
`/admin/content/games`, since the PianoKiosk UI offers no way to do it.

**Companion doc:** `Piano/docs/plans/2026-07-18-piano-retroarch-design.md` (the device-side
work — APK, cores, ROMs, FKB whitelists). **This design is inert until that doc's Phases 1–3
land.** The relay can be built and tested independently, but nothing will launch until
RetroArch actually exists on the tablet.

## Why not the obvious approaches

| Approach | Why not |
|----------|---------|
| Backend ADB launch (`AdbLauncher`) | The tablet has no `content_control.fallback.provider: adb`, and ADB-over-WiFi dies on every reboot and can't be made persistent without root. |
| Backend → FKB REST `startIntent` | Works, but needs the FKB password server-side and a new launcher adapter. Unnecessary — the tablet's own SPA is already running with the `fully` object in scope. |
| FKB `startApplication` | Cannot pass intent extras, so it opens RetroArch's menu rather than a title. |

The SPA-in-the-WebView already has the proven in-page path: `frontend/src/lib/fkb.js:112`
`launchIntent(pkg, activity, extras)` builds `intent:#Intent;component=…;S.KEY=val;end` and
calls `fully.startIntent(uri)`. Its own comment names RetroArch ROM/LIBRETRO/CONFIGFILE as the
motivating case. We only need to tell the kiosk *when* to call it.

## Message flow

```
Admin (browser)                backend eventbus              PianoKiosk (tablet WebView)
      │                              │                              │
      │  {topic:'kiosk.launch',      │                              │
      │   deviceId, contentId}       │                              │
      ├─────────────────────────────►│  whitelist relay             │
      │                              ├─────────────────────────────►│
      │                              │                              │ deviceId === KIOSK_DEVICE_ID?
      │                              │   GET /api/v1/launch/intent/{contentId}
      │                              │◄─────────────────────────────┤
      │                              │   {target, params}           │
      │                              ├─────────────────────────────►│
      │                              │                              │ launchIntent(...) → RetroArch
```

The message carries **no ROM path, core path, or package name** — only "this device, this
game." Paths are resolved on the tablet from the existing intent endpoint, so nothing
device-specific travels over the bus and `RetroArchAdapter` is untouched.

## Components

### 1. `backend/src/0_system/eventbus/kioskLaunchRelay.mjs` (new)

A direct mirror of the sibling `btRelay.mjs`: an explicit topic `Set` plus a
`shouldRelayKioskTopic(topic)` predicate. Relayed topics:

- `kiosk.launch` — admin → kiosk
- `kiosk.launch.result` — kiosk → admin (success/failure feedback)

Hooked in beside the bt relay in `app.mjs` (~`:518-525`). Whitelist only, never a blanket
relay — same reasoning as the comment already in `btRelay.mjs`.

### 2. `frontend/src/modules/Piano/PianoKiosk/useKioskLaunchCommand.js` (new)

```js
useWebSocketSubscription('kiosk.launch', async (msg) => {
  if (msg.deviceId !== KIOSK_DEVICE_ID) return;   // precedent: PianoApp.jsx:209
  const { target, params } = await fetchIntent(msg.contentId);
  const [pkg, activity] = target.split('/');
  launchIntent(pkg, activity, params);
});
```

- Device guard reuses `KIOSK_DEVICE_ID` from `kioskDeviceIdentity.js:42`, matching the
  `isThisDevice` gate already in `PianoApp.jsx:209`. Without it every kiosk on the bus would
  launch, since `WebSocketEventBus` delivers to wildcard subscribers and client-side filtering
  is the actual guardrail (see the comment at `WebSocketEventBus.mjs:353-364`).
- Publishes `kiosk.launch.result` so the parent gets feedback instead of a silent no-op.
- Logs via the structured logger at subscribe, guard-reject, intent-resolved, and launch.

### 3. `frontend/src/modules/Admin/Games/ConsoleDetail.jsx` (modified)

Cards are read-only today (`:26-35`). Add a per-game launch affordance plus a target-device
picker, publishing through `useWebSocketSend()` (`frontend/src/hooks/useWebSocket.js:73`).
Surface the `kiosk.launch.result` outcome — a launch that silently does nothing is the worst
outcome for a parent standing in another room.

## The availability guard

`/admin/content/games` lists the Shield's full catalog, synced from the device carrying the
`file_server` block. Only three GB titles will exist on the tablet.

**Decision: an explicit per-device allowlist in `games.yml`**, not a discovered filesystem
fact. The three titles were chosen deliberately — the companion doc's *one-game-one-device
rule* excludes Pokémon Red, Pokémon Crystal, and Wario Land because they carry live saves on
the Shield and there is no save-sync mechanism. That reasoning is a curation decision, so it
belongs in config where it can be read and audited, not inferred from what happens to be on
disk.

```yaml
# games.yml
launch:
  device_targets:
    yellow-room-tablet:
      package: com.retroarch.aarch64      # per-device; see ABI open item
      activity: com.retroarch.browser.retroactivity.RetroActivityFuture
      allow:
        - retroarch:gb/super-mario-land
        - retroarch:gb/super-mario-land-2
        - retroarch:gb/pokemon-yellow
```

Admin hides non-allowed titles for that target; the kiosk hook re-checks on receipt, so the
rule holds even if a stale admin tab is open. Enforced in the UI rather than left to a parent
remembering which saves live where.

## Must-fix bug found during design

`fkb.js:120` interpolates extras with no encoding:

```js
uri += `S.${key}=${value};`;
```

Android's `Intent.parseUri` expects URL-encoded values, and **all three chosen ROMs have
spaces and brackets** — e.g. `Super Mario Land (JUE) (V1.1) [!].gb`, `Pokemon - Yellow Version
(USA, Europe).gbc`. A `;` in a path would terminate the field and inject intent structure.
Encode values and reject separator characters, mirroring the `#validateIntentParam` guard
`AdbLauncher.mjs` already applies on the shell side.

This will bite on the first launch attempt regardless of the relay work.

## Testing

| Unit | Assertion |
|------|-----------|
| `kioskLaunchRelay` | whitelisted topics relay; everything else rejected |
| `useKioskLaunchCommand` | ignores messages for another `deviceId`; resolves intent; calls `launchIntent` with the resolved params; publishes a result |
| allowlist guard | a `contentId` outside the device's `allow` list is refused on receipt |
| `fkb.js` encoding | a ROM path with spaces/brackets round-trips; one with `;` is rejected |
| Admin | publishes a well-formed message; renders the result |

## Open items

- [ ] **Resolve the ABI contradiction before Phase 1.** `Piano/README.md` records
      `armeabi-v7a — 32-bit primary`; the companion design doc header says `arm64-v8a`. If the
      primary really is 32-bit, the Shield's `com.retroarch.aarch64` APK will not install.
      Check `adb shell getprop ro.product.cpu.abilist` during the USB session — cheapest
      possible check, and it gates the whole phase.
- [ ] Confirm the tablet's registry id matches the `deviceId` the kiosk SPA is loaded with
      (`?device=` → `localStorage['piano.kioskDeviceId']`), or the guard silently drops
      every command.
- [ ] Decide whether a launch should blank/park the piano SPA, since RetroArch takes the
      foreground and the SPA keeps running behind it.
