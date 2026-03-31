# ContentExpression — Unified Content Expression Parser

## Overview

A use-case-agnostic value object that represents "do something with some content on some screen with some options." One canonical form (query object), one serialized form (shortcode string). Replaces 6+ independent parsers across the backend.

## Module

`backend/src/2_domains/content/ContentExpression.mjs`

## API

```js
// Parse from query object (gold standard)
ContentExpression.fromQuery({ screen: 'living-room', queue: 'plex:595104', shuffle: '', volume: '50' })

// Parse from shortcode string (QR/barcode encoding)
ContentExpression.fromString('living-room:queue:plex:595104+shuffle+volume=50')

// Both produce:
{
  screen: 'living-room',       // null if not specified
  action: 'queue',             // null if bare content reference
  contentId: 'plex:595104',    // null if command-only
  options: { shuffle: true, volume: '50' }
}

// Serialize
expr.toString()   // → 'living-room:queue:plex:595104+shuffle+volume=50'
expr.toQuery()    // → { screen: 'living-room', queue: 'plex:595104', shuffle: '', volume: '50' }
```

## Reserved Keys

`screen`, `play`, `queue`, `list`, `open`, `display`, `read`

The first action key found becomes `action`, its value becomes `contentId`. `screen` is screen. Everything else is an option.

## Option Value Rules

- Bare key (empty/undefined value) → `true`: `shuffle` → `{ shuffle: true }`
- Key with value → string: `volume=50` → `{ volume: '50' }`
- No type coercion — consumers decide

## String Format

`[screen:][[action:]contentId][+opt1[=val]+opt2]`

- `:` segment delimiter
- `+` option delimiter
- Semicolons and spaces normalized to colons on parse

## String Parsing (`fromString`)

1. Normalize delimiters: `;` and spaces → `:`
2. Split on first `+` → segments part + options part
3. Parse options: split on `+`, each is `key=val` or `key` → `true`
4. Split segments on `:`, walk to identify screen/action/contentId:
   - Segment matches action key → action, remaining = contentId (rejoined with `:`)
   - First segment not an action, second is → first = screen
   - No action found → bare content reference

## Query Parsing (`fromQuery`)

1. Check each key against reserved set
2. First action key with non-empty value → `action` + `contentId`
3. `screen` key → screen
4. Everything else → options (empty = `true`, otherwise string)

## What It Replaces

| Location | Current | After |
|---|---|---|
| `catalog.mjs` | Manual KNOWN_PARAMS + bare-key extraction | `fromQuery(req.query)` |
| `qrcode.mjs` parseActionParams | 35-line function | `fromQuery(req.query)` + `.toString()` |
| `BarcodePayload.mjs` | Inline +/= splitting, segment counting | `fromString(barcode)` |
| `queue.mjs` parseQueueQuery | Manual shuffle/limit extraction | `fromQuery(req.query)` |
| `modifierParser.mjs` | Path-segment parsing | Callers convert to query, then `fromQuery()` |
| `contentQueryParser.mjs` | BOOLEAN_PARAMS, CANONICAL_KEYS | `fromQuery()` for action/options |

## Constraints

- No dependencies. Pure functions.
- No knowledge of use cases (barcodes, QR, catalogs, autoplay).
- No type coercion — string values stay strings.
- Frontend `parseAutoplayParams.js` is a follow-up (has unique composite/track-level concerns).
