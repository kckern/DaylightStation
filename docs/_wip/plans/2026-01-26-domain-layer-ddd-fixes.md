# Domain Layer DDD Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 200+ DDD violations in the domain layer to achieve clean architecture separation.

**Architecture:** Remove infrastructure coupling from domain entities by extracting timestamps, IDs, and serialization to application/adapter layers. Move ports from domain to application layer. Standardize error handling with shared domain error classes.

**Tech Stack:** Node.js ES Modules, Domain-Driven Design patterns

---

## Phase 1: Create Shared Domain Error Infrastructure

### Task 1: Create Core Domain Error Classes

**Files:**
- Create: `backend/src/1_domains/core/errors/ValidationError.mjs`
- Create: `backend/src/1_domains/core/errors/DomainInvariantError.mjs`
- Create: `backend/src/1_domains/core/errors/EntityNotFoundError.mjs`
- Create: `backend/src/1_domains/core/errors/index.mjs`

**Step 1: Write the failing test**

Create test file:
```javascript
// backend/src/1_domains/core/errors/__tests__/errors.test.mjs
import { describe, it, expect } from 'vitest';
import { ValidationError, DomainInvariantError, EntityNotFoundError } from '../index.mjs';

describe('ValidationError', () => {
  it('should include code, field, and value properties', () => {
    const error = new ValidationError('Duration must be positive', {
      code: 'INVALID_DURATION',
      field: 'duration',
      value: -5
    });

    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Duration must be positive');
    expect(error.code).toBe('INVALID_DURATION');
    expect(error.field).toBe('duration');
    expect(error.value).toBe(-5);
  });
});

describe('DomainInvariantError', () => {
  it('should include code and details properties', () => {
    const error = new DomainInvariantError('Cannot complete inactive session', {
      code: 'SESSION_NOT_ACTIVE',
      details: { currentStatus: 'pending' }
    });

    expect(error.name).toBe('DomainInvariantError');
    expect(error.code).toBe('SESSION_NOT_ACTIVE');
    expect(error.details).toEqual({ currentStatus: 'pending' });
  });
});

describe('EntityNotFoundError', () => {
  it('should include entityType and entityId properties', () => {
    const error = new EntityNotFoundError('Session', '20260126143052');

    expect(error.name).toBe('EntityNotFoundError');
    expect(error.entityType).toBe('Session');
    expect(error.entityId).toBe('20260126143052');
    expect(error.message).toBe('Session not found: 20260126143052');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- backend/src/1_domains/core/errors/__tests__/errors.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_domains/core/errors/ValidationError.mjs
/**
 * Input validation error - bad data coming IN to entity/service.
 *
 * @class ValidationError
 * @extends Error
 */
export class ValidationError extends Error {
  constructor(message, { code, field, value, details } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;
    this.value = value;
    this.details = details;
  }
}
```

```javascript
// backend/src/1_domains/core/errors/DomainInvariantError.mjs
/**
 * Business rule violation error - operation would break domain rules.
 *
 * @class DomainInvariantError
 * @extends Error
 */
export class DomainInvariantError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'DomainInvariantError';
    this.code = code;
    this.details = details;
  }
}
```

```javascript
// backend/src/1_domains/core/errors/EntityNotFoundError.mjs
/**
 * Entity lookup error - referenced entity doesn't exist.
 *
 * @class EntityNotFoundError
 * @extends Error
 */
export class EntityNotFoundError extends Error {
  constructor(entityType, entityId, { details } = {}) {
    super(`${entityType} not found: ${entityId}`);
    this.name = 'EntityNotFoundError';
    this.entityType = entityType;
    this.entityId = entityId;
    this.details = details;
  }
}
```

```javascript
// backend/src/1_domains/core/errors/index.mjs
export { ValidationError } from './ValidationError.mjs';
export { DomainInvariantError } from './DomainInvariantError.mjs';
export { EntityNotFoundError } from './EntityNotFoundError.mjs';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- backend/src/1_domains/core/errors/__tests__/errors.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/core/errors/
git commit -m "feat(core): add shared domain error classes

- ValidationError for input validation failures
- DomainInvariantError for business rule violations
- EntityNotFoundError for missing entity lookups

Part of DDD domain layer cleanup."
```

---

## Phase 2: Move Ports to Application Layer

### Task 2: Move AI Domain Ports

**Files:**
- Move: `backend/src/1_domains/ai/ports/IAIGateway.mjs` → `backend/src/3_applications/common/ports/IAIGateway.mjs`
- Move: `backend/src/1_domains/ai/ports/ITranscriptionService.mjs` → `backend/src/3_applications/common/ports/ITranscriptionService.mjs`
- Create: `backend/src/3_applications/common/ports/index.mjs`
- Delete: `backend/src/1_domains/ai/ports/` (directory)

**Step 1: Create target directory structure**

```bash
mkdir -p backend/src/3_applications/common/ports
```

**Step 2: Move IAIGateway.mjs**

```bash
mv backend/src/1_domains/ai/ports/IAIGateway.mjs backend/src/3_applications/common/ports/
```

**Step 3: Move ITranscriptionService.mjs**

```bash
mv backend/src/1_domains/ai/ports/ITranscriptionService.mjs backend/src/3_applications/common/ports/
```

**Step 4: Create barrel export**

```javascript
// backend/src/3_applications/common/ports/index.mjs
export { IAIGateway } from './IAIGateway.mjs';
export { ITranscriptionService } from './ITranscriptionService.mjs';
```

**Step 5: Find and update all imports**

Run: `grep -r "1_domains/ai/ports" backend/src --include="*.mjs" --include="*.js"`

Update each file to import from `#applications/common/ports/index.mjs`

**Step 6: Remove empty directory**

```bash
rmdir backend/src/1_domains/ai/ports
```

**Step 7: Run tests**

Run: `npm test`
Expected: PASS (or fix any import issues)

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(ai): move ports from domain to application layer

IAIGateway and ITranscriptionService now in 3_applications/common/ports/.
Ports define contracts for external systems and belong in application layer per DDD."
```

---

### Task 3: Move Messaging Domain Ports

**Files:**
- Move: `backend/src/1_domains/messaging/ports/*.mjs` → `backend/src/3_applications/common/ports/`
- Update: `backend/src/3_applications/common/ports/index.mjs`
- Delete: `backend/src/1_domains/messaging/ports/`

**Step 1: Move all messaging ports**

```bash
mv backend/src/1_domains/messaging/ports/INotificationChannel.mjs backend/src/3_applications/common/ports/
mv backend/src/1_domains/messaging/ports/IMessagingGateway.mjs backend/src/3_applications/common/ports/
mv backend/src/1_domains/messaging/ports/IConversationStateStore.mjs backend/src/3_applications/common/ports/
mv backend/src/1_domains/messaging/ports/IConversationStore.mjs backend/src/3_applications/common/ports/
```

**Step 2: Update barrel export**

```javascript
// backend/src/3_applications/common/ports/index.mjs
export { IAIGateway } from './IAIGateway.mjs';
export { ITranscriptionService } from './ITranscriptionService.mjs';
export { INotificationChannel } from './INotificationChannel.mjs';
export { IMessagingGateway } from './IMessagingGateway.mjs';
export { IConversationStateStore } from './IConversationStateStore.mjs';
export { IConversationStore } from './IConversationStore.mjs';
```

**Step 3: Find and update all imports**

Run: `grep -r "1_domains/messaging/ports" backend/src --include="*.mjs" --include="*.js"`

**Step 4: Remove empty directory**

```bash
rmdir backend/src/1_domains/messaging/ports
```

**Step 5: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(messaging): move ports from domain to application layer"
```

---

### Task 4: Move Fitness Domain Ports

**Files:**
- Move: `backend/src/1_domains/fitness/ports/*.mjs` → `backend/src/3_applications/fitness/ports/`
- Create: `backend/src/3_applications/fitness/ports/index.mjs`
- Update: `backend/src/1_domains/fitness/index.mjs` (remove port exports)
- Delete: `backend/src/1_domains/fitness/ports/`

**Step 1: Create target directory**

```bash
mkdir -p backend/src/3_applications/fitness/ports
```

**Step 2: Move fitness ports**

```bash
mv backend/src/1_domains/fitness/ports/ISessionStore.mjs backend/src/3_applications/fitness/ports/
mv backend/src/1_domains/fitness/ports/IFitnessSyncerGateway.mjs backend/src/3_applications/fitness/ports/
mv backend/src/1_domains/fitness/ports/IZoneLedController.mjs backend/src/3_applications/fitness/ports/
```

**Step 3: Create barrel export**

```javascript
// backend/src/3_applications/fitness/ports/index.mjs
export { ISessionStore } from './ISessionStore.mjs';
export { IFitnessSyncerGateway } from './IFitnessSyncerGateway.mjs';
export { IZoneLedController } from './IZoneLedController.mjs';
```

**Step 4: Update domain index.mjs**

Remove this line from `backend/src/1_domains/fitness/index.mjs`:
```javascript
// REMOVE: export { ISessionStore } from './ports/ISessionStore.mjs';
```

**Step 5: Find and update all imports**

Run: `grep -r "1_domains/fitness/ports" backend/src --include="*.mjs" --include="*.js"`

**Step 6: Remove empty directory and commit**

```bash
rmdir backend/src/1_domains/fitness/ports
npm test
git add -A
git commit -m "refactor(fitness): move ports from domain to application layer"
```

---

### Task 5: Move Nutrition Domain Ports

**Files:**
- Move: `backend/src/1_domains/nutrition/ports/*.mjs` → `backend/src/3_applications/nutribot/ports/`
- Create: `backend/src/3_applications/nutribot/ports/index.mjs`
- Delete: `backend/src/1_domains/nutrition/ports/`

**Step 1: Create target directory**

```bash
mkdir -p backend/src/3_applications/nutribot/ports
```

**Step 2: Move nutrition ports**

```bash
mv backend/src/1_domains/nutrition/ports/IFoodLogStore.mjs backend/src/3_applications/nutribot/ports/
mv backend/src/1_domains/nutrition/ports/INutriCoachStore.mjs backend/src/3_applications/nutribot/ports/
mv backend/src/1_domains/nutrition/ports/INutriListStore.mjs backend/src/3_applications/nutribot/ports/
```

**Step 3: Create barrel export**

```javascript
// backend/src/3_applications/nutribot/ports/index.mjs
export { IFoodLogStore } from './IFoodLogStore.mjs';
export { INutriCoachStore } from './INutriCoachStore.mjs';
export { INutriListStore } from './INutriListStore.mjs';
```

**Step 4: Find and update all imports**

Run: `grep -r "1_domains/nutrition/ports" backend/src --include="*.mjs" --include="*.js"`

**Step 5: Remove empty directory and commit**

```bash
rmdir backend/src/1_domains/nutrition/ports
npm test
git add -A
git commit -m "refactor(nutrition): move ports from domain to application layer"
```

---

### Task 6: Move Finance Domain Ports

**Files:**
- Move: `backend/src/1_domains/finance/ports/ITransactionSource.mjs` → `backend/src/3_applications/finance/ports/`
- Delete: `backend/src/1_domains/finance/ports/`

**Step 1: Create target and move**

```bash
mkdir -p backend/src/3_applications/finance/ports
mv backend/src/1_domains/finance/ports/ITransactionSource.mjs backend/src/3_applications/finance/ports/
```

**Step 2: Create barrel export**

```javascript
// backend/src/3_applications/finance/ports/index.mjs
export { ITransactionSource } from './ITransactionSource.mjs';
```

**Step 3: Find and update imports, remove empty dir, commit**

```bash
grep -r "1_domains/finance/ports" backend/src --include="*.mjs" --include="*.js"
rmdir backend/src/1_domains/finance/ports
npm test
git add -A
git commit -m "refactor(finance): move ports from domain to application layer"
```

---

## Phase 3: Remove Infrastructure Imports from Domain Entities

### Task 7: Remove nowTs24 from Finance Account Entity

**Files:**
- Modify: `backend/src/1_domains/finance/entities/Account.mjs`

**Step 1: Read current file**

Check line 5 for the import and lines 47, 55 for usage.

**Step 2: Modify factory method to accept timestamp**

Replace:
```javascript
import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';
```

With nothing (remove line).

Replace usages of `nowTs24()` with a required `timestamp` parameter in factory/methods:
```javascript
// In static create method:
static create({ name, balance, type, timestamp }) {
  if (!timestamp) throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
  return new Account({
    id: generateAccountId(),
    name,
    balance,
    type,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

// In updateBalance method:
updateBalance(newBalance, timestamp) {
  if (!timestamp) throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
  this.balance = newBalance;
  this.updatedAt = timestamp;
}
```

**Step 3: Update callers**

Run: `grep -r "Account.create" backend/src --include="*.mjs" --include="*.js"`

Update each caller to pass timestamp from application layer.

**Step 4: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(finance): remove infrastructure import from Account entity

Account.create() and updateBalance() now require timestamp parameter.
Application layer provides timestamps."
```

---

### Task 8: Remove nowTs24 from Messaging Entities

**Files:**
- Modify: `backend/src/1_domains/messaging/entities/Message.mjs`
- Modify: `backend/src/1_domains/messaging/entities/Notification.mjs`
- Modify: `backend/src/1_domains/messaging/entities/Conversation.mjs`

**Step 1: Remove import from Message.mjs (line 8)**

Remove: `import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';`

**Step 2: Update Message factory to require timestamp**

Find `static create` or constructor and add required `timestamp` parameter.

**Step 3: Repeat for Notification.mjs (line 8)**

**Step 4: Repeat for Conversation.mjs (line 5)**

**Step 5: Find and update all callers**

```bash
grep -r "Message.create\|Notification.create\|Conversation.create" backend/src --include="*.mjs"
```

**Step 6: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(messaging): remove infrastructure imports from entities

Message, Notification, Conversation now require timestamp parameter.
Application layer provides timestamps."
```

---

### Task 9: Remove nowTs24 from Journalist Entities

**Files:**
- Modify: `backend/src/1_domains/journalist/entities/ConversationMessage.mjs`
- Modify: `backend/src/1_domains/journalist/entities/JournalEntry.mjs`
- Modify: `backend/src/1_domains/journalist/entities/MessageQueue.mjs`
- Modify: `backend/src/1_domains/journalist/entities/QuizAnswer.mjs`
- Modify: `backend/src/1_domains/journalist/entities/QuizQuestion.mjs`

**Step 1: For each file, remove line 9-10 infrastructure import**

**Step 2: Update factory methods to require timestamp parameter**

**Step 3: Find and update callers**

```bash
grep -r "ConversationMessage.create\|JournalEntry.create\|MessageQueue.create\|QuizAnswer.create\|QuizQuestion.create" backend/src --include="*.mjs"
```

**Step 4: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(journalist): remove infrastructure imports from entities

All journalist entities now require timestamp parameter."
```

---

### Task 10: Remove nowTs24 from Remaining Entities

**Files:**
- Modify: `backend/src/1_domains/gratitude/entities/Selection.mjs` (line 11)
- Modify: `backend/src/1_domains/journaling/entities/JournalEntry.mjs` (line 5)
- Modify: `backend/src/1_domains/lifelog/entities/NutriLog.mjs` (line 3)
- Modify: `backend/src/1_domains/scheduling/entities/JobExecution.mjs` (line 4)

**Step 1: Remove import from each file**

**Step 2: Update factory methods to require timestamp**

**Step 3: Update callers and run tests**

```bash
npm test
git add -A
git commit -m "refactor: remove remaining nowTs24 imports from domain entities

Affects gratitude, journaling, lifelog, scheduling domains."
```

---

## Phase 4: Remove Date.now() and new Date() from Domain

### Task 11: Fix Session.mjs Time Dependencies

**Files:**
- Modify: `backend/src/1_domains/fitness/entities/Session.mjs`

**Step 1: Remove default parameters using Date.now()**

Line 107: Change `end(endTime = Date.now())` to `end(endTime)` with validation.
Line 198: Change `generateSessionId(date = new Date())` to require date parameter.

**Step 2: Remove inline Date.now() calls**

Line 127: `timestamp: Date.now()` → require timestamp parameter in `addEvent()`
Line 141: `this.snapshots.updatedAt = Date.now()` → require timestamp in `addSnapshot()`

**Step 3: Add validation for required timestamps**

```javascript
end(endTime) {
  if (!endTime) throw new ValidationError('endTime required', { code: 'MISSING_END_TIME', field: 'endTime' });
  this.endTime = endTime;
  this.durationMs = this.getDurationMs();
}

addEvent(event, timestamp) {
  if (!timestamp) throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
  this.timeline.events.push({ ...event, timestamp });
}
```

**Step 4: Update callers and run tests**

```bash
grep -r "session.end\|session.addEvent\|session.addSnapshot\|Session.generateSessionId" backend/src --include="*.mjs"
npm test
git add -A
git commit -m "refactor(fitness): remove Date.now() from Session entity

All time-dependent methods now require explicit timestamp parameter."
```

---

### Task 12: Fix Mortgage.mjs and MortgageCalculator.mjs Time Dependencies

**Files:**
- Modify: `backend/src/1_domains/finance/entities/Mortgage.mjs`
- Modify: `backend/src/1_domains/finance/services/MortgageCalculator.mjs`

**Step 1: Fix Mortgage.mjs line 68**

```javascript
// Change from:
getRemainingMonths() {
  const now = new Date();
  // ...
}

// To:
getRemainingMonths(asOfDate) {
  if (!asOfDate) throw new ValidationError('asOfDate required', { code: 'MISSING_DATE', field: 'asOfDate' });
  // ...
}
```

**Step 2: Fix MortgageCalculator.mjs lines 95, 170**

Update methods to require date parameters instead of defaulting to `new Date()`.

**Step 3: Update callers and commit**

```bash
npm test
git add -A
git commit -m "refactor(finance): remove new Date() from Mortgage domain

getRemainingMonths() and calculator methods now require date parameter."
```

---

### Task 13: Fix NutriLog.mjs Time Dependencies

**Files:**
- Modify: `backend/src/1_domains/nutrition/entities/NutriLog.mjs`

**Step 1: Remove private #now() method (line 136)**

**Step 2: Fix getCurrentDateStr getter**

This getter uses `new Date()`. Either:
- Remove it entirely (caller provides date)
- Convert to method requiring date parameter

**Step 3: Fix static create() (line 456)**

```javascript
// Change from:
const now = new Date();

// To: require timestamp parameter
static create({ timestamp, ...props }) {
  if (!timestamp) throw new ValidationError('timestamp required');
  // use timestamp instead of new Date()
}
```

**Step 4: Fix fromLegacy() (lines 539, 551-553)**

Add required `timestamp` parameter for fallback values.

**Step 5: Update callers and commit**

```bash
npm test
git add -A
git commit -m "refactor(nutrition): remove new Date() from NutriLog entity

Factory methods now require explicit timestamp parameter."
```

---

### Task 14: Fix Remaining Time Dependencies

**Files:**
- Modify: `backend/src/1_domains/scheduling/entities/JobState.mjs` (lines 36, 45)
- Modify: `backend/src/1_domains/scheduling/services/SchedulerService.mjs` (multiple lines)
- Modify: `backend/src/1_domains/messaging/entities/Message.mjs` (lines 98, 213)
- Modify: `backend/src/1_domains/messaging/services/*.mjs`
- Modify: `backend/src/1_domains/gratitude/entities/Selection.mjs` (line 123)
- Modify: `backend/src/1_domains/journalist/entities/QuizQuestion.mjs` (line 94)

**Step 1: For each file, replace default `new Date()` parameters with required parameters**

**Step 2: For computed properties using Date.now(), convert to methods requiring timestamp**

**Step 3: Update callers throughout**

**Step 4: Run tests and commit per domain**

```bash
npm test
git add -A
git commit -m "refactor: remove remaining Date.now()/new Date() from domain layer"
```

---

## Phase 5: Replace Generic Errors with Domain Errors

### Task 15: Replace Generic Errors in Fitness Domain

**Files:**
- Modify: `backend/src/1_domains/fitness/entities/Zone.mjs`
- Modify: `backend/src/1_domains/fitness/services/SessionService.mjs`

**Step 1: Add import to Zone.mjs**

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';
```

**Step 2: Replace line 25**

```javascript
// From:
throw new Error(`Invalid zone name: ${name}...`);

// To:
throw new ValidationError(`Invalid zone name: ${name}`, {
  code: 'INVALID_ZONE_NAME',
  field: 'name',
  value: name
});
```

**Step 3: Update SessionService.mjs**

```javascript
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

// Line 120: throw new Error('Valid sessionId is required')
throw new ValidationError('Valid sessionId is required', { code: 'INVALID_SESSION_ID', field: 'sessionId' });

// Line 151, 169: throw new Error(`Session not found: ${sessionId}`)
throw new EntityNotFoundError('Session', sessionId);
```

**Step 4: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(fitness): use domain error classes

Replace generic Error with ValidationError/EntityNotFoundError."
```

---

### Task 16: Replace Generic Errors in Finance Domain

**Files:**
- Modify: `backend/src/1_domains/finance/services/BudgetService.mjs`
- Modify: `backend/src/1_domains/finance/services/MortgageService.mjs`
- Modify: `backend/src/1_domains/finance/services/TransactionClassifier.mjs`

**Step 1: Add imports and replace errors**

```javascript
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

// BudgetService line 43, 62:
throw new EntityNotFoundError('Budget', id);

// MortgageService lines 43, 55, 93:
throw new EntityNotFoundError('Mortgage', id);

// TransactionClassifier line 53:
throw new ValidationError('TransactionClassifier requires bucket configuration', {
  code: 'MISSING_CONFIG',
  field: 'bucketConfig'
});
```

**Step 2: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(finance): use domain error classes"
```

---

### Task 17: Replace Generic Errors in Remaining Domains

**Files:**
- Modify: `backend/src/1_domains/content/entities/Item.mjs`
- Modify: `backend/src/1_domains/content/entities/WatchState.mjs`
- Modify: `backend/src/1_domains/nutrition/services/FoodLogService.mjs`
- Modify: `backend/src/1_domains/messaging/services/*.mjs`
- Modify: `backend/src/1_domains/scheduling/entities/Job.mjs`
- Modify: `backend/src/1_domains/scheduling/services/SchedulerService.mjs`
- Modify: `backend/src/1_domains/lifelog/entities/NutriLog.mjs`
- Modify: `backend/src/1_domains/gratitude/services/GratitudeService.mjs`

**Step 1: Add imports to each file**

```javascript
import { ValidationError, DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
```

**Step 2: Replace each generic error with appropriate domain error**

| Original | Replacement |
|----------|-------------|
| `throw new Error('X required')` | `throw new ValidationError('X required', { code: 'MISSING_X', field: 'x' })` |
| `throw new Error('X not found')` | `throw new EntityNotFoundError('X', id)` |
| `throw new Error('Cannot X when Y')` | `throw new DomainInvariantError('Cannot X when Y', { code: 'INVALID_STATE' })` |

**Step 3: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor: use domain error classes across all domains"
```

---

## Phase 6: Remove Custom ValidationError Classes

### Task 18: Remove Local ValidationError from Journalist Domain

**Files:**
- Modify: `backend/src/1_domains/journalist/entities/JournalEntry.mjs`
- Modify: `backend/src/1_domains/journalist/entities/QuizAnswer.mjs`
- Modify: `backend/src/1_domains/journalist/entities/MessageQueue.mjs`
- Modify: `backend/src/1_domains/journalist/entities/ConversationMessage.mjs`
- Modify: `backend/src/1_domains/journalist/entities/QuizQuestion.mjs`

**Step 1: In each file, remove local ValidationError class definition (lines ~15-20)**

```javascript
// REMOVE this block from each file:
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

**Step 2: Add import from core**

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';
```

**Step 3: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(journalist): use shared ValidationError from core"
```

---

### Task 19: Remove Local ValidationError from Nutrition Domain

**Files:**
- Modify: `backend/src/1_domains/nutrition/entities/FoodItem.mjs`
- Modify: `backend/src/1_domains/nutrition/entities/NutriLog.mjs`

**Step 1: Remove local class and infrastructure import**

```javascript
// REMOVE:
import { ValidationError } from '../../../0_infrastructure/utils/errors/index.mjs';
```

**Step 2: Add import from core**

```javascript
import { ValidationError } from '#domains/core/errors/index.mjs';
```

**Step 3: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(nutrition): use shared ValidationError from core"
```

---

## Phase 7: Move Serialization to Adapters (Large Scope - Break into Sub-tasks)

### Task 20: Create Session Mapper in Adapter Layer

**Files:**
- Create: `backend/src/2_adapters/fitness/mappers/SessionMapper.mjs`
- Modify: `backend/src/1_domains/fitness/entities/Session.mjs` (remove toJSON/fromJSON)
- Modify: Repository that uses Session

**Step 1: Write the failing test**

```javascript
// backend/src/2_adapters/fitness/mappers/__tests__/SessionMapper.test.mjs
import { describe, it, expect } from 'vitest';
import { SessionMapper } from '../SessionMapper.mjs';
import { Session } from '#domains/fitness/index.mjs';

describe('SessionMapper', () => {
  it('should serialize Session to persistence format', () => {
    const session = Session.create({
      timestamp: '20260126143052',
      startTime: 1706284252000,
      zones: []
    });

    const json = SessionMapper.toPersistence(session);

    expect(json.id).toBe(session.id);
    expect(json.start_time).toBeDefined();
  });

  it('should deserialize from persistence to Session', () => {
    const data = {
      id: '20260126143052',
      start_time: '2026-01-26 14:30:52',
      status: 'active',
      zones: []
    };

    const session = SessionMapper.toDomain(data);

    expect(session).toBeInstanceOf(Session);
    expect(session.id).toBe('20260126143052');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- backend/src/2_adapters/fitness/mappers/__tests__/SessionMapper.test.mjs
```

**Step 3: Implement SessionMapper**

```javascript
// backend/src/2_adapters/fitness/mappers/SessionMapper.mjs
import { Session } from '#domains/fitness/index.mjs';
import { formatLocalTimestamp, parseToDate } from '#infrastructure/utils/time.mjs';

export class SessionMapper {
  static toPersistence(session) {
    return {
      id: session.id,
      start_time: formatLocalTimestamp(new Date(session.startTime)),
      end_time: session.endTime ? formatLocalTimestamp(new Date(session.endTime)) : null,
      status: session.status,
      duration_ms: session.durationMs,
      zones: session.zones.map(z => ZoneMapper.toPersistence(z)),
      roster: session.roster,
      timeline: session.timeline,
      snapshots: session.snapshots
    };
  }

  static toDomain(data) {
    return new Session({
      id: data.id,
      startTime: parseToDate(data.start_time).getTime(),
      endTime: data.end_time ? parseToDate(data.end_time).getTime() : null,
      status: data.status,
      durationMs: data.duration_ms,
      zones: data.zones?.map(z => ZoneMapper.toDomain(z)) || [],
      roster: data.roster || [],
      timeline: data.timeline || { series: {}, events: [] },
      snapshots: data.snapshots || {}
    });
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- backend/src/2_adapters/fitness/mappers/__tests__/SessionMapper.test.mjs
```

**Step 5: Remove toJSON/fromJSON from Session entity**

Delete lines 168-192 from `Session.mjs`.

**Step 6: Update repository to use mapper**

Find repository that calls `session.toJSON()` or `Session.fromJSON()` and update to use `SessionMapper`.

**Step 7: Run full test suite and commit**

```bash
npm test
git add -A
git commit -m "refactor(fitness): move Session serialization to adapter mapper

SessionMapper handles persistence ↔ domain translation.
Session entity no longer has toJSON/fromJSON methods."
```

---

### Task 21-30: Create Mappers for Remaining Entities

Repeat Task 20 pattern for:
- Zone, Participant (fitness)
- Account, Budget, Mortgage, Transaction (finance)
- Message, Notification, Conversation (messaging)
- NutriLog, FoodItem (nutrition)
- Selection, GratitudeItem (gratitude)
- HealthMetric, WorkoutEntry (health)
- JournalEntry (journaling, journalist)
- Job, JobExecution, JobState (scheduling)

Each task follows same structure:
1. Write mapper test
2. Implement mapper
3. Remove toJSON/fromJSON from entity
4. Update repository
5. Commit

---

## Phase 8: Move Misplaced Services to Application Layer

### Task 31: Move YouTubeDownloadService to Application Layer

**Files:**
- Move: `backend/src/1_domains/media/services/YouTubeDownloadService.mjs` → `backend/src/3_applications/media/services/`
- Update: all imports

**Step 1: Create target directory and move**

```bash
mkdir -p backend/src/3_applications/media/services
mv backend/src/1_domains/media/services/YouTubeDownloadService.mjs backend/src/3_applications/media/services/
```

**Step 2: Update imports in the service**

The service uses `fs`, `path`, `child_process` - these are allowed in application layer.

**Step 3: Find and update all imports of this service**

```bash
grep -r "YouTubeDownloadService" backend/src --include="*.mjs"
```

**Step 4: Run tests and commit**

```bash
npm test
git add -A
git commit -m "refactor(media): move YouTubeDownloadService to application layer

Service uses infrastructure (fs, child_process) so belongs in application layer."
```

---

### Task 32: Move ArchiveService and MediaMemoryService to Application Layer

**Files:**
- Move: `backend/src/1_domains/content/services/ArchiveService.mjs` → `backend/src/3_applications/content/services/`
- Move: `backend/src/1_domains/content/services/MediaMemoryService.mjs` → `backend/src/3_applications/content/services/`

Follow same pattern as Task 31.

---

## Verification Tasks

### Task 33: Run Full Audit to Verify No Violations Remain

**Step 1: Search for remaining infrastructure imports in domain**

```bash
grep -r "0_infrastructure" backend/src/1_domains --include="*.mjs"
```
Expected: No results

**Step 2: Search for remaining Date.now() in domain**

```bash
grep -r "Date.now()" backend/src/1_domains --include="*.mjs"
```
Expected: No results

**Step 3: Search for remaining new Date() in domain**

```bash
grep -r "new Date()" backend/src/1_domains --include="*.mjs"
```
Expected: No results (except in tests)

**Step 4: Search for remaining generic errors**

```bash
grep -r "throw new Error(" backend/src/1_domains --include="*.mjs"
```
Expected: Only in port interface stubs

**Step 5: Verify no ports remain in domain**

```bash
find backend/src/1_domains -type d -name "ports"
```
Expected: No results

**Step 6: Run full test suite**

```bash
npm test
```
Expected: All pass

**Step 7: Commit verification**

```bash
git add -A
git commit -m "chore: verify domain layer DDD compliance

All infrastructure imports removed.
All ports moved to application layer.
All generic errors replaced with domain errors.
All time dependencies injected."
```

---

## Summary

| Phase | Tasks | Estimated Commits |
|-------|-------|-------------------|
| 1. Core errors | 1 | 1 |
| 2. Move ports | 5 | 5 |
| 3. Remove infra imports | 4 | 4 |
| 4. Remove time functions | 4 | 4 |
| 5. Replace generic errors | 3 | 3 |
| 6. Consolidate ValidationError | 2 | 2 |
| 7. Serialization mappers | 10 | 10 |
| 8. Move services | 2 | 2 |
| 9. Verification | 1 | 1 |
| **Total** | **32** | **32** |
