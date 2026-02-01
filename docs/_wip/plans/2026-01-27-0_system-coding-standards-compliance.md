# 0_system Layer Coding Standards Compliance

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix coding standards violations in the 0_system layer identified by the audit.

**Architecture:** This is a refactoring task with no behavior changes. Each fix is isolated. Tests verify no regressions.

**Tech Stack:** Node.js ES modules (.mjs), Jest for testing

---

## Overview

Six issues to fix from the audit at `docs/_wip/audits/2026-01-27-0_system-layer-audit.md`:

1. Error classes missing `code` property (Medium)
2. Logging uses `.js` instead of `.mjs` (Medium)
3. TypeScript stub file in JS codebase (Low)
4. Object default export anti-pattern (Low)
5. Missing `@throws` JSDoc (Low - skip for now)
6. Constructor calls time function (Low - skip, acceptable for system layer)

We'll fix issues 1-4. Issues 5-6 are low-priority and can be addressed later.

---

## Task 1: Add `code` Property to DomainError

**Files:**
- Modify: `backend/src/0_system/utils/errors/DomainError.mjs`
- Test: `backend/tests/unit/suite/0_system/utils/errors/DomainError.test.mjs` (create)

**Step 1: Write the failing test**

Create test file:

```javascript
// backend/tests/unit/suite/0_system/utils/errors/DomainError.test.mjs
import { describe, it, expect } from 'vitest';
import {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
} from '../../../../../../src/0_system/utils/errors/DomainError.mjs';

describe('DomainError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new DomainError('test message', { code: 'TEST_CODE' });
      expect(error.code).toBe('TEST_CODE');
    });

    it('should default to DOMAIN_ERROR when no code provided', () => {
      const error = new DomainError('test message');
      expect(error.code).toBe('DOMAIN_ERROR');
    });

    it('should include code in toJSON output', () => {
      const error = new DomainError('test', { code: 'MY_CODE' });
      const json = error.toJSON();
      expect(json.code).toBe('MY_CODE');
    });
  });
});

describe('ValidationError', () => {
  it('should default to VALIDATION_ERROR code', () => {
    const error = new ValidationError('invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('should allow custom code', () => {
    const error = new ValidationError('invalid input', { code: 'INVALID_EMAIL' });
    expect(error.code).toBe('INVALID_EMAIL');
  });
});

describe('NotFoundError', () => {
  it('should default to NOT_FOUND code', () => {
    const error = new NotFoundError('User', '123');
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('ConflictError', () => {
  it('should default to CONFLICT code', () => {
    const error = new ConflictError('duplicate entry');
    expect(error.code).toBe('CONFLICT');
  });
});

describe('BusinessRuleError', () => {
  it('should default to BUSINESS_RULE_VIOLATION code', () => {
    const error = new BusinessRuleError('MAX_ITEMS', 'exceeded limit');
    expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/Code/DaylightStation && npm test -- backend/tests/unit/suite/0_system/utils/errors/DomainError.test.mjs`

Expected: FAIL - `error.code` is undefined

**Step 3: Implement the code property**

Modify `backend/src/0_system/utils/errors/DomainError.mjs`:

```javascript
// In DomainError constructor, after super(message):
constructor(message, context = {}) {
  super(message);
  this.name = 'DomainError';
  this.code = context.code || 'DOMAIN_ERROR';  // ADD THIS LINE
  this.context = context;
  this.timestamp = nowTs24();
  this.httpStatus = 500;
  // ... rest unchanged
}

// In toJSON(), add code:
toJSON() {
  return {
    name: this.name,
    code: this.code,  // ADD THIS LINE
    message: this.message,
    context: this.context,
    timestamp: this.timestamp,
    httpStatus: this.httpStatus,
  };
}
```

For each subclass, set appropriate default code:

```javascript
// ValidationError constructor:
constructor(message, context = {}) {
  super(message, context);
  this.name = 'ValidationError';
  this.code = context.code || 'VALIDATION_ERROR';  // ADD THIS LINE
  this.httpStatus = 400;
}

// NotFoundError constructor:
constructor(entityType, identifier, context = {}) {
  // ... existing logic ...
  this.name = 'NotFoundError';
  this.code = context.code || 'NOT_FOUND';  // ADD THIS LINE
  this.httpStatus = 404;
}

// ConflictError constructor:
constructor(message, context = {}) {
  super(message, context);
  this.name = 'ConflictError';
  this.code = context.code || 'CONFLICT';  // ADD THIS LINE
  this.httpStatus = 409;
}

// BusinessRuleError constructor:
constructor(rule, message, context = {}) {
  super(message, { rule, ...context });
  this.name = 'BusinessRuleError';
  this.code = context.code || 'BUSINESS_RULE_VIOLATION';  // ADD THIS LINE
  this.rule = rule;
  this.httpStatus = 422;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /root/Code/DaylightStation && npm test -- backend/tests/unit/suite/0_system/utils/errors/DomainError.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/utils/errors/DomainError.mjs backend/tests/unit/suite/0_system/utils/errors/DomainError.test.mjs
git commit -m "feat(errors): add code property to domain error classes

Per coding standards, all errors need machine-readable code for
programmatic handling. Each error class now has a default code
(DOMAIN_ERROR, VALIDATION_ERROR, etc.) that can be overridden
via the context parameter.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add `code` Property to InfrastructureError

**Files:**
- Modify: `backend/src/0_system/utils/errors/InfrastructureError.mjs`
- Test: `backend/tests/unit/suite/0_system/utils/errors/InfrastructureError.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/suite/0_system/utils/errors/InfrastructureError.test.mjs
import { describe, it, expect } from 'vitest';
import {
  InfrastructureError,
  ExternalServiceError,
  RateLimitError,
  PersistenceError,
  TimeoutError,
} from '../../../../../../src/0_system/utils/errors/InfrastructureError.mjs';

describe('InfrastructureError', () => {
  it('should default to INFRASTRUCTURE_ERROR code', () => {
    const error = new InfrastructureError('something broke');
    expect(error.code).toBe('INFRASTRUCTURE_ERROR');
  });

  it('should allow custom code', () => {
    const error = new InfrastructureError('broke', { code: 'CUSTOM_CODE' });
    expect(error.code).toBe('CUSTOM_CODE');
  });

  it('should include code in toJSON', () => {
    const error = new InfrastructureError('test', { code: 'TEST' });
    expect(error.toJSON().code).toBe('TEST');
  });
});

describe('ExternalServiceError', () => {
  it('should default to EXTERNAL_SERVICE_ERROR code', () => {
    const error = new ExternalServiceError('Plex', 'connection failed');
    expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
  });
});

describe('RateLimitError', () => {
  it('should default to RATE_LIMIT_EXCEEDED code', () => {
    const error = new RateLimitError('OpenAI', 60);
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('PersistenceError', () => {
  it('should default to PERSISTENCE_ERROR code', () => {
    const error = new PersistenceError('write', 'disk full');
    expect(error.code).toBe('PERSISTENCE_ERROR');
  });
});

describe('TimeoutError', () => {
  it('should default to TIMEOUT code', () => {
    const error = new TimeoutError('api call', 5000);
    expect(error.code).toBe('TIMEOUT');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/Code/DaylightStation && npm test -- backend/tests/unit/suite/0_system/utils/errors/InfrastructureError.test.mjs`

Expected: FAIL

**Step 3: Implement code property**

Modify `backend/src/0_system/utils/errors/InfrastructureError.mjs`:

```javascript
// InfrastructureError constructor:
constructor(message, context = {}) {
  super(message);
  this.name = 'InfrastructureError';
  this.code = context.code || 'INFRASTRUCTURE_ERROR';  // ADD
  this.context = context;
  // ... rest unchanged
}

// toJSON:
toJSON() {
  return {
    name: this.name,
    code: this.code,  // ADD
    message: this.message,
    // ... rest unchanged
  };
}

// ExternalServiceError:
constructor(service, message, context = {}) {
  super(`${service} error: ${message}`, { service, ...context });
  this.name = 'ExternalServiceError';
  this.code = context.code || 'EXTERNAL_SERVICE_ERROR';  // ADD
  // ... rest unchanged
}

// RateLimitError:
constructor(service, retryAfter = null, context = {}) {
  // ... existing message logic ...
  super(message, { service, retryAfter, ...context });
  this.name = 'RateLimitError';
  this.code = context.code || 'RATE_LIMIT_EXCEEDED';  // ADD
  // ... rest unchanged
}

// PersistenceError:
constructor(operation, message, context = {}) {
  super(`Persistence ${operation} failed: ${message}`, { operation, ...context });
  this.name = 'PersistenceError';
  this.code = context.code || 'PERSISTENCE_ERROR';  // ADD
  // ... rest unchanged
}

// TimeoutError:
constructor(operation, timeoutMs, context = {}) {
  super(`Operation timed out after ${timeoutMs}ms: ${operation}`, {
    operation,
    timeoutMs,
    ...context
  });
  this.name = 'TimeoutError';
  this.code = context.code || 'TIMEOUT';  // ADD
  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

Run: `cd /root/Code/DaylightStation && npm test -- backend/tests/unit/suite/0_system/utils/errors/InfrastructureError.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/utils/errors/InfrastructureError.mjs backend/tests/unit/suite/0_system/utils/errors/InfrastructureError.test.mjs
git commit -m "feat(errors): add code property to infrastructure error classes

Each infrastructure error now has a default code that can be
overridden. Codes: INFRASTRUCTURE_ERROR, EXTERNAL_SERVICE_ERROR,
RATE_LIMIT_EXCEEDED, PERSISTENCE_ERROR, TIMEOUT.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Remove Object Default Export from Error Files

**Files:**
- Modify: `backend/src/0_system/utils/errors/DomainError.mjs`
- Modify: `backend/src/0_system/utils/errors/InfrastructureError.mjs`

**Step 1: Check for usages of default import**

Run: `grep -r "import.*from.*errors/DomainError" backend/src --include="*.mjs" --include="*.js" | grep -v "{ "`

Expected: No results (all imports should be named imports via barrel)

Run: `grep -r "import.*from.*errors/InfrastructureError" backend/src --include="*.mjs" --include="*.js" | grep -v "{ "`

Expected: No results

**Step 2: Remove the object default exports**

In `DomainError.mjs`, delete lines 158-167:

```javascript
// DELETE THIS BLOCK:
export default {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  isDomainError,
  isValidationError,
  isNotFoundError,
};
```

In `InfrastructureError.mjs`, delete lines 184-193:

```javascript
// DELETE THIS BLOCK:
export default {
  InfrastructureError,
  ExternalServiceError,
  RateLimitError,
  PersistenceError,
  TimeoutError,
  isInfrastructureError,
  isRetryableError,
  isRateLimitError,
};
```

**Step 3: Run existing tests to verify no regressions**

Run: `cd /root/Code/DaylightStation && npm test -- backend/tests/unit/suite/0_system/utils/errors/`

Expected: PASS (all tests should still pass with named imports)

**Step 4: Commit**

```bash
git add backend/src/0_system/utils/errors/DomainError.mjs backend/src/0_system/utils/errors/InfrastructureError.mjs
git commit -m "refactor(errors): remove object default exports

Per coding standards, barrel files should use named re-exports only.
The object default exports were redundant with the named exports
and could lead to inconsistent import patterns.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Rename Logging Files from .js to .mjs

**Files:**
- Rename: All `.js` files in `backend/src/0_system/logging/` to `.mjs`
- Modify: All files that import from logging (update extensions)

**Step 1: List all files to rename**

Files in `logging/`:
- `logger.js` → `logger.mjs`
- `dispatcher.js` → `dispatcher.mjs`
- `config.js` → `config.mjs`
- `utils.js` → `utils.mjs`
- `ingestion.js` → `ingestion.mjs`
- `index.js` → `index.mjs`

Files in `logging/transports/`:
- `console.js` → `console.mjs`
- `file.js` → `file.mjs`
- `loggly.js` → `loggly.mjs`
- `index.js` → `index.mjs`

**Step 2: Rename files**

```bash
cd /root/Code/DaylightStation/backend/src/0_system/logging
mv logger.js logger.mjs
mv dispatcher.js dispatcher.mjs
mv config.js config.mjs
mv utils.js utils.mjs
mv ingestion.js ingestion.mjs
mv index.js index.mjs

cd transports
mv console.js console.mjs
mv file.js file.mjs
mv loggly.js loggly.mjs
mv index.js index.mjs
```

**Step 3: Update internal imports in logging files**

In `logger.mjs`:
```javascript
// Change:
import { getDispatcher, isLoggingInitialized } from './dispatcher.js';
// To:
import { getDispatcher, isLoggingInitialized } from './dispatcher.mjs';
```

In `dispatcher.mjs`:
```javascript
// Change:
import { resolveLoggerLevel } from './config.js';
// To:
import { resolveLoggerLevel } from './config.mjs';
```

In `index.mjs`:
```javascript
// Update all .js to .mjs in re-exports
```

In `transports/index.mjs`:
```javascript
// Update all .js to .mjs
```

**Step 4: Update external imports**

Files to update (change `.js` to `.mjs`):

1. `backend/index.js`:
```javascript
import { ... } from './src/0_system/logging/config.mjs';
import { ... } from './src/0_system/logging/dispatcher.mjs';
import { ... } from './src/0_system/logging/transports/index.mjs';
import { ... } from './src/0_system/logging/logger.mjs';
```

2. `backend/src/server.mjs`:
```javascript
import { ... } from './0_system/logging/config.mjs';
import { ... } from './0_system/logging/dispatcher.mjs';
import { ... } from './0_system/logging/transports/index.mjs';
import { ... } from './0_system/logging/logger.mjs';
```

3. `backend/src/app.mjs`:
```javascript
import { ... } from './0_system/logging/dispatcher.mjs';
import { ... } from './0_system/logging/logger.mjs';
import { ... } from './0_system/logging/ingestion.mjs';
import { ... } from './0_system/logging/config.mjs';
```

4. `backend/src/0_system/config/UserDataService.mjs`:
```javascript
import { createLogger } from '../logging/logger.mjs';
```

5. `backend/src/0_system/users/UserResolver.mjs`:
```javascript
import { createLogger } from '../logging/logger.mjs';
```

6. `backend/src/0_system/http/httpClient.mjs`:
```javascript
import { createLogger } from '../logging/logger.mjs';
```

7. `backend/src/0_system/http/middleware/validation.mjs`:
```javascript
import { createLogger } from '../../logging/logger.mjs';
```

8. `backend/src/0_system/http/middleware/idempotency.mjs`:
```javascript
import { createLogger } from '../../logging/logger.mjs';
```

9. `backend/src/0_system/http/middleware/requestLogger.mjs`:
```javascript
import { createLogger } from '../../logging/logger.mjs';
```

10. `backend/src/0_system/http/middleware/errorHandler.mjs`:
```javascript
import { createLogger } from '../../logging/logger.mjs';
```

11. `backend/src/3_applications/content/services/ArchiveService.mjs`:
```javascript
import { createLogger } from '#system/logging/logger.mjs';
```

**Step 5: Run the server to verify**

Run: `cd /root/Code/DaylightStation && node backend/index.js`

Expected: Server starts without import errors

**Step 6: Run tests**

Run: `cd /root/Code/DaylightStation && npm test`

Expected: All tests pass

**Step 7: Commit**

```bash
git add backend/src/0_system/logging/ backend/index.js backend/src/server.mjs backend/src/app.mjs backend/src/0_system/config/UserDataService.mjs backend/src/0_system/users/UserResolver.mjs backend/src/0_system/http/ backend/src/3_applications/content/services/ArchiveService.mjs
git commit -m "refactor(logging): rename .js files to .mjs for consistency

All files in the logging module now use .mjs extension to match
the rest of the backend codebase. Updated all import statements
across the project.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Delete or Rename TypeScript Stub File

**Files:**
- Delete: `backend/src/0_system/registry.ts`

**Step 1: Verify file is unused**

Run: `grep -r "registry.ts\|registry'" backend/src --include="*.mjs" --include="*.js" --include="*.ts"`

Expected: No imports found (file is stub)

**Step 2: Check file content**

The file contains only TODOs and `export {}`. It's a placeholder with no implementation.

**Step 3: Delete the file**

```bash
rm backend/src/0_system/registry.ts
```

**Step 4: Commit**

```bash
git add backend/src/0_system/registry.ts
git commit -m "chore: remove unused TypeScript stub file

The registry.ts file contained only TODO comments and an empty
export. The actual registry implementation is in registries/
subdirectory.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Final Verification

**Step 1: Run full test suite**

Run: `cd /root/Code/DaylightStation && npm test`

Expected: All tests pass

**Step 2: Start dev server**

Run: `cd /root/Code/DaylightStation && node backend/index.js`

Expected: Server starts without errors

**Step 3: Update audit document**

Mark issues as resolved in `docs/_wip/audits/2026-01-27-0_system-layer-audit.md`
