# Universal Scan Vocabulary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make any barcode/QR scanner in the house handle any code the house generates, by putting every generated code behind a domain prefix and routing on that prefix instead of on which reader saw it.

**Architecture:** A pure domain parser (`ScanCode`) owns a closed prefix registry and resolves a raw string to `{ namespace, body, form }`. An application-layer `ScanDispatcher` maps namespace → handler and returns a uniform Outcome. Composition registers the four existing handlers. This is **Phase 1 only: zero behavior change** — legacy un-prefixed forms stay live, so every code that works today works identically after.

**Tech Stack:** Node ESM (`.mjs`), vitest 4.1.5, subpath aliases (`#domains/*`, `#apps/*`), DDD layering enforced by `scripts/audit-layer-imports.mjs`.

**Design doc:** `docs/plans/2026-07-28-universal-scan-vocabulary-design.md` — read it first.

---

## Context you need before starting

**Worktree:** `.worktrees/scan-vocabulary`, branch `feat/scan-vocabulary`, based on `main`. `node_modules` is symlinked from the main checkout — do not run `npm install`.

**Run a single test file:**
```bash
npx vitest run tests/unit/domains/scan/ScanCode.test.mjs
```

**Layer rule (enforced by `npm run test:refactor`):** `2_domains/` may not import from `3_applications/` or above. `ScanCode.mjs` is pure — no I/O, no logger, no config. Violating this fails the audit.

**The four grammars this unifies** (all already exist, none change):

| Domain | Entry point | Signature |
|---|---|---|
| Nutrition | `#domains/nutrition` | `parseScan(code)` → `{kind,...}` or `null` |
| School | `#domains/school/sessions/tokens.mjs` | `isSchoolToken(code)` → bool |
| Content/command | `#domains/barcode/BarcodePayload.mjs` | `BarcodePayload.parse({barcode,device,timestamp}, knownActions, knownCommands)` |
| Product | none | digit-only, handled by `getLogFoodFromUPC()` |

**Critical detail — school needs the RAW code.** `tokens.get(code)` looks up the full `sch:a7f3k2` string, so the school handler must receive the unstripped code. Every handler therefore gets both `raw` and `body`. Nutrition and content want `body` (prefix stripped); school wants `raw`.

**Critical detail — `go:` and `cmd:` share a handler.** Today both content and command codes go through `TriggerEvent` and are told apart downstream inside `BarcodePayload.parse`. Stripping `go:`/`cmd:` leaves exactly the legacy positional string, so both namespaces map to one trigger handler and parse identically. Do not build two.

---

## Task 1: ScanCode — registered prefixes

**Files:**
- Create: `backend/src/2_domains/scan/ScanCode.mjs`
- Test: `tests/unit/domains/scan/ScanCode.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { parseScanCode, NAMESPACES } from '#domains/scan/ScanCode.mjs';

describe('parseScanCode — registered prefixes', () => {
  it('resolves a content code', () => {
    expect(parseScanCode('go:living-room:plex:594036+shuffle')).toEqual({
      namespace: 'content',
      body: 'living-room:plex:594036+shuffle',
      raw: 'go:living-room:plex:594036+shuffle',
      form: 'prefixed',
    });
  });

  it('resolves a command code', () => {
    expect(parseScanCode('cmd:office:volume:30')).toMatchObject({
      namespace: 'command', body: 'office:volume:30', form: 'prefixed',
    });
  });

  it('resolves a nutrition code, leaving the sub-prefix in the body', () => {
    expect(parseScanCode('nut:dl:4')).toMatchObject({
      namespace: 'nutrition', body: 'dl:4', form: 'prefixed',
    });
  });

  it('keeps the raw code for school, which looks tokens up by full string', () => {
    const r = parseScanCode('sch:a7f3k2');
    expect(r.namespace).toBe('school');
    expect(r.raw).toBe('sch:a7f3k2');
  });

  it('trims surrounding whitespace', () => {
    expect(parseScanCode('  nut:dl:4  ').namespace).toBe('nutrition');
  });

  it('is case-sensitive', () => {
    expect(parseScanCode('NUT:dl:4').namespace).not.toBe('nutrition');
  });

  it('exposes the namespace list', () => {
    expect(NAMESPACES).toContain('content');
    expect(NAMESPACES).toContain('school');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/scan/ScanCode.test.mjs`
Expected: FAIL — `Failed to resolve import "#domains/scan/ScanCode.mjs"`

**Step 3: Write minimal implementation**

```javascript
/**
 * ScanCode — the house-wide scan vocabulary. PURE: no I/O, no config, no logger.
 *
 * Every code the house GENERATES carries a domain prefix naming its owner. The
 * prefix says only who parses the rest; each domain keeps the grammar it already
 * had. School already worked this way (`sch:`), so this generalizes an existing
 * pattern rather than introducing one.
 *
 * Registry rules, both enforced by test rather than convention:
 *   - case-sensitive
 *   - no registered prefix may be a prefix of another, so parsing is a single
 *     split on the first colon
 *
 * @module domains/scan/ScanCode
 */

/** prefix tag -> owning namespace. Closed set: unregistered means unknown. */
export const PREFIX_REGISTRY = Object.freeze({
  'go':  'content',
  'cmd': 'command',
  'nut': 'nutrition',
  'sch': 'school',
});

export const NAMESPACES = Object.freeze([...new Set(Object.values(PREFIX_REGISTRY))]);

/**
 * @param {string} code raw scanned string
 * @returns {{namespace: string|null, body: string, raw: string, form: string}}
 */
export function parseScanCode(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return { namespace: null, body: '', raw: '', form: 'unknown' };

  const idx = raw.indexOf(':');
  if (idx > 0) {
    const tag = raw.slice(0, idx);
    const namespace = PREFIX_REGISTRY[tag];
    // School is the exception: its body IS the whole token, because the registry
    // stores and looks tokens up by the full `sch:<body>` string.
    if (namespace) return { namespace, body: raw.slice(idx + 1), raw, form: 'prefixed' };
  }

  return { namespace: null, body: raw, raw, form: 'unknown' };
}

export default parseScanCode;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/scan/ScanCode.test.mjs`
Expected: PASS, 7 tests

**Step 5: Commit**

```bash
git add backend/src/2_domains/scan/ScanCode.mjs tests/unit/domains/scan/ScanCode.test.mjs
git commit -m "feat(scan): domain prefix registry and parser"
```

---

## Task 2: Registry invariant

This is the rule that makes single-split parsing safe. It must be a test, because a future domain will want to register a prefix and nothing else will stop a bad one.

**Files:**
- Modify: `tests/unit/domains/scan/ScanCode.test.mjs` (append)

**Step 1: Write the failing test**

> **Corrected 2026-07-28 after code review.** An earlier draft of this task
> asserted "no tag may be a prefix of another tag" and called that the invariant
> behind single-split parsing. It is not load-bearing: parsing does an exact
> match on the segment before the first colon, so a registry of `{go, gone}`
> resolves `gone:x` and `go:ne:x` unambiguously. The invariant that actually
> protects the parse is **no tag may contain a colon**. Register `go:room` and it
> is unreachable forever, because `go:room:x` splits at the first colon and
> resolves to `go`. Assert the real property.

```javascript
describe('registry invariants', () => {
  const tags = Object.keys(PREFIX_REGISTRY);

  it('has no tag containing a colon', () => {
    // THE load-bearing invariant. Parsing splits on the first colon and matches
    // the segment exactly, so a tag containing a colon can never be reached.
    for (const tag of tags) expect(tag).not.toContain(':');
  });

  it('has no empty tag', () => {
    for (const tag of tags) expect(tag.length).toBeGreaterThan(0);
  });

  it('does not let any domain claim nutrition sub-prefixes', () => {
    // `ct:` is containers. A content or command tag colliding with it would
    // break every container scan in the house.
    for (const tag of tags) expect(['dl', 'ct', 'rs']).not.toContain(tag);
  });

  it('does not collide with a legacy screen name', () => {
    // A legacy positional code is `screen:source:id`. If a screen were ever
    // named `go`, then `go:plex:1` would resolve as a PREFIXED content code with
    // body `plex:1` — silently dropping the screen. No such screen exists today;
    // this stops one being added.
    const RESERVED_AGAINST_SCREENS = ['go', 'cmd', 'nut', 'sch'];
    for (const tag of tags) expect(RESERVED_AGAINST_SCREENS).toContain(tag);
  });
});
```

Add `PREFIX_REGISTRY` to the existing import at the top of the file.

**Step 2: Run test to verify it passes immediately**

Run: `npx vitest run tests/unit/domains/scan/ScanCode.test.mjs`
Expected: PASS, 10 tests. This test is written to pass now and to fail later if someone registers a bad prefix — that is its whole job. Do not "make it fail first"; there is no implementation to add.

**Step 3: Commit**

```bash
git add tests/unit/domains/scan/ScanCode.test.mjs
git commit -m "test(scan): pin the prefix registry invariants"
```

---

## Task 3: Legacy fallbacks and shape detection

Resolution order, first match wins. Steps 2–3 are the deprecation shelf and get deleted in Phase 3.

**Files:**
- Modify: `backend/src/2_domains/scan/ScanCode.mjs`
- Modify: `tests/unit/domains/scan/ScanCode.test.mjs`

**Step 1: Write the failing test**

```javascript
describe('legacy and shape resolution', () => {
  it('routes a bare nutrition code to nutrition', () => {
    expect(parseScanCode('dl:4')).toMatchObject({
      namespace: 'nutrition', body: 'dl:4', form: 'legacy-prefixed',
    });
    expect(parseScanCode('ct:mug').namespace).toBe('nutrition');
    expect(parseScanCode('rs:clear').namespace).toBe('nutrition');
  });

  it('routes an un-prefixed positional content code to content', () => {
    expect(parseScanCode('living-room:plex:594036')).toMatchObject({
      namespace: 'content', form: 'legacy-positional',
    });
  });

  it('detects ISBN-13 by its Bookland prefix', () => {
    expect(parseScanCode('9780306406157')).toMatchObject({
      namespace: 'book', form: 'shape',
    });
    expect(parseScanCode('9791234567896').namespace).toBe('book');
  });

  it('treats other digit-only codes as product', () => {
    expect(parseScanCode('041260010682')).toMatchObject({
      namespace: 'product', form: 'shape',
    });
  });

  it('returns unknown rather than guessing', () => {
    expect(parseScanCode('!!!').namespace).toBeNull();
    expect(parseScanCode('').form).toBe('unknown');
  });

  it('keeps positional and shape disjoint', () => {
    // positional needs a colon; shape is digit-only. They cannot both match.
    expect(parseScanCode('041260010682').form).toBe('shape');
    expect(parseScanCode('living-room:plex:1').form).toBe('legacy-positional');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/scan/ScanCode.test.mjs`
Expected: FAIL — legacy codes currently return `namespace: null`

**Step 3: Write the implementation**

Replace the tail of `parseScanCode` (everything after the registered-prefix block) with:

```javascript
  // ---- step 2: legacy self-identifying nutrition codes -------------------
  // Deprecation shelf. Deleting this block and step 3 is Phase 3; steps 1, 4
  // and 5 are unaffected by their removal.
  if (idx > 0 && LEGACY_NUTRITION_TAGS.has(raw.slice(0, idx))) {
    return { namespace: 'nutrition', body: raw, raw, form: 'legacy-prefixed' };
  }

  // ---- step 3: legacy positional content/command ------------------------
  // Requires at least one colon, which is what keeps it disjoint from the
  // digit-only shape detection below — they can never both match, so their
  // ordering is not a judgment call.
  if (idx > 0) {
    return { namespace: 'content', body: raw, raw, form: 'legacy-positional' };
  }

  // ---- step 4: shape ----------------------------------------------------
  if (/^\d+$/.test(raw)) {
    const namespace = isIsbn13(raw) ? 'book' : 'product';
    return { namespace, body: raw, raw, form: 'shape' };
  }

  // ---- step 6: unknown --------------------------------------------------
  return { namespace: null, body: raw, raw, form: 'unknown' };
}

const LEGACY_NUTRITION_TAGS = new Set(['dl', 'ct', 'rs']);

/** Bookland EAN: a 13-digit code beginning 978 or 979 is an ISBN, not a product. */
function isIsbn13(digits) {
  return digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'));
}
```

Note `LEGACY_NUTRITION_TAGS` and `isIsbn13` are hoisted declarations, so their placement after use is fine.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/scan/ScanCode.test.mjs`
Expected: PASS, 16 tests

**Step 5: Commit**

```bash
git add backend/src/2_domains/scan/ScanCode.mjs tests/unit/domains/scan/ScanCode.test.mjs
git commit -m "feat(scan): legacy fallbacks and ISBN/product shape detection"
```

---

## Task 4: ScanDispatcher

**Files:**
- Create: `backend/src/3_applications/scan/ScanDispatcher.mjs`
- Test: `tests/unit/applications/scan/ScanDispatcher.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';

const handler = (namespace, impl) => ({ namespace, handle: vi.fn(impl) });

describe('ScanDispatcher', () => {
  it('routes a prefixed code to its namespace handler', async () => {
    const content = handler('content', async () => ({ status: 'ok', claimed: true }));
    const d = new ScanDispatcher({ handlers: [content] });

    const out = await d.dispatch({ code: 'go:office:plex:1', device: 'kitchen' });

    expect(content.handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'office:plex:1', raw: 'go:office:plex:1', device: 'kitchen' }),
    );
    expect(out.status).toBe('ok');
    expect(out.domain).toBe('content');
  });

  it('falls back to the reader route when the code says nothing', async () => {
    const nutrition = handler('nutrition', async () => ({ status: 'logged', claimed: true }));
    const d = new ScanDispatcher({
      handlers: [nutrition],
      routeFallback: { nutribot: 'nutrition' },
    });

    const out = await d.dispatch({ code: '041260010682', device: 'k', route: 'nutribot' });
    expect(out.domain).toBe('nutrition');
  });

  it('returns an explicit unknown outcome rather than falling through', async () => {
    const d = new ScanDispatcher({ handlers: [] });
    const out = await d.dispatch({ code: '!!!', device: 'k' });
    expect(out).toMatchObject({ status: 'unknown', domain: null, physical: 'none', printed: false });
    expect(out.message).toBeTruthy();
  });

  it('returns unknown when a namespace resolves but has no registered handler', async () => {
    const d = new ScanDispatcher({ handlers: [] });
    const out = await d.dispatch({ code: 'sch:abc', device: 'k' });
    expect(out.status).toBe('unknown');
  });

  it('never returns undefined for arbitrary input', async () => {
    const d = new ScanDispatcher({ handlers: [] });
    for (const code of ['', '   ', ':::', 'go:', '9', 'ct:', null, undefined]) {
      const out = await d.dispatch({ code, device: 'k' });
      expect(out).toBeDefined();
      expect(out.status).toBeTruthy();
    }
  });

  it('converts a handler throw into a failed outcome, not a rejection', async () => {
    const boom = handler('content', async () => { throw new Error('nope'); });
    const d = new ScanDispatcher({ handlers: [boom] });
    const out = await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(out.status).toBe('failed');
    expect(out.message).toContain('nope');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/scan/ScanDispatcher.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
/**
 * ScanDispatcher — one entry point for every scanner in the house.
 *
 * A code arrives from ANY transport (BLE relay, USB/MQTT cradle, virtual
 * scanner), resolves through the shared vocabulary, and goes to the domain that
 * owns it. Which reader saw it matters only as a last resort, for a code that
 * declares nothing.
 *
 * THE INVARIANT: a scan never falls through. Every path returns an Outcome and
 * `status: 'unknown'` is a real value, so a caller always has something to
 * render. This generalizes the guarantee school already made for its own tokens.
 *
 * @module applications/scan/ScanDispatcher
 */
import { parseScanCode } from '#domains/scan/ScanCode.mjs';

/** @typedef {{status:string, domain:string|null, message:string,
 *             physical:'worksheet'|'receipt'|'none', printed:boolean,
 *             effect:object|null}} Outcome */

const outcome = (over = {}) => ({
  status: 'unknown', domain: null, message: '', physical: 'none',
  printed: false, effect: null, ...over,
});

export class ScanDispatcher {
  #handlers; #routeFallback; #logger;

  /**
   * @param {object} deps
   * @param {Array<{namespace:string, handle:Function}>} deps.handlers
   * @param {Record<string,string>} [deps.routeFallback] reader route -> namespace
   * @param {object} [deps.logger]
   */
  constructor({ handlers = [], routeFallback = {}, logger = console } = {}) {
    this.#handlers = new Map(handlers.map((h) => [h.namespace, h]));
    this.#routeFallback = routeFallback;
    this.#logger = logger;
  }

  /**
   * @param {{code:string, device?:string, route?:string}} args
   * @returns {Promise<Outcome>}
   */
  async dispatch({ code, device = null, route = null } = {}) {
    const parsed = parseScanCode(code);

    // Step 5: the reader's route is consulted only for a code that declared
    // nothing itself. A prefixed code ignores it entirely, which is what makes
    // every scanner interchangeable.
    const namespace = parsed.namespace ?? this.#routeFallback[route] ?? null;

    if (!namespace) {
      this.#logger.info?.('scan.unknown', { device, form: parsed.form });
      return outcome({ message: 'That code is not one we recognize.' });
    }

    const handler = this.#handlers.get(namespace);
    if (!handler) {
      this.#logger.warn?.('scan.no_handler', { device, namespace });
      return outcome({ domain: namespace, message: `Nothing is wired up to handle ${namespace} codes.` });
    }

    try {
      const result = await handler.handle({ ...parsed, device, route });
      return outcome({ domain: namespace, ...(result || {}) });
    } catch (err) {
      this.#logger.warn?.('scan.handler.failed', { device, namespace, error: err.message });
      return outcome({ status: 'failed', domain: namespace, message: err.message });
    }
  }
}

export default ScanDispatcher;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/scan/ScanDispatcher.test.mjs`
Expected: PASS, 6 tests

**Step 5: Commit**

```bash
git add backend/src/3_applications/scan/ScanDispatcher.mjs tests/unit/applications/scan/ScanDispatcher.test.mjs
git commit -m "feat(scan): dispatcher with handler registry and never-fall-through outcome"
```

---

## Task 5: Claim ≠ success

A handler that recognizes a code but rejects it must stop dispatch, not leak into another domain. This is nutrition's existing `handled`-not-`ok` rule, generalized — it exists so a typo'd `ct:teapot` is refused rather than sent to a product lookup that answers with a nonsense food.

**Files:**
- Modify: `backend/src/3_applications/scan/ScanDispatcher.mjs`
- Modify: `tests/unit/applications/scan/ScanDispatcher.test.mjs`

**Step 1: Write the failing test**

```javascript
describe('claim is not success', () => {
  it('stops at a handler that claims but refuses, without a route fallback', async () => {
    const nutrition = handler('nutrition', async () => ({
      status: 'refused', claimed: true, ok: false, message: 'unknown container "teapot"',
    }));
    const product = handler('product', async () => ({ status: 'logged', claimed: true }));
    const d = new ScanDispatcher({
      handlers: [nutrition, product],
      routeFallback: { nutribot: 'product' },
    });

    const out = await d.dispatch({ code: 'ct:teapot', device: 'k', route: 'nutribot' });

    expect(out.status).toBe('refused');
    expect(out.message).toContain('teapot');
    expect(product.handle).not.toHaveBeenCalled();
  });

  it('does not fall back when a handler declines without claiming', async () => {
    // Declining is still terminal for this dispatch — the alternative is
    // re-entering resolution, which is how a code ends up meaning two things.
    const content = handler('content', async () => ({ status: 'declined', claimed: false }));
    const d = new ScanDispatcher({ handlers: [content] });
    const out = await d.dispatch({ code: 'go:nope', device: 'k' });
    expect(out.status).toBe('declined');
  });
});
```

**Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/unit/applications/scan/ScanDispatcher.test.mjs`
Expected: PASS both — the Task 4 implementation already returns the handler's result verbatim and never re-enters resolution. If either fails, the dispatcher is re-entering resolution after a handler result; fix by ensuring `dispatch` returns immediately after the single `handler.handle` call.

These tests pin behavior that is easy to break later. Keep them.

**Step 3: Commit**

```bash
git add tests/unit/applications/scan/ScanDispatcher.test.mjs
git commit -m "test(scan): pin claim-is-not-success so a refusal cannot leak domains"
```

---

## Task 6: Wire the four existing handlers

Replace the inline `if` chain in `app.mjs` with dispatcher registration. **Behavior must not change.**

**Files:**
- Create: `backend/src/5_composition/modules/scanDispatch.mjs`
- Modify: `backend/src/app.mjs:2761-2878` (the `onScan` callback passed to `createBarcodeRelay`)

**Step 1: Read the code you are replacing**

Read `backend/src/app.mjs` lines 2748–2880 in full before editing. The existing order is: school first and route-independent → `route === 'nutribot'` (nutriscan, then UPC) → else TriggerEvent. Your replacement must preserve exactly that, including the `NUTRISCAN_SWALLOW_EVENT` warn-once behavior and the `resolveNutribotConversationId()` derivation.

**Step 2: Create the composition module**

```javascript
/**
 * scanDispatch — binds the four scan domains to the shared dispatcher.
 *
 * Handlers are thin: each adapts one domain's existing entry point to the
 * dispatcher's contract. No routing logic lives here, and none should — routing
 * is the vocabulary's job.
 *
 * `go:` and `cmd:` share one handler on purpose. Content and command codes are
 * told apart downstream inside BarcodePayload.parse, and stripping either prefix
 * leaves exactly the legacy positional string it already understands.
 */
import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';

export function createScanDispatch({
  schoolLifecycle, triggerDispatchService, nutritionHandler, productHandler, logger,
}) {
  const trigger = {
    handle: async ({ body, device, route, raw }) => {
      await triggerDispatchService.handleEvent(
        makeTriggerEvent({ value: body, device, route, raw }),
      );
      return { status: 'dispatched', claimed: true, effect: { value: body } };
    },
  };

  return new ScanDispatcher({
    logger,
    routeFallback: { nutribot: 'product', content: 'content' },
    handlers: [
      { namespace: 'content',   handle: trigger.handle },
      { namespace: 'command',   handle: trigger.handle },
      // School looks tokens up by the FULL `sch:` string, so it gets `raw`.
      { namespace: 'school',    handle: ({ raw, device }) => schoolLifecycle.handleScan({ code: raw, device }) },
      { namespace: 'nutrition', handle: nutritionHandler },
      { namespace: 'product',   handle: productHandler },
    ],
  });
}
```

`makeTriggerEvent`, `nutritionHandler` and `productHandler` are lifted verbatim from the corresponding branches in `app.mjs` — move the code, do not rewrite it. `nutritionHandler` wraps `routeNutribotScan` + `scaleNutribotBridge.refreshPrompt`; `productHandler` wraps the `userId`/`conversationId` resolution + `getLogFoodFromUPC().execute`.

**Step 3: Replace the app.mjs callback**

```javascript
onScan: (relay) => {
  scanDispatch.dispatch({ code: relay.code, device: relay.device, route: relay.route })
    .catch((err) => barcodeLogger?.warn?.('scan.dispatch.failed', { device: relay.device, error: err.message }));
},
```

**Step 4: Verify nothing regressed**

```bash
npx vitest run tests/unit/domains/scan tests/unit/applications/scan
npm run test:refactor
```
Expected: all PASS. `test:refactor` includes the layer-import audit — if it flags `ScanCode.mjs`, you have imported something from `3_applications/` into `2_domains/`.

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/scanDispatch.mjs backend/src/app.mjs
git commit -m "refactor(scan): route every scanner through the shared dispatcher"
```

---

## Task 7: The regression that started this

**Files:**
- Create: `tests/unit/applications/scan/scanRegression.test.mjs`

**Step 1: Write the test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';

describe('a content code on a nutribot-routed reader', () => {
  it('goes to content, not to a UPC lookup', async () => {
    const content = { namespace: 'content', handle: vi.fn(async () => ({ status: 'dispatched', claimed: true })) };
    const product = { namespace: 'product', handle: vi.fn(async () => ({ status: 'logged', claimed: true })) };
    const d = new ScanDispatcher({ handlers: [content, product], routeFallback: { nutribot: 'product' } });

    const out = await d.dispatch({
      code: 'go:living-room:plex:594036+shuffle', device: 'nutribot-upc', route: 'nutribot',
    });

    expect(out.domain).toBe('content');
    expect(product.handle).not.toHaveBeenCalled();
  });

  it('still sends a bare UPC on that reader to the product lookup', async () => {
    const content = { namespace: 'content', handle: vi.fn() };
    const product = { namespace: 'product', handle: vi.fn(async () => ({ status: 'logged', claimed: true })) };
    const d = new ScanDispatcher({ handlers: [content, product], routeFallback: { nutribot: 'product' } });

    const out = await d.dispatch({ code: '041260010682', device: 'nutribot-upc', route: 'nutribot' });

    expect(out.domain).toBe('product');
    expect(content.handle).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run**

Run: `npx vitest run tests/unit/applications/scan/scanRegression.test.mjs`
Expected: PASS, 2 tests

**Step 3: Commit**

```bash
git add tests/unit/applications/scan/scanRegression.test.mjs
git commit -m "test(scan): content code on a nutribot reader no longer hits UPC lookup"
```

---

## Out of scope for Phase 1

Do **not** build these; they are Phase 2/3 and are listed so you don't drift into them:

- **Encoders** (`encode(namespace, body)`) and switching printed artifacts to prefixed forms — Phase 2.
- **Deleting the legacy steps** — Phase 3, after artifacts age out.
- **The books handler.** Step 4 reserves the `book` namespace and detects ISBN-13; nothing consumes it yet. A `book` code with no registered handler correctly returns `unknown`.

## Done when

- `npx vitest run tests/unit/domains/scan tests/unit/applications/scan` passes
- `npm run test:refactor` passes
- Every code that worked before works identically — the dispatcher changed *where* routing happens, not *what* it decides
