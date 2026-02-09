# ContentIdResolver

The `ContentIdResolver` is a 5-layer resolution chain that converts any content ID format into a resolved `{ source, localId, adapter }` triple. It replaces the scattered alias handling that was previously split across `actionRouteParser.mjs`, frontend `queryParamResolver.js`, and adapter-level `canResolve()` methods.

**Source:** `backend/src/3_applications/content/ContentIdResolver.mjs`
**Tests:** `tests/isolated/assembly/content/ContentIdResolver.test.mjs`

---

## Resolution Layers

Given an input like `hymn:166`, the resolver tries each layer in order, stopping at the first match:

| Layer | Check | Example Input | Result |
|-------|-------|---------------|--------|
| 1. Exact source | Registry has adapter named `{prefix}` | `plex:457385` | `{ source: 'plex', localId: '457385' }` |
| 2. Registry prefix | `registry.resolveFromPrefix(prefix, rest)` | `media:sfx/intro` | `{ source: 'filesystem', localId: 'sfx/intro' }` |
| 3. System alias | Alias table maps prefix to `{source}:{pathPrefix}` | `hymn:166` | `{ source: 'singalong', localId: 'hymn/166' }` |
| 4. No-colon default | Input has no colon → default to `media` adapter | `sfx/intro` | `{ source: 'media', localId: 'sfx/intro' }` |
| 5. Household alias | Household-level shortcut to a specific item | `music:` | `{ source: 'plex', localId: '12345' }` |

If no layer matches, `resolve()` returns `null`.

---

## System Aliases

System aliases are defined in bootstrap config. Each maps a friendly prefix to `{realSource}:{pathPrefix}`:

| Alias | Target | Effect |
|-------|--------|--------|
| `hymn` | `singalong:hymn` | `hymn:166` → `singalong:hymn/166` |
| `primary` | `singalong:primary` | `primary:42` → `singalong:primary/42` |
| `scripture` | `readalong:scripture` | `scripture:alma-32` → `readalong:scripture/alma-32` |
| `talk` | `readalong:talks` | `talk:ldsgc` → `readalong:talks/ldsgc` |
| `poem` | `readalong:poetry` | `poem:remedy/01` → `readalong:poetry/remedy/01` |
| `local` | `watchlist:` | `local:TVApp` → `watchlist:TVApp` (simple rename) |
| `singing` | `singalong:` | `singing:hymn/166` → `singalong:hymn/166` (simple rename) |
| `narrated` | `readalong:` | `narrated:scripture/x` → `readalong:scripture/x` (simple rename) |
| `list` | `menu:` | `list:fhe` → `menu:fhe` (simple rename) |

Aliases with a non-empty path prefix (like `hymn → singalong:hymn`) prepend that path to the rest: `hymn:166` becomes `singalong:hymn/166`.

Aliases with an empty path prefix (like `local → watchlist:`) act as simple source renames: `local:TVApp` becomes `watchlist:TVApp`.

---

## Household Aliases

Household aliases are user-configured shortcuts that resolve to a specific content ID:

```yaml
# Example household alias config
music: plex:12345
```

`music:` resolves to `{ source: 'plex', localId: '12345' }`.

---

## YAML Whitespace Quirk

YAML values like `input: plex: 457385` parse as `"plex: 457385"` (space after colon). The resolver normalizes this by trimming after the first colon split:

```javascript
// "plex: 457385" → source="plex", localId="457385"
const normalized = compoundId.replace(/^(\w+):\s+/, '$1:').trim();
```

---

## Integration Points

The resolver is wired in `bootstrap.mjs` and injected into API routers:

```javascript
const contentIdResolver = new ContentIdResolver(registry, { systemAliases, householdAliases });
// Passed to: createInfoRouter, createPlayRouter, createDisplayRouter, createListRouter
```

All action route routers use it via `actionRouteParser.mjs` → `contentIdResolver.resolve(compoundId)`.

---

## Heuristic Detection (actionRouteParser)

Before the resolver runs, `actionRouteParser.mjs` handles heuristic ID detection for bare values without a source prefix:

| Pattern | Detected Source | Example |
|---------|----------------|---------|
| All digits | `plex` | `/play/12345` → `plex:12345` |
| UUID format | `immich` | `/play/a1b2-...` → `immich:a1b2-...` |
| Path-like | `media` | `/play/sfx/intro` → `media:sfx/intro` |

This happens at the HTTP layer before the resolver is called.
