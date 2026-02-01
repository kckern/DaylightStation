# DDD Remediation: B+ to A

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve backend DDD adherence from B+ to A grade by extracting value objects and removing infrastructure concerns from domain layer.

**Architecture:** Extract high-value value objects (SessionId, ItemId, ZoneName, MessageType) following existing ConversationId pattern. Remove logger injection from 5 domain services, pushing logging to application/adapter layers.

**Tech Stack:** ES modules (.mjs), existing ValidationError for VO validation

---

## Scope Decision

| Area | Current | Action | Rationale |
|------|---------|--------|-----------|
| Value Objects | B- | **Fix** | High value - validation, type safety, DRY |
| Domain Purity | B+ | **Fix** | Medium value - removes infrastructure leak |
| Port Placement | B | **Skip** | Low value - "correct, just non-standard" per audit |
| Aggregate Roots | C+ | **Skip** | User decision - implicit is fine |

---

## Task 1: Create SessionId Value Object

**Files:**
- Create: `backend/src/1_domains/fitness/value-objects/SessionId.mjs`
- Create: `backend/src/1_domains/fitness/value-objects/index.mjs`
- Modify: `backend/src/1_domains/fitness/entities/Session.mjs`
- Modify: `backend/src/1_domains/fitness/index.mjs`

**Step 1: Create SessionId value object**

Create `backend/src/1_domains/fitness/value-objects/SessionId.mjs`:

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * SessionId Value Object
 * Format: YYYYMMDDHHmmss (14 digits derived from start time)
 * Immutable, validated, with date extraction behavior.
 */
export class SessionId {
  #value;

  constructor(id) {
    const sanitized = SessionId.sanitize(id);
    if (!sanitized) {
      throw new ValidationError('Invalid SessionId format (14 digits required)', {
        code: 'INVALID_SESSION_ID',
        field: 'sessionId',
        value: id,
      });
    }
    this.#value = sanitized;
    Object.freeze(this);
  }

  get value() { return this.#value; }
  toString() { return this.#value; }
  toJSON() { return this.#value; }

  /** Extract date portion as YYYY-MM-DD */
  getDate() {
    return `${this.#value.slice(0, 4)}-${this.#value.slice(4, 6)}-${this.#value.slice(6, 8)}`;
  }

  /** Extract time portion as HH:mm:ss */
  getTime() {
    return `${this.#value.slice(8, 10)}:${this.#value.slice(10, 12)}:${this.#value.slice(12, 14)}`;
  }

  equals(other) {
    if (other instanceof SessionId) return this.#value === other.value;
    if (typeof other === 'string') return this.#value === SessionId.sanitize(other);
    return false;
  }

  /** Generate SessionId from Date */
  static generate(date) {
    if (date == null) {
      throw new ValidationError('date required', { code: 'MISSING_DATE', field: 'date' });
    }
    const d = typeof date === 'string' ? new Date(date) : date;
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const id = [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
    return new SessionId(id);
  }

  /** Check if value is valid 14-digit format */
  static isValid(id) {
    if (!id) return false;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 14;
  }

  /** Sanitize to 14 digits or return null */
  static sanitize(id) {
    if (!id) return null;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 14 ? digits : null;
  }
}
```

**Step 2: Create value-objects index**

Create `backend/src/1_domains/fitness/value-objects/index.mjs`:

```javascript
export { SessionId } from './SessionId.mjs';
```

**Step 3: Update Session entity to use SessionId**

In `backend/src/1_domains/fitness/entities/Session.mjs`, update to delegate to SessionId:

```javascript
// Add import at top
import { SessionId } from '../value-objects/SessionId.mjs';

// In constructor, accept either string or SessionId
constructor({
  sessionId,
  // ... rest
}) {
  // Normalize to SessionId if string passed
  this.sessionId = sessionId instanceof SessionId
    ? sessionId
    : new SessionId(sessionId);
  // ... rest
}

// Update getDate() to delegate
getDate() {
  return this.sessionId.getDate();
}

// Keep static methods as facades for backward compatibility
static generateSessionId(date) {
  return SessionId.generate(date).value;
}

static isValidSessionId(id) {
  return SessionId.isValid(id);
}

static sanitizeSessionId(id) {
  return SessionId.sanitize(id);
}
```

**Step 4: Export from domain index**

In `backend/src/1_domains/fitness/index.mjs`, add:

```javascript
export * from './value-objects/index.mjs';
```

**Step 5: Commit**

```bash
git add backend/src/1_domains/fitness/value-objects/
git add backend/src/1_domains/fitness/entities/Session.mjs
git add backend/src/1_domains/fitness/index.mjs
git commit -m "feat(fitness): extract SessionId value object

- Create SessionId VO with validation, date/time extraction
- Delegate Session.getDate() to SessionId
- Keep static methods as facades for backward compat

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create ItemId Value Object

**Files:**
- Create: `backend/src/1_domains/content/value-objects/ItemId.mjs`
- Create: `backend/src/1_domains/content/value-objects/index.mjs`
- Modify: `backend/src/1_domains/content/entities/Item.mjs`
- Modify: `backend/src/1_domains/content/index.mjs`

**Step 1: Create ItemId value object**

Create `backend/src/1_domains/content/value-objects/ItemId.mjs`:

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * ItemId Value Object
 * Format: "source:localId" (e.g., "plex:12345")
 * Immutable composite identifier for content items.
 */
export class ItemId {
  #source;
  #localId;

  constructor(source, localId) {
    if (!source || typeof source !== 'string') {
      throw new ValidationError('ItemId requires source', {
        code: 'MISSING_SOURCE',
        field: 'source',
      });
    }
    if (!localId || typeof localId !== 'string') {
      throw new ValidationError('ItemId requires localId', {
        code: 'MISSING_LOCAL_ID',
        field: 'localId',
      });
    }
    this.#source = source;
    this.#localId = localId;
    Object.freeze(this);
  }

  get source() { return this.#source; }
  get localId() { return this.#localId; }

  toString() { return `${this.#source}:${this.#localId}`; }
  toJSON() { return this.toString(); }

  equals(other) {
    if (other instanceof ItemId) {
      return this.#source === other.source && this.#localId === other.localId;
    }
    if (typeof other === 'string') {
      const parsed = ItemId.tryParse(other);
      return parsed ? this.equals(parsed) : false;
    }
    return false;
  }

  /** Parse "source:localId" string */
  static parse(str) {
    const parsed = ItemId.tryParse(str);
    if (!parsed) {
      throw new ValidationError('Invalid ItemId format (expected "source:localId")', {
        code: 'INVALID_ITEM_ID',
        field: 'id',
        value: str,
      });
    }
    return parsed;
  }

  /** Try to parse, return null on failure */
  static tryParse(str) {
    if (!str || typeof str !== 'string') return null;
    const colonIndex = str.indexOf(':');
    if (colonIndex <= 0 || colonIndex === str.length - 1) return null;
    return new ItemId(str.substring(0, colonIndex), str.substring(colonIndex + 1));
  }

  /** Create from source and localId */
  static from(source, localId) {
    return new ItemId(source, String(localId));
  }
}
```

**Step 2: Create value-objects index**

Create `backend/src/1_domains/content/value-objects/index.mjs`:

```javascript
export { ItemId } from './ItemId.mjs';
```

**Step 3: Update Item entity to use ItemId**

In `backend/src/1_domains/content/entities/Item.mjs`, add ItemId support:

```javascript
// Add import
import { ItemId } from '../value-objects/ItemId.mjs';

// In constructor, normalize id to ItemId
constructor(props) {
  // Support both ItemId and string
  if (props.id instanceof ItemId) {
    this.itemId = props.id;
    this.id = props.id.toString();
    this.source = props.id.source;
    this.localId = props.id.localId;
  } else if (props.id) {
    this.itemId = ItemId.parse(props.id);
    this.id = props.id;
    this.source = this.itemId.source;
    this.localId = this.itemId.localId;
  } else if (props.source && props.localId) {
    this.itemId = ItemId.from(props.source, props.localId);
    this.id = this.itemId.toString();
    this.source = props.source;
    this.localId = props.localId;
  } else {
    throw new ValidationError('Item requires id or source+localId');
  }
  // ... rest unchanged
}

// getLocalId() can now delegate
getLocalId() {
  return this.itemId.localId;
}
```

**Step 4: Export from domain index**

In `backend/src/1_domains/content/index.mjs`, add:

```javascript
export * from './value-objects/index.mjs';
```

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/value-objects/
git add backend/src/1_domains/content/entities/Item.mjs
git add backend/src/1_domains/content/index.mjs
git commit -m "feat(content): extract ItemId value object

- Create ItemId VO with source:localId composite format
- Parse/tryParse for string handling
- Item entity now uses ItemId internally

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create ZoneName Enum Value Object

**Files:**
- Create: `backend/src/1_domains/fitness/value-objects/ZoneName.mjs`
- Modify: `backend/src/1_domains/fitness/value-objects/index.mjs`
- Modify: `backend/src/1_domains/fitness/entities/Zone.mjs`

**Step 1: Create ZoneName enum value object**

Create `backend/src/1_domains/fitness/value-objects/ZoneName.mjs`:

```javascript
/**
 * ZoneName Enum Value Object
 * Heart rate zone names with priority ordering.
 * Pattern: Frozen object enum with helper functions.
 */
export const ZoneName = Object.freeze({
  COOL: 'cool',
  ACTIVE: 'active',
  WARM: 'warm',
  HOT: 'hot',
  FIRE: 'fire',
});

export const ZONE_NAMES = Object.freeze(Object.values(ZoneName));

export const ZONE_PRIORITY = Object.freeze({
  [ZoneName.COOL]: 0,
  [ZoneName.ACTIVE]: 1,
  [ZoneName.WARM]: 2,
  [ZoneName.HOT]: 3,
  [ZoneName.FIRE]: 4,
});

export const ZONE_COLORS = Object.freeze({
  [ZoneName.COOL]: '#3B82F6',   // blue
  [ZoneName.ACTIVE]: '#22C55E', // green
  [ZoneName.WARM]: '#EAB308',   // yellow
  [ZoneName.HOT]: '#F97316',    // orange
  [ZoneName.FIRE]: '#EF4444',   // red
});

export function isValidZoneName(name) {
  return ZONE_NAMES.includes(name);
}

export function zonePriority(name) {
  return ZONE_PRIORITY[name] ?? -1;
}

export function zoneColor(name) {
  return ZONE_COLORS[name] ?? null;
}

export function compareZones(a, b) {
  return zonePriority(a) - zonePriority(b);
}
```

**Step 2: Update value-objects index**

In `backend/src/1_domains/fitness/value-objects/index.mjs`:

```javascript
export { SessionId } from './SessionId.mjs';
export {
  ZoneName,
  ZONE_NAMES,
  ZONE_PRIORITY,
  ZONE_COLORS,
  isValidZoneName,
  zonePriority,
  zoneColor,
  compareZones,
} from './ZoneName.mjs';
```

**Step 3: Update Zone entity to use ZoneName**

In `backend/src/1_domains/fitness/entities/Zone.mjs`, import from VO:

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';
import { ZONE_NAMES, ZONE_PRIORITY, isValidZoneName, zonePriority } from '../value-objects/ZoneName.mjs';

// Remove local ZONE_NAMES and ZONE_PRIORITY definitions

export class Zone {
  constructor({ name, minHr, maxHr, color = null }) {
    if (!isValidZoneName(name)) {
      throw new ValidationError(`Invalid zone name: ${name}. Must be one of: ${ZONE_NAMES.join(', ')}`);
    }
    this.name = name;
    this.minHr = minHr;
    this.maxHr = maxHr;
    this.color = color;
  }

  getPriority() { return zonePriority(this.name); }
  // ... rest unchanged
}

// Re-export for backward compat
export { ZONE_NAMES, ZONE_PRIORITY };
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/fitness/value-objects/ZoneName.mjs
git add backend/src/1_domains/fitness/value-objects/index.mjs
git add backend/src/1_domains/fitness/entities/Zone.mjs
git commit -m "feat(fitness): extract ZoneName enum value object

- Create ZoneName enum with priority and color constants
- Zone entity now delegates to ZoneName VO
- Re-export ZONE_NAMES/ZONE_PRIORITY for backward compat

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create MessageType/MessageDirection Enum VOs

**Files:**
- Create: `backend/src/1_domains/messaging/value-objects/MessageType.mjs`
- Create: `backend/src/1_domains/messaging/value-objects/MessageDirection.mjs`
- Modify: `backend/src/1_domains/messaging/value-objects/index.mjs`
- Modify: `backend/src/1_domains/messaging/entities/Message.mjs`

**Step 1: Create MessageType enum**

Create `backend/src/1_domains/messaging/value-objects/MessageType.mjs`:

```javascript
/**
 * MessageType Enum Value Object
 */
export const MessageType = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  IMAGE: 'image',
  DOCUMENT: 'document',
  CALLBACK: 'callback',
});

export const MESSAGE_TYPES = Object.freeze(Object.values(MessageType));

export function isValidMessageType(type) {
  return MESSAGE_TYPES.includes(type);
}
```

**Step 2: Create MessageDirection enum**

Create `backend/src/1_domains/messaging/value-objects/MessageDirection.mjs`:

```javascript
/**
 * MessageDirection Enum Value Object
 */
export const MessageDirection = Object.freeze({
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
});

export const MESSAGE_DIRECTIONS = Object.freeze(Object.values(MessageDirection));

export function isValidMessageDirection(direction) {
  return MESSAGE_DIRECTIONS.includes(direction);
}
```

**Step 3: Update value-objects index**

In `backend/src/1_domains/messaging/value-objects/index.mjs`:

```javascript
export { ConversationId } from './ConversationId.mjs';
export { MessageType, MESSAGE_TYPES, isValidMessageType } from './MessageType.mjs';
export { MessageDirection, MESSAGE_DIRECTIONS, isValidMessageDirection } from './MessageDirection.mjs';
```

**Step 4: Update Message entity**

In `backend/src/1_domains/messaging/entities/Message.mjs`:

```javascript
import { MESSAGE_TYPES, MESSAGE_DIRECTIONS, isValidMessageType, isValidMessageDirection } from '../value-objects/index.mjs';

// Remove local MESSAGE_TYPES and MESSAGE_DIRECTIONS definitions

// Re-export for backward compat
export { MESSAGE_TYPES, MESSAGE_DIRECTIONS };
```

**Step 5: Commit**

```bash
git add backend/src/1_domains/messaging/value-objects/MessageType.mjs
git add backend/src/1_domains/messaging/value-objects/MessageDirection.mjs
git add backend/src/1_domains/messaging/value-objects/index.mjs
git add backend/src/1_domains/messaging/entities/Message.mjs
git commit -m "feat(messaging): extract MessageType/MessageDirection enum VOs

- Create enum VOs with validation helpers
- Message entity imports from VOs
- Re-export constants for backward compat

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Remove Logger from Domain Services

**Files:**
- Modify: `backend/src/1_domains/messaging/services/ConversationService.mjs`
- Modify: `backend/src/1_domains/scheduling/services/SchedulerService.mjs`
- Modify: `backend/src/1_domains/health/services/HealthAggregationService.mjs`
- Modify: `backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs`
- Modify: `backend/src/1_domains/gratitude/services/GratitudeService.mjs`

**Approach:** Remove logger injection. Services return results/throw errors. Callers (application layer) handle logging.

**Step 1: Update ConversationService**

In `backend/src/1_domains/messaging/services/ConversationService.mjs`:

```javascript
// Remove from constructor
constructor({ conversationStore }) {
  this.conversationStore = conversationStore;
  // Remove: this.logger = logger || console;
}

// Remove all this.logger.info/debug/error calls
// Methods should return results or throw; callers log
```

**Step 2: Update SchedulerService**

This service has heavy logging. Pattern:
- Remove `logger` from constructor
- Remove all `this.logger.*` calls
- For job execution status, return structured results that callers can log

**Step 3: Update remaining services**

Apply same pattern to:
- `HealthAggregationService.mjs` - remove `this.#logger`
- `MediaMemoryValidatorService.mjs` - remove `this.#logger`
- `GratitudeService.mjs` - remove `this.#logger`

**Step 4: Update callers in application layer**

In `backend/src/3_applications/` and `backend/src/0_system/bootstrap.mjs`:
- Remove logger from service constructor calls
- Add logging at call sites where needed

**Step 5: Commit**

```bash
git add backend/src/1_domains/*/services/*.mjs
git add backend/src/3_applications/**/*.mjs
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor(domains): remove logger from domain services

- Domain services no longer accept logger injection
- Logging pushed to application/adapter layer
- Services return results/throw errors for callers to log

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update Domain Exports and Run Tests

**Step 1: Verify all exports**

Check that all new VOs are properly exported from domain index files.

**Step 2: Run tests**

```bash
cd backend && npm test
```

**Step 3: Fix any import issues**

Address any broken imports from the refactoring.

**Step 4: Final commit**

```bash
git add .
git commit -m "chore: fix imports after VO extraction

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Effort | Impact |
|------|--------|--------|
| SessionId VO | Small | High - timestamp parsing DRY |
| ItemId VO | Small | High - compound ID validation |
| ZoneName VO | Small | Medium - enum consolidation |
| MessageType/Direction VOs | Small | Medium - enum consolidation |
| Remove Logger | Medium | Medium - domain purity |
| Test & Fix | Small | Required |

**Expected Grade Improvement:**
- Value Objects: B- → A- (4 new VOs added)
- Domain Purity: B+ → A (logger removed)
- Overall: B+ → A-

**Skipped (by design):**
- Port relocation (low value, high effort)
- Aggregate root markers (implicit is fine)
