# Prefix Alias Search Routing Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route prefix-based searches (e.g., `primary:tell me`) to the correct adapter instead of searching all sources.

**Architecture:** Inject `prefixAliases` from `content-prefixes.yml` into `ContentQueryAliasResolver`. The resolver already has a priority chain (user config > built-in > registry > passthrough). We insert prefix alias resolution between registry and passthrough, so `primary` resolves to `singalong` without duplicating config.

**Tech Stack:** Node.js backend, Vitest for isolated tests.

**Bug doc:** `docs/_wip/bugs/2026-03-08-content-dnd-swap-not-persisted.md` (Bug 2)

---

### Task 1: Write failing test for prefix alias resolution in ContentQueryAliasResolver

**Files:**
- Create: `tests/isolated/application/content/ContentQueryAliasResolver.test.mjs`

**Step 1: Write the failing test**

```js
// tests/isolated/application/content/ContentQueryAliasResolver.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';

function createMockRegistry(sources = []) {
  return {
    get: vi.fn(() => null),
    list: vi.fn(() => sources),
    getByProvider: vi.fn(() => []),
    getByCategory: vi.fn(() => []),
  };
}

function createMockConfigService() {
  return {
    getAppConfig: vi.fn(() => null),
  };
}

describe('ContentQueryAliasResolver', () => {
  describe('prefix alias resolution', () => {
    it('resolves "primary" to singalong source via prefixAliases', () => {
      const registry = createMockRegistry(['singalong', 'plex', 'abs']);
      registry.get.mockImplementation(s => s === 'singalong' ? { source: 'singalong' } : null);
      const configService = createMockConfigService();
      const prefixAliases = {
        primary: 'singalong:primary',
        hymn: 'singalong:hymn',
        scripture: 'readalong:scripture',
      };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('primary');

      expect(result.sources).toEqual(['singalong']);
      expect(result.isPassthrough).toBeFalsy();
    });

    it('resolves "hymn" to singalong source via prefixAliases', () => {
      const registry = createMockRegistry(['singalong', 'plex']);
      registry.get.mockImplementation(s => s === 'singalong' ? { source: 'singalong' } : null);
      const configService = createMockConfigService();
      const prefixAliases = { hymn: 'singalong:hymn' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('hymn');

      expect(result.sources).toEqual(['singalong']);
    });

    it('resolves "scripture" to readalong source via prefixAliases', () => {
      const registry = createMockRegistry(['readalong', 'plex']);
      registry.get.mockImplementation(s => s === 'readalong' ? { source: 'readalong' } : null);
      const configService = createMockConfigService();
      const prefixAliases = { scripture: 'readalong:scripture' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('scripture');

      expect(result.sources).toEqual(['readalong']);
    });

    it('falls through to passthrough when prefix not in any alias system', () => {
      const registry = createMockRegistry(['plex', 'abs']);
      const configService = createMockConfigService();
      const prefixAliases = { primary: 'singalong:primary' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('unknownprefix');

      expect(result.isPassthrough).toBe(true);
    });

    it('user config aliases take priority over prefixAliases', () => {
      const registry = createMockRegistry(['custom-source', 'singalong']);
      registry.get.mockImplementation(s => s === 'custom-source' ? { source: 'custom-source' } : null);
      const configService = createMockConfigService();
      configService.getAppConfig.mockReturnValue({
        primary: 'source:custom-source',
      });
      const prefixAliases = { primary: 'singalong:primary' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('primary');

      // User config wins over prefixAliases
      expect(result.sources).toEqual(['custom-source']);
      expect(result.isUserDefined).toBe(true);
    });

    it('built-in aliases take priority over prefixAliases', () => {
      const registry = createMockRegistry(['plex', 'singalong']);
      const configService = createMockConfigService();
      // "music" is a built-in alias — even if prefixAliases also maps it
      const prefixAliases = { music: 'singalong:hymn' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('music');

      expect(result.isBuiltIn).toBe(true);
    });

    it('works without prefixAliases (backwards compatible)', () => {
      const registry = createMockRegistry(['plex']);
      const configService = createMockConfigService();

      const resolver = new ContentQueryAliasResolver({ registry, configService });
      const result = resolver.resolveContentQuery('primary');

      expect(result.isPassthrough).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/content/ContentQueryAliasResolver.test.mjs --no-coverage`
Expected: FAIL — `ContentQueryAliasResolver` constructor doesn't accept `prefixAliases`; resolveContentQuery returns passthrough for `primary`.

---

### Task 2: Implement prefix alias resolution in ContentQueryAliasResolver

**Files:**
- Modify: `backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs`

**Step 3: Add `prefixAliases` to constructor and resolution chain**

In the constructor (`line 85`), accept and store `prefixAliases`:

```js
constructor({ registry, configService, householdId = null, prefixAliases = {} }) {
  this.#registry = registry;
  this.#configService = configService;
  this.#householdId = householdId;
  this.#prefixAliases = prefixAliases;
}
```

Add private field alongside the existing ones (after `#householdId` declaration around line 51):

```js
#prefixAliases;
```

In `#resolveFromRegistry` (line 315), add a check for prefix aliases **before** the passthrough fallback (before line 365):

```js
// 4. Check content-prefixes.yml aliases (e.g., primary → singalong:primary)
const prefixMapping = this.#prefixAliases[prefix];
if (prefixMapping) {
  const [source] = prefixMapping.split(':');
  const adapter = this.#registry.get(source);
  if (adapter) {
    logger.debug('content-query-alias.resolve.prefixAlias', {
      prefix,
      mapping: prefixMapping,
      source
    });
    return {
      intent: `prefix-alias-${prefix}`,
      sources: [source],
      gatekeeper: null,
      libraryFilter: {},
      originalPrefix: prefix,
      isPrefixAlias: true
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/content/ContentQueryAliasResolver.test.mjs --no-coverage`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add tests/isolated/application/content/ContentQueryAliasResolver.test.mjs backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs
git commit -m "feat(content): route prefix aliases to correct adapter in search

Teach ContentQueryAliasResolver about content-prefixes.yml aliases
so that searches like 'primary:tell me' route only to singalong
instead of searching all 12 adapters."
```

---

### Task 3: Wire prefixAliases into the resolver at bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:748`

**Step 6: Pass prefixAliases to the resolver constructor**

Change line 748 from:
```js
const aliasResolver = new ContentQueryAliasResolver({ registry, configService });
```
to:
```js
const aliasResolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
```

`prefixAliases` is already in scope at this point (defined at line 456).

**Step 7: Run the existing ContentQueryService tests to check for regressions**

Run: `npx jest tests/isolated/application/content/ContentQueryService.test.mjs --no-coverage`
Expected: All existing tests PASS.

**Step 8: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "fix(bootstrap): pass prefixAliases to ContentQueryAliasResolver"
```

---

### Task 4: Live verification — search API performance

**Step 9: Restart dev server and test the search API**

```bash
# Restart backend to pick up changes
pkill -f 'node backend/index.js' && sleep 1 && npm run dev &

# Test: primary:tell me should now be fast (only singalong adapter)
curl -s "http://localhost:3112/api/v1/content/query/search?text=primary%3Atell+me&take=20&tier=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('_perf',{}); print(f'Total: {p[\"totalMs\"]}ms'); [print(f'  {k}: {v}') for k,v in p.get('adapters',{}).items() if not v.get('skipped')]"
```

Expected: Only `singalong` adapter queried. Total time ~2-3s instead of 6-17s. Results include `primary:57` ("Tell Me the Stories of Jesus") and `primary:176` ("Tell Me, Dear Lord").

**Step 10: Test other prefix aliases still work**

```bash
# hymn should route to singalong only
curl -s "http://localhost:3112/api/v1/content/query/search?text=hymn%3Alove&take=5&tier=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('_perf',{}); print(f'Total: {p[\"totalMs\"]}ms, adapters: {list(k for k,v in p.get(\"adapters\",{}).items() if not v.get(\"skipped\"))}')"

# scripture should route to readalong only
curl -s "http://localhost:3112/api/v1/content/query/search?text=scripture%3Afaith&take=5&tier=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('_perf',{}); print(f'Total: {p[\"totalMs\"]}ms, adapters: {list(k for k,v in p.get(\"adapters\",{}).items() if not v.get(\"skipped\"))}')"

# unprefixed search should still hit all adapters
curl -s "http://localhost:3112/api/v1/content/query/search?text=beethoven&take=5&tier=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('_perf',{}); print(f'Total: {p[\"totalMs\"]}ms, adapters: {list(k for k,v in p.get(\"adapters\",{}).items() if not v.get(\"skipped\"))}')"
```

Expected: Prefixed searches hit only the mapped adapter. Unprefixed searches still hit all adapters.

---

### Task 5: Update bug doc

**Files:**
- Modify: `docs/_wip/bugs/2026-03-08-content-dnd-swap-not-persisted.md`

**Step 11: Mark Bug 2 search routing as fixed**

Update Bug 2 status from Open to Fixed. Add resolution section noting:
- `ContentQueryAliasResolver` now reads `prefixAliases` from `content-prefixes.yml`
- `primary:` searches route to `singalong` adapter only (~2s vs 6-17s)
- Note: the blur-commit UX issue remains a separate concern (not addressed here)

**Step 12: Commit**

```bash
git add docs/_wip/bugs/2026-03-08-content-dnd-swap-not-persisted.md
git commit -m "docs: update bug doc with prefix alias search routing fix"
```
