# Content Expressions

A content expression describes an intent: do [action] with [contentId] on [screen] with [options].

## Canonical Form (Query Object)

The query object is the gold standard representation:

```
{ screen: 'living-room', queue: 'plex:595104', shuffle: '', volume: '50' }
```

### Reserved Keys

| Key | Purpose |
|-----|---------|
| `screen` | Target device/screen |
| `play` | Play content (value = contentId) |
| `queue` | Queue content for sequential playback |
| `list` | Browse container contents |
| `open` | Launch standalone app |
| `display` | Show static image |
| `read` | Open reader |

### Options

Any non-reserved key is an option:
- Empty value (`&shuffle`) → boolean `true`
- String value (`&volume=50`) → string `'50'`
- No type coercion — consumers decide if `'50'` should be a number

## Shortcode String

Serialized form for QR codes and barcodes:

```
[screen:][action:]source:id[+opt1[=val]+opt2]
```

Examples:
- `plex:595104` — bare content reference
- `queue:plex:595104` — action + content
- `living-room:queue:plex:595104` — screen + action + content
- `living-room:queue:plex:595104+shuffle+volume=50` — full expression

Delimiters `;` and spaces are normalized to `:` on parse.

## API

```javascript
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

// Parse from query object (gold standard)
const expr = ContentExpression.fromQuery(req.query);

// Parse from shortcode string
const expr = ContentExpression.fromString('living-room:queue:plex:595104+shuffle');

// Access
expr.screen     // 'living-room' | null
expr.action     // 'queue' | null
expr.contentId  // 'plex:595104' | null
expr.options    // { shuffle: true, volume: '50' }

// Serialize back
expr.toString() // 'living-room:queue:plex:595104+shuffle+volume=50'
expr.toQuery()  // { screen: 'living-room', queue: 'plex:595104', shuffle: '', volume: '50' }
```

## Consumers

| Endpoint / Module | Usage |
|-------------------|-------|
| `/api/v1/catalog/:source/:id` | `fromQuery` — extracts screen + options for QR generation |
| `/api/v1/qrcode` | `fromQuery` — builds encode string via `toString()` |
| `/api/v1/queue/:source/:id` | `fromQuery` — extracts shuffle, limit options |
| `BarcodePayload` | `fromString` — parses scanned shortcodes |

## URL Examples

```
# Catalog PDF with shuffle and loop
/api/v1/catalog/plex/674396?screen=living-room&shuffle&loop

# QR code with play action
/api/v1/qrcode?play=plex:595104&shuffle&screen=living-room

# Queue with shuffle
/api/v1/queue/plex/595104?shuffle
```
