# Menu Log Migration to DDD

## Overview

Move menu logging from broken legacy endpoint (`api/content/menu-log`) to the item router, using proper DDD infrastructure.

**Problem:** The content router's menu-log endpoint returns 501 because `loadFile`/`saveFile` aren't wired up.

**Solution:** Move to item router which already handles the read side (`recent_on_top` modifier), using FileIO utilities directly.

## Changes

### 1. Backend: `backend/src/4_api/routers/item.mjs`

Add POST endpoint for menu logging:

```javascript
// Add import at top
import { loadYaml, saveYaml } from '../../0_infrastructure/utils/FileIO.mjs';

// New endpoint (after existing GET handler)
router.post('/menu-log', async (req, res) => {
  try {
    const { media_key } = req.body;

    if (!media_key) {
      return res.status(400).json({ error: 'media_key is required' });
    }

    const menuMemoryPath = configService?.getHouseholdPath('history/menu_memory')
      ?? 'households/default/history/menu_memory';

    const menuLog = loadYaml(menuMemoryPath) || {};
    const nowUnix = Math.floor(Date.now() / 1000);

    menuLog[media_key] = nowUnix;
    saveYaml(menuMemoryPath, menuLog);

    logger.info?.('item.menu-log.updated', { media_key });
    res.json({ [media_key]: nowUnix });
  } catch (error) {
    logger.error?.('item.menu-log.error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});
```

### 2. Frontend: `frontend/src/modules/Menu/Menu.jsx`

Update line 27:

```javascript
// Before
await DaylightAPI("api/content/menu-log", { media_key: selectedKey });

// After
await DaylightAPI("api/v1/item/menu-log", { media_key: selectedKey });
```

### 3. Cleanup: `backend/src/4_api/routers/content.mjs`

Remove lines 297-332 (the entire menu-log endpoint block and its comments).

## Storage

- **Path:** `households/{hid}/history/menu_memory.yml`
- **Format:** YAML map of `media_key: unix_timestamp`
- **Matches:** Existing read path in item.mjs line 174

## Summary

| File | Change |
|------|--------|
| `item.mjs` | Add import + POST endpoint (~20 lines) |
| `Menu.jsx` | Update API path (1 line) |
| `content.mjs` | Remove dead endpoint (~35 lines) |

Net result: ~15 fewer lines, properly integrated with DDD infrastructure.
