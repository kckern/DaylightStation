# Emulator Console — Design

**Date:** 2026-06-22
**Status:** Design approved (pre-implementation)
**Topic:** Governed game-console emulation widget for the Fitness app (and beyond)

---

## Goal

A game-console emulator (starting with Game Boy / Game Boy Color, extensible to
GBA/NES/SNES/…) that is **subject to the fitness governance engine** — you must
keep exercising to keep playing — controlled by a **Bluetooth gamepad on the
frontend** (Gamepad API, no WebSocket relay). External emulator dependencies are
**lazy-loaded** so the heavy WASM never sits in the initial bundle. Cores, ROMs,
saves, and states live in their own folders on the media data mount. The player
component is **decoupled from FitnessApp** so it could be hosted elsewhere with
minimal headache.

### Decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Emulator foundation | **EmulatorJS** (libretro/WASM) — multi-console, built-in shaders, gamepad, save/state files |
| Governance binding | **Config-driven, dual mode**: `gate` (effort gates play) **and** `credit` (effort = play-time currency), selectable per game/user |
| Save scope | **Per-user** (keyed by active fitness player) |
| Launch flow | **Native ROM library browser** (gamepad-navigable, DaylightStation-styled) |
| Config home | **New `apps/emulator/config.yml`** + per-game manifests, referenced by `fitness.yml` |
| Reuse | **Design principle** — decoupled `<EmulatorConsole>` with injected adapters; no second host built yet (YAGNI) |
| In-game state hooks | **Build the framework now** (RAM memory-watch), hand-author per-game maps as needed |

---

## 1. Architecture & the decoupling seam

The heart is a **self-contained `<EmulatorConsole>`** that knows nothing about
fitness. Everything fitness-specific is injected.

```
frontend/src/modules/Emulator/              ← host-agnostic, NOT under Fitness/
  EmulatorConsole.jsx        ← the governed player (canvas + lifecycle)
  EmulatorLibrary.jsx        ← native console→game browser (gamepad-navigable)
  core/
    loadEmulatorJS.js        ← lazy loader (dynamic import + WASM boot)
    GamepadCapture.js        ← exclusive pad capture while playing
    MemoryProbe.js           ← RAM watcher (in-game state hooks)
    HookDispatcher.js        ← maps state-change events → actions
  shaders/                   ← shader registry (WebGL passes)
  adapters/
    GovernanceGate.js        ← INTERFACE: { mode, isPlayable(), getStatus(), onChange() }
    IdentityAdapter.js       ← INTERFACE: { getActivePlayerId() }
  EmulatorConsole.scss

frontend/src/modules/Fitness/widgets/EmulatorGame/   ← thin Fitness binding
  EmulatorGameWidget.jsx     ← wraps <EmulatorConsole>, supplies the two adapters
  index.js                   ← manifest { id:'emulator', name, icon }
```

**The seam:** `<EmulatorConsole>` takes a `governanceGate` prop (an object
implementing the `GovernanceGate` interface) and an `identity` prop. The Fitness
widget builds those from `useFitnessContext()` (governance phase,
`setGovernanceSuspended`, `getUserVitals`) and `IdentityProvider`. A future
non-fitness host passes a **null/always-open gate** and a static identity — the
console runs ungoverned with zero code changes.

`EmulatorConsole` never imports `useFitnessContext`. The dependency arrow points
one way: **Fitness → Emulator, never back.** That is what makes "reusable outside
FitnessApp" true rather than aspirational.

---

## 2. The GovernanceGate adapter (dual-mode mechanic)

The interface is deliberately tiny — the emulator core only asks one question per
frame: *may I run right now?*

```js
// adapters/GovernanceGate.js  (interface contract)
{
  mode: 'gate' | 'credit' | 'open',   // resolved from per-game/user config
  isPlayable(): boolean,              // emulator polls this each rAF tick
  getStatus(): {                      // for the overlay UI
    state: 'playing'|'warning'|'paused'|'depleted',
    creditSeconds?: number,           // credit mode: banked time remaining
    graceMsLeft?: number              // gate mode: countdown before pause
  },
  onChange(cb): unsubscribe           // pushes status transitions
}
```

**Fitness binding** (in `EmulatorGameWidget`):

- **`gate` mode** maps straight onto the existing engine. Read
  `governanceState.phase`; `isPlayable()` returns `phase === 'unlocked'`. On
  `warning` the console blurs/dims (reusing governed-video visual language); on
  `locked`/`pending` it **pauses the WASM loop**. Returning to zone resumes. We do
  **not** call `setGovernanceSuspended` — unlike CycleGame, we *want* to be
  governed.
- **`credit` mode** runs its own accumulator: watch `getUserVitals(activePlayerId)`;
  each tick spent in/above the required zone banks `creditSeconds` (configurable
  earn rate). The emulator runs while `creditSeconds > 0`, spending one second per
  second played. Hit zero → `depleted` → pause until more is earned.
- **`open` mode** = always playable (standalone / non-fitness default).

Per-game and per-user overrides (earn rate, required zone, grace) resolve from the
emulator config, merged: defaults ← game ← user.

---

## 3. Backend: serving cores/ROMs and per-user save write-back

A new router `backend/src/4_api/v1/routers/emulator.mjs` (registered in
`index.mjs`) owns everything under the data mount. All file I/O stays server-side;
the frontend never sees raw paths.

**Data layout** (under `getHouseholdAppPath('emulator', …)`):
```
data/household/apps/emulator/
  config.yml                 ← catalog + per-game/user rules (§4)
  cores/{system}/*.wasm,*.js ← EmulatorJS libretro cores (static, immutable)
  roms/{system}/{romId}.*    ← ROM binaries
  boxart/{romId}.*           ← library browser art / chrome
  saves/{userId}/{romId}.srm ← battery saves  (per-user)
  states/{userId}/{romId}/*  ← save-states    (per-user)
```

**Routes:**

| Route | Purpose |
|-------|---------|
| `GET /api/v1/emulator/library` | console→game catalog + art URLs + resolved rules for the browser |
| `GET /api/v1/emulator/core/:system/*` | stream a core file (long cache; immutable) |
| `GET /api/v1/emulator/rom/:romId` | stream a ROM binary (range-capable) |
| `GET /api/v1/emulator/save/:romId?user=` | fetch this user's `.srm` (404 → fresh game) |
| `PUT /api/v1/emulator/save/:romId?user=` | write-back battery save (debounced from client) |
| `GET/PUT /api/v1/emulator/state/:romId/:slot?user=` | save-states |

**Write-back contract:** EmulatorJS emits the SRAM buffer on a timer and on
pause/unmount. The console debounces and `PUT`s the binary body; the router
validates `user` against the household roster and writes **atomically (temp +
rename)** to dodge the macOS-mount permission gotcha. `userId` comes from the
injected `IdentityAdapter`, so a standalone host can pass a literal like `guest`.

Cores and ROMs are **served, not bundled** — nothing emulator-heavy touches the JS
bundle. The only JS that lazy-loads is the EmulatorJS loader itself (§5/§6).

---

## 4. Config schema (catalog + per-game/user rules)

The new `config.yml` is the single source of truth for catalog and rules.
`fitness.yml` only references it.

```yaml
# data/household/apps/emulator/config.yml
defaults:
  governance:
    mode: gate              # gate | credit | open
    required_zone: active   # zone id from fitness zones
    grace_seconds: 20       # gate mode: blur→pause countdown
    earn_rate: 1.0          # credit mode: sec banked per sec in-zone
    max_credit_seconds: 600
  shader: crt               # default shader id (see shaders/)
  chrome: null              # default bezel/background

systems:                    # console-level definitions
  gbc:
    core: gambatte          # EmulatorJS core name → cores/gbc/
    label: Game Boy Color

games:
  - id: pokemon-crystal
    system: gbc
    rom: pokemon-crystal.gbc
    title: Pokémon Crystal
    boxart: pokemon-crystal.png
    chrome: gbc-teal        # bezel/background for this game
    shader: lcd-grid        # override default shader
    governance:             # per-game override (deep-merged over defaults)
      mode: credit
      required_zone: warm
      earn_rate: 1.5

users:                      # per-user overlay, merged last
  soren:
    governance: { required_zone: cool }   # gentler for the kid
```

**Resolution order** (computed server-side in `/library`, so the client gets final
values): `defaults.governance` ← `game.governance` ← `users[activeUser].governance`.
The same deep-merge yields effective `shader` and `chrome` per (game, user).

**`fitness.yml`** adds only:
```yaml
emulator:
  enabled: true
  # optional household-wide policy nudges; catalog stays in emulator/config.yml
```

Unknown systems, missing ROM files, or a `credit` entry without `earn_rate` fall
back to defaults and are logged + skipped (mirrors audio-cue config tolerance).

---

## 5. Memory-watch framework (config-driven in-game state hooks)

**Why it works:** libretro cores expose `RETRO_MEMORY_SYSTEM_RAM`. Under
EmulatorJS the WASM module gives a pointer into the live RAM buffer
(`_retro_get_memory_data` / `HEAPU8`). So we can sample console RAM and watch known
addresses — exactly what RetroAchievements does. Pokémon Red's battle flag at CPU
`$D057` (0 = no battle), current map at `$D35E`, etc. are documented (datacrystal,
RA memory maps) and stable.

**The framework** (`core/MemoryProbe.js` + `core/HookDispatcher.js` + config):

```yaml
# per-game in emulator/config.yml
games:
  - id: pokemon-red
    system: gb
    watches:
      - id: in_battle
        addr: 0xD057      # CPU address; probe translates to RAM offset per-system
        size: 1
        when: { gt: 0 }   # equals | changed | gt | lt | mask
      - id: hp_low
        addr: 0xD16C
        size: 1
        when: { lt: 10 }
    hooks:                # event → action (config-driven, generic)
      - on: in_battle
        do: { governance: { required_zone: hot } }   # battles demand more effort
      - on: hp_low
        do: { cue: apps/fitness/ux/danger.mp3, chrome: red-alert }
```

**Runtime:** `MemoryProbe` samples at a configurable rate (default ~10 Hz, not every
frame — cheap), reads each watched region, evaluates predicates, and emits debounced
`state-change` events on an event bus. `HookDispatcher` maps events → actions:
`governance` (overlay the gate's `required_zone`/`mode` live), `cue`, `chrome`,
`shader`, `toast`, or structured `log`. Address→offset translation is per-system
(GB WRAM `$C000`→0, etc.), table-driven so new systems are additive.

**Scope/honesty:** the *engine* is buildable now; each game needs a hand-authored
RAM map (seed Pokémon Red as the proof). The exact EmulatorJS memory accessor is
pinned down in a spike before committing — fallback is reading the core `Module`
directly, which always works. Games with no `watches` never start the probe.

---

## 6. Input: gamepad capture & the library browser

**The conflict:** the existing `GamepadAdapter`
(`frontend/src/screen-framework/input/adapters/GamepadAdapter.js`) converts pad
presses into synthetic keyboard events for menu nav. If it stays live while a game
runs, "A" both fires the in-game button *and* triggers a menu `Enter`. We need
**mode-aware capture**.

Three input modes, owned by the Emulator module:

- **Browsing** (library grid up): the native DaylightStation adapter drives nav
  normally — d-pad moves selection, face button launches. Reuse the existing
  gamepad→key mapping; no special handling.
- **Playing** (game running): `GamepadCapture.js` takes **exclusive** control. On
  entering play it sets a flag (e.g. `window.__emulatorCapturingGamepad = true`)
  that `GamepadAdapter` checks to **suspend its keyboard synthesis**; raw pad state
  flows only to EmulatorJS input. One reserved combo (default **Select+Start**,
  configurable) breaks out → pauses and returns to the library. This flag-check is
  the single seam edit outside the Emulator module.
- **Paused/overlay** (governance warning, depleted-credit, or breakout menu):
  capture releases back to native nav so the user can choose resume/quit.

**Library browser** (`EmulatorLibrary.jsx`): a DaylightStation-styled,
gamepad-navigable grid. Top row = consoles; selecting one reveals its games with
box art and chrome. Each card shows the **resolved governance rule**
("Pokémon Crystal · credit · warm") so the player knows the deal before launching.
Built with the existing fitness-menu focus/scroll idioms (`onPointerDown`, keyboard
activation, `scrollIntoViewIfNeeded`). Catalog + art from `/api/v1/emulator/library`.

Entering the library does **not** load EmulatorJS — only picking a game triggers the
dynamic `import()` + WASM core fetch.

---

## 7. Testing & rollout

**Testing strategy** (no-skip discipline):

- **Adapter/unit (Vitest):** `GovernanceGate` resolution (deep-merge
  defaults←game←user), `credit`-mode accumulator math (earn/spend/deplete),
  `MemoryProbe` predicate evaluation (`equals/changed/gt/lt/mask`) and per-system
  address→offset translation — all pure, no WASM needed. Config loader tolerance
  (bad system, missing ROM, credit-without-earn-rate → fallback + log).
- **Backend (API):** library catalog resolution; save write-back round-trip
  (`PUT` then `GET` returns identical bytes); `user` validation against roster;
  atomic temp+rename write. ROM/core range requests.
- **Spike-gated:** the EmulatorJS memory accessor — a tiny harness that boots one
  core and asserts the RAM pointer reads a known byte. Runs first; de-risks §5.
- **Live (Playwright):** library renders from `/library`, gamepad-nav selects a
  game, governance overlay appears, and in `gate` mode the canvas pauses when zone
  drops (driven via the HR sim). Assert governance via engine SSoT, not just
  overlay visibility.

**Rollout sequence** (each step independently verifiable):

1. **Spike:** confirm EmulatorJS lazy-load + RAM accessor. Gate the whole effort on this.
2. **Backend router + config loader** (+ tests) — serve cores/ROMs/saves, resolve catalog.
3. **`<EmulatorConsole>` core**: lazy boot, governed run-loop, `open`-mode standalone first (proves decoupling).
4. **GovernanceGate Fitness binding** — `gate` then `credit` mode.
5. **Library browser** + gamepad capture seam.
6. **MemoryProbe + HookDispatcher** — seed Pokémon Red map as proof.
7. **Shaders/chrome** layer.
8. Wire `module_direct` nav entry + `fitness.yml` reference.

Steps 3 and 6 carry the "moonshot" risk; both are isolated so a failure there does
not block the playable baseline.

---

## Key file references

| Concern | Path |
|---------|------|
| Module loader / registry | `frontend/src/modules/Fitness/index.js` |
| Module container (mount point) | `frontend/src/modules/Fitness/player/FitnessModuleContainer.jsx` |
| Fitness context (governance, vitals) | `frontend/src/context/FitnessContext.jsx` |
| Governance engine | `frontend/src/hooks/fitness/GovernanceEngine.js` |
| Governance reference | `docs/reference/fitness/governance-engine.md` |
| Existing gamepad adapter (seam) | `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` |
| CycleGame (governance-driving precedent) | `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` |
| Data dir helpers | `backend/src/0_system/config/ConfigService.mjs` (`getHouseholdAppPath`) |
| Router registration | `backend/src/4_api/v1/routers/index.mjs` |
| Frontend media path helper | `frontend/src/lib/api.mjs` (`DaylightMediaPath`) |
