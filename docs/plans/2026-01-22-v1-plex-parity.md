# V1 Plex API Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring v1 list/plex endpoints to 100% parity with production `/media/plex/list/*` endpoints so frontend can consume v1 with no changes.

**Architecture:** Fix response shape in `list.mjs` router to match prod exactly. Add `plex` root field, populate `info` object for collections, align season field names, fix `thumb_id` type.

**Tech Stack:** Express router, PlexAdapter, Jest integration tests

---

## Parity Gaps to Fix

| Gap | Prod | v1 Current | Fix Location |
|-----|------|------------|--------------|
| Root `plex` field | `"plex": "671468"` | Missing | `list.mjs:291` |
| Collection `info` | Object with key/type/labels | `null` | `list.mjs` + PlexAdapter |
| Season `num` field | `"num": 1` | `"index": 1` | `list.mjs:283` |
| Season `img` field | `"img": "/plex_proxy/..."` | `"thumbnail"` | `list.mjs:281` |
| Item `thumb_id` type | Number `725580` | String `"662039"` | PlexAdapter metadata |
| `info.key` field | `"key": "662027"` | Missing | PlexAdapter.getContainerInfo |
| `info.collections` | Array | Missing | PlexAdapter.getContainerInfo |

---

## Task 1: Add Root `plex` Field to List Response

**Files:**
- Modify: `backend/src/4_api/routers/list.mjs:291-302`
- Test: `tests/integration/suite/api/_wip/prod-v1-parity.test.mjs`

**Step 1: Write the failing test assertion**

The existing parity test already checks for this. Verify it fails:

```bash
node tests/integration/suite/api/_wip/prod-v1-parity.test.mjs 2>&1 | grep -A5 "Missing in v1"
```

Expected: Shows `plex (string): "671468"` as missing

**Step 2: Add `plex` field to list response**

In `backend/src/4_api/routers/list.mjs`, find the response object around line 291:

```javascript
// Current:
res.json({
  media_key: localId,
  source,
  path: localId,
  ...
});

// Change to:
res.json({
  // Add plex field for plex source (matches prod format)
  ...(source === 'plex' && { plex: localId }),
  media_key: localId,
  source,
  path: localId,
  ...
});
```

**Step 3: Run parity test to verify fix**

```bash
node tests/integration/suite/api/_wip/prod-v1-parity.test.mjs 2>&1 | grep -A5 "Fitness Shows"
```

Expected: No longer shows `plex` as missing

**Step 4: Commit**

```bash
git add backend/src/4_api/routers/list.mjs
git commit -m "$(cat <<'EOF'
fix(list): add root plex field to match prod format

Prod returns { plex: "671468", ... } at root level for plex lists.
V1 was missing this field.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Populate `info` Object for Collections

**Files:**
- Modify: `backend/src/4_api/routers/list.mjs:265-270`
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs:787-818`
- Test: `tests/integration/suite/api/_wip/prod-v1-parity.test.mjs`

**Step 1: Verify current state**

```bash
curl -s "http://localhost:3111/api/v1/list/plex/671468" | jq '.info'
```

Expected: `null`

**Step 2: Update PlexAdapter.getContainerInfo to include `key` and `collections`**

In `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`, find `getContainerInfo` method (~line 787):

```javascript
// Add after line 802 (after extracting labels):
// Extract collections from Collection array
const collections = [];
if (Array.isArray(item.Collection)) {
  for (const col of item.Collection) {
    if (typeof col === 'string') collections.push(col);
    else if (col?.tag) collections.push(col.tag);
  }
}

// Update the return object to include key and collections:
return {
  key: localId,  // Add this line
  title: item.title,
  image: item.thumb ? `/plex_proxy${item.thumb}` : null,
  summary: item.summary || null,
  tagline: item.tagline || null,
  year: item.year || null,
  studio: item.studio || null,
  type: item.type || null,
  contentType: item.type || null,
  labels,
  collections,  // Add this line
  duration: item.duration ? Math.floor(item.duration / 1000) : null,
  ratingKey: item.ratingKey,
  childCount: item.leafCount || item.childCount || 0
};
```

**Step 3: Update list.mjs to always fetch info for plex source**

In `backend/src/4_api/routers/list.mjs`, around line 265-270, change:

```javascript
// Current (only fetches info for playable):
let info = null;
if (modifiers.playable && adapter.getContainerInfo) {
  info = await adapter.getContainerInfo(compoundId);
}

// Change to (always fetch for plex):
let info = null;
if (adapter.getContainerInfo) {
  info = await adapter.getContainerInfo(compoundId);
}
```

**Step 4: Verify fix**

```bash
curl -s "http://localhost:3111/api/v1/list/plex/671468" | jq '.info'
```

Expected: Object with `key`, `type`, `title`, `labels`, `collections`, `image`

**Step 5: Run parity test**

```bash
node tests/integration/suite/api/_wip/prod-v1-parity.test.mjs 2>&1 | grep -A5 "Type mismatches"
```

Expected: No longer shows `info: object (prod) vs null (v1)`

**Step 6: Commit**

```bash
git add backend/src/4_api/routers/list.mjs backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "$(cat <<'EOF'
fix(list): populate info object for all plex lists

- Always fetch container info for plex source (not just playable)
- Add key and collections fields to PlexAdapter.getContainerInfo
- Matches prod response format

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Align Season Field Names (`num`/`img` vs `index`/`thumbnail`)

**Files:**
- Modify: `backend/src/4_api/routers/list.mjs:273-289`
- Test: `tests/integration/suite/api/_wip/prod-v1-parity.test.mjs`

**Step 1: Verify current state**

```bash
curl -s "http://localhost:3111/api/v1/list/plex/662027/playable" | jq '.seasons["662028"]'
```

Expected: `{ "id": "662028", "title": "Season 1", "index": 1 }`

**Step 2: Update season object field names in list.mjs**

In `backend/src/4_api/routers/list.mjs`, find the seasons map building code (~line 273-289):

```javascript
// Current:
seasonsMap[seasonId] = {
  id: seasonId,
  title: item.metadata?.seasonName || item.metadata?.parentTitle || `Season`,
  index: item.metadata?.seasonNumber ?? item.metadata?.parentIndex,
  thumbnail: item.metadata?.seasonThumbUrl || item.metadata?.parentThumb
};

// Change to (use prod field names):
seasonsMap[seasonId] = {
  num: item.metadata?.seasonNumber ?? item.metadata?.parentIndex,
  title: item.metadata?.seasonName || item.metadata?.parentTitle || `Season`,
  img: item.metadata?.seasonThumbUrl || item.metadata?.parentThumb
};
```

**Step 3: Verify fix**

```bash
curl -s "http://localhost:3111/api/v1/list/plex/662027/playable" | jq '.seasons["662028"]'
```

Expected: `{ "num": 1, "title": "Season 1", "img": "/plex_proxy/..." }`

**Step 4: Run parity test**

```bash
node tests/integration/suite/api/_wip/prod-v1-parity.test.mjs 2>&1 | grep "seasons"
```

Expected: No season-related differences

**Step 5: Commit**

```bash
git add backend/src/4_api/routers/list.mjs
git commit -m "$(cat <<'EOF'
fix(list): use prod season field names (num/img instead of index/thumbnail)

Aligns with prod format:
- num instead of index
- img instead of thumbnail
- Remove id field (prod doesn't include it)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fix `thumb_id` Type (Number Instead of String)

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs:433`
- Test: `tests/integration/suite/api/_wip/prod-v1-parity.test.mjs`

**Step 1: Verify current state**

```bash
curl -s "http://localhost:3111/api/v1/list/plex/662027/playable" | jq '.items[0].thumb_id | type'
```

Expected: `"string"`

**Step 2: Update PlexAdapter to use numeric thumb_id from Media.Part.id**

In `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`, find the metadata building in `_toPlayableItem` (~line 433):

```javascript
// Current:
thumb_id: item.ratingKey,

// Change to (use Media Part id as number, fallback to ratingKey as number):
thumb_id: item.Media?.[0]?.Part?.[0]?.id ?? parseInt(item.ratingKey, 10),
```

**Step 3: Verify fix**

```bash
curl -s "http://localhost:3111/api/v1/list/plex/662027/playable" | jq '.items[0].thumb_id | type'
```

Expected: `"number"`

**Step 4: Run parity test**

```bash
node tests/integration/suite/api/_wip/prod-v1-parity.test.mjs 2>&1 | grep "thumb_id"
```

Expected: No thumb_id type mismatch

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "$(cat <<'EOF'
fix(plex): use numeric thumb_id from Media.Part.id

Prod returns thumb_id as number (the media part ID).
V1 was returning the ratingKey as a string.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Image URL Validation to Parity Test

**Files:**
- Modify: `tests/integration/suite/api/_wip/prod-v1-parity.test.mjs`

**Step 1: Add image validation helper**

Add after the `fetchJSON` function (~line 70):

```javascript
/**
 * Validate image URL returns valid image content
 * @param {string} baseUrl - Base URL (prod or local)
 * @param {string} imagePath - Image path from API response
 * @returns {Promise<{valid: boolean, contentType: string, status: number, error?: string}>}
 */
async function validateImageUrl(baseUrl, imagePath, timeout = 10000) {
  if (!imagePath) return { valid: false, error: 'No image path' };

  const url = `${baseUrl}${imagePath}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      method: 'HEAD'  // Just check headers, don't download
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';
    const isImage = contentType.startsWith('image/');

    // Check for broken image indicators
    const isSvgPlaceholder = contentType.includes('svg');
    const isValidImage = isImage && !isSvgPlaceholder && res.status === 200;

    return {
      valid: isValidImage,
      contentType,
      status: res.status,
      error: !isValidImage ? `Invalid image: ${contentType} (${res.status})` : undefined
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return { valid: false, error: err.message, status: 0, contentType: '' };
  }
}
```

**Step 2: Add image validation test**

Add a new describe block after the main parity tests:

```javascript
describe('Image URL Validation', () => {
  it('v1 collection image URLs return valid images', async () => {
    const res = await fetchJSON(LOCAL_URL, '/api/v1/list/plex/671468');
    if (!res.ok) return;

    const imagesToCheck = [
      res.body.image,
      res.body.info?.image,
      ...(res.body.items?.slice(0, 3).map(i => i.image) || [])
    ].filter(Boolean);

    const results = await Promise.all(
      imagesToCheck.map(img => validateImageUrl(LOCAL_URL, img))
    );

    const invalid = results.filter(r => !r.valid);
    if (invalid.length > 0) {
      console.log('\n  Invalid images found:');
      invalid.forEach((r, i) => console.log(`    - ${imagesToCheck[i]}: ${r.error}`));
    }

    // At least 80% should be valid (some may be missing)
    const validPercent = (results.filter(r => r.valid).length / results.length) * 100;
    expect(validPercent).toBeGreaterThanOrEqual(80);
  });

  it('v1 playable episode thumbnails return valid images', async () => {
    const res = await fetchJSON(LOCAL_URL, '/api/v1/list/plex/662027/playable');
    if (!res.ok) return;

    // Check first 5 items
    const items = res.body.items?.slice(0, 5) || [];
    const images = items.map(i => i.image).filter(Boolean);

    const results = await Promise.all(
      images.map(img => validateImageUrl(LOCAL_URL, img))
    );

    const invalid = results.filter(r => !r.valid);
    if (invalid.length > 0) {
      console.log('\n  Invalid episode thumbnails:');
      invalid.forEach((r, i) => console.log(`    - ${images[i]}: ${r.error}`));
    }

    expect(invalid.length).toBe(0);
  });
});
```

**Step 3: Run image validation tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/suite/api/_wip/prod-v1-parity.test.mjs -t "Image URL"
```

**Step 4: Commit**

```bash
git add tests/integration/suite/api/_wip/prod-v1-parity.test.mjs
git commit -m "$(cat <<'EOF'
test(parity): add image URL validation

Validates that image URLs in API responses return actual images,
not SVG placeholders or errors.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Remove Extra Fields from v1 Response (Cleanup)

**Files:**
- Modify: `backend/src/4_api/routers/list.mjs:301` (toListItem call)

**Step 1: Identify extra fields**

From parity test output, v1 includes extra fields not in prod:
- `id` (v1 uses `plex:123`, prod just has `plex: "123"`)
- `itemType` (prod has `type`)
- `childCount` (prod doesn't include for episodes)
- `metadata` object (prod flattens everything)
- `queue` object (prod doesn't include)
- `media_key` (prod just uses `plex`)

**Decision:** Keep extra fields for now - they don't break frontend and provide useful data. The critical parity is:
1. Required prod fields must exist
2. Types must match
3. Field names must match

Extra fields are OK - frontend ignores them.

**Step 2: Document decision**

No code change needed. Add comment in list.mjs:

```javascript
// Note: v1 includes additional fields (id, itemType, metadata, etc.) beyond prod format.
// This is intentional - extra fields don't break frontend, and provide richer data.
// Critical parity requirements: plex, type, image, rating, title, label must match prod.
```

**Step 3: Commit documentation**

```bash
git add backend/src/4_api/routers/list.mjs
git commit -m "$(cat <<'EOF'
docs(list): document intentional extra fields in v1 response

V1 includes additional fields beyond prod format (id, itemType, metadata).
This is intentional as extra fields don't break frontend compatibility.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final Parity Verification

**Step 1: Run full parity test**

```bash
node tests/integration/suite/api/_wip/prod-v1-parity.test.mjs
```

Expected output:
```
--- Fitness Config ---
  FULL PARITY

--- Plex List - Fitness Shows Collection ---
  Extra in v1 (X):  # These are OK - extra data
    ...

  # NO "Missing in v1" section
  # NO "Type mismatches" section

--- Plex List - Speed Train Playable ---
  Extra in v1 (X):  # These are OK
    ...

  # NO "Missing in v1" section
  # NO "Type mismatches" section
```

**Step 2: Run Jest test suite**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/suite/api/_wip/prod-v1-parity.test.mjs --verbose
```

Expected: All tests pass

**Step 3: Move test out of _wip**

```bash
mv tests/integration/suite/api/_wip/prod-v1-parity.test.mjs tests/integration/suite/api/prod-v1-parity.test.mjs
rmdir tests/integration/suite/api/_wip 2>/dev/null || true
```

**Step 4: Final commit**

```bash
git add tests/integration/suite/api/
git commit -m "$(cat <<'EOF'
test(parity): promote prod-v1 parity test from _wip

All parity gaps fixed:
- Root plex field added
- info object populated for collections
- Season fields aligned (num/img)
- thumb_id type fixed (number)
- Image URL validation added

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/src/4_api/routers/list.mjs` | Add `plex` field, always fetch `info`, fix season field names |
| `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs` | Add `key`/`collections` to getContainerInfo, fix `thumb_id` type |
| `tests/integration/suite/api/prod-v1-parity.test.mjs` | Add image validation tests |

## Test Commands

```bash
# Quick parity check (CLI)
node tests/integration/suite/api/prod-v1-parity.test.mjs

# Full Jest run
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/suite/api/prod-v1-parity.test.mjs --verbose

# Run all integration tests
npm run test:integration
```
