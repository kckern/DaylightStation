# QR Code Action-Based API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support action-based QR code URLs like `?queue=plex:595103&shuffle` that encode the action into the barcode string, use bare keys as options, and default the screen from device config.

**Architecture:** Extend the existing QR code router with a new param-parsing path that detects action keys (`queue`/`play`/`open`), extracts boolean options from bare query params, resolves the default screen from `devices.yml`, builds the encoded barcode string, then delegates to the existing `resolveContent` function for metadata/thumbnail resolution. Backward compatible — existing `?content=` and `?data=` params still work.

**Tech Stack:** Express.js router, existing ContentIdResolver

---

### Task 1: Pass default screen to QR code router

**Files:**
- Modify: `backend/src/app.mjs:1334-1340`
- Modify: `backend/src/4_api/v1/routers/qrcode.mjs:45-46`

Wire the barcode scanner's `target_screen` from `devices.yml` into the QR code router config.

- [ ] **Step 1: Extract default screen from devicesConfig in app.mjs**

In `backend/src/app.mjs`, the `devicesConfig` is already loaded at line 1527. The QR code router is created at line 1334. Add `defaultScreen` to the router config.

Find (around line 1334):
```javascript
  v1Routers.qrcode = createQRCodeRouter({
    renderer: qrcodeRenderer,
    contentIdResolver: contentServices.contentIdResolver,
    mediaPath: mediaBasePath,
    defaultLogoPath: `${mediaBasePath}/img/buttons/play.svg`,
    logger: rootLogger.child({ module: 'qrcode' }),
  });
```

The QR code router is created at line 1334, but `devicesConfig` isn't loaded until line 1527. Move the default screen extraction earlier or compute it inline. The simplest approach: extract from `configService` which is available at this point.

Replace with:
```javascript
  // Resolve default barcode target screen from devices config
  const _qrDevices = (configService.getHouseholdDevices(householdId)?.devices) || {};
  const _qrDefaultScreen = Object.values(_qrDevices)
    .find(d => d.type === 'barcode-scanner')?.target_screen || null;

  v1Routers.qrcode = createQRCodeRouter({
    renderer: qrcodeRenderer,
    contentIdResolver: contentServices.contentIdResolver,
    mediaPath: mediaBasePath,
    defaultLogoPath: `${mediaBasePath}/img/buttons/play.svg`,
    defaultScreen: _qrDefaultScreen,
    logger: rootLogger.child({ module: 'qrcode' }),
  });
```

- [ ] **Step 2: Accept `defaultScreen` in the router factory**

In `backend/src/4_api/v1/routers/qrcode.mjs`, update the destructuring at line 46:

```javascript
  const { renderer, contentIdResolver, mediaPath, defaultLogoPath, defaultScreen, logger = console } = config;
```

- [ ] **Step 3: Verify backend starts without errors**

Run: `cd /opt/Code/DaylightStation && node -e "import('./backend/src/app.mjs')" 2>&1 | head -5`
Or just check that the existing tests still pass:
Run: `npx vitest run backend/tests/unit/ 2>&1 | grep -E "pass|fail" | tail -5`

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/qrcode.mjs
git commit -m "refactor(qrcode): pass defaultScreen from devices.yml to QR code router"
```

---

### Task 2: Add action param parsing to QR code router

**Files:**
- Modify: `backend/src/4_api/v1/routers/qrcode.mjs` (the route handler)

Add a new code path that detects `queue`/`play`/`open` params, extracts bare-key options, builds the encoded barcode string, and feeds into the existing rendering pipeline.

- [ ] **Step 1: Add action detection constants**

At the top of `backend/src/4_api/v1/routers/qrcode.mjs`, after the existing `OPTION_ICON_MAP`, add:

```javascript
const ACTION_KEYS = ['queue', 'play', 'open'];
const KNOWN_PARAMS = new Set([
  ...ACTION_KEYS, 'data', 'content', 'options', 'screen',
  'label', 'sublabel', 'logo', 'size', 'style', 'fg', 'bg',
]);
```

- [ ] **Step 2: Add `parseActionParams` helper**

Add this helper function before the `resolveContent` function (around line 159):

```javascript
/**
 * Parse action-based query params into content resolution inputs.
 * Detects queue/play/open action, extracts bare-key options, builds encode string.
 *
 * @param {Object} query - Express req.query
 * @param {string|null} defaultScreen - Default screen from devices.yml
 * @returns {{ action, contentId, screen, options, encodeData } | null} - null if no action param found
 */
function parseActionParams(query, defaultScreen) {
  let action = null;
  let contentId = null;

  for (const key of ACTION_KEYS) {
    if (query[key] != null && query[key] !== '') {
      action = key;
      contentId = query[key];
      break;
    }
  }

  if (!action) return null;

  // Extract bare-key options (query params not in KNOWN_PARAMS with empty/missing value)
  const options = [];
  for (const [key, value] of Object.entries(query)) {
    if (KNOWN_PARAMS.has(key)) continue;
    if (value === '' || value === undefined) {
      options.push(key);
    }
  }

  // Determine screen: explicit param > default from config
  const screen = query.screen || null;
  const effectiveScreen = screen || defaultScreen;

  // Build encoded barcode string: [screen:]action:contentId[+opt1+opt2]
  let encodeData = `${action}:${contentId}`;
  if (options.length > 0) encodeData += `+${options.join('+')}`;
  // Only prepend screen if it differs from default (scanner already knows default)
  if (screen && screen !== defaultScreen) {
    encodeData = `${screen}:${encodeData}`;
  }

  return { action, contentId, screen: effectiveScreen, options, encodeData };
}
```

- [ ] **Step 3: Wire action parsing into the route handler**

In the route handler (`router.get('/', ...)`), add the action path after the `if (!data && !content)` check. Find this block (around line 70):

```javascript
      if (!data && !content) {
        return res.status(400).json({ error: 'Either "data" or "content" query param is required' });
      }
```

Replace with:

```javascript
      // Check for action-based params first
      const actionParams = parseActionParams(req.query, defaultScreen);

      if (!data && !content && !actionParams) {
        return res.status(400).json({ error: 'Provide an action (queue, play, open), "content", or "data" query param' });
      }
```

Then add the action path. Find the `if (content) {` block (around line 83) and add an `else if (actionParams)` before the `else` (raw/command mode). The full block becomes:

```javascript
      if (actionParams) {
        // ── Action mode ──────────────────────────────────
        encodeData = actionParams.encodeData;

        // Resolve content metadata (thumbnail, labels)
        const result = await resolveContent({
          contentId: actionParams.contentId,
          options: actionParams.options.join('+') || null,
          screen: null, // screen is already baked into encodeData
          contentIdResolver,
          mediaPath,
          logger,
        });

        // Use resolved labels but keep our own encodeData
        if (!label) label = result.label;
        if (!sublabel) sublabel = result.sublabel;
        if (result.logoData) {
          coverData = result.logoData;
          coverAspect = result.coverAspect || 1;
        }
        optionBadges = result.optionBadges || [];

      } else if (content) {
```

Note: the `resolveContent` call passes `screen: null` because the screen prefix is already handled in `actionParams.encodeData`. The `options` param is passed for option badge rendering only (the `+` delimited string that `resolveContent` uses to load badge icons).

- [ ] **Step 4: Test manually**

Rebuild and deploy, then test:
```bash
# Action mode with thumbnail
curl -s "http://localhost:3111/api/v1/qrcode?queue=plex:62450&shuffle" -o /tmp/qr-action.svg
# Check it has a cover image
grep "cover-clip" /tmp/qr-action.svg

# Action mode without options
curl -s "http://localhost:3111/api/v1/qrcode?play=plex:62450" -o /tmp/qr-play.svg
grep "cover-clip" /tmp/qr-play.svg

# Backward compat
curl -s "http://localhost:3111/api/v1/qrcode?content=plex:62450" -o /tmp/qr-compat.svg
grep "cover-clip" /tmp/qr-compat.svg
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/qrcode.mjs
git commit -m "feat(qrcode): add action-based params (queue/play/open) with bare-key options"
```

---

### Task 3: Debug thumbnail for plex:595103

**Files:**
- Modify: `backend/src/4_api/v1/routers/qrcode.mjs` (if needed)

The `plex:595103` content ID should return a thumbnail but doesn't. Debug the resolution path.

- [ ] **Step 1: Add temporary debug logging**

In `resolveContent` (around line 241), add debug logging after the `getItem` call:

```javascript
    const item = await resolved.adapter.getItem(resolved.localId);
    logger.info?.('qrcode.content.debug', {
      contentId,
      hasItem: !!item,
      title: item?.title,
      itemType: item?.itemType,
      thumbnail: item?.thumbnail,
      metaThumbnail: item?.metadata?.thumbnail,
    });
```

- [ ] **Step 2: Hit the endpoint and check logs**

```bash
curl -s "http://localhost:3111/api/v1/qrcode?queue=plex:595103" > /dev/null
sudo docker logs daylight-station 2>&1 | grep "qrcode.content.debug" | tail -3
```

If `thumbnail` is null, the Plex item doesn't have `thumb` or `composite` set. Check if this is a playlist (which uses a different metadata path in Plex).

- [ ] **Step 3: Fix based on findings**

If the item has no thumbnail but is a container/playlist, the fix may be:
- Check if `item.metadata.parentThumb` or similar is available
- Or fetch the first child item's thumbnail as fallback

Add fallback thumbnail logic in `resolveContent` after the initial `thumbUrl` check (line 285):

```javascript
    let thumbUrl = item.thumbnail || meta.thumbnail;

    // Fallback: for containers without thumbnails, try fetching first child's thumbnail
    if (!thumbUrl && item.itemType === 'container' && resolved.adapter.getList) {
      try {
        const children = await resolved.adapter.getList(resolved.localId);
        if (children?.length > 0) {
          thumbUrl = children[0].thumbnail;
          logger.debug?.('qrcode.content.fallbackThumb', { contentId, childThumb: thumbUrl });
        }
      } catch {
        // Best effort — skip if listing fails
      }
    }
```

Replace the existing `const thumbUrl = item.thumbnail || meta.thumbnail;` (line 285) with the block above.

- [ ] **Step 4: Remove debug logging**

Remove the temporary `logger.info?.('qrcode.content.debug', ...)` line added in Step 1.

- [ ] **Step 5: Verify thumbnails work for both content IDs**

```bash
# Album/playlist
curl -s "http://localhost:3111/api/v1/qrcode?queue=plex:595103&shuffle" -o /tmp/qr-album.svg
grep "cover-clip" /tmp/qr-album.svg && echo "HAS COVER" || echo "NO COVER"

# Movie (should still work)
curl -s "http://localhost:3111/api/v1/qrcode?play=plex:62450" -o /tmp/qr-movie.svg
grep "cover-clip" /tmp/qr-movie.svg && echo "HAS COVER" || echo "NO COVER"
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/qrcode.mjs
git commit -m "fix(qrcode): fallback to first child thumbnail for containers without cover art"
```

---

### Task 4: Build, push, deploy, verify

**Files:** None (verification only)

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Build Docker image**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 3: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 4: Verify endpoints**

```bash
# New action API
curl -s "https://daylightlocal.kckern.net/api/v1/qrcode?queue=plex:595103&shuffle" -o /dev/null -w "%{http_code}"
# Should return 200

# Backward compat
curl -s "https://daylightlocal.kckern.net/api/v1/qrcode?content=plex:62450" -o /dev/null -w "%{http_code}"
# Should return 200
```
