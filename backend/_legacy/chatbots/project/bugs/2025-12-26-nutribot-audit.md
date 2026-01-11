# NutriBot Integration Audit - December 26, 2025

## Executive Summary

A debugging session revealed **10+ distinct bugs** across the NutriBot food logging and reporting flow. These issues fall into recurring patterns that indicate systemic problems with integration testing, code consistency, and architectural boundaries.

---

## Bug Categories

### 1. 🔗 **Data Flow / Property Access Errors** (3 instances)

| Issue | Location | Root Cause |
|-------|----------|------------|
| Date lost on Accept | `AcceptFoodLog.mjs:74` | Used `nutriLog.date` instead of `nutriLog.meal?.date` |
| Date lost on UPC Portion | `SelectUPCPortion.mjs:93` | Hardcoded `today` instead of using meal date from log |
| MessageId not tracked | `LogFoodFromText.mjs`, `LogFoodFromImage.mjs`, `LogFoodFromUPC.mjs` | NutriLog created before message sent, never updated with messageId |

**Pattern**: Properties stored in nested objects (`meal.date`) but accessed at root level (`date`). No consistent convention.

**Fix Applied**: Use `nutriLog.meal?.date || nutriLog.date || fallbackDate` pattern consistently.

---

### 2. 🛤️ **Missing Route Handlers** (2 instances)

| Callback | Expected Behavior | Status Before |
|----------|-------------------|---------------|
| `report_adjust` | Start adjustment flow | `router.callback.unknown` warning |
| `report_accept` | Remove report buttons | `router.callback.unknown` warning |

**Pattern**: New UI features (report buttons) added without corresponding callback handlers in router.

**Fix Applied**: Added `#handleReportCallback()` method to `UnifiedEventRouter.mjs`.

---

### 3. 🔌 **API Mismatch / Wrong Method Names** (2 instances)

| Code Called | Actual Method | Location |
|-------------|---------------|----------|
| `nutrilistRepository.findById(itemId)` | `findByUuid(userId, uuid)` | `SelectItemForAdjustment.mjs:51` |
| `nutrilistRepository.getAll()` | `findAll(userId)` | `SelectItemForAdjustment.mjs:55` |

**Pattern**: Use case code assumes repository methods that don't exist. No interface enforcement.

**Fix Applied**: Changed to use `findByUuid(userId, itemId)` and `findAll(userId)`.

---

### 4. 📦 **Dependency Injection Gaps** (1 instance, 2 affected use cases)

| Use Case | Missing Dependencies |
|----------|---------------------|
| `DeleteListItem` | `nutriLogRepository`, `config` |
| `MoveItemToDate` | `nutriLogRepository`, `config` |

**Pattern**: Container wiring incomplete. Constructor requires deps, container doesn't provide them.

**Fix Applied**: Added missing dependencies to `container.mjs`.

---

### 5. 📸 **Telegram Message Type Handling** (2 instances)

| Issue | Symptom |
|-------|---------|
| Auto-accept keyboard removal | Tried `editMessageText` on photo message |
| Adjustment item selection | `Bad Request: there is no text in the message to edit` |

**Pattern**: Code assumes all messages are text messages. Photo messages require `editMessageCaption` or `editMessageReplyMarkup`.

**Fix Applied**: 
- Added fallback in `TelegramGateway.updateMessage()` to try `editMessageCaption` if `editMessageText` fails
- Simplified keyboard-only updates to just use `choices: []`

---

### 6. 📂 **Import Path Errors** (1 instance)

| File | Wrong Path | Correct Path |
|------|-----------|--------------|
| `GenerateDailyReport.mjs:156` | `../../../adapters/http/CanvasReportRenderer.mjs` | `../../../../adapters/http/CanvasReportRenderer.mjs` |

**Pattern**: Relative imports fragile when file structure is deep. Off-by-one in `../` count.

---

### 7. ⏱️ **Race Conditions / Timing Issues** (1 instance)

| Issue | Scenario |
|-------|----------|
| Report generated with pending items | User clicks Accept, concurrent webhook triggers report before pending check completes |

**Pattern**: Async operations interleave in unexpected ways. No locking or debouncing.

**Fix Applied**: 
- Added 300-500ms delays before report generation
- Removed `forceRegenerate: true` that bypassed pending checks
- Added `autoAcceptPending` flag for explicit opt-in

---

### 8. 📢 **Logging Level Issues** (1 instance)

| Log Key | Was | Should Be |
|---------|-----|-----------|
| `nutrilog.skipInvalid` | WARN | DEBUG |

**Pattern**: Expected/normal behavior logged at warning level, creating noise.

---

## Systemic Root Causes

### A. **No Repository Interface Contracts**
- Use cases call methods that don't exist on repositories
- No TypeScript/JSDoc interface enforcement
- Easy to use wrong method names (`findById` vs `findByUuid`)

### B. **Inconsistent Data Model Access**
- Some properties at root level (`nutriLog.date`)
- Some properties nested (`nutriLog.meal.date`)
- No single source of truth documentation

### C. **Missing Integration Tests**
These bugs would have been caught by tests that:
1. Accept a food log and verify date in nutrilist
2. Click report_adjust and verify adjustment flow starts
3. Delete an item via adjustment flow
4. Generate report on photo message thread

### D. **Incomplete Container Wiring**
- Use cases added with required dependencies
- Container wiring not updated to match
- No validation that all required deps are provided

### E. **Photo vs Text Message Blindness**
- Code assumes homogeneous message types
- Telegram API differs for photos vs text
- No abstraction layer for message types

---

## Recommended Actions

### Immediate
- [ ] Run full E2E test of: Log food → Accept → Report → Adjust → Delete flow
- [ ] Verify all `getXXX()` methods in container provide all required deps
- [ ] Audit all `nutriLog.date` usages, replace with `nutriLog.meal?.date`

### Short-term
- [ ] Add TypeScript interfaces for repositories (or JSDoc @interface)
- [ ] Create integration test suite for adjustment flow
- [ ] Add message type detection helper in TelegramGateway

### Long-term
- [ ] Consider path aliases (e.g., `@adapters/`, `@usecases/`) to avoid relative import hell
- [ ] Document NutriLog data model with all property locations
- [ ] Add container validation that checks all required deps at startup

---

## Files Modified in This Session

| File | Changes |
|------|---------|
| `NutriLogRepository.mjs` | Changed `skipInvalid` log to DEBUG |
| `GenerateDailyReport.mjs` | Fixed import path, added auto-accept, added delays |
| `AcceptFoodLog.mjs` | Fixed date access, added delay, removed forceRegenerate |
| `SelectUPCPortion.mjs` | Fixed date access, added pending check |
| `LogFoodFromText.mjs` | Save messageId to metadata |
| `LogFoodFromImage.mjs` | Save messageId to metadata |
| `LogFoodFromUPC.mjs` | Save messageId to metadata |
| `ConfirmAllPending.mjs` | Simplified keyboard removal |
| `SelectItemForAdjustment.mjs` | Fixed repository method calls |
| `UnifiedEventRouter.mjs` | Added report callback handlers, autoAcceptPending |
| `TelegramGateway.mjs` | Added fallback to editMessageCaption |
| `container.mjs` | Added missing deps to DeleteListItem, MoveItemToDate |
