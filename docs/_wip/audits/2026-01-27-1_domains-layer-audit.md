# Domain Layer Coding Standards Audit Report

**Date:** 2026-01-27
**Scope:** `backend/src/1_domains/`
**Files Examined:** 116 .mjs files across 14 domain modules
**Reference:** `docs/reference/core/coding-standards.md`

---

## Executive Summary

The domain layer shows **strong adherence** to coding standards in most areas, with several critical violations that need attention. The codebase demonstrates good use of ES2022 private fields, value objects, and proper error handling. However, there are significant issues with public mutable fields in entities, missing default exports on error classes, and inconsistent JSDoc coverage.

**Overall Grade: B- (78/100)**

---

## Violations by Severity

### HIGH Severity (Must Fix)

| Issue | Count | Files |
|-------|-------|-------|
| Public mutable fields in entities | ~60 | Session.mjs, Participant.mjs, Zone.mjs, Message.mjs, Transaction.mjs, etc. |
| Missing @class JSDoc | 69 | Almost all entity and service classes |
| Missing default exports on error classes | 3 | ValidationError.mjs, DomainInvariantError.mjs, EntityNotFoundError.mjs |

### MEDIUM Severity (Should Fix)

| Issue | Count | Files |
|-------|-------|-------|
| `toJSON()` in entities | ~80 | Session.mjs, Participant.mjs, Message.mjs, Transaction.mjs, etc. |
| Missing @param/@returns/@throws on public methods | ~60% | Most domain services and entities |
| Insufficient constructor validation | ~10 | Transaction.mjs, Account.mjs |

### LOW Severity (Nice to Have)

| Issue | Count | Files |
|-------|-------|-------|
| Static private method uses underscore | 1 | Item._resolveItemId() |
| Missing @example in factory functions | ~20 | Various |

---

## Detailed Findings

### 1. File/Folder Naming ✅ COMPLIANT

No violations found. All files follow conventions:
- Classes: `PascalCase.mjs` (Session.mjs, Participant.mjs)
- Value objects: `PascalCase.mjs` (SessionId.mjs, ItemId.mjs)
- Utilities: `camelCase.mjs` (id.mjs, time.mjs)
- Directories: `kebab-case` (home-automation/, value-objects/)
- Barrel files: `index.mjs`

### 2. Class Patterns ⚠️ MAJOR ISSUES

**Critical: Public Mutable Fields**

Most entities use public fields instead of private fields with getters:

```javascript
// ❌ BAD - Session.mjs (lines 24-34)
this.sessionId = sessionId;
this.startTime = startTime;
this.endTime = endTime;
this.durationMs = durationMs;

// ✅ GOOD - Should be:
#sessionId;
#startTime;
get sessionId() { return this.#sessionId; }
```

**Affected entities:** Session, Participant, Zone, Message, Conversation, Transaction, Account, Budget, Mortgage, Job, WatchState (~60 files)

**Compliant Examples (use as templates):**
- `SessionId.mjs` - Perfect value object with private fields
- `ItemId.mjs` - Private #source, #localId with getters
- `JournalEntry.mjs` - **EXEMPLARY**: All private fields, Object.freeze(), immutable .with() methods

### 3. Export Patterns ⚠️ PARTIAL COMPLIANCE

**Missing Default Exports on Error Classes:**

```javascript
// ❌ core/errors/ValidationError.mjs - Only has:
export class ValidationError extends Error { ... }

// ❌ Missing:
export default ValidationError;
```

Same issue in: `DomainInvariantError.mjs`, `EntityNotFoundError.mjs`

### 4. Import Patterns ✅ COMPLIANT

Excellent use of path aliases:
- `#domains/core/errors` for cross-domain imports
- `#system/utils` for system utilities
- No adapter imports in domain layer (pure domain confirmed)

### 5. Error Handling ✅ COMPLIANT

Good domain-specific error usage:
```javascript
throw new ValidationError('Invalid SessionId format', {
  code: 'INVALID_SESSION_ID',
  value
});
```

### 6. Domain Layer Specific Rules

**✅ NO `new Date()` in domain** - Timestamps passed as parameters

**❌ `toJSON()` in entities** - 80 methods found
- Per coding standards: "Repository handles serialization"
- This may require architectural discussion before refactoring

**✅ NO adapter imports** - Pure domain confirmed

### 7. JSDoc Requirements ❌ CRITICAL GAPS

Only 3 of 72 classes have `@class` JSDoc:
- ValidationError ✅
- DomainInvariantError ✅
- EntityNotFoundError ✅

All others missing proper class documentation.

---

## Patterns Worth Preserving

### Exemplary Files (Use as Templates)

1. **SessionId.mjs** - Perfect value object pattern
2. **ItemId.mjs** - Perfect value object pattern
3. **JournalEntry.mjs** - Perfect entity with immutability
4. **TransactionClassifier.mjs** - Perfect domain service
5. **time.mjs** - Perfect utility module

### Architecture Patterns ✅

- No adapter imports (pure domain)
- No `new Date()` (timestamps passed)
- Error throwing (no return objects)
- Domain-specific errors with codes
- Frozen enums (ZoneName, MessageType)

---

## Recommendations

### Immediate (High Priority)

1. Add default exports to error classes (3 files)
2. Add @class JSDoc to all classes (69 files)

### Medium-Term

3. Migrate entities to private fields with getters
4. Add @param/@returns/@throws to public methods

### Long-Term

5. Move `toJSON()` to repositories (requires architecture discussion)
6. Strengthen constructor validation

---

## Compliance Metrics

| Category | Compliance |
|----------|------------|
| File/Folder Naming | 100% |
| Private Fields | 40% |
| Export Patterns | 95% |
| Import Patterns | 100% |
| Error Handling | 100% |
| Domain Purity | 100% |
| JSDoc | 10% |

**Overall: 78%**
