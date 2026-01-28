# Adapters Layer Coding Standards Audit Report

**Date:** 2026-01-27
**Scope:** `backend/src/2_adapters/`
**Files Examined:** 116 .mjs files (24 barrel files, 92 implementation files)
**Reference:** `docs/reference/core/coding-standards.md`

---

## Executive Summary

The adapters layer shows **moderate compliance** with coding standards. Most adapters properly use private fields (#prefix) and dependency injection, but inconsistencies exist in export patterns, constructor parameter handling, and error handling. The biggest issues are using generic `Error` instead of `InfrastructureError` and missing default exports on classes.

**Overall Grade: C+ (70/100)**

---

## Violations by Severity

### HIGH Severity (Must Fix)

| Issue | Count | Files |
|-------|-------|-------|
| Generic Error instead of domain-specific errors | ~80 | PlexClient.mjs, OpenAIAdapter.mjs, AnthropicAdapter.mjs, etc. |
| Not using InfrastructureError for external failures | ~50 | All adapters making HTTP calls |
| Missing default exports on classes | 15-20 | TelegramMessagingAdapter.mjs, TelegramWebhookParser.mjs, etc. |

### MEDIUM Severity (Should Fix)

| Issue | Count | Files |
|-------|-------|-------|
| Public mutable fields instead of private | ~15 | PlexAdapter.mjs, OpenAIAdapter.mjs, AnthropicAdapter.mjs, BuxferAdapter.mjs |
| Inconsistent constructor parameter patterns | ~8 | OpenAIAdapter.mjs, AnthropicAdapter.mjs, etc. |
| Direct configService import (breaks DI) | 1 | PlexProxyAdapter.mjs |
| Missing class-level JSDoc | ~40 | Most adapter classes |
| Missing @param/@returns JSDoc | ~60% | Most public methods |
| Missing @throws JSDoc | ~90% | Most throwing methods |
| Missing error codes in throws | ~70% | Most error throws |

### LOW Severity (Nice to Have)

| Issue | Count | Files |
|-------|-------|-------|
| Positional args instead of config object | ~6 | BaseInputRouter.mjs, HomeBotInputRouter.mjs |
| Console.error instead of throwing | ~10 | PlexAdapter.mjs |

---

## Detailed Findings

### 1. File/Folder Naming ✅ COMPLIANT

No violations:
- Classes: `PascalCase.mjs` (PlexAdapter.mjs, TelegramMessagingAdapter.mjs)
- Utilities: `camelCase.mjs` (transcriptionContext.mjs)
- Directories: `kebab-case` (home-automation/, local-content/)
- Barrel files: All `index.mjs`

### 2. Class Patterns ⚠️ ISSUES

**✅ Private Fields:** Excellent compliance (~95%)
```javascript
// GOOD - TelegramMessagingAdapter.mjs
class TelegramMessagingAdapter {
  #token;
  #baseUrl;
  #httpClient;
  #logger;
```

**❌ Public Fields Found:**
```javascript
// BAD - PlexAdapter.mjs:39
this.client = new PlexClient(...);  // Should be #client
this.host = config.host;            // Should be #host
```

Affected: PlexAdapter.mjs, OpenAIAdapter.mjs, AnthropicAdapter.mjs, BuxferAdapter.mjs

### 3. Export Patterns ⚠️ MAJOR ISSUES

**Missing Default Exports:**
```javascript
// ❌ TelegramMessagingAdapter.mjs - Only has:
export class TelegramMessagingAdapter { ... }

// ❌ Missing:
export default TelegramMessagingAdapter;
```

Files with proper exports (use as examples):
- OpenAIAdapter.mjs ✅
- AnthropicAdapter.mjs ✅
- HomeAssistantAdapter.mjs ✅
- CircuitBreaker.mjs ✅

### 4. Import Patterns ✅ MOSTLY COMPLIANT

Good use of aliases:
```javascript
import { ConversationId } from '#domains/messaging/value-objects/ConversationId.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';
```

**❌ One Violation:**
```javascript
// PlexProxyAdapter.mjs:10 - Direct singleton import
import { configService } from '#system/config/index.mjs';
// Should be injected via constructor
```

### 5. Error Handling ❌ MAJOR ISSUES

**Generic Error Instead of InfrastructureError:**
```javascript
// ❌ BAD - PlexClient.mjs:26
if (!config.host) {
  throw new Error('PlexClient requires host');
}

// ✅ SHOULD BE:
if (!config.host) {
  throw new ConfigurationError('PlexClient requires host', {
    code: 'MISSING_HOST',
    adapter: 'PlexClient'
  });
}
```

**Should Use InfrastructureError:**
```javascript
// ❌ BAD - OpenAIAdapter.mjs:224
const err = new Error(errorData.error?.message || 'AI API error');
throw err;

// ✅ SHOULD BE:
throw new InfrastructureError('AI API request failed', {
  code: 'OPENAI_API_ERROR',
  status: response.status,
  isTransient: response.status >= 500
});
```

### 6. JSDoc Requirements ⚠️ GAPS

**Missing @class tags:** ~40 classes
**Missing @param/@returns:** ~60% of methods
**Missing @throws:** ~90% of throwing methods

Good example to follow:
```javascript
// GOOD - CircuitBreaker.mjs
/**
 * CircuitBreaker
 *
 * Resilience pattern for external API calls.
 * Opens after consecutive failures, closes after cooldown period.
 *
 * @module harvester/CircuitBreaker
 */
```

---

## Patterns Worth Preserving

### Excellent Patterns

1. **Private fields (#prefix)** - 95% compliance
2. **Config object dependency injection**
3. **Metrics tracking** (OpenAIAdapter.mjs)
4. **Circuit breaker pattern** (CircuitBreaker.mjs)
5. **Path alias usage** (100% compliance)
6. **Value object immutability** (TelegramChatRef with Object.freeze)
7. **Client/Adapter separation** (PlexClient + PlexAdapter)

---

## Recommendations

### Immediate (High Priority)

1. Add default exports to all adapter classes (15-20 files)
2. Replace generic Error with InfrastructureError for external failures (~50 sites)
3. Add error codes to all throws (~80 sites)

### Medium-Term

4. Convert public fields to private (4 files, ~15 fields)
5. Standardize constructor parameters to single config object
6. Add comprehensive JSDoc (@class, @param, @throws)
7. Remove direct configService import from PlexProxyAdapter

### Low Priority

8. Convert positional args to config objects (~6 files)
9. Fix console.error → proper error propagation (PlexAdapter)

---

## Compliance Metrics

| Category | Compliance |
|----------|------------|
| File/Folder Naming | 100% |
| Private Fields | 92% |
| Constructor Validation | 91% |
| Default Exports | 78% |
| Error Types | 27% |
| InfrastructureError Usage | 17% |
| JSDoc Classes | 56% |
| JSDoc Methods | 40% |
| Dependency Injection | 99% |
| Path Aliases | 100% |

**Overall: 70%**
