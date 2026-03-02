# List Cache mtime Invalidation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically invalidate the ListAdapter's in-memory cache when the underlying YAML file changes on disk, eliminating the need to restart the Docker container after config edits.

**Architecture:** Store the file's `mtime` alongside each cached entry. On cache hit, stat the file and compare mtimes. If the file is newer, reload it. This is cheap (one `fs.statSync` per request vs. re-parsing YAML) and requires no file watchers or TTLs.

**Tech Stack:** Node.js `fs.statSync`, existing ListAdapter in `backend/src/1_adapters/content/list/ListAdapter.mjs`

---

### Task 1: Add mtime-aware caching to `_loadList`

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs:316-336`

**Step 1: Update `_loadList` to store and check mtime**

Replace the `_loadList` method with:

```javascript
_loadList(listType, name) {
    const cacheKey = `${listType}:${name}`;
    const filePath = this._getListPath(listType, name);
    if (!filePath || !fileExists(filePath)) {
      this._listCache.delete(cacheKey);
      return null;
    }

    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = this._listCache.get(cacheKey);
    if (cached && cached.mtime === mtime) {
      return cached.data;
    }

    try {
      const raw = loadYaml(filePath.replace(/\.yml$/, ''));
      const data = normalizeListConfig(raw, name);
      this._listCache.set(cacheKey, { data, mtime });
      return data;
    } catch (err) {
      console.warn(`Failed to load list ${listType}/${name}:`, err.message);
      return null;
    }
  }
```

**Step 2: Ensure `fs` is imported at the top of the file**

Check if `fs` is already imported. If not, add:

```javascript
import fs from 'fs';
```

**Step 3: Update `clearCache` to stay compatible**

No change needed — `this._listCache.clear()` still works since we're just changing the shape of cached values.

**Step 4: Verify by editing a menu YAML and curling without restart**

```bash
# Before: curl to prime cache
curl -s https://daylightlocal.kckern.net/api/v1/list/menu/fhe/recent_on_top | jq '.items[0].label'

# Edit the file (e.g., change a label)
# Curl again — should reflect the change without restart
curl -s https://daylightlocal.kckern.net/api/v1/list/menu/fhe/recent_on_top | jq '.items[0].label'
```

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs
git commit -m "fix(list): invalidate cache when YAML file changes on disk"
```
