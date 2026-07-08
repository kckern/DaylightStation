# Emulator → Fitness Menu (locked, governed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the built-but-unwired EmulatorConsole launchable from the Fitness app menu as a **locked** (fingerprint to open) and **governed** (credit-gated: keep exercising in the required zone to keep playing) module that boots the seeded Pokémon Red.

**Architecture:** A thin Fitness binding `EmulatorGameWidget` builds the EmulatorConsole's `governanceGate` (from the game's `governance` config + the active player's live vitals), `controls` (from the library's `input.keyboard` via `buildEjsControls`), `identity`, and `resolveMediaUrl`, and renders `<EmulatorConsole>`. Controls are threaded through `EmulatorEngine.boot`→loader (already supports `EJS_defaultControls`). The fitness menu gains an item + a per-user `locks` entry. A `window.__emulatorCapturingGamepad` flag stops the menu GamepadAdapter from fighting EmulatorJS.

**Tech Stack:** React + Mantine (frontend), vitest. Emulator core modules under `frontend/src/modules/Emulator/`. Backend already live (`/api/v1/emulator/*`).

**Handoff/design:** `docs/_wip/plans/2026-06-22-emulator-console-handoff.md`, `docs/plans/2026-06-22-emulator-console-{design,implementation}.md`.

**Verified contracts:**
- Library `GET /api/v1/emulator/library` → `{ systems:{gb:{core,label}}, games:[{ id, system, title, governance:{mode:'credit', required_zone:'warm', grace_seconds, earn_rate, max_credit_seconds}, shader, chrome, romUrl, coverUrl, bezelUrl }], input:{ keyboard:{up,down,left,right,start,select,a,b,y,x,l,r}, controllers:[...] } }`.
- `EmulatorConsole` props: `{ game, engineConfig, governanceGate, identity, actionHandlers, resolveMediaUrl, onExit, controllers, btInventory, pairing, onPairController, getGamepads, fetchImpl }`. It polls `governanceGate.getStatus()` every 500ms → `{state:'playing'|'warning'|'paused'|'depleted'}` drives the overlay.
- `game` needs `{ id, system, romUrl, chrome, shader, states?, bindings? }`; `engineConfig` needs `{ pathtodata, core, controls? }`.
- `EmulatorSession.start({mount})` → `engine.boot({ mount, romUrl, pathtodata, core })`. **`controls` is NOT forwarded yet** (Task 1). `loadEmulatorJS`/`buildEjsglobals` already set `EJS_defaultControls` from a `controls` arg.
- `createCreditAccumulator({earnRate, maxCredit})` → `{ get creditSeconds, tick(dtSec,inZone), isPlayable() }` (it has NO getStatus — the widget wraps it).
- Fitness module: `FitnessModuleContainer` renders `<ModuleComponent mode onClose fitnessContext config onMount/>`. `fitnessContext` exposes `getUserVitals(id)→{zoneId,...}`, `getActivePlayerId()` (verify exact name in Task 3), `zones`. Module registry: `frontend/src/modules/Fitness/index.js` (`REGISTRY_KEYS` `'fitness:<name>'`, `LEGACY_ID_MAP`).
- Live menu config: `data/household/config/fitness.yml` → `plex.app_menus[{name,id,items:[{name,id}]}]` (the "Fitness Apps" menu is `id: app_menu1`); an item `id` resolves via `getModule(id)`; `locks.<id>: [userIds]` makes it fingerprint-locked (`FitnessModuleMenu.isLocked`). No `locks:` block exists yet.
- GamepadAdapter poll: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` `_pollGamepad()`/`_pollOne()`, with `_lastPollAt` and `_invalidateAllSeeds()`.

**Run a test:** `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`

---

## File Structure
- **Modify** `frontend/src/modules/Emulator/core/EmulatorEngine.js` — `boot` accepts + forwards `controls`.
- **Modify** `frontend/src/modules/Emulator/core/EmulatorSession.js` — `start` passes `engineConfig.controls` to `boot`.
- **Create** `frontend/src/modules/Fitness/widgets/EmulatorGame/fitnessGameGate.js` — pure gate builder (credit/gate/open) + zone test.
- **Create** `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` — the binding.
- **Create** `frontend/src/modules/Fitness/widgets/EmulatorGame/index.jsx` — manifest + default export.
- **Modify** `frontend/src/modules/Fitness/index.js` — register `fitness:emulator`.
- **Modify** `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` — capture seam.
- **Modify** (live volume) `data/household/config/fitness.yml` — menu item + `locks`.

---

## Task 1: Thread `controls` through boot

**Files:** Modify `core/EmulatorEngine.js`, `core/EmulatorSession.js`. Test: `frontend/src/modules/Emulator/core/EmulatorEngine.controls.test.js` (create).

- [ ] **Step 1 — failing test** `EmulatorEngine.controls.test.js`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { createEmulatorEngine } from './EmulatorEngine.js';

describe('EmulatorEngine forwards controls', () => {
  it('passes controls to the loader', async () => {
    const load = vi.fn().mockResolvedValue({ wramBase: 1 });
    const engine = createEmulatorEngine({ load, win: {} });
    await engine.boot({ mount: {}, romUrl: 'r', pathtodata: '/p/', core: 'gb', controls: { 0: { 3: { value: 'enter' } } } });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ controls: { 0: { 3: { value: 'enter' } } } }));
  });
});
```
- [ ] **Step 2 — run, expect FAIL** (`controls` not in the `load(...)` call).
  Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Emulator/core/EmulatorEngine.controls.test.js`
- [ ] **Step 3 — implement.** In `EmulatorEngine.js` `boot`, add `controls` to the destructure and the `load({...})` call:
```javascript
  async function boot({ mount, romUrl, pathtodata, core = 'gb', controls } = {}) {
    if (bootPromise) return bootPromise;
    ...
    bootPromise = load({ player: mount, core, romUrl, pathtodata, controls, win })
```
  In `EmulatorSession.js` `start`, forward `engineConfig.controls`:
```javascript
    await engine.boot({
      mount,
      romUrl: game.romUrl,
      pathtodata: engineConfig.pathtodata,
      core: engineConfig.core || system,
      controls: engineConfig.controls,
    });
```
- [ ] **Step 4 — run, expect PASS**; also re-run the existing engine/session tests: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Emulator/core/`
- [ ] **Step 5 — commit** `feat(emulator): thread EJS controls through engine boot`.

---

## Task 2: Pure fitness game gate (credit/gate/open)

**Files:** Create `frontend/src/modules/Fitness/widgets/EmulatorGame/fitnessGameGate.js` + `fitnessGameGate.test.js`.

- [ ] **Step 1 — failing test** `fitnessGameGate.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { isInRequiredZone, buildFitnessGameGate } from './fitnessGameGate.js';

const ZONES_ORDER = ['cool', 'warm', 'hot', 'max'];

describe('isInRequiredZone', () => {
  it('true when at or above the required zone', () => {
    expect(isInRequiredZone('warm', 'warm', ZONES_ORDER)).toBe(true);
    expect(isInRequiredZone('hot', 'warm', ZONES_ORDER)).toBe(true);
    expect(isInRequiredZone('cool', 'warm', ZONES_ORDER)).toBe(false);
    expect(isInRequiredZone(null, 'warm', ZONES_ORDER)).toBe(false);
  });
});

describe('buildFitnessGameGate credit mode', () => {
  const game = { governance: { mode: 'credit', required_zone: 'warm', earn_rate: 2, max_credit_seconds: 100 } };
  it('earns in-zone, depletes out, getStatus flips playing/depleted', () => {
    let zone = 'warm';
    const gate = buildFitnessGameGate({
      game, zonesOrder: ZONES_ORDER,
      getActivePlayerId: () => 'p', getUserVitals: () => ({ zoneId: zone }),
    });
    expect(gate.mode).toBe('credit');
    expect(gate.getStatus().state).toBe('depleted');     // starts at 0 credit
    gate.tick(3);                                         // in-zone: +6 earn, -3 spend = +3
    expect(gate.getStatus().state).toBe('playing');
    zone = 'cool';
    gate.tick(5);                                         // out: 0 earn, -5 spend → 0
    expect(gate.getStatus().state).toBe('depleted');
  });
});

describe('buildFitnessGameGate open mode', () => {
  it('open → always playing', () => {
    const gate = buildFitnessGameGate({ game: { governance: { mode: 'open' } }, zonesOrder: ZONES_ORDER, getActivePlayerId: () => null, getUserVitals: () => null });
    expect(gate.getStatus().state).toBe('playing');
    expect(gate.isPlayable()).toBe(true);
  });
});
```
- [ ] **Step 2 — run, expect FAIL** (module missing).
- [ ] **Step 3 — implement** `fitnessGameGate.js`:
```javascript
import { createCreditAccumulator, createOpenGate } from '../../../Emulator/adapters/GovernanceGate.js';

// At or above the required zone in the configured order. Unknown zone → false.
export function isInRequiredZone(zoneId, requiredZone, zonesOrder = []) {
  if (!zoneId || !requiredZone) return false;
  const cur = zonesOrder.indexOf(zoneId);
  const req = zonesOrder.indexOf(requiredZone);
  if (cur === -1 || req === -1) return false;
  return cur >= req;
}

/**
 * Build the EmulatorConsole governanceGate for a fitness-hosted game.
 *  - credit: earn playtime while the active player is in/above required_zone.
 *  - gate:   playable while phase==='unlocked' (uses getPhase()).
 *  - open/none: always playable.
 * Returns the gate { mode, isPlayable, getStatus, onChange } PLUS a `tick(dtSec)`
 * the host calls on an interval (credit only; no-op otherwise).
 */
export function buildFitnessGameGate({ game, zonesOrder = [], getActivePlayerId, getUserVitals }) {
  const gov = game?.governance || {};
  const mode = gov.mode || 'open';

  if (mode === 'credit') {
    const acc = createCreditAccumulator({
      earnRate: Number(gov.earn_rate) || 1,
      maxCredit: Number(gov.max_credit_seconds) || 600,
    });
    const inZoneNow = () => {
      const v = typeof getActivePlayerId === 'function' ? getUserVitals?.(getActivePlayerId()) : null;
      return isInRequiredZone(v?.zoneId, gov.required_zone, zonesOrder);
    };
    return {
      mode: 'credit',
      tick: (dtSec) => acc.tick(dtSec, inZoneNow()),
      isPlayable: () => acc.isPlayable(),
      getStatus: () => ({ state: acc.isPlayable() ? 'playing' : 'depleted', creditSeconds: acc.creditSeconds }),
      onChange: () => () => {},
    };
  }

  // open / none / unknown → never gated.
  const open = createOpenGate();
  return { ...open, tick: () => {} };
}

export default { isInRequiredZone, buildFitnessGameGate };
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit** `feat(emulator): pure fitness game gate (credit/open) + zone test`.

---

## Task 3: EmulatorGameWidget (the Fitness binding)

**Files:** Create `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx`, `index.jsx`, `EmulatorGameWidget.test.jsx`.

> READ first: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (how it reads `useFitnessContext`, `getUserVitals`, identity/active player, and `onClose`); `frontend/src/modules/Emulator/input/buildEjsControls.js` (export name + signature); `frontend/src/modules/Emulator/EmulatorConsole.jsx` (the `EmulatorConsole` named export + props); `frontend/src/lib/api.mjs` (`DaylightAPI`, `DaylightMediaPath`). Use the EXACT active-player accessor the context provides (e.g. `getActivePlayerId`, or the first roster id) — verify in CycleGameContainer/FitnessContext; if none, fall back to `() => null` (gate still works, just never in-zone).

- [ ] **Step 1 — failing test** `EmulatorGameWidget.test.jsx`:
```javascript
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock('../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info(){}, debug(){}, warn(){}, error(){} }) }) }));
// Stub the heavy console so the test asserts wiring, not EmulatorJS boot.
vi.mock('../../../Emulator/EmulatorConsole.jsx', () => ({
  EmulatorConsole: (props) => <div data-testid="console" data-game={props.game?.id}
    data-haskbd={!!props.engineConfig?.controls} data-gate={props.governanceGate?.mode} />,
}));

import EmulatorGameWidget from './EmulatorGameWidget.jsx';

const fitnessContext = { getUserVitals: () => ({ zoneId: 'warm' }), zones: { cool:{}, warm:{}, hot:{} } };

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({
    systems: { gb: { core: 'gb' } },
    games: [{ id: 'pokemon-red', system: 'gb', title: 'Pokémon Red', romUrl: '/rom', chrome: 'gb-bezel', shader: 'dotmatrix',
              governance: { mode: 'credit', required_zone: 'warm', earn_rate: 1.5, max_credit_seconds: 600 } }],
    input: { keyboard: { up: 'ArrowUp', start: 'Enter', a: 'x', b: 'z' } },
  });
  delete window.__emulatorCapturingGamepad;
});
afterEach(() => { delete window.__emulatorCapturingGamepad; });

describe('EmulatorGameWidget', () => {
  it('loads the library, builds controls + a credit gate, renders the console', async () => {
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('console')).toBeTruthy());
    const el = screen.getByTestId('console');
    expect(el.getAttribute('data-game')).toBe('pokemon-red');
    expect(el.getAttribute('data-haskbd')).toBe('true');
    expect(el.getAttribute('data-gate')).toBe('credit');
    expect(api).toHaveBeenCalledWith('api/v1/emulator/library');
  });

  it('captures the gamepad while mounted and releases on unmount', async () => {
    const { unmount } = render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('console')).toBeTruthy());
    expect(window.__emulatorCapturingGamepad).toBe(true);
    unmount();
    expect(window.__emulatorCapturingGamepad).toBeFalsy();
  });
});
```
- [ ] **Step 2 — run, expect FAIL** (module missing).
- [ ] **Step 3 — implement** `EmulatorGameWidget.jsx`:
```javascript
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';
import { EmulatorConsole } from '../../../Emulator/EmulatorConsole.jsx';
import { buildEjsControls } from '../../../Emulator/input/buildEjsControls.js';
import { buildFitnessGameGate } from './fitnessGameGate.js';

const ENGINE_PATH = 'api/v1/emulator/engine/';
const GATE_TICK_MS = 1000;

// Fitness binding for the host-agnostic EmulatorConsole: library → game/controls/
// gate/identity → governed console. Locked-launch is handled by the menu (locks).
export default function EmulatorGameWidget({ fitnessContext, onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-emulator' }), []);
  const [game, setGame] = useState(null);
  const [engineConfig, setEngineConfig] = useState(null);
  const [error, setError] = useState(null);
  const gateRef = useRef(null);

  const zonesOrder = useMemo(() => Object.keys(fitnessContext?.zones || {}), [fitnessContext]);
  const getActivePlayerId = fitnessContext?.getActivePlayerId
    || (() => fitnessContext?.fitnessSessionInstance?.roster?.[0]?.userId ?? null);
  const getUserVitals = fitnessContext?.getUserVitals || (() => null);

  // Load the library, pick the requested (or first) game, build controls + gate.
  useEffect(() => {
    let alive = true;
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (!alive) return;
      const games = lib?.games || [];
      const chosen = (config?.gameId && games.find((g) => g.id === config.gameId)) || games[0];
      if (!chosen) { setError('No games'); return; }
      const controls = buildEjsControls(lib?.input?.keyboard || {});
      const gate = buildFitnessGameGate({
        game: chosen, zonesOrder, getActivePlayerId, getUserVitals,
      });
      gateRef.current = gate;
      setGame({ id: chosen.id, system: chosen.system, romUrl: chosen.romUrl, chrome: chosen.chrome, shader: chosen.shader });
      setEngineConfig({ pathtodata: ENGINE_PATH, core: lib?.systems?.[chosen.system]?.core || chosen.system || 'gb', controls });
      logger.info('fitness-emulator.loaded', { game: chosen.id, gate: gate.mode });
      onMount?.();
    }).catch((e) => { if (alive) { setError(e.message); logger.error('fitness-emulator.load-failed', { error: e.message }); onMount?.(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop the menu GamepadAdapter from fighting EmulatorJS while a game is up.
  useEffect(() => {
    window.__emulatorCapturingGamepad = true;
    return () => { window.__emulatorCapturingGamepad = false; };
  }, []);

  // Drive the credit gate from live vitals.
  useEffect(() => {
    const id = setInterval(() => gateRef.current?.tick?.(GATE_TICK_MS / 1000), GATE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (error) return <div className="fitness-emulator__error">Emulator unavailable: {error}</div>;
  if (!game || !engineConfig) return <div className="fitness-emulator__loading">Loading…</div>;

  return (
    <EmulatorConsole
      game={game}
      engineConfig={engineConfig}
      governanceGate={gateRef.current}
      identity={{ getActivePlayerId }}
      resolveMediaUrl={(p) => DaylightMediaPath(p)}
      onExit={onClose}
    />
  );
}
```
  Create `index.jsx`:
```javascript
import EmulatorGameWidget from './EmulatorGameWidget.jsx';

export default EmulatorGameWidget;
export const manifest = {
  id: 'emulator',
  name: 'Game Boy',
  icon: '🎮',
  description: 'Retro games — keep moving to keep playing.',
};
```
- [ ] **Step 4 — run, expect PASS** (2 tests).
- [ ] **Step 5 — commit** `feat(emulator): EmulatorGameWidget fitness binding`.

---

## Task 4: Register `fitness:emulator`

**Files:** Modify `frontend/src/modules/Fitness/index.js`.

- [ ] **Step 1** — READ the file; mirror an existing entry (e.g. CycleGame). Add the import + registry + legacy id:
```javascript
import * as EmulatorGame from './widgets/EmulatorGame/index.jsx';
// in REGISTRY_KEYS:
  'fitness:emulator': EmulatorGame,
// in LEGACY_ID_MAP:
  'emulator': 'fitness:emulator',
```
  (Match the exact shape the other entries use — some register the module object, some `{ default, manifest }`. Follow the established pattern in that file.)
- [ ] **Step 2 — verify** the registry resolves: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/EmulatorGame/` still green, and (if present) any Fitness registry test stays green.
- [ ] **Step 3 — commit** `feat(emulator): register fitness:emulator module`.

---

## Task 5: GamepadAdapter capture seam

**Files:** Modify `frontend/src/screen-framework/input/adapters/GamepadAdapter.js`. Test: `GamepadAdapter.capture.test.js` (create) or extend an existing GamepadAdapter test.

- [ ] **Step 1 — failing test** (adapt to the real constructor/poll API after reading the file): assert that with `window.__emulatorCapturingGamepad = true`, a poll emits NO ActionBus events even when a button is pressed; with it false/unset, it emits.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement.** At the top of `_pollGamepad()` (after computing `now`/before iterating), add the guard — when capturing, keep the loop alive but emit nothing and invalidate seeds so re-entry doesn't fire a burst:
```javascript
    this._lastPollAt = now;
    if (typeof window !== 'undefined' && window.__emulatorCapturingGamepad === true) {
      this._invalidateAllSeeds();
      return;
    }
```
  (Place it AFTER the stale-gap check sets `_lastPollAt`, BEFORE the `getActiveGamepads()` loop.)
- [ ] **Step 4 — run, expect PASS**; re-run existing GamepadAdapter tests for no regression.
- [ ] **Step 5 — commit** `feat(emulator): gamepad-capture seam so the menu adapter yields to EmulatorJS`.

---

## Task 6: Fitness menu entry + lock (live config)

**Files:** `data/household/config/fitness.yml` (Docker volume — edit via `sudo docker exec`, heredoc, NEVER `sed -i`).

- [ ] **Step 1** — read current file: `sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml'`.
- [ ] **Step 2** — add `Game Boy` to the `app_menu1` items list (under `plex.app_menus` → the menu with `id: app_menu1`):
```yaml
        - name: Game Boy
          id: emulator
```
- [ ] **Step 3** — add a top-level `locks:` block (sibling of `plex:`, e.g. near the end) gating the module to a parent fingerprint (adjust the user list as desired):
```yaml
locks:
  emulator:
    - user_1
```
  Write the WHOLE file back via heredoc inside `sh -c` (preserve everything else). Confirm it parses:
  `sudo docker exec daylight-station sh -c 'node -e "require(\"js-yaml\").load(require(\"fs\").readFileSync(\"data/household/config/fitness.yml\",\"utf8\")); console.log(\"ok\")"'`
- [ ] **Step 4 — no commit** (data volume not versioned); note the change.

---

## Task 7: Build, deploy, verify

- [ ] **Step 1** — full affected suites:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Emulator/ frontend/src/modules/Fitness/widgets/EmulatorGame/ \
  frontend/src/screen-framework/input/
```
  Expected: all PASS.
- [ ] **Step 2** — build: `sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .`
- [ ] **Step 3** — gate (per CLAUDE.local.md), then deploy:
```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
- [ ] **Step 4 — manual verify** in the Fitness app: open the **Fitness Apps** menu → **Game Boy** shows a **lock badge**; tapping prompts a fingerprint (user_1); after unlock it launches the EmulatorConsole; with no one in the `warm` zone the overlay shows paused/depleted ("Out of credit — earn more!"), and pedaling into the zone resumes play. **Garage display** is the fitness screen — after deploy, hard-reload it (CLAUDE.local.md fitness-display reload).

---

## Self-Review (author)
- Locked (fingerprint) → Task 6 `locks.emulator`. ✓
- Governed (credit, keep-moving) → Task 2 gate + Task 3 tick. ✓
- Controls (keyboard + gamepad defaults) → Task 1 thread + Task 3 `buildEjsControls`. ✓
- Menu entry in Fitness app menu → Task 6 `app_menu1`. ✓
- Gamepad seam → Task 5. ✓
- Registration → Task 4. ✓
- No placeholders; shapes (`game`/`engineConfig`/gate/`getUserVitals`) consistent across tasks. Active-player accessor is verified in Task 3 (fallback to roster[0]/null).
