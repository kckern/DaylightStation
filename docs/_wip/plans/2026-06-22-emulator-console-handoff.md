# Emulator Console — Handoff

**Date:** 2026-06-22
**Branch merged to main:** `feature/emulator-console`
**Status:** Engine + backend complete and tested in isolation. **NOT yet assembled into the running UI.** Backend API is live; frontend modules are built but unwired (dead code, not in the bundle).

**Design:** `docs/plans/2026-06-22-emulator-console-design.md`
**Plan:** `docs/plans/2026-06-22-emulator-console-implementation.md`
**Spike findings:** `docs/_wip/2026-06-22-emulator-spike-findings.md`
**Memory:** `project_emulator_console` (in agent memory)

---

## What this is

A governance-gated game-console emulator (EmulatorJS / gambatte GB core) for the Fitness app: you must keep exercising to keep playing. Controlled by a Bluetooth gamepad (native Gamepad API) or keyboard. Plus a config-driven **memory-watch** system that detects in-game states (e.g. "in a Pokémon battle") from console RAM and fires actions (governance changes, music/chimes, animations, Home Assistant scenes). Decoupled `<EmulatorConsole>` so it can be hosted outside FitnessApp.

---

## What is LIVE after this push

- **Backend API** mounted at `/api/v1/emulator` (additive, graceful — empty catalog if no seed). Verified end-to-end against the real seed:
  - `GET /library[?user=]` → catalog (systems, games w/ resolved governance + URLs, `input` config)
  - `GET /rom/:system/:gameId`, `GET /art/:system/:gameId/:kind(cover|bezel)`
  - `GET|PUT /save/:system/:gameId?user=`, `GET|PUT /state/:system/:gameId/:slot?user=`
  - `GET /engine/*` — serves the vendored EmulatorJS bundle (EJS_pathtodata target), typed by extension
- **Seed media** (on the Dropbox media mount → syncs to prod): `media/emulation/gb/` (Pokémon Red ROM/save/cover/bezel + `gameboy.yml` manifest with the semantic state map), `media/emulation/_engine/` (vendored ~1.7 MB GB EmulatorJS bundle), `media/emulation/input.yml` (keyboard + controllers).

## What is BUILT but NOT WIRED (no UI entry point yet)

All under `frontend/src/modules/Emulator/` (host-agnostic — zero FitnessContext coupling) and `_extensions/fitness/`:
- **EmulatorConsole.jsx** (React) — governed mount + overlay + audio; not rendered anywhere yet.
- Engine: `loadEmulatorJS`, `EmulatorEngine`, `EmulatorSession` (boot→calibrate→state→bindings→governance).
- Memory-watch: `WramCalibrator`, `MemoryProbe`, `StateMap`, `BindingMatcher`, `memoryPredicates`, `addressMap`, `memoryRead`, `HookDispatcher`.
- Governance adapters: `GovernanceGate` (open/gate/credit).
- Audio: `AudioMixer` (3-bus + duck), `AudioFx` (EQ/reverb/filter/compressor), `htmlAudioClip`.
- Input: `buildEjsControls`, `useGamepadStatus`, `ControllerStatus`.
- Bridge: `_extensions/fitness/src/btInventory.mjs` + `server.mjs` wiring (BlueZ `bt_inventory` WS feed) — **deploys to the garage box separately, NOT via the main prod deploy.**

**259 tests** (194 frontend + 65 backend), all green.

---

## Spike outcomes (the de-risked unknowns — don't re-investigate)

1. **Build-free RAM reads work.** EmulatorJS cores don't export `retro_get_memory_data`, but `Module.HEAPU8` is exposed. One-time boot calibration writes a unique signature into WRAM via the cheat API (GB GameShark `01DDAAAA`, **little-endian addr, UPPERCASE code** — lowercase is silently ignored), scans HEAPU8 for it → WRAM base. Then all reads are direct `HEAPU8[base + (addr-0xC000)]`. Re-fetch HEAPU8 each read (memory.grow swaps the view). **No custom core build needed.**
2. **Audio FX bus works.** EmulatorJS audio = emscripten OpenAL at `Module.AL.currentCtx.audioCtx` + `sources[].gain`. We splice a Web Audio FX chain between the source gains and destination.
3. **Per-channel audio control: NOT feasible** on stock gambatte (APU IO registers aren't locatable in the heap — GameShark can't reach `0xFF00+`). Use the external 3-bus mixer instead. (Ruled out after prototyping.)
4. **Controller identity:** the browser Gamepad API exposes only slot index + model id (no MAC/UUID). Hybrid solution: native Gamepad API for **input** (zero latency); the garage bridge's **BlueZ feed** (`bt_inventory` over WS) supplies real MAC/connected/battery for the troubleshooting UI. Two identical-model pads still can't be told apart by the browser — handled via model-count + per-slot press-to-identify.
5. **Self-hosting works** — EmulatorJS `data/` bundle served from our `/engine/*` route, `EJS_pathtodata` points at it, `EJS_threads=false` (no COOP/COEP), `EJS_DEBUG_XX` must stay OFF.

---

## REMAINING WORK to make it playable (the "assembly" phase)

In rough order:

1. **Wire input → controls in EmulatorConsole:** fetch `/library`, read `input.keyboard`, call `buildEjsControls()`, pass `controls` into `loadEmulatorJS`/`EmulatorSession`/`EmulatorEngine.boot`. Wire `AudioFx` into the session (create it after boot from `engine`'s AudioContext tap; add an `audio_fx` binding action that calls `fx.apply()`).
2. **Live standalone boot (decoupling proof):** render `<EmulatorConsole>` with `createOpenGate()` on a dev route; boot Pokémon Red headed; verify governance overlay, audio, and the `$D057` battle hook firing. (Harness `tests/_scratch/emulator-spike/` already proves the raw mechanics.)
3. **Fitness host binding — `EmulatorGameWidget`** (`frontend/src/modules/Fitness/widgets/EmulatorGame/`): build the `governanceGate` from `FitnessContext` (`gate` ← `governanceState.phase`; `credit` ← `getUserVitals` zone accumulator); `identity` from `IdentityProvider`; `resolveMediaUrl` = `DaylightMediaPath`; action handlers (`haScene` → HA adapter, `governance` → live gate update, `toast` → fitness toast); subscribe the `bt_inventory` WS topic in `FitnessContext` and pass `btInventory` down to `ControllerStatus`. Register `fitness:emulator` in `frontend/src/modules/Fitness/index.js`.
4. **Library browser** (`EmulatorLibrary.jsx`) + the **gamepad-capture seam**: while a game runs, set `window.__emulatorCapturingGamepad = true` and add a guard at the top of `GamepadAdapter._pollGamepad()` (`if (window.__emulatorCapturingGamepad) { this._invalidateAllSeeds(); this._lastPollAt = now; return; }`) so the menu adapter doesn't fight EmulatorJS input. Mount `ControllerStatus` in the library/a debug panel.
5. **Dot-matrix shader + JSX bezel** (Phase 7): EmulatorJS has NO LCD shader built-in (only 6 CRT/scale) and NO bezel — both are ours. Add a custom GLSL dot-matrix shader to the self-hosted `_engine/` (data/src/shaders.js is editable) or a WebGL pass; render `bezel.png` as a JSX chrome layer. Tune to match the RetroArch `gameboy-color-dot-matrix` intent recorded in `gameboy.yml`'s `retroarch_reference`.
6. **Nav + config:** add a `module_direct` (or `screen`) nav entry targeting `emulator` in `fitness.yml`; add `emulator` to the `unifyKeys` list in `FitnessApp.jsx` if the frontend needs to read it.
7. **Playwright live test:** `tests/live/flow/fitness/emulator-governance.runtime.test.mjs` — library → launch → governance overlay → drop zone → assert pause via `window.__fitnessGovernance.phase` (engine SSoT, not just overlay).

---

## Deploy notes

- **Backend (this push):** live on container restart. Reads `getMediaDir()/emulation`. Safe if absent (empty catalog).
- **Garage bridge (`_extensions/fitness`):** the `bt_inventory` feed only activates when the bridge is rebuilt/redeployed on the garage box (build-on-garage). It shells out to `bluetoothctl` every 3s; harmless if `bluetoothctl` is absent (returns `[]`). Not deployed by the main prod push.
- **input.yml controller addresses** are placeholders — replace with real MACs via `bluetoothctl devices Connected` on the garage box for the OS-identity badges to match.

## Key files index

| Concern | Path |
|---------|------|
| Backend router | `backend/src/4_api/v1/routers/emulator.mjs` |
| Config loader + catalog | `backend/src/3_applications/emulator/{loadEmulatorConfig,EmulatorCatalog}.mjs` |
| FS resolvers | `backend/src/4_api/v1/routers/lib/emulatorFs.mjs` |
| App mount | `backend/src/app.mjs` (search `v1Routers.emulator`) + `api.mjs` routeMap |
| Frontend engine | `frontend/src/modules/Emulator/core/` |
| Audio | `frontend/src/modules/Emulator/audio/` |
| Input | `frontend/src/modules/Emulator/input/` |
| React component | `frontend/src/modules/Emulator/EmulatorConsole.jsx` |
| Bridge BT feed | `_extensions/fitness/src/btInventory.mjs` |
| Seed manifest | `media/emulation/gb/gameboy.yml` (semantic state map + bindings) |
| Spike harness (scratch, gitignored) | `tests/_scratch/emulator-spike/` |
