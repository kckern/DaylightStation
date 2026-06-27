# Emulator field feedback: GBA LCD alignment, kiosk cursor, BT controller UX

**Date:** 2026-06-27
**Status:** Design (approved) → implementation pending

Field feedback covering four issues in the EmulatorJS console (`frontend/src/modules/Emulator/`)
and its fitness widget (`frontend/src/modules/Fitness/widgets/EmulatorGame/`).

## Summary of issues

| # | Issue | Root cause | Size |
|---|-------|-----------|------|
| 1 | GBA dot-matrix grid misaligned | Screen-box math hardcodes GB's 160×144; GBA is 240×160 | Small (config) |
| 2 | Mouse cursor visible over bezel in kiosk | Emulator `createPortal`'d to `document.body`, escaping `.fitness-app-container.kiosk-ui { cursor:none }` | Tiny |
| 3a | No controller-connected indicator in game menu | `ControllerStatus` only renders in-game behind a 🎮 toggle | Small |
| 3b | No BT controller management UX | Backend pairing infra exists; needs frontend UX + a `bt.remove` path + bus relay | Medium |

---

## Part 1 — GBA LCD alignment (config-driven native resolution)

`EmulatorConsole.jsx` (lines ~218–223) hardcodes `160`/`144` when picking the largest integer
scale that fits the bezel cutout. `pixelBox` (lines 575–577) drives **both** the emulator video
window (line 612) and the shader/grid (line 617), so fixing native resolution corrects alignment
everywhere at once. The grid loop (lines 259–263) already keys off `screenBox.scale`.

**Resolution order (auto-default by core, explicit override wins):**

```
native = game.native ?? system.native ?? CORE_NATIVE[core] ?? { width:160, height:144 }
```

`CORE_NATIVE`: `gba`/`mgba` → 240×160; `gb`/`gbc`/`gambatte` → 160×144.

Mario Super Circuit already lives in the `gb` system with `core: gba`, so just having `core: gba`
auto-yields 240×160 — no manifest edit required. An explicit `native:` in a manifest still wins.

**Changes:**
- `backend/src/3_applications/emulator/loadEmulatorConfig.mjs`: resolve `native` onto each game
  and expose on system config (same place `core` is resolved). Add `CORE_NATIVE` map.
- `EmulatorConsole.jsx`: replace the four `160`/`144` literals with `native.width`/`native.height`
  (fallback 160/144 if absent).

**Result:** GBA box becomes the largest integer multiple of 240×160 fitting the GB cutout, centered
(slight letterbox top/bottom: GBA 3:2 vs GB ~10:9). Grid cells land exactly on GBA pixels.

---

## Part 2 — Kiosk cursor over the bezel

Emulator is portaled to `document.body` (`EmulatorGameWidget.jsx:199`), escaping the kiosk
cursor-hide scope. Mirror the existing FitnessApp pattern on the portal wrapper.

**Changes:**
- `EmulatorGameWidget.jsx`: `className={`fitness-emulator-fullscreen ${isKioskMode() ? 'kiosk-ui' : ''}`}`
  using the existing `frontend/src/lib/kioskEnv.js` helper.
- SCSS (`EmulatorConsole.scss` or the widget's stylesheet):
  `.fitness-emulator-fullscreen.kiosk-ui, .fitness-emulator-fullscreen.kiosk-ui * { cursor: none !important; }`

---

## Part 3a — Controller indicator in the game menu

`ArcadeShell` shows nothing today. Add a compact status chip (corner of the menu):
- 🎮 green = connected (+ battery % when BlueZ reports it)
- dim/✕ = no controller

Reuses the existing `useGamepadStatus` hook (browser Gamepad API) merged with the `bt_inventory`
feed for battery/OS state.

---

## Part 3b — Controller management panel (status + pair + remove)

**Already built (fitness extension, `_extensions/fitness/src/`):**
- `btPairing.mjs`: scan → `isLikelyGamepad()` → pair → trust → connect, with `bt.pair.progress` events.
- `bt.pair.request` topic already subscribed (`server.mjs:213`).
- `btInventory.mjs`: `bt_inventory` broadcast every 3s (address/name/connected/battery).
- `ControllerStatus.jsx` already accepts `onPair` + `pairing` props and renders a pair button.

**New backend (bus relay) — `backend/src/app.mjs`:**
Add a targeted `onClientMessage` relay for BT control topics (matching the existing whitelist style,
NOT a blanket relay):
- Browser → extension: `bt.pair.request`, `bt.remove`
- Extension → browser: `bt.pair.progress`, `bt_inventory`, `bt.remove.result`

The backend bus does not relay arbitrary client-published topics today (only `source:'fitness'`,
`homeline:*`, `playback_state`), so both directions of `bt.*` are currently dropped.

**New backend (fitness extension):**
- Subscribe to `bt.remove` (add to the subscribe list in `server.mjs`).
- `handleBtRemoveRequest`: `bluetoothctl remove <MAC>`, emit `bt.remove.result`.

**New frontend:**
- Extend `FitnessContext` to subscribe to `bt_inventory` + `bt.pair.progress` + `bt.remove.result`,
  expose `btInventory`, `pairingState`, and actions `pairController()` / `forgetController(mac)`
  that publish via `wsService.send(...)`.
- A "Controllers" panel in `ArcadeShell` reusing `ControllerStatus.jsx` (status list + battery +
  Pair button with live progress) plus a Forget button per known device.

---

## Logging

Per CLAUDE.md, all new components/hooks ship with structured logging (`getLogger().child(...)`):
- Indicator/panel mount, controller connect/disconnect, pair start/progress/result, forget start/result,
  WS publish of `bt.pair.request`/`bt.remove`.

## Testing (TDD)

- Part 1: native-resolution resolution in `loadEmulatorConfig` (gba→240×160, gb→160×144, explicit
  override, per-game override); screen-box scale math given a native size.
- Part 2: portal wrapper gets `kiosk-ui` when kiosk.
- Part 3a: indicator render states (connected / battery / none).
- Part 3b: backend relay whitelist (relays bt.* topics, drops others); extension `bt.remove` handler
  (mock exec); frontend context actions publish correct messages (mock WS); panel pair/forget flows.

## Risks / notes
- GBA aspect-ratio letterbox inside the GB cutout is expected and acceptable (decision: keep GB bezel).
- Relay must be a whitelist, not generic, to avoid turning the bus into an open relay.
- Verify pairing actually reaches the garage container end-to-end (`ssh garage docker ps`) after wiring.
