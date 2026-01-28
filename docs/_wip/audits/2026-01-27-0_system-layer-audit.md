# 0_system Layer Audit

**Date:** 2026-01-27
**Auditor:** Claude
**Reference:** `docs/reference/core/coding-standards.md`

---

## Executive Summary

The `backend/src/0_system/` layer is **largely compliant** with coding standards. Most patterns (private fields, factory functions, dependency injection, barrel exports) are implemented correctly. A few issues need attention.

| Category | Status |
|----------|--------|
| File/Folder Naming | Minor Issues |
| Class Patterns | Compliant |
| Function Patterns | Compliant |
| Error Handling | Minor Issues |
| Import/Export | Minor Issues |
| JSDoc | Minor Issues |

---

## Issues Found

### 1. TypeScript File in JS Codebase

**File:** `registry.ts`
**Severity:** Low (stub file)

The codebase uses `.mjs` for ES modules, but this file uses `.ts`. It's a placeholder with only TODOs and an empty export, so low impact.

**Recommendation:** Convert to `registry.mjs` or delete if unused.

---

### 2. Logging Directory Uses `.js` Instead of `.mjs`

**Files:** All files in `logging/` (logger.js, dispatcher.js, config.js, etc.)
**Severity:** Medium

The coding standards specify `.mjs` for ES modules. The logging directory uses `.js` throughout, creating inconsistency.

**Recommendation:** Rename all logging files to `.mjs` and update imports.

---

### 3. Error Classes Missing `code` Property

**File:** `utils/errors/DomainError.mjs`
**Severity:** Medium

Per coding standards:
> All errors include a machine-readable `code` for programmatic handling.

Current implementation has no `code` property:
```javascript
// Current
constructor(message, context = {}) {
  this.context = context;
  // Missing: this.code
}
```

**Recommendation:** Add required `code` parameter:
```javascript
constructor(message, { code, ...context } = {}) {
  this.code = code || 'UNKNOWN_ERROR';
  this.context = context;
}
```

---

### 4. DomainError Calls External Function in Constructor

**File:** `utils/errors/DomainError.mjs:21`
**Severity:** Low

```javascript
this.timestamp = nowTs24();
```

Per coding standards, domain-layer code should receive timestamps as parameters, not call `new Date()` or time functions. However, this is system-layer infrastructure, so the rule may not strictly apply.

**Recommendation:** Accept as-is (system layer exception) or pass timestamp as optional parameter.

---

### 5. Inconsistent Default Export Patterns

**Files:** Various
**Severity:** Low

Some barrel files export both named and default:
- `config/index.mjs`: `export default configService`
- `logging/logger.js`: `export default createLogger`
- `utils/errors/DomainError.mjs`: `export default { DomainError, ValidationError, ... }`

The object default export in DomainError.mjs is unusual - barrel files should use named re-exports only.

**Recommendation:** Remove the default object export from DomainError.mjs. Keep factory function defaults where appropriate.

---

### 6. Missing @throws JSDoc in Some Functions

**Files:** Various
**Severity:** Low

Some functions that throw don't document it:
- `getConfigService()` throws if not initialized (documented ✓)
- `initConfigService()` throws if already initialized (documented ✓)
- Various other functions missing @throws

**Recommendation:** Add `@throws` annotations to functions that can throw.

---

## Compliant Patterns (Good Examples)

### Private Fields Usage

All classes properly use `#` for private fields:

```javascript
// ConfigService.mjs
class ConfigService {
  #config;
  constructor(config) {
    this.#config = Object.freeze(config);
  }
}

// WebSocketEventBus.mjs
class WebSocketEventBus {
  #wss;
  #subscribers;
  #clients;
  #handlers;
}
```

### Factory Function Pattern

Factory functions consistently use `create` prefix and config objects:

```javascript
// logger.js
export function createLogger({ source = 'backend', app = 'default', context = {} } = {}) {
  // ...
}

// config/index.mjs
export function createConfigService(dataDir) {
  const config = loadConfig(dataDir);
  validateConfig(config, dataDir);
  return new ConfigService(config);
}
```

### Barrel File Pattern

All subdirectories have proper `index.mjs` with named re-exports:

```javascript
// config/index.mjs
export { ConfigService } from './ConfigService.mjs';
export { ConfigValidationError } from './configValidator.mjs';
export { configSchema } from './configSchema.mjs';
export { loadConfig } from './configLoader.mjs';
```

### Interface Pattern

Proper use of interface base classes with checking functions:

```javascript
// IEventBus.mjs
export class IEventBus {
  publish(topic, payload) { throw new Error('Not implemented'); }
  subscribe(topic, handler) { throw new Error('Not implemented'); }
}

export function isEventBus(obj) {
  return obj && typeof obj.publish === 'function' && typeof obj.subscribe === 'function';
}
```

### Dependency Injection

Consistent use of config object pattern:

```javascript
// CanvasService.mjs
constructor(config) {
  const { fontDir, logger = console } = config;
  if (!fontDir) throw new Error('fontDir is required');
  this.#fontDir = fontDir;
  this.#logger = logger;
}
```

### Directory Naming

All directories use kebab-case:
- `config/`
- `eventbus/`
- `http/middleware/`
- `value-objects/` (if any)

---

## Recommendations Summary

| Priority | Action | Files |
|----------|--------|-------|
| Medium | Add `code` property to error classes | `utils/errors/DomainError.mjs` |
| Medium | Rename `.js` to `.mjs` in logging | `logging/*.js` |
| Low | Remove object default export | `utils/errors/DomainError.mjs` |
| Low | Delete or rename `registry.ts` | `registry.ts` |
| Low | Add missing @throws JSDoc | Various |

---

## Files Reviewed

| Directory | Files | Status |
|-----------|-------|--------|
| config/ | 7 | Compliant |
| logging/ | 9 | Naming issue (.js) |
| utils/ | 8 | Minor issues |
| services/ | 4 | Compliant |
| eventbus/ | 6 | Compliant |
| registries/ | 4 | Compliant |
| routing/ | 4 | Compliant |
| scheduling/ | 3 | Compliant |
| proxy/ | 3 | Compliant |
| canvas/ | 3 | Compliant |
| http/ | 8 | Compliant |
| testing/ | 1 | Compliant |
| users/ | 1 | Compliant |
| root | 2 | TypeScript stub issue |
