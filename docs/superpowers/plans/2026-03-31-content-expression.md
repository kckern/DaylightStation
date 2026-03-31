# ContentExpression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a unified, use-case-agnostic parser for content expressions (screen + action + contentId + options) that replaces 6+ independent parsers across the backend.

**Architecture:** A pure value object `ContentExpression` in the domain layer with two entry points: `fromQuery(obj)` for query objects (gold standard) and `fromString(str)` for shortcode strings. Both produce the same normalized output. Serialization via `toString()` and `toQuery()`. Then migrate each consumer to use it.

**Tech Stack:** Pure ES modules, no dependencies. Vitest for tests.

---

### Task 1: Create ContentExpression with fromQuery + tests

**Files:**
- Create: `backend/src/2_domains/content/ContentExpression.mjs`
- Create: `tests/isolated/domain/content/ContentExpression.test.mjs`

**Step 1: Write the failing tests**

```javascript
import { describe, it, expect } from 'vitest';
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

const ACTIONS = ['play', 'queue', 'list', 'open', 'display', 'read'];

describe('ContentExpression.fromQuery', () => {
  it('parses action + contentId', () => {
    const expr = ContentExpression.fromQuery({ queue: 'plex:595104' });
    expect(expr.action).toBe('queue');
    expect(expr.contentId).toBe('plex:595104');
    expect(expr.screen).toBeNull();
    expect(expr.options).toEqual({});
  });

  it('parses screen', () => {
    const expr = ContentExpression.fromQuery({ screen: 'living-room', play: 'plex:123' });
    expect(expr.screen).toBe('living-room');
    expect(expr.action).toBe('play');
    expect(expr.contentId).toBe('plex:123');
  });

  it('parses bare-key options as boolean true', () => {
    const expr = ContentExpression.fromQuery({ play: 'plex:123', shuffle: '', loop: '' });
    expect(expr.options).toEqual({ shuffle: true, loop: true });
  });

  it('parses key=value options as strings', () => {
    const expr = ContentExpression.fromQuery({ play: 'plex:123', volume: '50', shader: 'dark' });
    expect(expr.options).toEqual({ volume: '50', shader: 'dark' });
  });

  it('parses mixed boolean and value options', () => {
    const expr = ContentExpression.fromQuery({ queue: 'plex:123', shuffle: '', volume: '50' });
    expect(expr.options).toEqual({ shuffle: true, volume: '50' });
  });

  it('handles no action (bare content reference not applicable to query)', () => {
    const expr = ContentExpression.fromQuery({ shuffle: '', loop: '' });
    expect(expr.action).toBeNull();
    expect(expr.contentId).toBeNull();
    expect(expr.options).toEqual({ shuffle: true, loop: true });
  });

  it('picks first action key found', () => {
    const expr = ContentExpression.fromQuery({ play: 'plex:1', queue: 'plex:2' });
    expect(expr.action).toBe('play');
    expect(expr.contentId).toBe('plex:1');
  });

  it('ignores undefined values same as empty string', () => {
    const expr = ContentExpression.fromQuery({ play: 'plex:1', shuffle: undefined });
    expect(expr.options).toEqual({ shuffle: true });
  });

  it('handles all action types', () => {
    for (const action of ACTIONS) {
      const expr = ContentExpression.fromQuery({ [action]: 'plex:1' });
      expect(expr.action).toBe(action);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/domain/content/ContentExpression.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
/**
 * ContentExpression — use-case-agnostic value object for content expressions.
 *
 * Represents: do [action] with [contentId] on [screen] with [options].
 * Query object is the gold standard. Strings are serialized representations.
 *
 * @module domains/content/ContentExpression
 */

const ACTION_KEYS = new Set(['play', 'queue', 'list', 'open', 'display', 'read']);
const RESERVED_KEYS = new Set([...ACTION_KEYS, 'screen']);

export class ContentExpression {
  constructor({ screen = null, action = null, contentId = null, options = {} }) {
    this.screen = screen;
    this.action = action;
    this.contentId = contentId;
    this.options = options;
  }

  /**
   * Parse from a query object (gold standard format).
   * Action keys: play, queue, list, open, display, read (value = contentId).
   * screen key = target screen. Everything else = option.
   * Empty/undefined values become boolean true; string values stay strings.
   *
   * @param {Object} query
   * @returns {ContentExpression}
   */
  static fromQuery(query = {}) {
    let screen = null;
    let action = null;
    let contentId = null;
    const options = {};

    for (const [key, value] of Object.entries(query)) {
      if (key === 'screen') {
        screen = value || null;
      } else if (ACTION_KEYS.has(key) && !action && value != null && value !== '' && value !== true) {
        action = key;
        contentId = value;
      } else if (!RESERVED_KEYS.has(key)) {
        options[key] = (value === '' || value === undefined) ? true : value;
      }
    }

    return new ContentExpression({ screen, action, contentId, options });
  }

  /**
   * Parse from a shortcode string (QR/barcode format).
   * Format: [screen:][action:]source:id[+opt1[=val]+opt2]
   * Semicolons and spaces normalized to colons.
   *
   * @param {string} str
   * @param {string[]} [knownActions] - Override action detection (default: ACTION_KEYS)
   * @returns {ContentExpression}
   */
  static fromString(str, knownActions) {
    if (!str || typeof str !== 'string') {
      return new ContentExpression({});
    }

    const actions = knownActions ? new Set(knownActions) : ACTION_KEYS;

    // Split options (everything after first +)
    const plusIdx = str.indexOf('+');
    const mainPart = plusIdx !== -1 ? str.slice(0, plusIdx) : str;
    const optStr = plusIdx !== -1 ? str.slice(plusIdx + 1) : '';

    const options = {};
    if (optStr) {
      for (const part of optStr.split('+')) {
        if (!part) continue;
        const eqIdx = part.indexOf('=');
        if (eqIdx !== -1) {
          options[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
        } else {
          options[part] = true;
        }
      }
    }

    // Normalize delimiters and split segments
    const normalized = mainPart.replace(/[; ]/g, ':');
    const segments = normalized.split(':');

    let screen = null;
    let action = null;
    let contentId = null;

    if (segments.length < 2) {
      // Single segment — could be a bare action or unknown
      if (actions.has(segments[0])) {
        action = segments[0];
      }
      return new ContentExpression({ screen, action, contentId, options });
    }

    // Content IDs are always source:localId (last two segments)
    contentId = segments.slice(-2).join(':');
    const prefixes = segments.slice(0, -2);

    if (prefixes.length === 0) {
      // source:id only
    } else if (prefixes.length === 1) {
      if (actions.has(prefixes[0])) {
        action = prefixes[0];
      } else {
        screen = prefixes[0];
      }
    } else if (prefixes.length === 2) {
      screen = prefixes[0];
      action = prefixes[1];
    }

    return new ContentExpression({ screen, action, contentId, options });
  }

  /**
   * Serialize to shortcode string.
   * @returns {string}
   */
  toString() {
    const parts = [];
    if (this.screen) parts.push(this.screen);
    if (this.action) parts.push(this.action);
    if (this.contentId) parts.push(this.contentId);

    let result = parts.join(':');

    const optParts = [];
    for (const [key, value] of Object.entries(this.options)) {
      if (value === true) {
        optParts.push(key);
      } else if (value != null && value !== '') {
        optParts.push(`${key}=${value}`);
      }
    }
    if (optParts.length > 0) {
      result += '+' + optParts.join('+');
    }

    return result;
  }

  /**
   * Serialize to query object (gold standard format).
   * @returns {Object}
   */
  toQuery() {
    const query = {};
    if (this.screen) query.screen = this.screen;
    if (this.action && this.contentId) query[this.action] = this.contentId;
    for (const [key, value] of Object.entries(this.options)) {
      query[key] = value === true ? '' : value;
    }
    return query;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/content/ContentExpression.test.mjs`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/ContentExpression.mjs tests/isolated/domain/content/ContentExpression.test.mjs
git commit -m "feat: add ContentExpression unified parser with fromQuery"
```

---

### Task 2: Add fromString + toString + toQuery tests

**Files:**
- Modify: `tests/isolated/domain/content/ContentExpression.test.mjs`

**Step 1: Add fromString and serialization tests**

Append to existing test file:

```javascript
describe('ContentExpression.fromString', () => {
  it('parses source:id', () => {
    const expr = ContentExpression.fromString('plex:595104');
    expect(expr.contentId).toBe('plex:595104');
    expect(expr.action).toBeNull();
    expect(expr.screen).toBeNull();
  });

  it('parses action:source:id', () => {
    const expr = ContentExpression.fromString('queue:plex:595104');
    expect(expr.action).toBe('queue');
    expect(expr.contentId).toBe('plex:595104');
  });

  it('parses screen:source:id', () => {
    const expr = ContentExpression.fromString('living-room:plex:595104');
    expect(expr.screen).toBe('living-room');
    expect(expr.contentId).toBe('plex:595104');
    expect(expr.action).toBeNull();
  });

  it('parses screen:action:source:id', () => {
    const expr = ContentExpression.fromString('living-room:queue:plex:595104');
    expect(expr.screen).toBe('living-room');
    expect(expr.action).toBe('queue');
    expect(expr.contentId).toBe('plex:595104');
  });

  it('parses options with +', () => {
    const expr = ContentExpression.fromString('plex:595104+shuffle+shader=dark');
    expect(expr.contentId).toBe('plex:595104');
    expect(expr.options).toEqual({ shuffle: true, shader: 'dark' });
  });

  it('parses full expression with screen, action, and options', () => {
    const expr = ContentExpression.fromString('living-room:queue:plex:595104+shuffle+volume=50');
    expect(expr.screen).toBe('living-room');
    expect(expr.action).toBe('queue');
    expect(expr.contentId).toBe('plex:595104');
    expect(expr.options).toEqual({ shuffle: true, volume: '50' });
  });

  it('normalizes semicolons to colons', () => {
    const expr = ContentExpression.fromString('living-room;queue;plex;595104+shuffle');
    expect(expr.screen).toBe('living-room');
    expect(expr.action).toBe('queue');
    expect(expr.contentId).toBe('plex:595104');
    expect(expr.options).toEqual({ shuffle: true });
  });

  it('normalizes spaces to colons', () => {
    const expr = ContentExpression.fromString('living-room queue plex 595104');
    expect(expr.screen).toBe('living-room');
    expect(expr.action).toBe('queue');
    expect(expr.contentId).toBe('plex:595104');
  });

  it('preserves dashes in screen names', () => {
    const expr = ContentExpression.fromString('living-room:plex:123');
    expect(expr.screen).toBe('living-room');
  });

  it('returns empty expression for null/empty input', () => {
    const expr = ContentExpression.fromString('');
    expect(expr.action).toBeNull();
    expect(expr.contentId).toBeNull();
  });
});

describe('ContentExpression.toString', () => {
  it('serializes full expression', () => {
    const expr = ContentExpression.fromQuery({ screen: 'living-room', queue: 'plex:595104', shuffle: '', volume: '50' });
    expect(expr.toString()).toBe('living-room:queue:plex:595104+shuffle+volume=50');
  });

  it('serializes without screen', () => {
    const expr = ContentExpression.fromQuery({ play: 'plex:123', shuffle: '' });
    expect(expr.toString()).toBe('play:plex:123+shuffle');
  });

  it('serializes bare content reference', () => {
    const expr = ContentExpression.fromString('plex:123');
    expect(expr.toString()).toBe('plex:123');
  });
});

describe('ContentExpression.toQuery', () => {
  it('serializes to query object', () => {
    const expr = ContentExpression.fromString('living-room:queue:plex:595104+shuffle+volume=50');
    expect(expr.toQuery()).toEqual({
      screen: 'living-room',
      queue: 'plex:595104',
      shuffle: '',
      volume: '50',
    });
  });

  it('omits null screen', () => {
    const expr = ContentExpression.fromQuery({ play: 'plex:1' });
    const q = expr.toQuery();
    expect(q.screen).toBeUndefined();
    expect(q.play).toBe('plex:1');
  });
});

describe('roundtrip', () => {
  it('fromQuery → toString → fromString produces same result', () => {
    const original = ContentExpression.fromQuery({ screen: 'office', play: 'plex:999', shuffle: '', shader: 'dark' });
    const str = original.toString();
    const parsed = ContentExpression.fromString(str);
    expect(parsed.screen).toBe(original.screen);
    expect(parsed.action).toBe(original.action);
    expect(parsed.contentId).toBe(original.contentId);
    expect(parsed.options).toEqual(original.options);
  });

  it('fromString → toQuery → fromQuery produces same result', () => {
    const original = ContentExpression.fromString('living-room:queue:plex:595104+shuffle+volume=50');
    const query = original.toQuery();
    const parsed = ContentExpression.fromQuery(query);
    expect(parsed.screen).toBe(original.screen);
    expect(parsed.action).toBe(original.action);
    expect(parsed.contentId).toBe(original.contentId);
    expect(parsed.options).toEqual(original.options);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run tests/isolated/domain/content/ContentExpression.test.mjs`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add tests/isolated/domain/content/ContentExpression.test.mjs
git commit -m "test: add fromString, toString, toQuery, and roundtrip tests for ContentExpression"
```

---

### Task 3: Migrate catalog router

**Files:**
- Modify: `backend/src/4_api/v1/routers/catalog.mjs`

**Step 1: Replace inline parser with ContentExpression**

In `catalog.mjs`, replace lines 39-47:

```javascript
// OLD:
const { screen } = req.query;
const KNOWN_PARAMS = new Set(['screen', 'source', 'id']);
const bareOptions = Object.entries(req.query)
  .filter(([key, val]) => !KNOWN_PARAMS.has(key) && (val === '' || val === undefined))
  .map(([key]) => key);
const options = bareOptions.length > 0 ? bareOptions.join('+') : null;
```

With:

```javascript
// NEW:
import { ContentExpression } from '#domains/content/ContentExpression.mjs';
// ...
const expr = ContentExpression.fromQuery(req.query);
const screen = expr.screen;
const optionStr = Object.entries(expr.options)
  .map(([k, v]) => v === true ? k : `${k}=${v}`)
  .join('+') || null;
```

Then update the QR URL builder (line 66-67) to use `optionStr` instead of `options`:

```javascript
if (screen) params.set('screen', screen);
if (optionStr) params.set('options', optionStr);
```

**Step 2: Test manually**

Run: `curl -s -w "%{http_code}" "http://localhost:3112/api/v1/catalog/plex/674396?screen=living-room&shuffle" | head -c 5`
Expected: `%PDF-` (200 OK, valid PDF)

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/catalog.mjs
git commit -m "refactor(catalog): use ContentExpression for query parsing"
```

---

### Task 4: Migrate qrcode router parseActionParams

**Files:**
- Modify: `backend/src/4_api/v1/routers/qrcode.mjs`

**Step 1: Replace parseActionParams with ContentExpression**

Remove the `parseActionParams` function (lines 260-295), `ACTION_KEYS` (line 37), and `KNOWN_PARAMS` (lines 38-41).

In the route handler where `parseActionParams` is called, replace with:

```javascript
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

// In the handler:
const expr = ContentExpression.fromQuery(req.query);

// action mode (was actionParams block):
if (expr.action) {
  encodeData = expr.toString();
  // If default screen matches, strip it from encode string
  if (defaultScreen && !expr.screen) {
    // No screen in query = use default, don't encode it
  } else if (expr.screen === defaultScreen) {
    const noScreen = new ContentExpression({ ...expr, screen: null });
    // Optionally strip default screen from encoded data
  }

  const result = await resolveContent({
    contentId: expr.contentId,
    options: Object.entries(expr.options).map(([k, v]) => v === true ? k : `${k}=${v}`).join('+') || null,
    screen: null,
    contentIdResolver, mediaPath, logger,
  });

  if (!label) label = result.label;
  if (!sublabel) sublabel = result.sublabel;
  if (result.logoData) { coverData = result.logoData; coverAspect = result.coverAspect || 1; }
  optionBadges = result.optionBadges || [];
}
```

The exact integration depends on how `defaultScreen` stripping works — preserve current behavior.

**Step 2: Run existing QR tests**

Run: `npx vitest run tests/isolated/rendering/qrcode/`
Expected: PASS

**Step 3: Manual test**

Run: `curl -s "http://localhost:3112/api/v1/qrcode?play=plex:595104&shuffle&screen=living-room" | head -c 5`
Expected: `<svg ` (valid SVG)

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/qrcode.mjs
git commit -m "refactor(qrcode): use ContentExpression, remove parseActionParams"
```

---

### Task 5: Migrate BarcodePayload to use ContentExpression

**Files:**
- Modify: `backend/src/2_domains/barcode/BarcodePayload.mjs`

**Step 1: Refactor BarcodePayload.parse to delegate to ContentExpression**

BarcodePayload has extra concerns: command detection, device, timestamp. Keep BarcodePayload as the barcode-specific wrapper. Delegate the content+options parsing to ContentExpression:

```javascript
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

// In parse(), after command detection fails:
// Replace the inline options parsing (lines 76-94) and content parsing (lines 119-151) with:
const expr = ContentExpression.fromString(barcode, knownActions);
return new BarcodePayload({
  type: 'content',
  contentId: expr.contentId,
  action: expr.action,
  command: null,
  commandArg: null,
  options: Object.keys(expr.options).length > 0 ? expr.options : null,
  targetScreen: expr.screen,
  ...common,
});
```

Command detection stays in BarcodePayload (it's barcode-specific, not a content expression concern).

**Step 2: Run existing BarcodePayload tests**

Run: `npx vitest run tests/isolated/domain/barcode/BarcodePayload.test.mjs`
Expected: PASS (all existing tests still pass)

**Step 3: Commit**

```bash
git add backend/src/2_domains/barcode/BarcodePayload.mjs
git commit -m "refactor(barcode): delegate content parsing to ContentExpression"
```

---

### Task 6: Migrate queue router

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs`

**Step 1: Replace parseQueueQuery with ContentExpression**

Remove `parseQueueQuery` function (lines 6-17). Replace usage with:

```javascript
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

// Where parseQueueQuery was called:
const expr = ContentExpression.fromQuery(req.query);
const shuffle = expr.options.shuffle === true || expr.options.shuffle === 'true' || expr.options.shuffle === '1';
const limitRaw = expr.options.limit;
const limit = Number.parseInt(limitRaw, 10);
const queueOpts = { shuffle, limit: Number.isFinite(limit) && limit > 0 ? limit : null };
```

**Step 2: Test**

Run: `curl -s "http://localhost:3112/api/v1/queue/plex/595104?shuffle" | head -c 20`
Expected: JSON response

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs
git commit -m "refactor(queue): use ContentExpression for query parsing"
```

---

### Task 7: Write reference documentation

**Files:**
- Create: `docs/reference/content/content-expressions.md`

**Step 1: Write the doc**

```markdown
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

// Parse
const expr = ContentExpression.fromQuery(req.query);
const expr = ContentExpression.fromString('living-room:queue:plex:595104+shuffle');

// Access
expr.screen     // 'living-room' | null
expr.action     // 'queue' | null
expr.contentId  // 'plex:595104' | null
expr.options    // { shuffle: true, volume: '50' }

// Serialize
expr.toString() // 'living-room:queue:plex:595104+shuffle+volume=50'
expr.toQuery()  // { screen: 'living-room', queue: 'plex:595104', shuffle: '', volume: '50' }
```

## Consumers

| Endpoint | Usage |
|----------|-------|
| `/api/v1/catalog/:source/:id` | `fromQuery` — extracts screen + options for QR generation |
| `/api/v1/qrcode` | `fromQuery` — builds encode string via `toString()` |
| `/api/v1/queue/:source/:id` | `fromQuery` — extracts shuffle, limit options |
| Barcode scanner | `fromString` — parses scanned shortcodes |
```

**Step 2: Commit**

```bash
git add docs/reference/content/content-expressions.md
git commit -m "docs: add content expressions reference"
```

---

### Task 8: Final cleanup

**Files:**
- Modify: `backend/src/4_api/v1/utils/modifierParser.mjs` (if still used — check if any callers remain)
- Delete: any dead code from migrations

**Step 1: Search for dead code**

```bash
grep -r 'parseActionParams\|parseQueueQuery\|KNOWN_PARAMS.*Set\|modifierParser' backend/src/ --include='*.mjs' -l
```

Remove any orphaned imports or unused functions.

**Step 2: Run all tests**

Run: `npx vitest run tests/isolated/`
Expected: All pass

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove dead parser code after ContentExpression migration"
```
