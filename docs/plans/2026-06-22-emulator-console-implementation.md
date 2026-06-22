# Emulator Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Use superpowers:test-driven-development for every code task.

**Goal:** Build a governance-gated game-console emulator (EmulatorJS) as a decoupled `<EmulatorConsole>` widget for the Fitness app, with per-user saves on the media mount, a native gamepad-navigable ROM browser, config-driven dual governance modes (gate/credit), and a RAM memory-watch framework for in-game state hooks.

**Architecture:** A host-agnostic `frontend/src/modules/Emulator/` package whose `<EmulatorConsole>` receives a `governanceGate` and `identity` adapter via props (never imports `useFitnessContext`). A thin `frontend/src/modules/Fitness/widgets/EmulatorGame/` widget builds those adapters from `useFitnessContext()` + `IdentityProvider` and registers into the fitness widget registry. A new backend router `emulator.mjs` serves cores/ROMs and reads/writes per-user saves/states from the media mount; config + catalog live in a new `apps/emulator/config.yml`.

**Tech Stack:** React 18, Vite, Vitest (frontend: jsdom; backend: node env via root `vitest.config.mjs`), Express + supertest, EmulatorJS (lazy-loaded WASM libretro cores), Gamepad API, js-yaml.

**Design doc:** `docs/plans/2026-06-22-emulator-console-design.md`

---

## Conventions & commands (read first)

- **Frontend unit test:** `cd frontend && npx vitest run <path-relative-to-frontend> --reporter=dot`
- **Backend unit test:** `npx vitest run <path-from-repo-root> --reporter=dot` (root has `vitest.config.mjs`)
- **Logging:** Use the framework, never raw `console.*`. Module-level lazy logger pattern (see CLAUDE.md "Module-Level Loggers"). Components: `getLogger().child({ component })` via `useMemo`.
- **Data paths (reconciled with `ConfigService.mjs`):**
  - Config (small, structured): `getHouseholdAppPath('emulator', 'config.yml')` → `data/households/apps/emulator/config.yml`
  - Binaries + saves (the "media data mount"): `getHouseholdAppMediaPath('emulator', <rel>)` → `media/apps/emulator/households/<rel>`
    - `cores/{system}/…`, `roms/{system}/…`, `boxart/…`, `saves/{user}/{rom}.srm`, `states/{user}/{rom}/{slot}.state`
- **Interactive controls:** prefer `onPointerDown` + keyboard activation (Enter/Space), per FitnessApp note.
- **Commit cadence:** commit after every green test (TDD step 5). Branch is `feature/emulator-console` in worktree `.worktrees/emulator-console`.
- **Path-safety rule (security-critical):** every `user`, `romId`, `system`, `slot` segment that reaches the filesystem MUST be validated against `^[a-z0-9_-]+$` (romId/slot may also allow `.`) and rejected otherwise. This — not roster membership — is the hard requirement that prevents path traversal.

---

## Phase 0 — Spike (de-risk; gates everything)

### Task 0.0: EmulatorJS lazy-load + RAM accessor spike

**Goal:** Confirm (a) EmulatorJS can be lazy-loaded and boot a GB core in this Vite app, and (b) we can read the live system-RAM buffer at a known address. This is the one true unknown; do it before any production code.

**Files:**
- Create: `tests/_scratch/emulator-spike.md` (findings doc — what API exposes RAM)
- Create (temporary): a throwaway route or HTML harness under `frontend/` that boots EmulatorJS against one small public-domain ROM.

**Steps:**
1. Vendor EmulatorJS: decide delivery (npm `@emulatorjs/emulatorjs` if available, else vendored `data/` loader served by the backend). Record the chosen delivery in the findings doc.
2. Boot a homebrew/public-domain GB ROM (e.g. a test ROM) via the EmulatorJS loader using a dynamic `import()`.
3. Find the RAM accessor. Try, in order, and record which works:
   - EmulatorJS public API (`EJS_emulator.gameManager.getMemoryData?` / `.getRAM?` if present)
   - Underlying core module: `Module._retro_get_memory_data(2 /* RETRO_MEMORY_SYSTEM_RAM */)` → pointer into `Module.HEAPU8`, with `Module._retro_get_memory_size(2)` for length.
4. Read one byte at a known WRAM address while the ROM runs; toggle in-game state; confirm the byte changes.
5. Write `tests/_scratch/emulator-spike.md`: chosen delivery method, the working accessor call, system-RAM base offsets per system (GB/GBC), and any gotchas. **This document is the input to Phase 1 Task 1.x core decisions and all of Phase 3 + 6.**

**Decision gate:** If no RAM accessor works, Phase 6 (memory hooks) is descoped to "framework only, disabled" and we flag it. Phases 1–5 + 7 proceed regardless.

**Commit:** `git add tests/_scratch/emulator-spike.md && git commit -m "spike: emulatorjs lazy-load + RAM accessor findings"`

> Move any throwaway harness files to `_deleteme/` (don't leave scratch in the tree).

---

## Phase 1 — Backend: config loader + router

### Task 1.1: `deepMerge` utility

**Files:**
- Create: `backend/src/3_applications/emulator/lib/deepMerge.mjs`
- Test: `backend/src/3_applications/emulator/lib/deepMerge.test.mjs`

**Step 1 — failing test:**
```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deepMerge } from './deepMerge.mjs';

describe('deepMerge', () => {
  it('overlays scalars right-over-left', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });
  it('merges nested objects, not arrays', () => {
    expect(deepMerge({ g: { mode: 'gate', zone: 'active' } }, { g: { zone: 'warm' } }))
      .toEqual({ g: { mode: 'gate', zone: 'warm' } });
  });
  it('treats arrays as replace-whole', () => {
    expect(deepMerge({ w: [1, 2] }, { w: [3] })).toEqual({ w: [3] });
  });
  it('ignores undefined right values, keeps left', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});
```
**Step 2 — run, expect FAIL:** `npx vitest run backend/src/3_applications/emulator/lib/deepMerge.test.mjs --reporter=dot`
**Step 3 — implement:**
```js
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  if (typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = (k in base) ? deepMerge(base[k], v) : v;
  }
  return out;
}
```
**Step 4 — run, expect PASS.**
**Step 5 — commit:** `feat(emulator): deepMerge config utility`

---

### Task 1.2: Governance/visual rule resolution

**Files:**
- Create: `backend/src/3_applications/emulator/EmulatorCatalog.mjs` (start with `resolveGameRules`)
- Test: `backend/src/3_applications/emulator/EmulatorCatalog.test.mjs`

**Step 1 — failing test:**
```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveGameRules } from './EmulatorCatalog.mjs';

const cfg = {
  defaults: { governance: { mode: 'gate', required_zone: 'active', grace_seconds: 20, earn_rate: 1 }, shader: 'crt', chrome: null },
  games: [{ id: 'pkmn', system: 'gbc', rom: 'p.gbc', title: 'Pokémon',
            shader: 'lcd-grid', governance: { mode: 'credit', required_zone: 'warm', earn_rate: 1.5 } }],
  users: { soren: { governance: { required_zone: 'cool' } } },
};

describe('resolveGameRules', () => {
  it('merges defaults <- game with no user', () => {
    const r = resolveGameRules(cfg, 'pkmn', null);
    expect(r.governance).toEqual({ mode: 'credit', required_zone: 'warm', grace_seconds: 20, earn_rate: 1.5 });
    expect(r.shader).toBe('lcd-grid');
  });
  it('applies per-user overlay last', () => {
    const r = resolveGameRules(cfg, 'pkmn', 'soren');
    expect(r.governance.required_zone).toBe('cool');
    expect(r.governance.mode).toBe('credit');
  });
  it('returns null for unknown game', () => {
    expect(resolveGameRules(cfg, 'nope', null)).toBeNull();
  });
});
```
**Step 2 — FAIL.**
**Step 3 — implement** `resolveGameRules(cfg, gameId, userId)`: find game by id (return null if missing); `const base = { governance: cfg.defaults.governance, shader: cfg.defaults.shader, chrome: cfg.defaults.chrome }`; merge game-level `{governance, shader, chrome}` via `deepMerge`; then if `userId && cfg.users?.[userId]`, merge that. Return resolved `{ id, system, rom, title, boxart, governance, shader, chrome, watches, hooks }`.
**Step 4 — PASS. Step 5 — commit:** `feat(emulator): resolveGameRules (defaults<-game<-user merge)`

---

### Task 1.3: `EmulatorCatalog` load + validation/tolerance

**Files:** same `EmulatorCatalog.mjs` (add `buildCatalog`), same test file.

**Behavior:** `buildCatalog(cfg)` → `{ systems, games: [resolvedDefaults...] }` for the browser. Tolerate bad entries (mirror audio-cue tolerance): drop games whose `system` isn't in `cfg.systems`, log + skip; a `credit` game missing `earn_rate` falls back to `defaults.earn_rate`. Tests assert: unknown-system game omitted; credit-without-earn-rate gets default; result lists box-art-relative path untouched (URL building happens in the router).

**TDD steps** as above. **Commit:** `feat(emulator): buildCatalog with tolerant validation`

---

### Task 1.4: Path-safety guard

**Files:**
- Create: `backend/src/4_api/v1/routers/lib/emulatorPaths.mjs`
- Test: `backend/src/4_api/v1/routers/lib/emulatorPaths.test.mjs`

**Step 1 — failing test:**
```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { safeSegment } from './emulatorPaths.mjs';

describe('safeSegment', () => {
  it('accepts slug', () => expect(safeSegment('soren')).toBe('soren'));
  it('accepts rom with dot', () => expect(safeSegment('pokemon-red.gb', { dot: true })).toBe('pokemon-red.gb'));
  it('rejects traversal', () => expect(() => safeSegment('../etc')).toThrow());
  it('rejects slashes', () => expect(() => safeSegment('a/b')).toThrow());
  it('rejects empty', () => expect(() => safeSegment('')).toThrow());
});
```
**Implement:** `safeSegment(s, { dot=false } = {})` → test against `dot ? /^[a-z0-9_.-]+$/i : /^[a-z0-9_-]+$/i` AND reject if it contains `..`; throw `Error('unsafe path segment')` otherwise; return `s`.
**Commit:** `feat(emulator): path-segment safety guard`

---

### Task 1.5: Router — `GET /library`

**Files:**
- Create: `backend/src/4_api/v1/routers/emulator.mjs`
- Test: `backend/src/4_api/v1/routers/emulator.test.mjs`

**Step 1 — failing test (supertest, injected deps — no real FS):**
```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEmulatorRouter } from './emulator.mjs';

const silent = { info(){}, warn(){}, error(){}, debug(){} };
const cfg = { defaults:{ governance:{ mode:'gate', required_zone:'active' }, shader:'crt' },
  systems:{ gbc:{ core:'gambatte', label:'Game Boy Color' } },
  games:[{ id:'pkmn', system:'gbc', rom:'p.gbc', title:'Pokémon', boxart:'pkmn.png' }] };

function appWith(overrides = {}) {
  const app = express(); app.use(express.json());
  app.use('/', createEmulatorRouter({
    logger: silent,
    loadConfig: () => cfg,
    readBinary: vi.fn(), writeBinary: vi.fn(),
    ...overrides,
  }));
  return app;
}

describe('emulator router — library', () => {
  it('returns resolved catalog with boxart URLs', async () => {
    const res = await request(appWith()).get('/library');
    expect(res.status).toBe(200);
    expect(res.body.systems.gbc.label).toBe('Game Boy Color');
    const g = res.body.games.find(x => x.id === 'pkmn');
    expect(g.governance.required_zone).toBe('active');
    expect(g.boxartUrl).toBe('/api/v1/emulator/boxart/pkmn.png');
  });
  it('accepts ?user= and applies overlay', async () => {
    const res = await request(appWith({ loadConfig: () => ({ ...cfg, users:{ soren:{ governance:{ required_zone:'cool' } } } }) }))
      .get('/library?user=soren');
    expect(res.body.games[0].governance.required_zone).toBe('cool');
  });
});
```
**Implement:** `createEmulatorRouter({ logger, loadConfig, readBinary, writeBinary, romsDir, coresDir, savesDir, statesDir, boxartDir })` returning an Express router. `GET /library` reads `loadConfig()`, calls `buildCatalog` + per-game `resolveGameRules` (with `req.query.user`), maps `boxart` → `boxartUrl` `/api/v1/emulator/boxart/<file>`, and `core`/`rom` → their URLs. Inject `loadConfig`/`readBinary`/`writeBinary` so tests never touch disk.
**Commit:** `feat(emulator): GET /library catalog endpoint`

---

### Task 1.6: Router — core/rom/boxart streaming

Add `GET /core/:system/*`, `GET /rom/:romId`, `GET /boxart/:file`. Use `safeSegment` on every segment. Delegate to injected `readBinary(absPath)` (returns `{ stream, size, contentType }` or throws 404). Set long cache headers on cores/roms (immutable). Support HTTP range on `/rom` (honor `Range` header; the injected reader returns a range-capable stream). Tests inject a fake `readBinary` and assert: 200 + bytes for known file; 404 for missing; 400 for unsafe segment; range request returns 206.
**Commit:** `feat(emulator): stream cores/roms/boxart with range + safety`

---

### Task 1.7: Router — per-user save GET/PUT (atomic)

Add `GET /save/:romId` and `PUT /save/:romId` (`?user=`). `GET` → `readBinary(savesDir/<user>/<rom>.srm)`; 404 → respond `204 No Content` (means "fresh game"). `PUT` (raw body via `express.raw({ type: '*/*', limit: '8mb' })` on this route) → `safeSegment(user)` + `safeSegment(romId, {dot:true})`, then `writeBinary(path, buffer)` which writes **atomically (temp file + rename)** to dodge the macOS-mount permission gotcha. Validate non-empty body. Tests: PUT then GET round-trips identical bytes (fake in-memory store); unsafe user → 400; missing user → 400.
**Commit:** `feat(emulator): per-user battery-save read/write (atomic)`

---

### Task 1.8: Router — save-state GET/PUT

Add `GET/PUT /state/:romId/:slot` (`?user=`), same pattern as saves but path `statesDir/<user>/<rom>/<slot>.state`. `safeSegment` slot with `{dot:true}`. Tests mirror 1.7.
**Commit:** `feat(emulator): per-user save-state read/write`

---

### Task 1.9: Wire router into the app

**Files:**
- Modify: `backend/src/4_api/v1/routers/index.mjs` (add `export { createEmulatorRouter } from './emulator.mjs';`)
- Modify: wherever routers are mounted (find the file that imports `createFitnessRouter` and calls `app.use('/api/v1/...')`; grep `createFitnessRouter(` under `backend/src/4_api`). Mount at `/api/v1/emulator`, supplying real `loadConfig` (read+parse `getHouseholdAppPath('emulator','config.yml')` with js-yaml, mtime-cached like other configs), and real `readBinary`/`writeBinary` resolving under `getHouseholdAppMediaPath('emulator', …)`.

**Verify:** start backend (`npm run backend` in worktree on its own port), `curl localhost:<port>/api/v1/emulator/library` returns JSON (empty catalog OK if no config yet). No automated test for wiring; manual curl + a one-line log assertion.
**Commit:** `feat(emulator): mount emulator router at /api/v1/emulator`

---

## Phase 2 — Frontend pure adapters (no React, no WASM)

> All Phase 2 modules live in `frontend/src/modules/Emulator/` and are pure JS — fully unit-testable. Run with `cd frontend && npx vitest run src/modules/Emulator/... --reporter=dot`.

### Task 2.1: `GovernanceGate` — `open` mode factory

**Files:**
- Create: `frontend/src/modules/Emulator/adapters/GovernanceGate.js`
- Test: `frontend/src/modules/Emulator/adapters/GovernanceGate.test.js`

`createOpenGate()` → `{ mode:'open', isPlayable:()=>true, getStatus:()=>({state:'playing'}), onChange:()=>()=>{} }`. Test asserts always playable. **Commit:** `feat(emulator): open-mode governance gate`

### Task 2.2: `gate` mode

`createGateAdapter({ getPhase })` where `getPhase()` returns `'unlocked'|'warning'|'pending'|'locked'`. `isPlayable()` → `getPhase()==='unlocked'`. `getStatus()` maps phase→`{state}` (`unlocked→playing`, `warning→warning`, else `paused`). Pure; inject `getPhase`. Tests cover each phase. **Commit:** `feat(emulator): gate-mode adapter`

### Task 2.3: `credit` mode accumulator

`createCreditAccumulator({ earnRate, maxCredit })` with `.tick(dtSec, inZone)` (banks `earnRate*dtSec` when `inZone`, clamped to `maxCredit`; spends `dtSec` when playing), `.creditSeconds`, `.isPlayable()` (`creditSeconds > 0`). Decide spend/earn order: earn first, then spend, so a tick in-zone nets positive. Tests: earns when in-zone; depletes to 0 and clamps (never negative); clamps to max; `isPlayable` flips at 0. **Commit:** `feat(emulator): credit-mode accumulator`

### Task 2.4: `MemoryProbe` predicate evaluation

**Files:**
- Create: `frontend/src/modules/Emulator/core/memoryPredicates.js`
- Test: `…/memoryPredicates.test.js`

`evalPredicate(when, value, prevValue)` supporting `{equals}`, `{changed:true}` (value !== prevValue), `{gt}`, `{lt}`, `{mask}` (`(value & mask) !== 0`). Tests for each + combined (all keys must hold). **Commit:** `feat(emulator): memory-watch predicate evaluator`

### Task 2.5: Address→offset translation per system

**Files:**
- Create: `frontend/src/modules/Emulator/core/addressMap.js`
- Test: `…/addressMap.test.js`

`toRamOffset(system, cpuAddr)` table-driven: e.g. `gb`/`gbc` WRAM CPU `0xC000`–`0xDFFF` → offset `cpuAddr - 0xC000`; throw for out-of-range or unknown system (so a bad config fails loudly, not silently reads garbage). Seed `gb`, `gbc`; structure so adding `nes`/`gba` is one table entry. Tests: GB `0xD057`→`0x1057`; unknown system throws; out-of-range throws. **Commit:** `feat(emulator): per-system RAM address translation`

### Task 2.6: `HookDispatcher` event→action mapping

**Files:**
- Create: `frontend/src/modules/Emulator/core/HookDispatcher.js`
- Test: `…/HookDispatcher.test.js`

`createHookDispatcher({ handlers })` where `handlers = { governance, cue, chrome, shader, toast, log }` (injected fns). `.dispatch(hooks, eventId)` finds hooks with `on === eventId` and invokes the matching handler(s) from each hook's `do` object. Unknown action key → routed to `log` + warn (tolerant). Tests: `{on:'in_battle', do:{governance:{required_zone:'hot'}}}` calls `handlers.governance` with that payload; unknown action logs. **Commit:** `feat(emulator): hook dispatcher`

---

## Phase 3 — `<EmulatorConsole>` core (lazy boot, open-mode standalone first)

> Integration-heavy + WASM. TDD where pure; otherwise build behind the `open` gate and verify in a real browser via the `run` skill. **Prove decoupling: this phase imports NOTHING from `modules/Fitness` or `context/FitnessContext`.**

### Task 3.1: Lazy loader

**Files:** Create `frontend/src/modules/Emulator/core/loadEmulatorJS.js`.
Single `loadEmulatorJS()` returning a memoized promise that dynamic-`import()`s the EmulatorJS entry (per spike findings) and resolves the boot API. Guarantees the heavy chunk is absent from the initial bundle. Add a lightweight test asserting the module exports a function and does not eagerly import the heavy dep at module-eval time (e.g. assert calling it triggers the dynamic import — mock `import`). **Commit:** `feat(emulator): lazy EmulatorJS loader`

### Task 3.2: `EmulatorConsole` component

**Files:** Create `frontend/src/modules/Emulator/EmulatorConsole.jsx` + `.scss`.
Props: `{ system, romUrl, coreUrl, governanceGate, identity, saveIO, rules, onExit }`. Behavior:
- On mount: `loadEmulatorJS()`, boot core into a `<div ref>` canvas host, fetch initial save via `saveIO.load()` if present.
- Run-loop gate: poll `governanceGate.isPlayable()` (subscribe via `onChange`); pause/resume the emulator accordingly. On `warning` add a blur/dim class (reuse governed-video visual language); on paused show an overlay from `getStatus()`.
- `child` logger; log lifecycle (`emulator.mount`, `emulator.boot`, `emulator.pause{reason}`, `emulator.resume`, `emulator.unmount`).
Render the overlay states (playing/warning/paused/depleted) from `governanceGate.getStatus()`.
**Verify:** with `createOpenGate()` and a real ROM, boots and plays in-browser (use the `run` skill / Playwright screenshot). **Commit:** `feat(emulator): EmulatorConsole governed run-loop (open mode)`

### Task 3.3: Save write-back wiring

**Files:** Create `frontend/src/modules/Emulator/core/saveIO.js`; integrate in `EmulatorConsole`.
`createSaveIO({ romId, getUserId, baseUrl })` → `{ load(), save(buffer) }`. `save` is debounced (e.g. 5s trailing) and also flushed on pause/unmount; `PUT`s SRAM to `/api/v1/emulator/save/:romId?user=`. Unit-test the debounce/flush logic with fake timers + a fake fetch (assert one PUT after burst, immediate flush on `.flush()`). **Commit:** `feat(emulator): debounced per-user save write-back`

### Task 3.4: `MemoryProbe` runtime integration

**Files:** Create `frontend/src/modules/Emulator/core/MemoryProbe.js`; wire into `EmulatorConsole` (only when `rules.watches?.length`).
`createMemoryProbe({ readRam, system, watches, sampleHz=10, onEvent })`: on each sample reads each watch's region via `readRam` + `toRamOffset`, evaluates `evalPredicate` against prev value, emits debounced `onEvent(watchId)` on rising edge. Pure-ish: inject `readRam` (returns a `Uint8Array` view) and a clock. Unit-test with a fake RAM array you mutate between ticks: asserts event fires on the configured transition, not on steady state. **Commit:** `feat(emulator): MemoryProbe sampling runtime`

---

## Phase 4 — Fitness binding (thin)

### Task 4.1: `EmulatorGameWidget` + registration

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx`
- Create: `frontend/src/modules/Fitness/widgets/EmulatorGame/index.jsx` (exports `default` + `manifest`)
- Modify: `frontend/src/modules/Fitness/index.js` (import, add to `REGISTRY_KEYS` as `fitness:emulator`, add legacy id `emulator` → `fitness:emulator`)

`EmulatorGameWidget({ fitnessContext, config, onClose })`:
- Resolves active player id from `IdentityProvider` (or `fitnessContext` primary user) → `identity` adapter.
- Builds `governanceGate` from `rules.governance.mode`:
  - `gate` → `createGateAdapter({ getPhase: () => fitnessContext.governanceState?.phase })`
  - `credit` → drives `createCreditAccumulator` from a ticking effect reading `fitnessContext.getUserVitals(playerId)` zone vs `rules.governance.required_zone` (use existing zone-rank compare).
  - `open` → `createOpenGate()`.
- Does **NOT** call `setGovernanceSuspended` (we want to be governed).
- Renders `<EmulatorConsole>` with the resolved adapters, `saveIO`, and `rules`.
`manifest = { id: 'emulator', name: 'Game Console', icon: '🎮' }`.
**Verify:** deep-link `/fitness/module/emulator` mounts the widget (it will need a rom/rules — for now allow it to open straight into the library from Phase 5; until then, pin a test game via `config`). **Commit:** `feat(emulator): fitness EmulatorGame widget + registry`

---

## Phase 5 — Library browser + gamepad capture

### Task 5.1: `EmulatorLibrary` component

**Files:** Create `frontend/src/modules/Emulator/EmulatorLibrary.jsx` + `.scss`.
Fetches `/api/v1/emulator/library?user=<id>`; renders console row → game grid with `boxartUrl`, title, and the resolved rule badge (`"Pokémon · credit · warm"`). Keyboard + `onPointerDown` + gamepad navigable using the existing focus/scroll idioms (`scrollIntoViewIfNeeded`, Enter/Space activate). On select → calls `onLaunch(game)`. Test (jsdom + mocked fetch): renders games, fires `onLaunch` on Enter. **Commit:** `feat(emulator): native ROM library browser`

### Task 5.2: Gamepad capture + adapter seam

**Files:**
- Create: `frontend/src/modules/Emulator/core/GamepadCapture.js`
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js`

`GamepadCapture`: `acquire()` sets `window.__emulatorCapturingGamepad = true`; `release()` clears it; reserved breakout combo (default Select+Start, configurable) detected via its own rAF poll → calls `onBreakout()`.
Seam edit in `GamepadAdapter._pollGamepad()` (top of method, after computing `now`):
```js
if (typeof window !== 'undefined' && window.__emulatorCapturingGamepad) {
  this._invalidateAllSeeds();   // re-seed on release so held buttons don't phantom-fire
  this._lastPollAt = now;
  return;
}
```
Add a focused test to the GamepadAdapter test suite: when the flag is set, no synthetic key events fire; when cleared, the next press fires normally (one re-seed frame in between). `EmulatorConsole` calls `acquire()` on play, `release()` on pause/overlay/unmount; breakout → pause + `onExit` back to library.
**Commit:** `feat(emulator): exclusive gamepad capture + adapter seam`

---

## Phase 6 — In-game state hooks wired to governance/cue/chrome

### Task 6.1: Wire `HookDispatcher` into `EmulatorGameWidget`

Build `handlers` for the dispatcher: `governance` → live-overlay the gate's `required_zone`/`mode` (mutate the running credit/gate adapter's target); `cue` → reuse the fitness audio-duck cue mechanism; `chrome`/`shader` → set state consumed by Phase 7 layers; `toast` → `fitnessContext` toast; `log`. Pass `onEvent` from `MemoryProbe` → `dispatcher.dispatch(rules.hooks, eventId)`. Unit-test the wiring with fake handlers (already covered at the dispatcher level; here assert the widget passes hooks through).
**Commit:** `feat(emulator): wire memory-watch hooks to governance/cue/chrome`

### Task 6.2: Seed Pokémon Red RAM map (proof)

Add a `pokemon-red` game entry to the household `config.yml` (NOT committed if it references a real ROM — keep ROM out of git; commit only the config shape under a fixture or doc). Provide `watches` (`in_battle` `$D057`) + `hooks` (battle → `required_zone: hot`). **Verify** in-browser with the spike's confirmed accessor: entering a battle raises the required zone. Document in `docs/reference/` (new `emulator-console.md`). **Commit:** `docs(emulator): pokemon-red memory-watch proof + reference`

> If Phase 0 descoped memory hooks, mark 6.1 "framework wired, disabled" and skip 6.2's live proof.

---

## Phase 7 — Shaders & chrome

### Task 7.1: Shader registry + chrome layer

**Files:** Create `frontend/src/modules/Emulator/shaders/index.js` (+ shader passes) and a `Chrome`/bezel layer component.
Map shader ids (`crt`, `lcd-grid`, …) to EmulatorJS's shader option or a WebGL post-pass; map `chrome` ids to a bezel/background image set served from `boxart`/a `chrome/` media folder. `EmulatorConsole` applies `rules.shader`/`rules.chrome` on boot and on hook-driven changes. Verify visually (screenshot). **Commit:** `feat(emulator): shader + chrome/bezel layers`

---

## Phase 8 — Nav wiring + live test

### Task 8.1: Nav entry + `fitness.yml` reference

Add a `module_direct` (or a dedicated `screen`) nav entry targeting `emulator` so the library is reachable from the fitness navbar. Add `emulator: { enabled: true }` to the household `fitness.yml` and ensure `unifyKeys` in `FitnessApp.jsx` includes `'emulator'` if the frontend needs to read it. **Commit:** `feat(emulator): nav entry + fitness.yml reference`

### Task 8.2: Live Playwright flow

**Files:** Create `tests/live/flow/fitness/emulator-governance.runtime.test.mjs`.
With `?nogovern` off and the HR sim: open the library, gamepad-nav to a game, launch, assert the governance overlay appears, then drop the simulated zone and assert (in `gate` mode) the canvas pauses — asserted via the **engine SSoT** (`window.__fitnessGovernance.phase`), not just overlay visibility (per governance-engine.md gotcha #5). Follow the no-skip discipline: if setup fails, fail loudly. **Commit:** `test(emulator): live governance-gated playback flow`

---

## Final integration

- Run full unit suites: `npx vitest run backend/src/3_applications/emulator backend/src/4_api/v1/routers/emulator.test.mjs` and `cd frontend && npx vitest run src/modules/Emulator src/modules/Fitness/widgets/EmulatorGame`.
- Run the live flow test.
- Use superpowers:requesting-code-review before merge.
- Update `docs/reference/` emulator doc; update `docs/docs-last-updated.txt`.
- Use superpowers:finishing-a-development-branch to merge `feature/emulator-console` → `main` and clean up the worktree.

---

## Risk notes

- **Phase 0 gates Phases 3/6.** If the RAM accessor or lazy-boot fails, the playable baseline (1–5, 7) still ships; memory hooks degrade to "framework present, disabled."
- **EmulatorJS delivery** (npm vs vendored `data/`): decided in the spike; affects Task 3.1 and the backend core-serving paths. If vendored, the loader files themselves are served by the `emulator` router under `cores/` or a dedicated `engine/` media folder.
- **Decoupling invariant:** keep `modules/Emulator/` free of any `modules/Fitness` / `FitnessContext` import. A grep in code review (`grep -r "Fitness" frontend/src/modules/Emulator/`) must return nothing.
