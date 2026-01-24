# Talk Folder Random Selection

## Problem

Requesting `/api/local-content/talk/ldsgc202510` (a folder path) returns 404 because the API expects a specific talk like `ldsgc202510/26`.

## Solution

Enhance the talk endpoint to detect folder-level requests and select the next unwatched talk using shuffle logic with automatic reset.

## Behavior

1. Request comes in for `/talk/{folder}`
2. Check if path is a folder (contains multiple talk YAMLs)
3. Load watch history from `media_memory/talk.yml`
4. Filter to talks not yet completed (< 90% watched)
5. Randomly select from unwatched talks
6. If all watched → clear folder entries from memory → start fresh shuffle

## Implementation

### File: `backend/src/4_api/routers/localContent.mjs`

**Add import:**
```javascript
import { findUnwatchedItems } from '../../../_legacy/routers/fetch.mjs';
```

**Modify `/talk/*` route (lines 287-318):**

```javascript
router.get('/talk/*', async (req, res) => {
  try {
    const path = req.params[0] || '';
    const adapter = registry.get('local-content');

    if (!adapter) {
      return res.status(500).json({ error: 'LocalContent adapter not configured' });
    }

    let item = await adapter.getItem(`talk:${path}`);

    // If not found, check if it's a folder
    if (!item) {
      const folder = await adapter._getTalkFolder(path);
      if (folder?.children?.length) {
        const keys = folder.children.map(c => `talks/${path}/${c.localId}`);
        const [selectedKey] = findUnwatchedItems(keys, 'talk', true);
        if (selectedKey) {
          const selectedId = selectedKey.replace('talks/', '');
          item = await adapter.getItem(`talk:${selectedId}`);
        }
      }
    }

    if (!item) {
      return res.status(404).json({ error: 'Talk not found', path });
    }

    res.json({
      title: item.title,
      speaker: item.metadata.speaker,
      media_key: item.id,
      mediaUrl: item.mediaUrl,
      duration: item.duration,
      date: item.metadata.date,
      description: item.metadata.description,
      content: item.metadata.content || []
    });
  } catch (err) {
    console.error('[localContent] talk error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

## Dependencies

- `findUnwatchedItems` from `backend/_legacy/routers/fetch.mjs` - handles filtering, shuffle, and auto-reset
- `adapter._getTalkFolder()` from LocalContentAdapter - returns folder contents
- `media_memory/talk.yml` - existing watch history storage

## Testing

1. Request `/api/local-content/talk/ldsgc202510` → returns random unwatched talk
2. Mark all talks as watched → next request clears memory and returns random talk
3. Request `/api/local-content/talk/ldsgc202510/26` → still returns specific talk
