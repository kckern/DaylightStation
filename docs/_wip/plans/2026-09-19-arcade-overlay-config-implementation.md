# Arcade Session Overlay Unification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace three uncoordinated, largely-hardcoded "who's playing / what
console / how much time" displays (a native Shield/RetroArch WebView overlay,
a per-manifest bare-text timer, and a hardcoded browser countdown box) with
one household-YAML-driven `fields` list shared by all three surfaces, plus a
new anchor+offset+scale position model for the two browser-rendered surfaces.

**Architecture:** A new pure domain function (`resolveOverlayConfig`) merges
`data/household/gaming/arcade-overlay.yml` defaults with a per-console
override. The backend resolves it once per play-session message
(`EventBusPlaySessionAnnouncer`) and attaches it as `overlay: {...}` to the
same `play-session:<deviceId>` broadcast every consumer already subscribes
to — no new endpoint. `arcade-film.html` (static, no build step) reads
`overlay.fields` to toggle visibility, keeping its own bezel-zone placement.
The browser `EmulatorConsole` reads the same shape to render one new
`session`-kind entry in the existing `OverlayLayer`, positioned by a new
`anchorStyle.js` helper. The old hardcoded play-budget box and the redundant
per-manifest `timer`/`player` overlay entries are deleted.

**Tech Stack:** Node/Express backend (ESM, DDD layers under `backend/src/`),
React frontend (Vite), Vitest for both, plain YAML for config, a dependency-
free static HTML/JS page for the native kiosk overlay.

**Design doc:** `docs/_wip/plans/2026-09-19-arcade-overlay-config-design.md`
(read it first — it has the full rationale for every decision below).

---

### Task 1: Domain — `resolveOverlayConfig` merge function

**Files:**
- Create: `backend/src/2_domains/gaming/value-objects/OverlaySessionFields.mjs`
- Test: `backend/src/2_domains/gaming/value-objects/OverlaySessionFields.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { resolveOverlayConfig } from './OverlaySessionFields.mjs';

const CONFIG = {
  defaults: { anchor: 'top-left', offset_x: '2%', offset_y: '2%', scale: 0.5, fields: ['player', 'system_label', 'timer'] },
  systems: {
    gbc: { scale: 0.4 },
    snes: { anchor: 'bottom-right', fields: ['player', 'timer'] },
    n64: { fields: [] },
  },
};

describe('resolveOverlayConfig', () => {
  it('returns pure defaults for a system with no override', () => {
    expect(resolveOverlayConfig(CONFIG, 'genesis')).toEqual({
      anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5,
      fields: ['player', 'system_label', 'timer'],
    });
  });

  it('overrides only the keys a system names, inheriting the rest', () => {
    const r = resolveOverlayConfig(CONFIG, 'gbc');
    expect(r.scale).toBe(0.4);
    expect(r.anchor).toBe('top-left');
    expect(r.fields).toEqual(['player', 'system_label', 'timer']);
  });

  it('lets a system drop a field while keeping others', () => {
    expect(resolveOverlayConfig(CONFIG, 'snes').fields).toEqual(['player', 'timer']);
  });

  it('treats an explicit empty fields list as "show nothing", not "inherit"', () => {
    expect(resolveOverlayConfig(CONFIG, 'n64').fields).toEqual([]);
  });

  it('falls back to safe built-in defaults when no config exists at all', () => {
    expect(resolveOverlayConfig(null, 'gb')).toEqual({
      anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5, fields: [],
    });
  });

  it('falls back to the config defaults for a system id with no matching entry', () => {
    expect(resolveOverlayConfig(CONFIG, 'nes').fields).toEqual(['player', 'system_label', 'timer']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks backend/src/2_domains/gaming/value-objects/OverlaySessionFields.test.mjs`
Expected: FAIL — `OverlaySessionFields.mjs` does not exist.

**Step 3: Write minimal implementation**

```js
/**
 * Merge household arcade-overlay.yml defaults with a per-system override.
 *
 * `fields: []` on a system is an explicit "show nothing", distinct from
 * omitting `fields` (which inherits the default list) — a system asking for
 * silence must not read the same as a system that said nothing at all.
 *
 * The fallback values here are a safety net for a missing/corrupt config
 * file, not the intended household defaults — those live in
 * data/household/gaming/arcade-overlay.yml. An absent config shows nothing
 * (`fields: []`) rather than guessing at content the household never chose.
 */
export function resolveOverlayConfig(config, systemId) {
  const defaults = config?.defaults || {};
  const override = (systemId && config?.systems?.[systemId]) || {};
  return {
    anchor: override.anchor ?? defaults.anchor ?? 'top-left',
    offsetX: override.offset_x ?? defaults.offset_x ?? '2%',
    offsetY: override.offset_y ?? defaults.offset_y ?? '2%',
    scale: override.scale ?? defaults.scale ?? 0.5,
    fields: override.fields !== undefined ? override.fields : (defaults.fields ?? []),
  };
}

export default resolveOverlayConfig;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks backend/src/2_domains/gaming/value-objects/OverlaySessionFields.test.mjs`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/2_domains/gaming/value-objects/OverlaySessionFields.mjs backend/src/2_domains/gaming/value-objects/OverlaySessionFields.test.mjs
git commit -m "feat(gaming): add resolveOverlayConfig defaults/override merge"
```

---

### Task 2: Household config registry + the real config file

**Files:**
- Modify: `shared/contracts/householdConfig.mjs`
- Create (real data tree, NOT in git — see `CLAUDE.local.md`):
  `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/gaming/arcade-overlay.yml`

**Step 1: Register the config key**

In `shared/contracts/householdConfig.mjs`, next to the existing `games:` entry
(around line 56), add:

```js
  games:            'gaming/games',
  'arcade-overlay': 'gaming/arcade-overlay',
```

**Step 2: Create the real household YAML**

This file lives on the Dropbox-synced data tree, not in this git checkout.
Write it directly (no SSH needed — it's a normal folder on the laptop):

```yaml
# Arcade session badge — what shows (fields), and for the browser overlay
# only, where/how big (anchor/offset/scale). The native Shield/RetroArch
# overlay (arcade-film.html) reads `fields` only and keeps its own
# bezel-measured placement — see docs/reference/gaming/play-sessions.md.
defaults:
  anchor: top-left
  offset_x: 2%
  offset_y: 2%
  scale: 0.5
  fields: [player, system_label, timer]

systems: {}
```

Path: `$DAYLIGHT_BASE_PATH/data/household/gaming/arcade-overlay.yml`
(`DAYLIGHT_BASE_PATH` from `.env` on this machine).

**Step 3: Verify it loads**

Run: `npx vitest run --pool=forks backend/src/0_system/config` (or whatever
existing suite covers `ConfigService`) to confirm nothing chokes on the new
registry entry. There is no per-key test to add — `getHouseholdAppConfig`
is generic.

**Step 4: Commit**

```bash
git add shared/contracts/householdConfig.mjs
git commit -m "feat(config): register arcade-overlay household app config"
```

(The YAML file itself is on the Dropbox tree, outside git — nothing to add there.)

---

### Task 3: Backend — carry `overlay` config on every play-session message

**Files:**
- Modify: `backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.mjs`
- Test: `backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.test.mjs`

**Step 1: Write the failing tests**

Add to the existing test file (it already has a `harness({ placementFor, sessions })`
helper and a `GB` content fixture — extend both):

```js
function harness({ placementFor, overlayConfigFor, sessions = null } = {}) {
  const sent = [];
  const direct = [];
  let onSubscription = null;
  const eventBus = {
    broadcast: (topic, payload) => sent.push({ topic, payload }),
    onClientSubscription: (handler) => { onSubscription = handler; },
    sendToClient: (clientId, payload) => direct.push({ clientId, payload }),
  };
  const announcer = new EventBusPlaySessionAnnouncer({
    eventBus, placementFor, overlayConfigFor, sessions,
    logger: quiet,
  });
  return {
    sent, direct, announcer,
    subscribe: (clientId, topics) => onSubscription?.(clientId, topics),
  };
}
```

(This replaces the existing `harness` definition — same shape, one new param.)

```js
it('publishes the resolved overlay config alongside placement', async () => {
  const OVERLAY = { anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5, fields: ['player', 'timer'] };
  const { sent, announcer } = harness({ placementFor: () => PLACEMENT, overlayConfigFor: () => OVERLAY });
  await announcer.started(session(GB));

  expect(sent[0].payload.overlay).toEqual(OVERLAY);
});

it('reports no overlay config when no resolver is wired', async () => {
  const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
  await announcer.started(session(GB));

  expect(sent[0].payload.overlay).toBeNull();
});

it('still publishes when the overlay config lookup throws', async () => {
  const { sent, announcer } = harness({
    placementFor: () => PLACEMENT,
    overlayConfigFor: () => { throw new Error('bad config'); },
  });
  await announcer.started(session(GB));

  expect(sent).toHaveLength(2);
  expect(sent[0].payload.overlay).toBeNull();
  expect(sent[0].payload.playedMs).toBe(61_000);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --pool=forks backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.test.mjs`
Expected: FAIL — `payload.overlay` is `undefined`, not `null`/the resolved object (the field doesn't exist yet).

**Step 3: Implement**

In `EventBusPlaySessionAnnouncer.mjs`:

```js
export class EventBusPlaySessionAnnouncer extends IPlaySessionAnnouncer {
  #bus; #placementFor; #overlayConfigFor; #identify; #sessions; #logger;

  constructor({ eventBus, placementFor = null, overlayConfigFor = null, identify = null, sessions = null, logger = console }) {
    super();
    if (!eventBus?.broadcast) throw new Error('EventBusPlaySessionAnnouncer requires an eventBus with broadcast()');
    this.#bus = eventBus;
    this.#placementFor = placementFor;
    this.#overlayConfigFor = overlayConfigFor;
    this.#identify = identify;
    this.#sessions = sessions;
    this.#logger = logger;
    if (sessions && eventBus.onClientSubscription && eventBus.sendToClient) {
      eventBus.onClientSubscription((clientId, topics) => this.#replay(clientId, topics));
    }
  }
  // ... started/progress/ended/#identity unchanged ...

  #presentation(session) {
    const content = session.content ?? null;
    let placement = null;
    try {
      placement = this.#placementFor ? this.#placementFor(content) : null;
    } catch (error) {
      this.#logger.warn?.('play.placement.failed', {
        sessionId: session.id, error: error.message,
      });
    }
    let overlay = null;
    try {
      overlay = this.#overlayConfigFor ? this.#overlayConfigFor(content?.console) : null;
    } catch (error) {
      this.#logger.warn?.('play.overlay_config.failed', {
        sessionId: session.id, error: error.message,
      });
    }
    return {
      system: content?.console ?? null,
      systemLabel: content?.consoleLabel ?? null,
      placement,
      overlay,
    };
  }
  // ... rest unchanged ...
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run --pool=forks backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.test.mjs`
Expected: PASS (all tests, including the 3 new ones and the pre-existing "reports no system for a session that is not yet named" / "works with no placement resolver at all" tests, which should still pass since `overlay` defaults to `null` the same way `placement` does)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.mjs backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.test.mjs
git commit -m "feat(gaming): carry resolved overlay config on play-session messages"
```

---

### Task 4: Backend composition — wire arcade-overlay.yml through to the announcer

**Files:**
- Modify: `backend/src/5_composition/modules/playSessions.mjs`
- Modify: `backend/src/app.mjs`

**Step 1: Wire the composition module**

In `playSessions.mjs`, add the import and thread a new param through
`createPlaySessionTracking`:

```js
import { resolveOverlayConfig } from '#domains/gaming/value-objects/OverlaySessionFields.mjs';
```

In the `createPlaySessionTracking` destructure (around line 129):

```js
  const {
    devicesConfig, gamesConfig, gamesCatalog = null, arcadeOverlayConfig = null,
    configService, eventBus, httpClient,
    daylightHost = null, overlayPath = '/arcade-film.html',
```

Near the existing `placementFor` definition (around line 211), add a sibling:

```js
  const overlayConfigFor = (systemId) => resolveOverlayConfig(arcadeOverlayConfig, systemId);
```

And pass it into the announcer construction (around line 239):

```js
      new EventBusPlaySessionAnnouncer({ eventBus, placementFor, overlayConfigFor, identify, sessions, logger }),
```

**Step 2: Load the config at the composition root**

In `app.mjs`, in the `createPlaySessionTracking({...})` call (around line
3817), add:

```js
  const playSessionTracking = createPlaySessionTracking({
    devicesConfig: devicesConfig.devices || {},
    gamesConfig: configService.getHouseholdAppConfig(householdId, 'games'),
    gamesCatalog: dataService.household.read('gaming/retroarch/catalog'),
    arcadeOverlayConfig: configService.getHouseholdAppConfig(householdId, 'arcade-overlay'),
    configService,
    eventBus,
    httpClient: axios,
    daylightHost,
    haGateway: homeAutomationAdapters.haGateway,
    profileFor: (username) => userService.getProfile(username),
    logger: rootLogger.child({ module: 'play-sessions' }),
  });
```

**Step 3: Verify nothing broke**

Run: `npx vitest run --pool=forks backend/src/5_composition/modules` (or the
narrowest existing suite covering `playSessions.mjs`, if one exists — check
with `find backend/src/5_composition/modules -iname "*playSessions*test*"`
first). This is composition wiring, not new logic — Task 1 and Task 3 already
cover the actual behavior with unit tests; this step is a smoke check.

**Step 4: Commit**

```bash
git add backend/src/5_composition/modules/playSessions.mjs backend/src/app.mjs
git commit -m "feat(gaming): load arcade-overlay.yml and wire it into play-session announcements"
```

---

### Task 5: Frontend — `countdown` format for the pre-computed session clock

**Files:**
- Modify: `frontend/src/modules/Emulator/core/resolveOverlayValue.js`
- Test: `frontend/src/modules/Emulator/core/resolveOverlayValue.test.js`

**Step 1: Write the failing test**

Append to the `describe('formatOverlayValue', ...)` block:

```js
it('formats a countdown from a pre-computed {text, urgency, stale} value', () => {
  expect(formatOverlayValue('countdown', { text: '11:49', urgency: null, stale: false }))
    .toEqual({ kind: 'stat', text: '11:49', unit: '', urgency: null, stale: false });
  expect(formatOverlayValue('countdown', { text: '00:45', urgency: 'crit', stale: false }))
    .toEqual({ kind: 'stat', text: '00:45', unit: '', urgency: 'crit', stale: false });
  expect(formatOverlayValue('countdown', { text: '--:--', urgency: null, stale: true }))
    .toEqual({ kind: 'stat', text: '--:--', unit: '', urgency: null, stale: true });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator/core/resolveOverlayValue.test.js`
Expected: FAIL — `'countdown'` falls through to the generic
`{ kind: 'text', text: '[object Object]' }` branch today.

**Step 3: Implement**

In `formatOverlayValue`, add a new branch before the `STAT_UNITS` check:

```js
  // Session countdown/count-up clock. Unlike `timer`/`clock` (raw elapsed
  // SECONDS, always count-up), this trusts an already-formatted text plus
  // urgency/staleness computed by usePlayBudget's derivePlayBudget — keeping
  // that clock math in exactly one place.
  if (format === 'countdown') {
    const text = (value && typeof value === 'object') ? String(value.text ?? '--:--') : String(value);
    const urgency = (value && typeof value === 'object') ? (value.urgency ?? null) : null;
    const stale = !!(value && typeof value === 'object' && value.stale);
    return { kind: 'stat', text, unit: '', urgency, stale };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator/core/resolveOverlayValue.test.js`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/core/resolveOverlayValue.js frontend/src/modules/Emulator/core/resolveOverlayValue.test.js
git commit -m "feat(emulator): add a countdown overlay format for the session clock"
```

---

### Task 6: Frontend — `anchorStyle.js`

**Files:**
- Create: `frontend/src/modules/Emulator/ui/anchorStyle.js`
- Test: `frontend/src/modules/Emulator/ui/anchorStyle.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { anchorStyle } from './anchorStyle.js';

describe('anchorStyle', () => {
  it('positions top-left with the given offsets', () => {
    expect(anchorStyle({ anchor: 'top-left', offsetX: '3%', offsetY: '4%', scale: 1 }))
      .toEqual({ position: 'absolute', top: '4%', left: '3%' });
  });

  it('positions the opposite edges for bottom-right', () => {
    const s = anchorStyle({ anchor: 'bottom-right', offsetX: '2%', offsetY: '2%', scale: 1 });
    expect(s.bottom).toBe('2%');
    expect(s.right).toBe('2%');
    expect(s.top).toBeUndefined();
    expect(s.left).toBeUndefined();
  });

  it('applies a scale transform anchored to the correct corner', () => {
    const s = anchorStyle({ anchor: 'top-right', offsetX: '2%', offsetY: '2%', scale: 0.5 });
    expect(s.transform).toBe('scale(0.5)');
    expect(s.transformOrigin).toBe('top right');
  });

  it('omits the transform at scale 1 (a no-op that would still cost a paint)', () => {
    const s = anchorStyle({ anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 1 });
    expect(s.transform).toBeUndefined();
  });

  it('falls back to top-left for an unrecognised anchor', () => {
    const s = anchorStyle({ anchor: 'nowhere', offsetX: '1%', offsetY: '1%', scale: 1 });
    expect(s.top).toBe('1%');
    expect(s.left).toBe('1%');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator/ui/anchorStyle.test.js`
Expected: FAIL — module does not exist.

**Step 3: Implement**

```js
/**
 * anchorStyle — corner anchor + offset + scale → absolute CSS.
 *
 * Unlike regionStyle (a manifest-measured %-box), a session badge is sized by
 * its own content, not a fixed box: position is a corner + offset, and size
 * is one scale multiplier applied via `transform`, so font/padding/gaps move
 * together and the badge can't clip regardless of console.
 */
const CORNERS = {
  'top-left': { top: true, left: true },
  'top-right': { top: true, right: true },
  'bottom-left': { bottom: true, left: true },
  'bottom-right': { bottom: true, right: true },
};

export function anchorStyle({ anchor, offsetX, offsetY, scale } = {}) {
  const corner = CORNERS[anchor] || CORNERS['top-left'];
  const style = { position: 'absolute' };
  if (corner.top) style.top = offsetY ?? '2%';
  if (corner.bottom) style.bottom = offsetY ?? '2%';
  if (corner.left) style.left = offsetX ?? '2%';
  if (corner.right) style.right = offsetX ?? '2%';
  const s = Number(scale);
  if (Number.isFinite(s) && s > 0 && s !== 1) {
    style.transform = `scale(${s})`;
    style.transformOrigin = `${corner.top ? 'top' : 'bottom'} ${corner.left ? 'left' : 'right'}`;
  }
  return style;
}

export default anchorStyle;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator/ui/anchorStyle.test.js`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/ui/anchorStyle.js frontend/src/modules/Emulator/ui/anchorStyle.test.js
git commit -m "feat(emulator): add anchorStyle for corner-positioned overlays"
```

---

### Task 7: Frontend — `OverlayLayer` gains a `session`-kind composite overlay

**Files:**
- Modify: `frontend/src/modules/Emulator/ui/OverlayLayer.jsx`
- Test: `frontend/src/modules/Emulator/ui/OverlayLayer.test.jsx`

**Step 1: Write the failing tests**

Append to `OverlayLayer.test.jsx`:

```js
describe('OverlayLayer — session kind', () => {
  const sessionOverlay = [{
    id: 'session', kind: 'session', anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5,
    fields: ['player', 'system_label', 'timer'],
  }];
  const fieldDescriptors = {
    player: { kind: 'player', name: 'KC', avatar: '/a.png' },
    system_label: { kind: 'text', text: 'Game Boy Color' },
    timer: { kind: 'stat', text: '11:49', unit: '', urgency: 'warn', stale: false },
  };
  const resolveField = (f) => fieldDescriptors[f];

  it('renders one field per listed name, in order', () => {
    const { container } = render(<OverlayLayer overlays={sessionOverlay} resolve={() => null} resolveField={resolveField} />);
    const el = container.querySelector('[data-overlay-id="session"]');
    expect(el.className).toContain('emu-overlay--session');
    const names = Array.from(el.querySelectorAll('.emu-overlay-session__field')).map((f) => f.className);
    expect(names[0]).toContain('--player');
    expect(names[1]).toContain('--system_label');
    expect(names[2]).toContain('--timer');
  });

  it('carries urgency onto the field that reports it', () => {
    const { container } = render(<OverlayLayer overlays={sessionOverlay} resolve={() => null} resolveField={resolveField} />);
    expect(container.querySelector('.emu-overlay-session__field--timer').className).toContain('is-warn');
  });

  it('renders nothing for a session overlay with an empty fields list', () => {
    const empty = [{ id: 'session', kind: 'session', fields: [] }];
    const { container } = render(<OverlayLayer overlays={empty} resolve={() => null} resolveField={resolveField} />);
    expect(container.querySelector('[data-overlay-id="session"]')).toBeNull();
  });

  it('skips one field that individually resolves empty, keeping the rest', () => {
    const partial = (f) => (f === 'system_label' ? { empty: true, text: '' } : fieldDescriptors[f]);
    const { container } = render(<OverlayLayer overlays={sessionOverlay} resolve={() => null} resolveField={partial} />);
    const el = container.querySelector('[data-overlay-id="session"]');
    expect(el.querySelectorAll('.emu-overlay-session__field').length).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator/ui/OverlayLayer.test.jsx`
Expected: FAIL — no `session`-kind handling exists; `resolveField` is unused.

**Step 3: Implement**

```jsx
import React from 'react';
import { regionStyle } from './regionStyle.js';
import { anchorStyle } from './anchorStyle.js';

function OverlayBody({ d }) {
  if (!d || d.empty) return null;
  if (d.kind === 'player') {
    return (
      <>
        {d.avatar ? <img className="emu-overlay__avatar" src={d.avatar} alt="" /> : null}
        <span className="emu-overlay__name">{d.name}</span>
      </>
    );
  }
  if (d.kind === 'stat') {
    return (
      <>
        <span className="emu-overlay__value">{d.text}</span>
        {d.unit ? <span className="emu-overlay__unit">{d.unit}</span> : null}
      </>
    );
  }
  return <span className="emu-overlay__value">{d.text}</span>;
}

function SessionOverlay({ overlay, resolveField }) {
  const fields = overlay.fields || [];
  if (fields.length === 0) return null;
  return (
    <div className="emu-overlay emu-overlay--session" data-overlay-id={overlay.id} style={anchorStyle(overlay)}>
      {fields.map((field) => {
        const d = (typeof resolveField === 'function' && resolveField(field)) || { empty: true, text: '' };
        if (d.empty) return null;
        const cls = `emu-overlay-session__field emu-overlay-session__field--${field}`
          + (d.urgency ? ` is-${d.urgency}` : '')
          + (d.stale ? ' is-stale' : '');
        return (
          <div key={field} className={cls}>
            <OverlayBody d={d} />
          </div>
        );
      })}
    </div>
  );
}

export function OverlayLayer({ overlays = [], resolve, resolveField }) {
  if (!overlays || overlays.length === 0) return null;

  return (
    <div className="emu-overlay-layer">
      {overlays.map((o) => {
        if (o.kind === 'session') {
          return <SessionOverlay key={o.id} overlay={o} resolveField={resolveField} />;
        }
        const d = (typeof resolve === 'function' && resolve(o)) || { empty: true, text: '' };
        const kind = d.empty ? 'empty' : d.kind || 'text';
        const cls = `emu-overlay emu-overlay--${kind}${d.empty ? ' is-empty' : ''}`;
        return (
          <div key={o.id} className={cls} data-overlay-id={o.id} style={regionStyle(o.region)}>
            <OverlayBody d={d} />
          </div>
        );
      })}
    </div>
  );
}

export default OverlayLayer;
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator/ui/OverlayLayer.test.jsx`
Expected: PASS (all tests, including the 5 pre-existing ones — the region-based
path is untouched)

**Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/ui/OverlayLayer.jsx frontend/src/modules/Emulator/ui/OverlayLayer.test.jsx
git commit -m "feat(emulator): render an anchor-positioned session overlay in OverlayLayer"
```

---

### Task 8: Frontend — `usePlayBudget` exposes `systemLabel`/`overlayConfig`

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/usePlayBudget.js`
- Test: `frontend/src/modules/Fitness/widgets/EmulatorGame/usePlayBudget.test.js`

**Step 1: Write the failing tests**

Append to the `describe('derivePlayBudget', ...)` block:

```js
it('passes the systemLabel and resolved overlay config through from the message', () => {
  const overlay = { anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5, fields: ['player', 'timer'] };
  const r = at({ playedMs: 1000, systemLabel: 'Game Boy Color', overlay });
  expect(r.systemLabel).toBe('Game Boy Color');
  expect(r.overlayConfig).toEqual(overlay);
});

it('reports null systemLabel/overlayConfig when there is no session', () => {
  expect(at(null)).toMatchObject({ systemLabel: null, overlayConfig: null });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run --pool=forks frontend/src/modules/Fitness/widgets/EmulatorGame/usePlayBudget.test.js`
Expected: FAIL — `r.systemLabel`/`r.overlayConfig` are `undefined`.

**Step 3: Implement**

In `usePlayBudget.js`, thread the two passthrough fields onto every branch of
`derivePlayBudget`:

```js
export function derivePlayBudget({ message, receivedAt, now }) {
  const systemLabel = message?.systemLabel ?? null;
  const overlayConfig = message?.overlay ?? null;
  if (!message) return { visible: false, stale: false, mode: 'idle', label: '--:--', ms: 0, systemLabel, overlayConfig };

  const age = now - receivedAt;
  const stale = age > STALE_AFTER_MS;
  const drift = stale || message.state === 'paused' ? 0 : age;

  if (message.remainingMs == null) {
    return {
      visible: true, stale, mode: 'elapsed',
      ms: Math.max(0, (message.playedMs ?? 0) + drift),
      label: 'played', warning: message.warning ?? null,
      systemLabel, overlayConfig,
    };
  }
  const left = Math.max(0, message.remainingMs - drift);
  return {
    visible: true, stale, mode: 'remaining', ms: left,
    label: left <= 0 ? "time's up" : 'remaining',
    urgency: left <= 60_000 ? 'crit' : (left <= 180_000 ? 'warn' : null),
    warning: message.warning ?? null,
    systemLabel, overlayConfig,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run --pool=forks frontend/src/modules/Fitness/widgets/EmulatorGame/usePlayBudget.test.js`
Expected: PASS (all tests — the pre-existing ones use `toMatchObject`/single-field
assertions, so the two new fields don't break them)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/EmulatorGame/usePlayBudget.js frontend/src/modules/Fitness/widgets/EmulatorGame/usePlayBudget.test.js
git commit -m "feat(fitness): pass systemLabel and overlay config through usePlayBudget"
```

---

### Task 9: Frontend — `EmulatorConsole.jsx` renders the session overlay, drops dead code

**Files:**
- Modify: `frontend/src/modules/Emulator/EmulatorConsole.jsx`

No new test file — this task wires already-tested pieces (Tasks 5–7) together;
its correctness is verified by the widget-level test in Task 10 and the
visual check in Task 14.

**Step 1: Remove the dead count-up timer plumbing**

Delete the `playStartedAt` prop (line 119: `playStartedAt = null,`), the
`elapsedSec` state and its effect (lines 195–203):

```js
  // Count-up play timer (seconds since launch), ticked every 1s.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!playStartedAt) return undefined;
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - playStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [playStartedAt]);
```

and the `'session.play_seconds': elapsedSec,` line inside the `overlayData`
`useMemo` (line 233). Verified by grep (Task-planning research) that nothing
else in the codebase reads `session.play_seconds`, `elapsedSec`, or
`playStartedAt` once the manifest `timer` overlays are gone (Task 13).

**Step 2: Accept the new props and extend `overlayData`**

Add two new props alongside `nowPlaying`:

```js
  // Now-playing person ({ name, avatarSrc }) for the player overlay.
  nowPlaying = null,
  // Console/system label (e.g. "Game Boy Color") and the pre-computed
  // {text, urgency, stale} clock for the unified session badge.
  systemLabel = null,
  sessionTimer = null,
  // Resolved arcade-overlay.yml config for THIS system: {anchor, offsetX,
  // offsetY, scale, fields}. Absent/empty fields ⇒ no session badge at all.
  sessionOverlayConfig = null,
```

Update the `overlayData` `useMemo` (was lines 226-236):

```js
  const overlayData = useMemo(() => ({
    ...overlayDataProp,
    'session.current_player': nowPlaying
      ? { name: nowPlaying.name, avatar: nowPlaying.avatarSrc }
      : (overlayDataProp['session.current_player'] ?? null),
    'session.system_label': systemLabel ?? overlayDataProp['session.system_label'] ?? null,
    'session.timer': sessionTimer ?? overlayDataProp['session.timer'] ?? null,
    // Coins economy not built yet — render a literal placeholder.
    'session.coins': overlayDataProp['session.coins'] ?? '—',
  }), [overlayDataProp, nowPlaying, systemLabel, sessionTimer]);
```

**Step 3: Synthesize the session overlay entry and add a field resolver**

Near the existing `resolveOverlay` callback (was lines 924-933), add a
sibling and extend the overlays list:

```js
  const sessionFields = sessionOverlayConfig?.fields || [];
  const allOverlays = sessionFields.length
    ? [...overlays, { id: 'session', kind: 'session', ...sessionOverlayConfig }]
    : overlays;

  const resolveOverlay = useCallback(
    (o) =>
      formatOverlayValue(
        o.format,
        resolveOverlayValue(o.source, { gameState, governance: status, overlayData }),
      ),
    [gameState, status, overlayData],
  );

  // Each session field maps to a fixed source+format — `player` reuses the
  // existing player_card rendering, `timer` is the new countdown format,
  // `system_label` needs no format at all (resolveOverlayValue's generic
  // overlayData branch already returns a plain string, which formatOverlayValue's
  // default branch renders as text).
  const SESSION_FORMATS = { player: 'player_card', timer: 'countdown' };
  const resolveSessionField = useCallback(
    (field) => formatOverlayValue(
      SESSION_FORMATS[field],
      resolveOverlayValue(`session.${field === 'player' ? 'current_player' : field}`, { gameState, governance: status, overlayData }),
    ),
    [gameState, status, overlayData],
  );
```

**Step 4: Pass the new resolver + overlays to `OverlayLayer`**

Where the component renders (was line 958):

```jsx
      <OverlayLayer overlays={allOverlays} resolve={resolveOverlay} resolveField={resolveSessionField} />
```

**Step 5: Run the emulator test suite**

Run: `npx vitest run --pool=forks frontend/src/modules/Emulator`
Expected: PASS. If any existing `EmulatorConsole` test asserted on
`playStartedAt`/count-up behavior, it will fail here — fix by removing that
assertion (the count-up timer's replacement is the session badge's `timer`
field, driven by `sessionTimer` from outside, not derived internally anymore).

**Step 6: Commit**

```bash
git add frontend/src/modules/Emulator/EmulatorConsole.jsx
git commit -m "feat(emulator): render the unified session overlay, drop the count-up timer"
```

---

### Task 10: Frontend — `EmulatorGameWidget.jsx` feeds the console, drops the old box

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx`

**Step 1: Write the failing test (update the existing one)**

Update the `EmulatorConsole` mock (lines 19–38) to surface the two new props:

```jsx
vi.mock('../../../Emulator/EmulatorConsole.jsx', () => ({
  EmulatorConsole: (props) => (
    <>
      <div
        data-testid="console"
        data-game={props.game?.id}
        data-haskbd={!!props.engineConfig?.controls}
        data-core={props.engineConfig?.core}
        data-gate={props.governanceGate?.mode}
        data-persist={props.persistence?.persist ? '1' : '0'}
        data-user={props.persistence?.userId || ''}
        data-player={props.nowPlaying?.name || ''}
        data-coins={props.overlayData?.['session.coins'] ?? ''}
        data-system-label={props.systemLabel || ''}
        data-timer={props.sessionTimer?.text || ''}
      />
      <button data-testid="exit" onClick={() => props.onExit?.()}>exit</button>
      <button data-testid="play-signal" onClick={() => props.onPlayStateChange?.('playing')}>playing</button>
      <button data-testid="pause-signal" onClick={() => props.onPlayStateChange?.('paused')}>paused</button>
    </>
  ),
}));
```

Replace the "subscribes to the device play feed and renders the server play
clock" test (lines 142–157) — it currently asserts a `data-testid="play-budget"`
node this change deletes:

```jsx
it('subscribes to the device play feed and feeds the server clock to the console', async () => {
  api.mockResolvedValue(libraryWith('none'));
  render(<EmulatorGameWidget fitnessContext={fitnessContext} deviceId="garage-tv" onClose={() => {}} config={{}} onMount={() => {}} />);
  await waitFor(() => expect(bus.subscribe).toHaveBeenCalledWith(
    'play-session:garage-tv', expect.any(Function),
  ));
  await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
  fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
  await screen.findByTestId('console');

  const subscription = bus.subscriptions.find((entry) => entry.topic === 'play-session:garage-tv');
  subscription.handler({ event: 'play.session.progress', state: 'playing', playedMs: 95_000, systemLabel: 'Game Boy' });

  await waitFor(() => expect(screen.getByTestId('console')).toHaveAttribute('data-timer', '01:35'));
  expect(screen.getByTestId('console')).toHaveAttribute('data-system-label', 'Game Boy');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx`
Expected: FAIL — `EmulatorConsole` never receives `systemLabel`/`sessionTimer`
yet, so both new `data-*` attributes are empty.

**Step 3: Implement**

In `EmulatorGameWidget.jsx`, delete the inline play-budget `<div>` (lines
464–475):

```jsx
          {playBudget.visible && (
            <div
              className={`fitness-emulator-play-budget${playBudget.urgency ? ` is-${playBudget.urgency}` : ''}${playBudget.stale ? ' is-stale' : ''}`}
              data-testid="play-budget"
              role="status"
              aria-live="polite"
            >
              <strong>{formatClock(playBudget.ms)}</strong>
              <span>{playBudget.stale ? 'meter offline' : playBudget.label}</span>
              {playBudget.warning && <small>{playBudget.warning}</small>}
            </div>
          )}
```

Replace the `overlayData` `useMemo` (lines 403–407) with one that also
computes the session timer, and stop passing `playStartedAt`:

```js
  // Session overlay data: the coin placeholder (only while a coin gate is
  // live) plus nothing else here — player/system_label/timer are passed as
  // their own props below so EmulatorConsole can merge them consistently
  // whether they come from this widget or a future non-Fitness host.
  const overlayData = useMemo(() => (
    activeGate?.mode === 'coin-metered' && coins != null
      ? { 'session.coins': coins }
      : undefined
  ), [activeGate, coins]);

  // Pre-formatted for the session badge — clock TEXT plus urgency/staleness,
  // computed once here from the same usePlayBudget derivation the deleted
  // box used, never recomputed inside EmulatorConsole.
  const sessionTimer = useMemo(() => (
    playBudget.visible
      ? { text: formatClock(playBudget.ms), urgency: playBudget.urgency ?? null, stale: playBudget.stale }
      : null
  ), [playBudget.visible, playBudget.ms, playBudget.urgency, playBudget.stale]);
```

Update the `<EmulatorConsole>` call site (was lines 448–463): remove
`playStartedAt={launch.startedAt}`, add the three new props:

```jsx
          <EmulatorConsole
            key={launch.key}
            game={launch.game}
            engineConfig={launch.engineConfig}
            governanceGate={launch.gate}
            identity={{ getActivePlayerId: () => launch.userId }}
            persistence={launch.persistence}
            overlayData={overlayData}
            autosaveSeconds={autosaveSeconds}
            nowPlaying={launch.person}
            systemLabel={playBudget.systemLabel}
            sessionTimer={sessionTimer}
            sessionOverlayConfig={playBudget.overlayConfig}
            resolveMediaUrl={(p) => DaylightMediaPath(p)}
            showInputActivity={settings.inputActivityLed !== false}
            onPlayStateChange={handlePlayStateChange}
            onExit={handleExitGame}
          />
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx
git commit -m "feat(fitness): feed the session badge from usePlayBudget, delete the hardcoded box"
```

---

### Task 11: Styling — delete the old box, style the session badge

**Files:**
- Modify: `frontend/src/modules/Emulator/EmulatorConsole.scss`

**Step 1: Delete the old hardcoded box CSS**

Remove the entire `.fitness-emulator-play-budget { ... }` block (was lines
506–530, right after the `.fitness-emulator-fullscreen` rule and before the
kiosk cursor-hide rule — leave those two untouched).

**Step 2: Add the session badge styling**

Add this near the existing `.emu-overlay--player` rule (inside the same
`.emu-overlay { ... }` block, was around line 190), as a sibling modifier —
and the field-level rules just after the closing brace of `.emu-overlay`:

```scss
    &.emu-overlay--session {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.2em;
      padding: 0.6em 0.9em;
      border-radius: 0.6em;
      background: rgba(8, 10, 15, 0.78);
      z-index: 6;
    }
  }

  // One row per configured field inside the session badge. Urgency/stale
  // reuse the same semantics (and, deliberately, similar colors) as the
  // native arcade-film.html overlay — same visual spec, independent files.
  .emu-overlay-session__field {
    display: flex;
    align-items: center;
    gap: 0.35em;

    &--player { flex-direction: row; }
    &--timer .emu-overlay__value { font-size: 1.8rem; }
    &.is-warn .emu-overlay__value { color: #ffd666; }
    &.is-crit .emu-overlay__value { color: #ff6b6b; }
    &.is-stale .emu-overlay__value { color: #9aa4b2; }
  }
```

(Note the extra closing `}` — `.emu-overlay--session` closes out the
`.emu-overlay { ... }` parent block, and `.emu-overlay-session__field` is a
new top-level-within-`.emulator-console` sibling rule, matching how
`.emu-overlay-layer`/`.emu-hotspot-layer` are already siblings of `.emu-overlay`
in this file.)

**Step 3: Verify the build**

Run: `node scripts/check-scss-build.mjs` (the project's SCSS build gate,
already run by the pre-commit hook — run it directly here to catch a syntax
error before committing).
Expected: `SCSS build gate OK`

**Step 4: Commit**

```bash
git add frontend/src/modules/Emulator/EmulatorConsole.scss
git commit -m "style(emulator): delete the hardcoded play-budget box, style the session badge"
```

---

### Task 12: Native overlay — `arcade-film.html` reads `fields`, drops the placeholder skin

**Files:**
- Modify: `frontend/public/arcade-film.html`

No automated test — this file has none today (it's driven by
`window.__arcadeFilm` for manual/screenshot verification, per its own source
comment). Verified in Task 14 by screenshotting the real device.

**Step 1: Remove the placeholder skin**

Delete these CSS rules (the file's placeholder-specific styling):

```css
  #banner.placeholder{border:2px dashed rgba(255,214,102,.75);border-top:2px dashed rgba(255,214,102,.75);
    background:rgba(10,12,18,.82)}
  #meta{display:none;font-size:calc(var(--u) * 1.1);line-height:1.35;color:#7f8a99;
    font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre;text-align:left}
  #banner.placeholder #meta{display:block}
```
```css
  #banner.placeholder.stacked #meta{margin-top:calc(var(--u) * .6)}
```

Replace the base `#banner{...}` background/border with the shared visual spec
(same numbers as `EmulatorConsole.scss`'s `.emu-overlay--session`):

```css
  #banner{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;
    display:none;align-items:center;
    gap:calc(var(--u) * 2.8);padding:calc(var(--u) * 2.2) calc(var(--u) * 4);
    overflow:hidden;
    background:rgba(8,10,15,.78);
    border-radius:calc(var(--u) * 1.2);
    box-shadow:0 -10px 50px rgba(0,0,0,.5)}
```

(Drops the old gradient + `border-top:4px solid #ffd666` + heavy shadow —
the accent color moves to the urgency states below, which already exist and
are untouched: `body.warn`/`body.crit` `#clock` color.)

Add a small `.hide-field{display:none !important}` rule near the existing
`.shed{display:none !important}` rule.

**Step 2: Remove the debug meta dump**

Delete the `<div id="meta"></div>` element from the `#banner` markup, the
`metaLines()` function, and the line `document.getElementById('meta').textContent
= metaLines(m);` inside `show()`. Also remove `document.getElementById('meta')`
from the `optional` array inside `fit()`:

```js
function fit() {
  if (!placement || !rectOk(placement.toast)) return;
  var optional = [barEl, avEl];   // was: [document.getElementById('meta'), barEl, avEl]
  ...
```

Remove `banner.classList.add('placeholder');` from `show()`.

**Step 3: Add field-visibility**

Add a small function near `place()`:

```js
function applyFields(fields) {
  var set = {};
  (fields || ['player', 'system_label', 'timer']).forEach(function (f) { set[f] = true; });
  document.getElementById('name').classList.toggle('hide-field', !set.player);
  avEl.classList.toggle('hide-field', !set.player);
  document.getElementById('sub').classList.toggle('hide-field', !set.system_label);
  document.querySelector('.timer').classList.toggle('hide-field', !set.timer);
}
```

Call it from `handle()`, right where `placement` is already applied on any
message:

```js
    if (m.placement !== undefined) place(m.placement);
    if (m.overlay !== undefined) applyFields(m.overlay && m.overlay.fields);
    if (m.event === 'play.session.started') show(m);
```

**Step 4: Manual verification via the existing test seam**

This file's own comment says it exposes `window.__arcadeFilm.handle()`
specifically so its states can be "driven and screenshotted in a headless
browser... without taking over a television." Use that: open the file
locally (`open frontend/public/arcade-film.html` or serve it via the dev
server) and in the console:

```js
window.__arcadeFilm.handle({
  event: 'play.session.started', displayName: 'Robin', systemLabel: 'Game Boy Color',
  playedMs: 0, remainingMs: 300000, grantedMs: 600000,
  placement: { toast: [0.1, 0.1, 0.3, 0.15], orientation: 'wide' },
  overlay: { fields: ['player', 'timer'] },
});
```

Confirm: no dashed border, no debug text dump, the system label (`#sub`) is
hidden (it's not in `fields`), player + clock show.

**Step 5: Commit**

```bash
git add frontend/public/arcade-film.html
git commit -m "feat(gaming): drive arcade-film.html field visibility from overlay config, drop the placeholder skin"
```

---

### Task 13: Data — retire the redundant per-manifest `timer`/`player` overlays

**Files (real household data tree, NOT in this git repo — see
`CLAUDE.local.md`'s "Reading app config/auth locally" section for why):**
- `$DAYLIGHT_BASE_PATH/media/emulation/gb/gameboy.yml`
- `$DAYLIGHT_BASE_PATH/media/emulation/gba/gba.yml`
- `$DAYLIGHT_BASE_PATH/media/emulation/gbc/gbc.yml`
- `$DAYLIGHT_BASE_PATH/media/emulation/genesis/genesis.yml`

Where `$DAYLIGHT_BASE_PATH` = `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation`
(from `.env`). `snes`/`n64` manifests declare no overlays today — no edit
needed.

**Step 1: `gameboy.yml`** — in the top-level `overlays:` block, delete the
`timer` and `player` entries, keeping `coins`:

```yaml
  overlays:
    - id: coins             # right pocket - placeholder until the economy lands
      region: { x: 71.77, y: 51.85, width: 12.19, height: 12.04 }
      source: session.coins
      format: coins
```

(The `badges` overlay nested under the Pokémon game-specific override, ~line
149, is untouched — a different concept.)

**Step 2: `gba.yml`** — same pattern, delete `timer` and `player`, keep `coins`:

```yaml
  overlays:
    - id: coins
      region: { x: 17.969, y: 90.185, width: 13.281, height: 9.815 }
      source: session.coins
      format: coins
```

**Step 3: `gbc.yml`** — delete `timer` and `player`, keep `coins`:

```yaml
  overlays:
    - id: coins
      region: { x: 10.365, y: 59.259, width: 13.906, height: 13.889 }
      source: session.coins
      format: coins
```

**Step 4: `genesis.yml`** — delete `timer`, keep `coins` (this manifest never
had a `player` overlay):

```yaml
  overlays:
    - id: coins
      region: { x: 4.167, y: 29.630, width: 11.979, height: 9.259 }
      source: session.coins
```
(confirm the exact remaining lines with `sed -n '215,240p' genesis.yml` before
editing — the snippet above is truncated from the read at plan-writing time.)

**Step 5: Verify the backend picks it up**

Config here is loaded fresh per-request from the media tree (not the cached
household-config path), but if a dev server is running against this data,
restart it or hit whatever reload path `loadEmulatorConfig.mjs` exposes. Then
confirm via `curl` or the running app that `gb`/`gbc`/`gba`/`genesis` each
report exactly one overlay (`coins`) from `presentation.overlays`.

**Step 6: No git commit** — these files are outside this repository.

---

### Task 14: Visual verification across all three surfaces

**No files changed — this is a manual verification pass.**

**Step 1: Garage kiosk (browser EmulatorJS + Fitness widget)**

```bash
ssh garage "sudo -u kckern DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority scrot -z /tmp/garage-verify.png"
scp garage:/tmp/garage-verify.png /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/logs/garage-verify-$(date +%Y%m%d-%H%M%S).png
ssh garage "rm -f /tmp/garage-verify.png"
```

Confirm: exactly ONE badge on screen (no more duplicate clock), sitting
top-left per the shipped defaults, no clipping.

**Step 2: Shield/RetroArch device**

```bash
FKB_HOST=10.0.0.12:2323 node cli/fkb.cli.mjs adb-connect
FKB_HOST=10.0.0.12:2323 node cli/fkb.cli.mjs adb "screencap -p /sdcard/verify.png"
adb -s 10.0.0.12:5555 pull /sdcard/verify.png /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/logs/shield-verify-$(date +%Y%m%d-%H%M%S).png
adb -s 10.0.0.12:5555 shell rm /sdcard/verify.png
```

Confirm: no dashed yellow border, no debug field dump, the badge uses the
shared visual spec (dark translucent background, no border except in a
degraded/`is-stale` state).

**Step 3: Per-console override sanity check**

Temporarily add a `systems: { gbc: { anchor: bottom-right } }` override to
the real `arcade-overlay.yml`, restart/reload config, re-screenshot the
garage kiosk on a Game Boy Color game specifically, confirm the badge moved
to the bottom-right corner, then revert the override.

**Step 4: Full test suite for the touched areas**

```bash
npx vitest run --pool=forks frontend/src/modules/Emulator frontend/src/modules/Fitness/widgets/EmulatorGame backend/src/2_domains/gaming backend/src/1_adapters/eventbus/EventBusPlaySessionAnnouncer.test.mjs
```

Expected: all pass, 0 failures.

**Step 5: Update the design doc's status line**

In `docs/_wip/plans/2026-09-19-arcade-overlay-config-design.md`, change
`Status: design validated...` to `Status: implemented 2026-09-19` (or the
actual completion date) and commit:

```bash
git add docs/_wip/plans/2026-09-19-arcade-overlay-config-design.md
git commit -m "docs(gaming): mark the arcade session overlay design as implemented"
```
