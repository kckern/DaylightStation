# Bug Report: news/cnn Direct Play Fails - Missing Endpoint

**Date Discovered:** 2026-01-23
**Severity:** Medium
**Status:** Open - Needs Fix
**Component:** Backend - Content Router

---

## Summary

The `play=news/cnn` URL pattern fails because the frontend expects an endpoint `/api/v1/content/local/info/:media` that doesn't exist.

---

## Root Cause

**URL Parsing:** Works correctly - `play=news/cnn` maps to `{ play: { media: "news/cnn" } }`

**Frontend API Call:** When `media` key is present, `Player/lib/api.js` calls:
```javascript
const url = buildUrl(`api/v1/content/local/info/${media}`, { shuffle });
```

**Missing Endpoint:** The backend content router has no `/api/v1/content/local/info/*` route.

---

## Working Alternatives

These endpoints DO work:
- `/api/v1/content/item/filesystem/news/cnn` - Returns folder metadata
- `/api/v1/content/playables/filesystem/news/cnn` - Returns playable video files

---

## Fix Options

### Option A: Add `/content/local/info/*` endpoint (Recommended)

Add a new route in `backend/src/4_api/routers/content.mjs`:
```javascript
router.get('/local/info/*', async (req, res) => {
  const mediaPath = req.params[0];
  const adapter = registry.get('filesystem');
  const item = await adapter.getItem(`filesystem:${mediaPath}`);
  const playables = await adapter.resolvePlayables(`filesystem:${mediaPath}`);
  // Return response similar to /plex/info/:id
  res.json({
    ...item,
    playables: playables.slice(0, 1)  // First playable
  });
});
```

### Option B: Change frontend to use existing endpoints

Modify `frontend/src/modules/Player/lib/api.js`:
```javascript
} else if (media) {
  const url = buildUrl(`api/v1/content/playables/filesystem/${media}`);
  const response = await DaylightAPI(url);
  return response.playables?.[0] || null;
}
```

### Option C: Source name alignment

The FilesystemAdapter is registered as `"filesystem"` but the frontend expects `"local"`. Adding a `local` alias would work but conflicts with FolderAdapter's existing `"local"` alias.

---

## Recommendation

**Option A** is cleanest - add the missing endpoint to match what the frontend expects.

---

## Related

- Investigation from Task 4 of `docs/plans/2026-01-23-tv-folder-submenu-bugs-fix.md`
