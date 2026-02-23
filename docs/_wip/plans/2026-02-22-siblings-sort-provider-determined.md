# Siblings Sort: Provider-Determined Ordering — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the central alpha sort from SiblingsService so each adapter controls its own item ordering.

**Architecture:** Delete the sort in SiblingsService, add alpha sort to 6 adapters that have no natural order. Adapters with natural order (Plex, Komga, etc.) already return items correctly — just stop re-sorting them.

**Tech Stack:** Node.js/Express backend, ES modules (.mjs)

---

## Task 1: Remove central sort from SiblingsService

**Files:**
- Modify: `backend/src/3_applications/content/services/SiblingsService.mjs:43-79`

**Step 1: Update the JSDoc resolution steps (lines 47-51)**

Replace:
```js
   * Resolution:
   * 1. Resolve adapter from registry (exact match, then prefix fallback)
   * 2. Delegate to adapter.resolveSiblings(compoundId)
   * 3. Sort items alphabetically by title
   * 4. Apply windowed pagination
   * 5. Normalize result to uniform DTO shape
```

With:
```js
   * Resolution:
   * 1. Resolve adapter from registry (exact match, then prefix fallback)
   * 2. Delegate to adapter.resolveSiblings(compoundId)
   * 3. Apply windowed pagination (adapter controls item ordering)
   * 4. Normalize result to uniform DTO shape
```

**Step 2: Remove the alpha sort and pass items directly (lines 73-79)**

Replace:
```js
    // Sort items alphabetically by title
    const sortedItems = [...(result.items || [])].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '')
    );

    // Apply windowed pagination
    const windowed = this.#applyWindow(sortedItems, compoundId, opts);
```

With:
```js
    // Apply windowed pagination (adapter controls item ordering)
    const windowed = this.#applyWindow(result.items || [], compoundId, opts);
```

**Step 3: Commit**

```
feat: remove central alpha sort from SiblingsService

Adapters now own their item ordering. This preserves natural order
for sources like Plex (episode/track order), Komga (series number),
and Singalong (song number).
```

---

## Task 2: Add alpha sort to FileAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/media/files/FileAdapter.mjs:853-856`

**Step 1: Add sort after listItems assignment (line 854)**

Replace:
```js
    const items = await this.getList(`files:${parentPath}`);
    const listItems = Array.isArray(items) ? items : (items?.children || []);

    return { parent, items: listItems };
```

With:
```js
    const items = await this.getList(`files:${parentPath}`);
    const listItems = Array.isArray(items) ? items : (items?.children || []);
    listItems.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    return { parent, items: listItems };
```

---

## Task 3: Add alpha sort to AppRegistryAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/app-registry/AppRegistryAdapter.mjs:104-107`

**Step 1: Add sort before return (line 105-106)**

Replace:
```js
  async resolveSiblings() {
    const items = await this.getList();
    return { parent: null, items };
  }
```

With:
```js
  async resolveSiblings() {
    const items = await this.getList();
    items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return { parent: null, items };
  }
```

---

## Task 4: Add alpha sort to QueryAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/query/QueryAdapter.mjs:411`

**Step 1: Add sort after items map (line 411)**

Replace:
```js
    const items = baseItems.map(b => b.item);

    const parent = {
```

With:
```js
    const items = baseItems.map(b => b.item);
    items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    const parent = {
```

---

## Task 5: Add alpha sort to ImmichAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs:834-846`

**Step 1: Add sort after listItems assignment (line 835)**

Replace:
```js
      const items = await this.getList(localId);
      const listItems = Array.isArray(items) ? items : (items?.children || []);
      const containerItem = await this.getItem(localId);
```

With:
```js
      const items = await this.getList(localId);
      const listItems = Array.isArray(items) ? items : (items?.children || []);
      listItems.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      const containerItem = await this.getItem(localId);
```

---

## Task 6: Add alpha sort to LocalContentAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs:1749`

**Step 1: Add sort after listCollection (line 1749)**

Replace:
```js
    const items = await this.listCollection(prefix);
    const titleized = prefix.charAt(0).toUpperCase() + prefix.slice(1);
```

With:
```js
    const items = await this.listCollection(prefix);
    items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const titleized = prefix.charAt(0).toUpperCase() + prefix.slice(1);
```

---

## Task 7: Add alpha sort to AudiobookshelfAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs:675-686`

**Step 1: Add sort after listItems assignment (line 676)**

Replace:
```js
    const items = await this.getList(`lib:${libraryId}`);
    const listItems = Array.isArray(items) ? items : (items?.children || []);

    const parent = {
```

With:
```js
    const items = await this.getList(`lib:${libraryId}`);
    const listItems = Array.isArray(items) ? items : (items?.children || []);
    listItems.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    const parent = {
```

---

## Task 8: Commit adapter changes

**Step 1: Stage and commit all adapter changes**

```
feat: add alpha sort to adapters without natural order

FileAdapter, AppRegistryAdapter, QueryAdapter, ImmichAdapter,
LocalContentAdapter, and AudiobookshelfAdapter now sort items
by title. Adapters with natural order (Plex, Komga, Singalong,
Readalong, List) are unchanged.
```

---

## Notes

- **FilesystemCanvasAdapter** returns `null` from `resolveSiblings()` — no items to sort, skip it.
- **No test changes needed** — no existing tests assert sort order of sibling results.
- **No API contract changes** — response shape is identical, only ordering changes.
