# Siblings Router — Domain Logic Extraction (v2 Redesign)

**Date:** 2026-02-07  
**Status:** Revised Plan  
**Supersedes:** 2026-02-07-siblings-router-domain-logic-extraction.md  
**Related code:** `backend/src/4_api/v1/routers/siblings.mjs`, `backend/src/3_applications/content/`, `backend/src/1_adapters/content/`

---

## Problem with V1 Implementation

The initial implementation still violates DDD:

1. **Adapter-type checking** — Application layer checks `if (adapter.source === 'local-content')` and `if (adapter.source === 'list')`. This violates Open/Closed Principle.

2. **Plex-specific metadata knowledge** — Application layer reads `parentRatingKey`, `librarySectionID`, `albumId` — these are Plex API implementation details that shouldn't leak to the application layer.

3. **Path-based navigation logic** — The `requestLocalId.includes('/')` check and path splitting is file-adapter-specific logic.

**Root cause:** Trying to centralize parent-finding logic in the application layer forces it to know about all adapter implementations. This is backwards.

---

## Correct DDD Approach

**Each adapter knows how to find its own siblings.** The application layer just delegates.

### Add `resolveSiblings()` to IContentSource

```typescript
interface IContentSource {
  source: string;
  prefixes: PrefixMapping[];
  
  getItem(id: string): Promise<Item|null>;
  getList(id: string): Promise<ListableItem[]>;
  resolvePlayables(id: string): Promise<PlayableItem[]>;
  
  // NEW: Each adapter implements its own sibling resolution
  resolveSiblings(localId: string): Promise<SiblingsResult|null>;
}

interface SiblingsResult {
  parent: {
    id: string;
    title: string;
    thumbnail?: string;
    parentId?: string;
    libraryId?: string;
  } | null;
  items: Array<{
    id: string;
    title: string;
    source: string;
    type?: string;
    thumbnail?: string;
    parentTitle?: string;
    grandparentTitle?: string;
    libraryTitle?: string;
    childCount?: number;
    isContainer: boolean;
  }>;
}
```

### Adapter Implementations

Each adapter encapsulates its own parent-finding strategy:

**PlexAdapter:**
```javascript
async resolveSiblings(localId) {
  const item = await this.getItem(localId);
  if (!item) return null;
  
  // Plex knows about parentRatingKey, librarySectionID
  const parentKey = item.metadata?.parentRatingKey || item.metadata?.librarySectionID;
  if (!parentKey) return { parent: null, items: [] };
  
  const parent = await this.getItem(parentKey);
  const siblings = await this.getList(parentKey);
  
  return { parent: this.#formatParent(parent), items: siblings.map(this.#formatItem) };
}
```

**FileAdapter:**
```javascript
async resolveSiblings(localId) {
  // File adapter knows about path-based navigation
  if (!localId.includes('/')) return { parent: null, items: [] };
  
  const parentPath = localId.split('/').slice(0, -1).join('/');
  const siblings = await this.getList(parentPath);
  
  return {
    parent: { id: parentPath, title: parentPath.split('/').pop() },
    items: siblings.map(this.#formatItem)
  };
}
```

**LocalContentAdapter:**
```javascript
async resolveSiblings(localId) {
  // LocalContent knows about collections (scripture, hymn, talk, etc.)
  const collection = this.#determineCollection(localId);
  if (collection) {
    return this.#resolveCollectionSiblings(collection);
  }
  
  // Fall back to item-based resolution
  return this.#resolveItemSiblings(localId);
}
```

**ListAdapter:**
```javascript
async resolveSiblings(localId) {
  // List adapter knows about menu/watchlist prefixes
  const listType = this.#determineListType(localId);
  const items = await this.getList(`${listType}:`);
  
  return {
    parent: { id: `${listType}:`, title: titleize(listType) },
    items: items.map(this.#formatItem)
  };
}
```

### Slim Application Layer

```javascript
class SiblingsService {
  #registry;
  
  async resolveSiblings(source, localId) {
    const adapter = this.#registry.get(source);
    if (!adapter) return { error: 'Unknown source', status: 404 };
    
    // Delegate entirely to adapter
    const result = await adapter.resolveSiblings(localId);
    if (!result) return { error: 'Item not found', status: 404 };
    
    return result;
  }
}
```

The application layer has **zero domain knowledge**. It just finds the adapter and calls its method.

---

## Migration Strategy

1. **Add `resolveSiblings()` to IContentSource** (optional for now, for backward compat)
2. **Add base implementation to ContentSourceBase** that throws "not implemented"
3. **Implement in each adapter:**
   - PlexAdapter — use Plex metadata fields
   - FileAdapter — use path-based navigation
   - LocalContentAdapter — use collection logic
   - ListAdapter — use list prefix logic
4. **Simplify SiblingsService** to just delegate to adapter
5. **Remove all adapter-specific logic** from application layer

---

## Benefits

✅ **Open/Closed Principle** — Adding a new adapter doesn't require changing the application layer  
✅ **Encapsulation** — Plex implementation details stay in PlexAdapter  
✅ **Testability** — Each adapter's sibling logic can be tested independently  
✅ **True layering** — Application layer has no adapter-specific knowledge  

---

## What This Means

The original router code was **accidentally correct** in placing logic at the API layer, because we didn't have a proper adapter interface for siblings. 

The v1 refactor moved that logic to the application layer, which was **correct in direction but wrong in depth** — we should have moved it to the **adapter layer**.

This v2 redesign pushes it down one more layer to where it belongs: **in each adapter**.

---

## Implementation Order

1. Update `IContentSource.mjs` — add `resolveSiblings()` as optional method  
2. Update `ContentSourceBase.mjs` — add default implementation that returns null  
3. Implement in FileAdapter (simplest — path splitting)  
4. Implement in PlexAdapter (metadata-based)  
5. Implement in LocalContentAdapter (collection logic)  
6. Implement in ListAdapter (prefix logic)  
7. Simplify `SiblingsService` to pure delegation  
8. Test each adapter independently  
9. Run integration tests

---

## Success Criteria

- [ ] `IContentSource` includes `resolveSiblings()` method
- [ ] Each adapter implements its own sibling resolution strategy
- [ ] `SiblingsService` has NO adapter-specific branches
- [ ] `SiblingsService` has NO metadata field knowledge
- [ ] Adding a new adapter requires zero changes to application/API layers
