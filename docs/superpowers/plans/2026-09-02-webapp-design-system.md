# Webapp Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared webapp design system (tokens, base theme, packs, primitives, anti-slop audit gate) that the Health revamp and later app migrations consume via `@/lib/theme` and `@/lib/ui`.

**Architecture:** Semantic token contract exposed both as Mantine color ramps and `--ds-*` CSS custom properties; a small set of behavior-owning primitives promoted from proven duplicates (Auto's data hook, Media's dismiss stack, Life's state triad); a baseline-style audit script wired into the existing pre-commit gate chain.

**Tech Stack:** React 18, Mantine 7.11, SCSS, vitest (jsdom) for unit tests, Playwright for visual verification.

**Spec:** `docs/superpowers/specs/2026-09-02-webapp-design-system-unification-design.md`

## Global Constraints

- All new frontend files live under `frontend/src/lib/theme/` and `frontend/src/lib/ui/` (plus one gallery route). Import via the `@` alias (`@/lib/ui`, `@/lib/theme`) — configured in `frontend/vite.config.js:52`.
- **Logging:** never raw `console.*`; use the logging framework (`frontend/src/lib/logging/`). New primitives log via the `createAppLogger` factory built in Task 3.
- **No raw color values** outside `lib/theme/` files — every color in `lib/ui/` SCSS/JSX comes from `var(--ds-*)` or Mantine theme vars. The audit script (Task 12) enforces this.
- **Breakpoints:** only `frontend/src/styles/_breakpoints.scss` mixins (`mobile-only`, `tablet-up`, `desktop-up`; `$bp-md: 768`, `$bp-lg: 1200`).
- Unit tests: colocated `*.test.jsx` / `*.test.js`, run with `npx vitest run <path>` from the repo root. jsdom cannot see layout — no layout assertions in unit tests; visual verification is the Playwright gallery test (Task 11).
- Frontend components: React function components, hooks-first, no class components. Icons are inline SVG, never emoji/unicode glyphs.
- Commits after every task (the pre-commit gate chain runs audits automatically). Commit messages end with the Claude Code trailer used repo-wide.
- Dev server check before Playwright: `ss -tlnp | grep 3112` (backend) / port from `tests/_lib/configHelper.mjs`.

---

### Task 1: Token contract, base theme, packs, and AppThemeProvider

**Files:**
- Create: `frontend/src/lib/theme/tokens.mjs`
- Create: `frontend/src/lib/theme/packs.mjs`
- Create: `frontend/src/lib/theme/createAppTheme.js`
- Create: `frontend/src/lib/ui/AppThemeProvider.jsx`
- Create: `frontend/src/lib/theme/tokens.test.mjs`

**Interfaces:**
- Produces: `DS_TOKENS` (object: `colors`, `status`, `motion`, `breakpoints`), `dsCssVars(pack?) → { '--ds-*': value }`, `PACKS` (`health`, `life`, `auto`, `home`, `media`), `createAppTheme(pack) → Mantine theme`, `<AppThemeProvider pack="health">…</AppThemeProvider>` (renders MantineProvider + a `div.ds-root` carrying the CSS vars).
- Consumed by: every later task; Health plan Task F1.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/lib/theme/tokens.test.mjs
import { describe, it, expect } from 'vitest';
import { DS_TOKENS, dsCssVars } from './tokens.mjs';
import { PACKS } from './packs.mjs';
import { createAppTheme } from './createAppTheme.js';

describe('DS token contract', () => {
  it('defines the seven semantic color roles', () => {
    for (const role of ['background','surface','surfaceAlt','border','textHigh','textMid','textLow']) {
      expect(DS_TOKENS.colors[role], role).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('defines reserved status colors and motion tokens', () => {
    for (const s of ['success','warning','danger','info','live']) {
      expect(DS_TOKENS.status[s], s).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(DS_TOKENS.motion.fast).toBe('120ms');
    expect(DS_TOKENS.motion.base).toBe('200ms');
    expect(DS_TOKENS.motion.reveal).toBe('300ms');
  });

  it('emits every token as a --ds-* CSS var', () => {
    const vars = dsCssVars();
    expect(vars['--ds-surface']).toBe(DS_TOKENS.colors.surface);
    expect(vars['--ds-danger']).toBe(DS_TOKENS.status.danger);
    expect(vars['--ds-motion-base']).toBe('200ms');
  });

  it('pack color overrides flow into the CSS vars', () => {
    const vars = dsCssVars(PACKS.health);
    expect(vars['--ds-accent']).toBe(PACKS.health.accent);
  });

  it('every pack has name, character, primaryColor, accent', () => {
    for (const [key, pack] of Object.entries(PACKS)) {
      expect(pack.name, key).toBeTruthy();
      expect(pack.character.length, key).toBeGreaterThan(20);
      expect(pack.primaryColor, key).toBeTruthy();
      expect(pack.accent, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('createAppTheme builds a Mantine theme with semantic ramps', () => {
    const theme = createAppTheme(PACKS.health);
    expect(theme.primaryColor).toBe('blue');
    expect(theme.colors.surface).toHaveLength(10);
    expect(theme.other.success).toBe(DS_TOKENS.status.success);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/theme/tokens.test.mjs`
Expected: FAIL — cannot resolve `./tokens.mjs`

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/lib/theme/tokens.mjs
//
// The design-system token contract. The ONLY place base colors, status
// colors, motion durations, and breakpoints are defined as raw values.
// Everything else consumes them via Mantine theme vars or --ds-* CSS vars.
// Values adopted from HealthApp.theme.js / LifeApp.theme.js (identical ramps).

export const DS_TOKENS = Object.freeze({
  colors: Object.freeze({
    background: '#0f1419',
    surface:    '#1c2229',
    surfaceAlt: '#0a0e12',
    border:     '#2d3743',
    textHigh:   '#e8eef3',
    textMid:    '#94a3b8',
    textLow:    '#6b7785',
  }),
  status: Object.freeze({
    success: '#3fb950',
    warning: '#d29922',
    danger:  '#f85149',
    info:    '#58a6ff',
    live:    '#ff6b6b',
  }),
  motion: Object.freeze({
    fast:   '120ms',
    base:   '200ms',
    reveal: '300ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  }),
  // Mirrors frontend/src/styles/_breakpoints.scss — change both together.
  breakpoints: Object.freeze({ md: 768, lg: 1200 }),
});

/**
 * Emit the token set as --ds-* CSS custom properties, with pack overrides
 * applied. This is how non-Mantine SCSS consumes the same contract.
 * @param {Object} [pack] - a PACKS entry (may override colors, adds accent)
 * @returns {Object} style object of CSS custom properties
 */
export function dsCssVars(pack = null) {
  const colors = { ...DS_TOKENS.colors, ...(pack?.colors || {}) };
  const vars = {};
  for (const [role, hex] of Object.entries(colors)) {
    vars[`--ds-${role.replace(/([A-Z])/g, '-$1').toLowerCase()}`] = hex;
  }
  for (const [name, hex] of Object.entries(DS_TOKENS.status)) {
    vars[`--ds-${name}`] = hex;
  }
  vars['--ds-motion-fast'] = DS_TOKENS.motion.fast;
  vars['--ds-motion-base'] = DS_TOKENS.motion.base;
  vars['--ds-motion-reveal'] = DS_TOKENS.motion.reveal;
  vars['--ds-motion-easing'] = DS_TOKENS.motion.easing;
  if (pack?.accent) vars['--ds-accent'] = pack.accent;
  return vars;
}

export default DS_TOKENS;
```

```javascript
// frontend/src/lib/theme/packs.mjs
//
// Per-app theme packs. A pack owns art direction (accent, primary, optional
// color overrides) and carries a direction statement so drift is a visible
// decision (spec: anti-slop Tier 3). The base contract owns everything else.

export const PACKS = Object.freeze({
  health: Object.freeze({
    name: 'health',
    character: 'Quiet clinical focus: the daily log is the screen; numbers '
      + 'are tabular and calm; the single blue accent marks the budget and '
      + 'primary actions, nothing else.',
    primaryColor: 'blue',
    accent: '#4dabf7',
  }),
  life: Object.freeze({
    name: 'life',
    character: 'Reflective planning space: violet accent for commitments and '
      + 'goals; generous whitespace; reads like a journal, not a dashboard.',
    primaryColor: 'violet',
    accent: '#9775fa',
  }),
  auto: Object.freeze({
    name: 'auto',
    character: 'Garage utility: condensed, dense, glanceable numbers; one '
      + 'amber-green accent for OK states; built for a phone held in one hand.',
    primaryColor: 'teal',
    accent: '#2dd4bf',
  }),
  home: Object.freeze({
    name: 'home',
    character: 'Ambient household glance: camera tiles and status, minimal '
      + 'chrome, nothing demands interaction.',
    primaryColor: 'gray',
    accent: '#94a3b8',
  }),
  media: Object.freeze({
    name: 'media',
    character: 'Amber-on-near-black theater chrome (product-owned; extends '
      + 'the base further in modules/Media/theme/mediaTheme.js during Phase 6).',
    primaryColor: 'orange',
    accent: '#f0a05a',
  }),
});

export default PACKS;
```

```javascript
// frontend/src/lib/theme/createAppTheme.js
import { createTheme } from '@mantine/core';
import { DS_TOKENS } from './tokens.mjs';

const ramp = (hex) => Array(10).fill(hex);

/**
 * Build a Mantine theme from the base token contract + an app pack.
 * Semantic ramps read in SCSS as var(--mantine-color-surface-0) etc.
 * Component defaults adopted from mediaTheme's touch-target discipline.
 */
export function createAppTheme(pack) {
  const colors = { ...DS_TOKENS.colors, ...(pack?.colors || {}) };
  return createTheme({
    primaryColor: pack?.primaryColor || 'blue',
    colors: {
      background: ramp(colors.background),
      surface:    ramp(colors.surface),
      surfaceAlt: ramp(colors.surfaceAlt),
      border:     ramp(colors.border),
      textHigh:   ramp(colors.textHigh),
      textMid:    ramp(colors.textMid),
      textLow:    ramp(colors.textLow),
    },
    other: { ...DS_TOKENS.status, accent: pack?.accent || null },
    components: {
      Button: { defaultProps: { size: 'md' } },
      ActionIcon: { defaultProps: { size: 'lg', variant: 'subtle' } },
      Modal: { defaultProps: { centered: true, radius: 'md' } },
      Drawer: { defaultProps: { radius: 'md' } },
    },
  });
}

export default createAppTheme;
```

```jsx
// frontend/src/lib/ui/AppThemeProvider.jsx
import { useMemo } from 'react';
import { MantineProvider } from '@mantine/core';
import { createAppTheme } from '../theme/createAppTheme.js';
import { dsCssVars } from '../theme/tokens.mjs';
import { PACKS } from '../theme/packs.mjs';

/**
 * Wraps an app in its themed MantineProvider and a .ds-root div carrying
 * the --ds-* custom properties, so both Mantine components and plain SCSS
 * consume the same token contract.
 */
export function AppThemeProvider({ pack = 'health', children }) {
  const packDef = typeof pack === 'string' ? PACKS[pack] : pack;
  const theme = useMemo(() => createAppTheme(packDef), [packDef]);
  const vars = useMemo(() => dsCssVars(packDef), [packDef]);
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <div className="ds-root" style={{ ...vars, minHeight: '100%' }}>
        {children}
      </div>
    </MantineProvider>
  );
}

export default AppThemeProvider;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/theme/tokens.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/theme/ frontend/src/lib/ui/AppThemeProvider.jsx
git commit -m "feat(ds): token contract, base theme, app packs, AppThemeProvider"
```

---

### Task 2: main.jsx base provider fix

**Files:**
- Modify: `frontend/src/main.jsx:172` (the outer `<MantineProvider>`)

**Interfaces:**
- Consumes: `createAppTheme` from Task 1.
- Produces: provider-less apps (Auto, Home, Feed, Finance) now inherit the dark base theme instead of Mantine defaults.

- [ ] **Step 1: Make the change**

In `frontend/src/main.jsx`, add imports after the existing MantineProvider import (line 4):

```javascript
import { createAppTheme } from './lib/theme/createAppTheme.js';
```

Replace the opening `<MantineProvider>` (line 172) with:

```jsx
  <MantineProvider theme={createAppTheme(null)} defaultColorScheme="dark">
```

(`createAppTheme(null)` is the base contract with no pack — Task 1's implementation already tolerates a null pack.)

- [ ] **Step 2: Verify no regression on themed apps**

Run: `npm run dev` if not already running (check `ss -tlnp | grep 3112` first), then load `/life` and `/health` in a browser or via the headless screenshot harness — both nest their own providers and must look unchanged; `/auto` and `/home` now render on the dark base.

Automated check: `npx vitest run frontend/src/lib/theme/tokens.test.mjs` still passes and `npm run check:parse` is green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main.jsx
git commit -m "fix(frontend): themed dark base provider for provider-less apps"
```

---

### Task 3: createAppLogger factory

**Files:**
- Create: `frontend/src/lib/ui/createAppLogger.js`
- Create: `frontend/src/lib/ui/createAppLogger.test.js`

**Interfaces:**
- Consumes: `getLogger` from `frontend/src/lib/logging/Logger.js` (default export, `.child({...})` API per CLAUDE.md).
- Produces: `createAppLogger(app) → { debug, info, warn, error, sampled, child(component) }` — lazy singleton per app; `child(component)` returns the same shape scoped `{ app, component }`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/lib/ui/createAppLogger.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../logging/Logger.js', () => {
  const emitted = [];
  const make = (ctx) => ({
    debug: (e, d) => emitted.push({ level: 'debug', e, d, ctx }),
    info:  (e, d) => emitted.push({ level: 'info', e, d, ctx }),
    warn:  (e, d) => emitted.push({ level: 'warn', e, d, ctx }),
    error: (e, d) => emitted.push({ level: 'error', e, d, ctx }),
    sampled: (e, d) => emitted.push({ level: 'sampled', e, d, ctx }),
    child: (c) => make({ ...ctx, ...c }),
  });
  return { default: () => make({}), __emitted: emitted };
});

import { createAppLogger } from './createAppLogger.js';
import * as mocked from '../logging/Logger.js';

describe('createAppLogger', () => {
  it('lazily creates a child logger scoped to the app', () => {
    const log = createAppLogger('testapp');
    log.info('hello', { a: 1 });
    const last = mocked.__emitted.at(-1);
    expect(last.e).toBe('hello');
    expect(last.ctx.app).toBe('testapp');
  });

  it('child() scopes a component under the app', () => {
    const log = createAppLogger('testapp').child('combobox');
    log.debug('evt');
    expect(mocked.__emitted.at(-1).ctx.component).toBe('combobox');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/ui/createAppLogger.test.js`
Expected: FAIL — cannot resolve `./createAppLogger.js`

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/lib/ui/createAppLogger.js
//
// The lazy module-logger boilerplate (repeated ~5x across apps), once.
// Lazy so import-time logger configuration races are impossible.
import getLogger from '../logging/Logger.js';

export function createAppLogger(app) {
  let _logger;
  const base = () => {
    if (!_logger) _logger = getLogger().child({ app });
    return _logger;
  };
  const facade = (get) => ({
    debug: (e, d) => get().debug(e, d),
    info:  (e, d) => get().info(e, d),
    warn:  (e, d) => get().warn(e, d),
    error: (e, d) => get().error(e, d),
    sampled: (e, d, o) => get().sampled(e, d, o),
    child: (component) => {
      let _child;
      return facade(() => {
        if (!_child) _child = get().child({ component });
        return _child;
      });
    },
  });
  return facade(base);
}

export default createAppLogger;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/ui/createAppLogger.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ui/createAppLogger.js frontend/src/lib/ui/createAppLogger.test.js
git commit -m "feat(ds): createAppLogger factory replacing per-app logger boilerplate"
```

---

### Task 4: useApiResource hook

**Files:**
- Create: `frontend/src/lib/hooks/useApiResource.js`
- Create: `frontend/src/lib/hooks/useApiResource.test.jsx`

**Interfaces:**
- Consumes: `DaylightAPI` from `frontend/src/lib/api.mjs` (`DaylightAPI(path)` GET; auto-POST when data passed), `createAppLogger` (Task 3).
- Produces: `useApiResource(path, { deps=[], enabled=true, label, logger }) → { data, loading, error, reload }`. Null/falsy `path` disables. Unmounted-in-flight responses are discarded. (This is Auto's `useAutoApi.js:18-54` promoted verbatim with an injectable logger.)

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/lib/hooks/useApiResource.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));

import { useApiResource } from './useApiResource.js';

describe('useApiResource', () => {
  beforeEach(() => apiMock.mockReset());

  it('loads data and clears loading', async () => {
    apiMock.mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(result.current.error).toBeNull();
  });

  it('captures errors', async () => {
    apiMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error.message).toBe('boom');
  });

  it('null path disables and does not call the API', () => {
    const { result } = renderHook(() => useApiResource(null));
    expect(result.current.loading).toBe(false);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('reload refetches', async () => {
    apiMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiResource('api/v1/thing'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    apiMock.mockResolvedValue({ n: 2 });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('discards responses that land after unmount', async () => {
    let resolve;
    apiMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useApiResource('api/v1/thing'));
    unmount();
    resolve({ late: true }); // must not throw or warn about state updates
    await new Promise((r) => setTimeout(r, 0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/hooks/useApiResource.test.jsx`
Expected: FAIL — cannot resolve `./useApiResource.js`

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/lib/hooks/useApiResource.js
//
// The house { data, loading, error, reload } fetch hook — promoted from
// modules/Auto/useAutoApi.js (same semantics: a request whose component
// unmounted mid-flight is discarded rather than written to state).
import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../api.mjs';
import { createAppLogger } from '../ui/createAppLogger.js';

const defaultLogger = createAppLogger('ds');

export function useApiResource(path, { deps = [], enabled = true, label, logger = defaultLogger } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && path));
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !path) { setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    setError(null);

    const startedAt = performance.now();
    DaylightAPI(path)
      .then((result) => {
        if (!live) return;
        setData(result);
        setLoading(false);
        logger.debug('api.loaded', { resource: label || path, ms: Math.round(performance.now() - startedAt) });
      })
      .catch((err) => {
        if (!live) return;
        setError(err);
        setLoading(false);
        logger.warn('api.failed', { resource: label || path, error: err?.message });
      });

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, nonce, ...deps]);

  return { data, loading, error, reload };
}

export default useApiResource;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/hooks/useApiResource.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/hooks/useApiResource.js frontend/src/lib/hooks/useApiResource.test.jsx
git commit -m "feat(ds): useApiResource — the shared data-fetch hook"
```

---

### Task 5: useHotkey hook

**Files:**
- Create: `frontend/src/lib/hooks/useHotkey.js`
- Create: `frontend/src/lib/hooks/useHotkey.test.jsx`

**Interfaces:**
- Produces: `useHotkey(combo, handler, { allowInInput = false } = {})`. Combos: `'mod+k'` (⌘/Ctrl), `'escape'`, `'/'`, plain letters. The "am I typing in an input?" check (input/textarea/select/contentEditable) lives here, once — the four ad-hoc keydown blocks it replaces each did this differently.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/lib/hooks/useHotkey.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHotkey } from './useHotkey.js';

const press = (key, opts = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));

describe('useHotkey', () => {
  it('fires on mod+k with metaKey or ctrlKey', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('mod+k', fn));
    press('k', { metaKey: true });
    press('k', { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not fire without the modifier', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('mod+k', fn));
    press('k');
    expect(fn).not.toHaveBeenCalled();
  });

  it('suppresses plain-key hotkeys while typing in an input', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('/', fn));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(fn).not.toHaveBeenCalled();
    input.remove();
  });

  it('escape fires even inside an input', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('escape', fn));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('removes the listener on unmount', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useHotkey('mod+k', fn));
    unmount();
    press('k', { metaKey: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/hooks/useHotkey.test.jsx`
Expected: FAIL — cannot resolve `./useHotkey.js`

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/lib/hooks/useHotkey.js
import { useEffect, useRef } from 'react';

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/**
 * Bind a global hotkey. `combo`: 'mod+k' (⌘ on mac / Ctrl elsewhere),
 * 'escape', '/', or a plain letter. Escape always fires; other combos are
 * suppressed while the user is typing unless allowInInput.
 */
export function useHotkey(combo, handler, { allowInInput = false } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const [mod, key] = combo.includes('+') ? combo.split('+') : [null, combo];
    const wantMod = mod === 'mod';
    const wantKey = key.toLowerCase();

    const onKey = (e) => {
      if (e.key.toLowerCase() !== wantKey) return;
      if (wantMod && !(e.metaKey || e.ctrlKey)) return;
      if (!wantMod && (e.metaKey || e.ctrlKey || e.altKey)) return;
      const escape = wantKey === 'escape';
      if (!escape && !allowInInput && isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      handlerRef.current(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [combo, allowInInput]);
}

export default useHotkey;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/hooks/useHotkey.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/hooks/useHotkey.js frontend/src/lib/hooks/useHotkey.test.jsx
git commit -m "feat(ds): useHotkey — one global hotkey helper with input guard"
```

---

### Task 6: State triad (LoadingState / ErrorState / EmptyState) + shared SCSS entry

**Files:**
- Create: `frontend/src/lib/ui/states.jsx`
- Create: `frontend/src/lib/ui/ds.scss`
- Create: `frontend/src/lib/ui/states.test.jsx`

**Interfaces:**
- Produces: `<LoadingState label?>` (renders `Skeleton` rows, `aria-busy`), `<ErrorState error onRetry label?>` (**onRetry is required** — throws in dev if missing; renders the error message + a Retry button), `<EmptyState title hint? action?>` (action = `{ label, onClick }`). All classnames `ds-state ds-state--{loading|error|empty}`. `ds.scss` is the DS stylesheet entry — later tasks append to it.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/lib/ui/states.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoadingState, ErrorState, EmptyState } from './states.jsx';

describe('state triad', () => {
  it('LoadingState is aria-busy and decorative', () => {
    const { container } = render(<LoadingState label="log" />);
    expect(container.querySelector('.ds-state--loading').getAttribute('aria-busy')).toBe('true');
  });

  it('ErrorState shows the message and wires retry', () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('boom')} onRetry={retry} />);
    expect(screen.getByText(/boom/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('ErrorState without onRetry throws (no dead ends)', () => {
    expect(() => render(<ErrorState error={new Error('x')} />)).toThrow(/onRetry/);
  });

  it('EmptyState renders title, hint, and action', () => {
    const act = vi.fn();
    render(<EmptyState title="Nothing yet" hint="Log something" action={{ label: 'Add', onClick: act }} />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(act).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/ui/states.test.jsx`
Expected: FAIL — cannot resolve `./states.jsx`

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/lib/ui/states.jsx
//
// The Loading / Error / Empty triad — the only way DS apps render async
// states. ErrorState REQUIRES a retry action: a dead-end error screen is a
// spec violation (anti-slop Tier 2), so its absence throws loudly.
import { Button } from '@mantine/core';
import Skeleton from './Skeleton.jsx';
import './ds.scss';

export function LoadingState({ label = 'content', rows = 3 }) {
  return (
    <div className="ds-state ds-state--loading" aria-busy="true" aria-label={`Loading ${label}`}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={20} width={`${90 - i * 15}%`} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry, label = 'This section' }) {
  if (typeof onRetry !== 'function') {
    throw new Error('ErrorState requires onRetry — errors must offer a next step');
  }
  return (
    <div className="ds-state ds-state--error" role="alert">
      <p className="ds-state__title">{label} failed to load</p>
      <p className="ds-state__detail">{error?.message || 'Unknown error'}</p>
      <Button size="xs" variant="light" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="ds-state ds-state--empty">
      <p className="ds-state__title">{title}</p>
      {hint ? <p className="ds-state__detail">{hint}</p> : null}
      {action ? (
        <Button size="xs" variant="light" onClick={action.onClick}>{action.label}</Button>
      ) : null}
    </div>
  );
}
```

```scss
// frontend/src/lib/ui/ds.scss
// Design-system stylesheet entry. Colors ONLY via --ds-* custom properties
// (set by AppThemeProvider); breakpoints ONLY via the shared mixins.
@use '../../styles/breakpoints' as bp;

.ds-state {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border-radius: 9px;
  background: var(--ds-surface);
  color: var(--ds-text-mid);

  &__title { margin: 0; color: var(--ds-text-high); font-weight: 600; }
  &__detail { margin: 0; font-size: 0.85rem; color: var(--ds-text-mid); }

  &--error &__title { color: var(--ds-danger); }
}
```

Note: check the actual `@use` path — `frontend/src/styles/_breakpoints.scss` is imported elsewhere as seen in `modules/Media/shell/MediaShell.scss`; copy that file's exact `@use`/`@import` line. If breakpoints aren't needed yet in this file, omit the line and add it when AppChrome (Task 9) needs it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/ui/states.test.jsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ui/states.jsx frontend/src/lib/ui/ds.scss frontend/src/lib/ui/states.test.jsx
git commit -m "feat(ds): Loading/Error/Empty state triad with mandatory retry"
```

---

### Task 7: SectionCard and StatCard

**Files:**
- Create: `frontend/src/lib/ui/cards.jsx`
- Modify: `frontend/src/lib/ui/ds.scss` (append card styles)
- Create: `frontend/src/lib/ui/cards.test.jsx`

**Interfaces:**
- Produces: `<SectionCard title actions? children>` (a titled surface panel; `actions` renders right-aligned in the header) and `<StatCard label value unit? trend? spark? emphasis?>` — label + big tabular number + optional trend node + optional sparkline node. `emphasis` (boolean) is the ONE louder variant (accent left border) — the single-focal-point rule.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/lib/ui/cards.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionCard, StatCard } from './cards.jsx';

describe('cards', () => {
  it('SectionCard renders title, actions, children', () => {
    render(
      <SectionCard title="Weight" actions={<button>edit</button>}>
        <span>body</span>
      </SectionCard>
    );
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'edit' })).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('StatCard renders label, value, unit and emphasis class', () => {
    const { container } = render(
      <StatCard label="Remaining" value={1140} unit="kcal" emphasis />
    );
    expect(screen.getByText('Remaining')).toBeTruthy();
    expect(screen.getByText('1140')).toBeTruthy();
    expect(screen.getByText('kcal')).toBeTruthy();
    expect(container.querySelector('.ds-stat--emphasis')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/ui/cards.test.jsx`
Expected: FAIL — cannot resolve `./cards.jsx`

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/lib/ui/cards.jsx
import './ds.scss';

/** A titled surface panel — the house card. */
export function SectionCard({ title, actions, children, className = '' }) {
  return (
    <section className={`ds-card ${className}`.trim()}>
      {(title || actions) ? (
        <header className="ds-card__header">
          {title ? <h3 className="ds-card__title">{title}</h3> : <span />}
          {actions ? <div className="ds-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ds-card__body">{children}</div>
    </section>
  );
}

/**
 * Label / big tabular number / trend / sparkline. `emphasis` is the ONE
 * louder variant — a screen should have at most one emphasized stat.
 */
export function StatCard({ label, value, unit, trend, spark, emphasis = false }) {
  return (
    <div className={`ds-stat${emphasis ? ' ds-stat--emphasis' : ''}`}>
      <span className="ds-stat__label">{label}</span>
      <span className="ds-stat__value">
        <span className="ds-stat__number">{value}</span>
        {unit ? <span className="ds-stat__unit">{unit}</span> : null}
      </span>
      {trend ? <span className="ds-stat__trend">{trend}</span> : null}
      {spark ? <div className="ds-stat__spark">{spark}</div> : null}
    </div>
  );
}
```

Append to `frontend/src/lib/ui/ds.scss`:

```scss
.ds-card {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: 9px;
  padding: 0.75rem 1rem;

  &__header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  &__title { margin: 0; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ds-text-mid); }
}

.ds-stat {
  display: flex; flex-direction: column; gap: 0.15rem;
  padding: 0.75rem 1rem;
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: 9px;

  &--emphasis { border-left: 3px solid var(--ds-accent, var(--ds-info)); }
  &__label { font-size: 0.75rem; color: var(--ds-text-mid); }
  &__value { display: flex; align-items: baseline; gap: 0.3rem; }
  &__number { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ds-text-high); }
  &__unit { font-size: 0.8rem; color: var(--ds-text-low); }
  &__trend { font-size: 0.8rem; color: var(--ds-text-mid); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/ui/cards.test.jsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ui/cards.jsx frontend/src/lib/ui/ds.scss frontend/src/lib/ui/cards.test.jsx
git commit -m "feat(ds): SectionCard and StatCard primitives"
```

---

### Task 8: Dismiss stack + Sheet

**Files:**
- Create: `frontend/src/lib/ui/dismiss/DismissStackProvider.jsx` (ported from `frontend/src/modules/Media/shell/DismissStackProvider.jsx` — read that file first and copy its mechanism; Media keeps its own copy until Phase 6)
- Create: `frontend/src/lib/ui/dismiss/useDismissLayer.js` (port of `frontend/src/modules/Media/shell/useDismissLayer.js`)
- Create: `frontend/src/lib/ui/Sheet.jsx`
- Modify: `frontend/src/lib/ui/ds.scss` (append sheet styles)
- Create: `frontend/src/lib/ui/Sheet.test.jsx`

**Interfaces:**
- Consumes: `useHotkey` (Task 5) for Escape inside DismissStackProvider.
- Produces: `<DismissStackProvider>` (top of an app; Escape dismisses the topmost registered layer), `useDismissLayer(open, onDismiss, { managed })`, `<Sheet open onClose title children>` — scrim + panel (bottom sheet on mobile, right panel on desktop via CSS), body-scroll-lock while open, close button, registers itself on the dismiss stack.

- [ ] **Step 1: Port the dismiss stack**

Read `frontend/src/modules/Media/shell/DismissStackProvider.jsx` and copy its provider into `frontend/src/lib/ui/dismiss/DismissStackProvider.jsx`, adjusting only imports (use `useHotkey('escape', …)` from Task 5 if the original binds its own keydown listener — keep the original's registration/managed semantics exactly). Copy `useDismissLayer.js` verbatim, fixing the provider import path. Export both from the new location.

- [ ] **Step 2: Write the failing Sheet test**

```jsx
// frontend/src/lib/ui/Sheet.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
import { Sheet } from './Sheet.jsx';

const wrap = (ui) => render(<DismissStackProvider>{ui}</DismissStackProvider>);

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    const { container } = wrap(<Sheet open={false} onClose={() => {}} title="T">x</Sheet>);
    expect(container.querySelector('.ds-sheet')).toBeNull();
  });

  it('renders title and children when open, closes on scrim click and Escape', () => {
    const onClose = vi.fn();
    const { container } = wrap(<Sheet open onClose={onClose} title="Portion">body</Sheet>);
    expect(screen.getByText('Portion')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(container.querySelector('.ds-sheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('locks body scroll while open and restores on unmount', () => {
    const { unmount } = wrap(<Sheet open onClose={() => {}} title="T">x</Sheet>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/ui/Sheet.test.jsx`
Expected: FAIL — cannot resolve `./Sheet.jsx`

- [ ] **Step 4: Write the Sheet implementation**

```jsx
// frontend/src/lib/ui/Sheet.jsx
import { useEffect } from 'react';
import { ActionIcon } from '@mantine/core';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import './ds.scss';

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * The house overlay: bottom sheet on mobile, right panel on desktop (CSS).
 * Registers on the dismiss stack (Escape), closes on scrim click, locks
 * body scroll while open.
 */
export function Sheet({ open, onClose, title, children }) {
  useDismissLayer(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <div className="ds-sheet__panel">
        <header className="ds-sheet__header">
          <h3 className="ds-sheet__title">{title}</h3>
          <ActionIcon onClick={onClose} aria-label="Close"><CloseIcon /></ActionIcon>
        </header>
        <div className="ds-sheet__body">{children}</div>
      </div>
    </div>
  );
}

export default Sheet;
```

Append to `frontend/src/lib/ui/ds.scss` (uses the breakpoints mixin — add the `@use` line from Task 6's note if not present):

```scss
.ds-sheet {
  position: fixed; inset: 0; z-index: 300;

  &__scrim {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.55); /* data-color: scrim alpha, not a palette color */
  }
  &__panel {
    position: absolute; left: 0; right: 0; bottom: 0;
    max-height: 85dvh; overflow-y: auto;
    background: var(--ds-surface);
    border-top: 1px solid var(--ds-border);
    border-radius: 14px 14px 0 0;
    padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
    animation: ds-sheet-up var(--ds-motion-base) var(--ds-motion-easing);

    @include bp.tablet-up {
      left: auto; top: 0; bottom: 0; width: 420px;
      border-radius: 0; border-left: 1px solid var(--ds-border);
    }
  }
  &__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
  &__title { margin: 0; font-size: 1rem; color: var(--ds-text-high); }
}

@keyframes ds-sheet-up {
  from { transform: translateY(24px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ds-sheet__panel { animation: none; }
}
```

(Adjust the mixin namespace `bp.` to match how `_breakpoints.scss` is actually consumed in `MediaShell.scss` — copy its exact usage.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/ui/Sheet.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/ui/dismiss/ frontend/src/lib/ui/Sheet.jsx frontend/src/lib/ui/ds.scss frontend/src/lib/ui/Sheet.test.jsx
git commit -m "feat(ds): dismiss stack (ported from Media) and Sheet overlay"
```

---

### Task 9: AppChrome shell

**Files:**
- Create: `frontend/src/lib/ui/AppChrome.jsx`
- Modify: `frontend/src/lib/ui/ds.scss` (append chrome styles)
- Create: `frontend/src/lib/ui/AppChrome.test.jsx`

**Interfaces:**
- Produces: `<AppChrome title tabs activeTab onTabChange headerActions? footer? children>`. `tabs: [{ id, label, icon }]` where `icon` is a React node (inline SVG). Renders: header (title left, actions right — **max 3 actions enforced**), main scroll region, nav (bottom tab bar on mobile / left rail on tablet-up — same DOM, CSS-switched), optional sticky footer above the tab bar. Nav buttons carry `aria-current="page"` when active.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/lib/ui/AppChrome.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppChrome } from './AppChrome.jsx';

const tabs = [
  { id: 'today', label: 'Today', icon: <svg data-testid="i1" /> },
  { id: 'progress', label: 'Progress', icon: <svg data-testid="i2" /> },
];

describe('AppChrome', () => {
  it('renders title, tabs, children; marks the active tab', () => {
    render(
      <AppChrome title="Health" tabs={tabs} activeTab="today" onTabChange={() => {}}>
        <p>content</p>
      </AppChrome>
    );
    expect(screen.getByText('Health')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
    const active = screen.getByRole('link', { name: /Today/ });
    expect(active.getAttribute('aria-current')).toBe('page');
  });

  it('fires onTabChange with the tab id', () => {
    const change = vi.fn();
    render(
      <AppChrome title="H" tabs={tabs} activeTab="today" onTabChange={change}>x</AppChrome>
    );
    fireEvent.click(screen.getByRole('link', { name: /Progress/ }));
    expect(change).toHaveBeenCalledWith('progress');
  });

  it('throws when given more than 3 header actions', () => {
    expect(() =>
      render(
        <AppChrome title="H" tabs={tabs} activeTab="today" onTabChange={() => {}}
          headerActions={[<b key="1" />, <b key="2" />, <b key="3" />, <b key="4" />]}>
          x
        </AppChrome>
      )
    ).toThrow(/3 header actions/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/ui/AppChrome.test.jsx`
Expected: FAIL — cannot resolve `./AppChrome.jsx`

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/lib/ui/AppChrome.jsx
//
// The webapp shell: slim header, main scroll region, primary nav rendered
// as a bottom tab bar on mobile and a left rail on tablet-up (same DOM,
// CSS-switched). Nav pattern adopted from Media's PrimaryNav.
import './ds.scss';

export function AppChrome({ title, tabs = [], activeTab, onTabChange, headerActions, footer, children }) {
  const actions = Array.isArray(headerActions) ? headerActions : (headerActions ? [headerActions] : []);
  if (actions.length > 3) {
    throw new Error('AppChrome allows at most 3 header actions — quiet chrome is the contract');
  }
  return (
    <div className="ds-chrome">
      <header className="ds-chrome__header">
        <h1 className="ds-chrome__title">{title}</h1>
        {actions.length ? <div className="ds-chrome__actions">{actions}</div> : null}
      </header>
      <nav className="ds-chrome__nav" aria-label="Primary">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            role="link"
            tabIndex={0}
            className={`ds-chrome__tab${tab.id === activeTab ? ' ds-chrome__tab--active' : ''}`}
            aria-current={tab.id === activeTab ? 'page' : undefined}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTabChange(tab.id); }}
          >
            <span className="ds-chrome__tab-icon">{tab.icon}</span>
            <span className="ds-chrome__tab-label">{tab.label}</span>
          </a>
        ))}
      </nav>
      <main className="ds-chrome__main">{children}</main>
      {footer ? <div className="ds-chrome__footer">{footer}</div> : null}
    </div>
  );
}

export default AppChrome;
```

Append to `frontend/src/lib/ui/ds.scss`:

```scss
.ds-chrome {
  display: grid;
  min-height: 100dvh;
  background: var(--ds-background);
  color: var(--ds-text-high);
  // Mobile: header / main / footer / bottom tabs
  grid-template-rows: auto 1fr auto auto;
  grid-template-areas: "header" "main" "footer" "nav";

  @include bp.tablet-up {
    // Desktop: left rail spanning all rows
    grid-template-columns: 200px 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas: "nav header" "nav main" "nav footer";
  }

  &__header {
    grid-area: header;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.5rem 1rem;
    padding-top: calc(0.5rem + env(safe-area-inset-top));
    border-bottom: 1px solid var(--ds-border);
  }
  &__title { margin: 0; font-size: 1rem; font-weight: 600; }
  &__actions { display: flex; gap: 0.5rem; }
  &__main { grid-area: main; overflow-y: auto; padding: 0.75rem 1rem; }
  &__footer { grid-area: footer; border-top: 1px solid var(--ds-border); padding: 0.4rem 1rem; }

  &__nav {
    grid-area: nav;
    display: flex; justify-content: space-around;
    border-top: 1px solid var(--ds-border);
    background: var(--ds-surface-alt);
    padding-bottom: env(safe-area-inset-bottom);

    @include bp.tablet-up {
      flex-direction: column; justify-content: flex-start;
      gap: 0.25rem; padding: 0.75rem 0.5rem;
      border-top: none; border-right: 1px solid var(--ds-border);
    }
  }
  &__tab {
    display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
    padding: 0.5rem 0.75rem; min-width: 64px;
    color: var(--ds-text-mid); cursor: pointer; border-radius: 9px;
    font-size: 0.7rem; text-decoration: none;

    &:focus-visible { outline: 2px solid var(--ds-accent, var(--ds-info)); outline-offset: 2px; }
    &--active { color: var(--ds-accent, var(--ds-text-high)); }

    @include bp.tablet-up {
      flex-direction: row; gap: 0.5rem; font-size: 0.85rem; min-width: 0;
    }
  }
  &__tab-icon { display: inline-flex; width: 20px; height: 20px; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/ui/AppChrome.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ui/AppChrome.jsx frontend/src/lib/ui/ds.scss frontend/src/lib/ui/AppChrome.test.jsx
git commit -m "feat(ds): AppChrome shell — header, rail/tabbar nav, footer slots"
```

---

### Task 10: DateStepper and AskAffordance

**Files:**
- Create: `frontend/src/lib/ui/DateStepper.jsx`
- Create: `frontend/src/lib/ui/AskAffordance.jsx`
- Modify: `frontend/src/lib/ui/ds.scss` (append styles)
- Create: `frontend/src/lib/ui/DateStepper.test.jsx`

**Interfaces:**
- Produces: `<DateStepper date onChange max?>` — `date`/`max` are ISO `YYYY-MM-DD` strings; renders `‹ [label] ›`; label is "Today"/"Yesterday"/weekday-month-day; forward arrow disabled at `max`; tapping the label jumps to `max` (today). `<AskAffordance placeholder onActivate>` — a full-width pill button that opens chat (replaces Health's AskBar; pairs with existing `modules/Agent/AgentChatSurface`).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/lib/ui/DateStepper.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateStepper } from './DateStepper.jsx';

describe('DateStepper', () => {
  it('steps back and forward a day', () => {
    const change = vi.fn();
    render(<DateStepper date="2026-09-02" onChange={change} max="2026-09-02" />);
    fireEvent.click(screen.getByLabelText('Previous day'));
    expect(change).toHaveBeenCalledWith('2026-09-01');
  });

  it('disables forward at max and labels max as Today', () => {
    render(<DateStepper date="2026-09-02" onChange={() => {}} max="2026-09-02" />);
    expect(screen.getByLabelText('Next day').disabled).toBe(true);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('label click jumps back to max', () => {
    const change = vi.fn();
    render(<DateStepper date="2026-08-20" onChange={change} max="2026-09-02" />);
    fireEvent.click(screen.getByRole('button', { name: /Aug/ }));
    expect(change).toHaveBeenCalledWith('2026-09-02');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/ui/DateStepper.test.jsx`
Expected: FAIL — cannot resolve `./DateStepper.jsx`

- [ ] **Step 3: Write the implementations**

```jsx
// frontend/src/lib/ui/DateStepper.jsx
import './ds.scss';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`); // noon avoids DST edge shifts
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const labelFor = (iso, max) => {
  if (iso === max) return 'Today';
  if (max && iso === addDays(max, -1)) return 'Yesterday';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
};

const Arrow = ({ flip }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
    style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function DateStepper({ date, onChange, max }) {
  const atMax = max != null && date >= max;
  return (
    <div className="ds-datestepper">
      <button type="button" className="ds-datestepper__arrow" aria-label="Previous day"
        onClick={() => onChange(addDays(date, -1))}><Arrow /></button>
      <button type="button" className="ds-datestepper__label"
        onClick={() => { if (max && date !== max) onChange(max); }}>
        {labelFor(date, max)}
      </button>
      <button type="button" className="ds-datestepper__arrow" aria-label="Next day"
        disabled={atMax} onClick={() => onChange(addDays(date, 1))}><Arrow flip /></button>
    </div>
  );
}

export default DateStepper;
```

```jsx
// frontend/src/lib/ui/AskAffordance.jsx
import './ds.scss';

const SparkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1l1.8 4.5L14 7l-4.2 1.5L8 13l-1.8-4.5L2 7l4.2-1.5L8 1z"
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

/** Chat entry pill. Pairs with modules/Agent/AgentChatSurface in an overlay. */
export function AskAffordance({ placeholder = 'Ask your coach…', onActivate }) {
  return (
    <button type="button" className="ds-ask" onClick={onActivate}>
      <SparkIcon />
      <span className="ds-ask__placeholder">{placeholder}</span>
      <kbd className="ds-ask__kbd">⌘K</kbd>
    </button>
  );
}

export default AskAffordance;
```

Append to `frontend/src/lib/ui/ds.scss`:

```scss
.ds-datestepper {
  display: flex; align-items: center; justify-content: center; gap: 0.25rem;

  &__arrow, &__label {
    background: none; border: none; color: var(--ds-text-high); cursor: pointer;
    padding: 0.4rem 0.6rem; border-radius: 9px; font-size: 0.9rem;
    &:focus-visible { outline: 2px solid var(--ds-accent, var(--ds-info)); outline-offset: 2px; }
    &:disabled { color: var(--ds-text-low); cursor: default; }
  }
  &__label { font-weight: 600; min-width: 7.5rem; }
}

.ds-ask {
  display: flex; align-items: center; gap: 0.5rem; width: 100%;
  padding: 0.5rem 0.9rem; border-radius: 999px;
  background: var(--ds-surface); border: 1px solid var(--ds-border);
  color: var(--ds-text-mid); cursor: pointer; font-size: 0.85rem;
  &:focus-visible { outline: 2px solid var(--ds-accent, var(--ds-info)); outline-offset: 2px; }
  &__placeholder { flex: 1; text-align: left; }
  &__kbd { font-size: 0.7rem; color: var(--ds-text-low); border: 1px solid var(--ds-border); border-radius: 4px; padding: 0 0.3rem; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/ui/DateStepper.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ui/DateStepper.jsx frontend/src/lib/ui/AskAffordance.jsx frontend/src/lib/ui/ds.scss frontend/src/lib/ui/DateStepper.test.jsx
git commit -m "feat(ds): DateStepper and AskAffordance primitives"
```

---

### Task 11: Barrel export, DS gallery route, and Playwright visual check

**Files:**
- Create: `frontend/src/lib/ui/index.js`
- Create: `frontend/src/dev/DsGallery/DsGallery.jsx`
- Modify: `frontend/src/main.jsx` (add lazy `/dev/ds-gallery` route)
- Create: `tests/live/flow/ds/ds-gallery.runtime.test.mjs`

**Interfaces:**
- Produces: `@/lib/ui` barrel exporting `AppThemeProvider, AppChrome, Sheet, DismissStackProvider, useDismissLayer, LoadingState, ErrorState, EmptyState, SectionCard, StatCard, Skeleton, DateStepper, AskAffordance, createAppLogger`; `/dev/ds-gallery` renders every primitive in every state on one page (the standing visual-verification surface for all DS work).

- [ ] **Step 1: Write the barrel**

```javascript
// frontend/src/lib/ui/index.js
export { AppThemeProvider } from './AppThemeProvider.jsx';
export { AppChrome } from './AppChrome.jsx';
export { Sheet } from './Sheet.jsx';
export { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
export { useDismissLayer } from './dismiss/useDismissLayer.js';
export { LoadingState, ErrorState, EmptyState } from './states.jsx';
export { SectionCard, StatCard } from './cards.jsx';
export { default as Skeleton } from './Skeleton.jsx';
export { DateStepper } from './DateStepper.jsx';
export { AskAffordance } from './AskAffordance.jsx';
export { createAppLogger } from './createAppLogger.js';
```

- [ ] **Step 2: Write the gallery**

```jsx
// frontend/src/dev/DsGallery/DsGallery.jsx
//
// Every DS primitive in every state on one page — the standing visual
// verification surface. Dev-only route; lazy-loaded so it never rides in
// the main bundle.
import { useState } from 'react';
import {
  AppThemeProvider, AppChrome, Sheet, DismissStackProvider,
  LoadingState, ErrorState, EmptyState, SectionCard, StatCard,
  DateStepper, AskAffordance,
} from '../../lib/ui/index.js';

const Dot = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export default function DsGallery() {
  const [tab, setTab] = useState('one');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [date, setDate] = useState('2026-09-01');

  return (
    <AppThemeProvider pack="health">
      <DismissStackProvider>
        <AppChrome
          title="DS Gallery"
          tabs={[
            { id: 'one', label: 'One', icon: <Dot /> },
            { id: 'two', label: 'Two', icon: <Dot /> },
          ]}
          activeTab={tab}
          onTabChange={setTab}
          footer={<AskAffordance onActivate={() => setSheetOpen(true)} />}
        >
          <div style={{ display: 'grid', gap: '0.75rem' }} data-testid="gallery-grid">
            <SectionCard title="States">
              <LoadingState label="demo" />
              <ErrorState error={new Error('Example failure')} onRetry={() => {}} />
              <EmptyState title="Nothing logged" hint="Add your first item"
                action={{ label: 'Add', onClick: () => {} }} />
            </SectionCard>
            <SectionCard title="Stats" actions={<button>edit</button>}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <StatCard label="Remaining" value={1140} unit="kcal" emphasis />
                <StatCard label="Protein" value={82} unit="g" trend="▲ on pace" />
              </div>
            </SectionCard>
            <SectionCard title="Date">
              <DateStepper date={date} onChange={setDate} max="2026-09-02" />
            </SectionCard>
            <button onClick={() => setSheetOpen(true)}>Open sheet</button>
          </div>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Example sheet">
            <p>Sheet body content.</p>
          </Sheet>
        </AppChrome>
      </DismissStackProvider>
    </AppThemeProvider>
  );
}
```

- [ ] **Step 3: Add the route**

In `frontend/src/main.jsx`, next to the other lazy dev routes (line 24 area):

```javascript
const DsGallery = React.lazy(() => import('./dev/DsGallery/DsGallery.jsx'));
```

And in the `<Routes>` next to `/dev/game-presentation-harness`:

```jsx
<Route path="/dev/ds-gallery" element={<React.Suspense fallback={null}><DsGallery /></React.Suspense>} />
```

- [ ] **Step 4: Write the Playwright check**

```javascript
// tests/live/flow/ds/ds-gallery.runtime.test.mjs
// Visual verification for DS primitives — jsdom cannot see layout, this can.
import { test, expect } from '@playwright/test';

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`ds gallery renders at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/dev/ds-gallery');
    await expect(page.getByTestId('gallery-grid')).toBeVisible();

    // Chrome renders: title, both tabs, footer affordance
    await expect(page.getByText('DS Gallery')).toBeVisible();
    await expect(page.getByRole('link', { name: /One/ })).toBeVisible();

    // No horizontal overflow (responsive containment gate G4)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Sheet opens and closes
    await page.getByRole('button', { name: 'Open sheet' }).click();
    await expect(page.getByText('Sheet body content.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sheet body content.')).not.toBeVisible();

    await page.screenshot({ path: `test-results/ds-gallery-${viewport.name}.png`, fullPage: true });
  });
}
```

- [ ] **Step 5: Run the Playwright test**

Check the dev server first (`ss -tlnp | grep 3112`; start `npm run dev` if absent — Playwright's webServer config reuses an existing server).

Run: `npx playwright test tests/live/flow/ds/ds-gallery.runtime.test.mjs --reporter=line`
Expected: PASS (2 tests). **Look at both screenshots in `test-results/`** — verify the rail appears on desktop, bottom tabs on phone, and colors are the dark token palette (not Mantine defaults).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/ui/index.js frontend/src/dev/DsGallery/ frontend/src/main.jsx tests/live/flow/ds/
git commit -m "feat(ds): barrel export, /dev/ds-gallery, Playwright visual check"
```

---

### Task 12: Anti-slop audit script + pre-commit wiring

**Files:**
- Create: `scripts/audit-ui-tokens.mjs`
- Create: `scripts/audit-ui-tokens.baseline.json`
- Modify: `package.json` (add `"audit:ui": "node scripts/audit-ui-tokens.mjs"` to scripts)
- Modify: `.githooks/pre-commit` (add `npm run audit:ui` after `npm run audit:layers`)
- Create: `scripts/audit-ui-tokens.test.mjs`

**Interfaces:**
- Produces: `npm run audit:ui` — scans webapp UI sources for anti-slop violations, compares per-rule counts to the baseline, exits 1 if any rule count **exceeds** baseline. Rules: `raw-color` (hex/rgb/hsl literals), `raw-motion` (literal transition/animation durations, `@keyframes` outside theme), `raw-keydown` (`addEventListener('keydown'` outside `lib/`), `native-control` (`<button`/`<select` in JSX outside `lib/ui/`). Scanned roots: `frontend/src/Apps/`, `frontend/src/modules/Health/`, `frontend/src/modules/Life/`, `frontend/src/modules/Auto/`, `frontend/src/modules/Media/`, `frontend/src/lib/ui/`. Exempt: `frontend/src/lib/theme/`, `*.test.*`, lines containing `/* data-color */`.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/audit-ui-tokens.test.mjs
import { describe, it, expect } from 'vitest';
import { scanSource } from './audit-ui-tokens.mjs';

describe('audit-ui-tokens rules', () => {
  it('flags raw hex colors', () => {
    const hits = scanSource('a.scss', '.x { color: #ff0000; }');
    expect(hits.some(h => h.rule === 'raw-color')).toBe(true);
  });

  it('passes var(--ds-*) usage and data-color annotations', () => {
    expect(scanSource('a.scss', '.x { color: var(--ds-danger); }')).toEqual([]);
    expect(scanSource('a.scss', '.x { color: #ff0000; /* data-color */ }')).toEqual([]);
  });

  it('flags literal motion durations and keyframes', () => {
    const hits = scanSource('a.scss', '.x { transition: all 0.3s; } @keyframes spin {}');
    expect(hits.filter(h => h.rule === 'raw-motion').length).toBe(2);
  });

  it('passes motion via tokens', () => {
    expect(scanSource('a.scss', '.x { transition: opacity var(--ds-motion-base); }')).toEqual([]);
  });

  it('flags ad-hoc keydown listeners in app code', () => {
    const hits = scanSource('frontend/src/modules/Health/X.jsx', "document.addEventListener('keydown', fn)");
    expect(hits.some(h => h.rule === 'raw-keydown')).toBe(true);
  });

  it('flags undefined --ds-* tokens, passes defined ones', () => {
    expect(scanSource('a.scss', '.x { color: var(--ds-surfce); }')
      .some(h => h.rule === 'undefined-token')).toBe(true);
    expect(scanSource('a.scss', '.x { color: var(--ds-surface); }')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/audit-ui-tokens.test.mjs`
Expected: FAIL — `scanSource` not exported

- [ ] **Step 3: Write the implementation**

```javascript
// scripts/audit-ui-tokens.mjs
//
// Anti-slop UI gate (design-system spec, Tier 1). Baseline-style like
// audit-layer-imports.mjs: existing violations don't block, growth does.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOTS = [
  'frontend/src/Apps',
  'frontend/src/modules/Health',
  'frontend/src/modules/Life',
  'frontend/src/modules/Auto',
  'frontend/src/modules/Media',
  'frontend/src/lib/ui',
];
const EXEMPT = [/frontend\/src\/lib\/theme\//, /\.test\./, /node_modules/];

const RULES = [
  {
    rule: 'raw-color',
    // hex colors, rgb()/rgba()/hsl() literals — in style-bearing lines
    re: /(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/,
    files: /\.(scss|css|jsx|js)$/,
    exemptLine: /data-color|--ds-|--mantine-/,
  },
  {
    rule: 'raw-motion',
    re: /(transition:[^;]*\b\d+m?s\b|animation:[^;]*\b\d+m?s\b|@keyframes)/,
    files: /\.(scss|css)$/,
    exemptLine: /--ds-motion/,
    exemptFile: /lib\/ui\/ds\.scss$/, // the DS sheet defines the shared keyframes
  },
  {
    rule: 'raw-keydown',
    re: /addEventListener\(\s*['"]keydown['"]/,
    files: /\.(jsx|js)$/,
    exemptFile: /frontend\/src\/lib\//,
  },
  {
    rule: 'native-control',
    re: /<(button|select)[\s>]/,
    files: /\.jsx$/,
    exemptFile: /frontend\/src\/lib\/ui\/|frontend\/src\/dev\//,
  },
  {
    rule: 'undefined-token',
    // any var(--ds-*) not in the manifest — silent fallback to `inherit`
    re: /var\(--ds-[a-z-]+/g,
    files: /\.(scss|css|jsx|js)$/,
    custom: 'checkTokenManifest',
  },
];

// Manifest of legal --ds-* names, derived from the token contract. Kept as a
// literal list here (scripts can't import frontend ESM with JSX deps): update
// it when tokens.mjs changes — the tokens test pins the roles, this pins usage.
const DS_TOKEN_NAMES = new Set([
  '--ds-background', '--ds-surface', '--ds-surface-alt', '--ds-border',
  '--ds-text-high', '--ds-text-mid', '--ds-text-low',
  '--ds-success', '--ds-warning', '--ds-danger', '--ds-info', '--ds-live',
  '--ds-motion-fast', '--ds-motion-base', '--ds-motion-reveal', '--ds-motion-easing',
  '--ds-accent',
]);

export function scanSource(filePath, source) {
  const hits = [];
  const lines = source.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(filePath)) continue;
    if (rule.exemptFile && rule.exemptFile.test(filePath)) continue;
    lines.forEach((line, i) => {
      if (rule.custom === 'checkTokenManifest') {
        for (const m of line.matchAll(/var\((--ds-[a-z-]+)/g)) {
          if (!DS_TOKEN_NAMES.has(m[1])) {
            hits.push({ rule: rule.rule, file: filePath, line: i + 1, token: m[1] });
          }
        }
        return;
      }
      if (!rule.re.test(line)) return;
      if (rule.exemptLine && rule.exemptLine.test(line)) return;
      hits.push({ rule: rule.rule, file: filePath, line: i + 1 });
    });
  }
  return hits;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main() {
  const baselinePath = 'scripts/audit-ui-tokens.baseline.json';
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    : {};

  const allHits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (EXEMPT.some((re) => re.test(file))) continue;
      if (!/\.(scss|css|jsx|js)$/.test(file)) continue;
      allHits.push(...scanSource(file, fs.readFileSync(file, 'utf8')));
    }
  }

  const counts = {};
  for (const h of allHits) counts[h.rule] = (counts[h.rule] || 0) + 1;

  let failed = false;
  for (const rule of RULES.map((r) => r.rule)) {
    const n = counts[rule] || 0;
    const base = baseline[rule] ?? 0;
    const ok = n <= base;
    if (!ok) failed = true;
    console.log(`${rule.padEnd(20)} ${String(n).padStart(4)} (baseline ${base}) ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) {
      for (const h of allHits.filter((x) => x.rule === rule).slice(0, 20)) {
        console.log(`  ${h.file}:${h.line}`);
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test, then generate the baseline**

Run: `npx vitest run scripts/audit-ui-tokens.test.mjs`
Expected: PASS (6 tests)

Then run `node scripts/audit-ui-tokens.mjs` once — it will FAIL (no baseline; existing apps have hundreds of raw colors). Copy the printed per-rule counts into `scripts/audit-ui-tokens.baseline.json`, e.g.:

```json
{ "raw-color": 0, "raw-motion": 0, "raw-keydown": 0, "native-control": 0 }
```

…replacing each `0` with the actual printed count. Re-run `node scripts/audit-ui-tokens.mjs` — expect all `ok`, exit 0.

- [ ] **Step 5: Wire into package.json and pre-commit**

Add to `package.json` scripts: `"audit:ui": "node scripts/audit-ui-tokens.mjs"`.

In `.githooks/pre-commit`, after the `npm run audit:layers` block, add:

```sh
npm run audit:ui
```

- [ ] **Step 6: Verify the gate runs on commit, then commit**

```bash
git add scripts/audit-ui-tokens.mjs scripts/audit-ui-tokens.baseline.json scripts/audit-ui-tokens.test.mjs package.json .githooks/pre-commit
git commit -m "feat(ds): anti-slop UI audit gate (raw colors, motion, keydown, native controls)"
```

The commit output must show the `audit:ui` rule table — if it doesn't, the hook edit didn't take.

---

### Task 13: Design-system reference doc

**Files:**
- Create: `docs/reference/frontend/design-system.md`
- Modify: `CLAUDE.md` (add a Navigation table row: `| Webapp design system (tokens, primitives, packs) | docs/reference/frontend/design-system.md |`)

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the doc**

Write `docs/reference/frontend/design-system.md` in present-tense endstate style (house convention — no class names, no history). Contents, each as a short section:

1. **Token contract** — the seven semantic roles, status colors, motion tokens; consumed via `var(--mantine-color-<role>-0)` in Mantine contexts and `var(--ds-*)` in plain SCSS; raw values live only in `frontend/src/lib/theme/tokens.mjs`; data-derived colors require the `/* data-color */` annotation.
2. **Packs** — what a pack owns (accent, primary, character statement) and what it may not remove (focus, contrast, state behavior); how to add one (edit `packs.mjs`, nothing else).
3. **Primitives** — one row per primitive from the Task 11 barrel: what it's for, when NOT to use it (e.g. Sheet vs Mantine Modal: Sheet for task flows, Modal for confirmations).
4. **The rules** — new webapp UI uses `@/lib/ui` and tokens; third duplicate of any pattern gets promoted, never copy-pasted; `npm run audit:ui` is the gate and how baselines work (shrink freely, never grow).
5. **Visual verification** — `/dev/ds-gallery` + the Playwright screenshot test; every DS change re-runs it.

- [ ] **Step 2: Commit**

```bash
git add docs/reference/frontend/design-system.md CLAUDE.md
git commit -m "docs(ds): design-system reference + navigation entry"
```

---

## Final verification (whole plan)

- [ ] `npx vitest run frontend/src/lib scripts/audit-ui-tokens.test.mjs` — all DS unit tests green.
- [ ] `npm run audit:ui` — exit 0.
- [ ] `npx playwright test tests/live/flow/ds/ --reporter=line` — green; screenshots visually inspected at both viewports.
- [ ] `npm run test:unit:vitest` — the repo vitest gate stays green (no regressions from the main.jsx change).
- [ ] `/health`, `/life`, `/auto`, `/home` all load without console errors (the provider change touched them all).
