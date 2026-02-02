# API Test Commands for Singing/Reading Routes

Quick reference for testing the singing and reading API routes with curl.

## Prerequisites

- Dev server running: `npm run dev`
- Backend port: 3112 (from settings.local.json)
- singing/reading adapters configured in system.yml

## Item Router Tests (`/api/v1/item/:source/*`)

### Singing Content

```bash
# Get single hymn
curl http://localhost:3112/api/v1/item/singing/hymn/2 | jq

# Get primary song
curl http://localhost:3112/api/v1/item/singing/primary/5 | jq

# List all hymns (container)
curl http://localhost:3112/api/v1/item/singing/hymn | jq

# Get playable hymns only
curl http://localhost:3112/api/v1/item/singing/hymn/playable | jq

# Shuffle hymns
curl http://localhost:3112/api/v1/item/singing/hymn/shuffle | jq

# Recent on top (uses menu history)
curl http://localhost:3112/api/v1/item/singing/hymn/recent_on_top | jq
```

### Reading Content

```bash
# Get scripture chapter
curl http://localhost:3112/api/v1/item/reading/scripture/bom/sebom/31103 | jq

# Get talk
curl http://localhost:3112/api/v1/item/reading/talk/general/1 | jq

# Get poem
curl http://localhost:3112/api/v1/item/reading/poem/remedy/01 | jq

# List all scripture (container)
curl http://localhost:3112/api/v1/item/reading/scripture | jq

# Get playable scripture
curl http://localhost:3112/api/v1/item/reading/scripture/playable | jq

# Recent on top
curl http://localhost:3112/api/v1/item/reading/scripture/recent_on_top | jq
```

## Content Router Tests (`/api/v1/content/*`)

### Get Item (legacy route)

```bash
# Singing
curl http://localhost:3112/api/v1/content/item/singing/hymn/2 | jq

# Reading
curl http://localhost:3112/api/v1/content/item/reading/scripture/bom/sebom/31103 | jq
```

### Get Playables (flatten containers)

```bash
# Get playable hymns
curl http://localhost:3112/api/v1/content/playables/singing/hymn | jq

# Get playable scripture
curl http://localhost:3112/api/v1/content/playables/reading/scripture | jq
```

### Update Progress (watch state)

```bash
# Mark hymn position
curl -X POST http://localhost:3112/api/v1/content/progress/singing/hymn/2 \
  -H "Content-Type: application/json" \
  -d '{"seconds": 120, "duration": 300}' | jq

# Mark scripture position
curl -X POST http://localhost:3112/api/v1/content/progress/reading/scripture/bom/sebom/31103 \
  -H "Content-Type: application/json" \
  -d '{"seconds": 450, "duration": 900}' | jq
```

## Item Router - Menu Logging

```bash
# Log navigation (for recent_on_top sorting)
curl -X POST http://localhost:3112/api/v1/item/menu-log \
  -H "Content-Type: application/json" \
  -d '{"assetId": "singing:hymn/2"}' | jq

curl -X POST http://localhost:3112/api/v1/item/menu-log \
  -H "Content-Type: application/json" \
  -d '{"assetId": "reading:scripture/bom/sebom/31103"}' | jq
```

## Query/Search Tests

### Search by Text

```bash
# Find hymns by text
curl "http://localhost:3112/api/v1/content/query/search?text=hymn&source=singing" | jq

# Find scripture by text
curl "http://localhost:3112/api/v1/content/query/search?text=Alma&source=reading" | jq
```

### Search by Capability

```bash
# Find playable singing items
curl "http://localhost:3112/api/v1/content/query/search?capability=playable&source=singing" | jq

# Find listable reading items
curl "http://localhost:3112/api/v1/content/query/search?capability=listable&source=reading" | jq
```

## Expected Response Format

### Single Item

```json
{
  "id": "singing:hymn/2",
  "source": "singing",
  "path": "hymn/2",
  "title": "All Creatures of Our God and King",
  "label": "All Creatures of Our God and King",
  "itemType": "item",
  "thumbnail": "/path/to/image.jpg",
  "image": "/path/to/image.jpg",
  "items": []
}
```

### Container (with children)

```json
{
  "id": "singing:hymn",
  "source": "singing",
  "path": "hymn",
  "title": "Hymns",
  "itemType": "container",
  "thumbnail": null,
  "items": [
    {
      "id": "singing:hymn/1",
      "source": "singing",
      "path": "hymn/1",
      "title": "O Come, All Ye Faithful",
      "itemType": "item",
      "thumbnail": null
    },
    {
      "id": "singing:hymn/2",
      "source": "singing",
      "path": "hymn/2",
      "title": "All Creatures of Our God and King",
      "itemType": "item",
      "thumbnail": null
    }
  ]
}
```

### Playables Response

```json
{
  "source": "singing",
  "path": "hymn",
  "items": [
    {
      "id": "singing:hymn/1",
      "source": "singing",
      "path": "hymn/1",
      "title": "O Come, All Ye Faithful",
      "itemType": "item",
      "thumbnail": null
    }
  ]
}
```

### Progress Update Response

```json
{
  "itemId": "singing:hymn/2",
  "playhead": 120,
  "duration": 300,
  "percent": 40,
  "watched": false
}
```

### Menu Log Response

```json
{
  "singing:hymn/2": 1738506234
}
```

## Error Responses

### Source Not Found

```bash
curl http://localhost:3112/api/v1/item/unknown/something
```

Response (404):
```json
{
  "error": "Unknown source: unknown"
}
```

### Item Not Found

```bash
curl http://localhost:3112/api/v1/item/singing/hymn/999999
```

Response (404):
```json
{
  "error": "Item not found",
  "source": "singing",
  "localId": "hymn/999999"
}
```

## Debugging Tips

### Check Dev Server is Running

```bash
# Should return health status
curl http://localhost:3112/api/v1/ping | jq

# Check mounted routes
curl http://localhost:3112/api/v1/status | jq '.routes'
```

### Check Adapter Registration

```bash
# In backend logs, should see:
# [Bootstrap] Registering adapters: singing, reading

# API status should show /item, /content mounted
curl http://localhost:3112/api/v1/status | jq
```

### Enable Verbose Logging

```bash
# Tail dev logs
tail -f dev.log | grep -E "singing|reading|item|content"
```

## Notes

- All routes use **compound IDs** in format `source:localId`
- Modifiers (playable, shuffle, recent_on_top) append to path: `/api/v1/item/:source/:localId/:modifier`
- Menu logging uses asset IDs from the compound ID system
- Progress updates require both `seconds` and `duration` in request body
- Empty response indicates item exists but is not a container or has no children
