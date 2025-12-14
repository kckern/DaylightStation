# Phase 5B: Audit & Missing Implementation

> **Phase:** 5B (Remediation)  
> **Purpose:** Complete all missing items from Phase 3-5  
> **Test Command:** `npm test -- --testPathPattern="backend/chatbots/_tests"`

---

## Audit Results

### Missing from Phase 3 (NutriBot Domain)

| Item | Status | Notes |
|------|--------|-------|
| `nutribot/application/ports/IReportRenderer.mjs` | ❌ MISSING | Port interface |
| `nutribot/application/ports/INutrilogRepository.mjs` | ❌ MISSING | Port interface |
| `nutribot/application/ports/INutrilistRepository.mjs` | ❌ MISSING | Port interface |
| `nutribot/application/ports/IUPCGateway.mjs` | ❌ MISSING | Port interface |
| `nutribot/application/usecases/LogFoodFromImage.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/LogFoodFromText.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/LogFoodFromVoice.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/LogFoodFromUPC.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/AcceptFoodLog.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/DiscardFoodLog.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/ReviseFoodLog.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/ProcessRevisionInput.mjs` | ❌ MISSING | Core use case |
| `nutribot/application/usecases/SelectUPCPortion.mjs` | ❌ MISSING | Core use case |

### Missing from Phase 4 (Journalist)

| Item | Status | Notes |
|------|--------|-------|
| `journalist/application/ports/IQuizRepository.mjs` | ❌ MISSING | Port interface |
| `journalist/application/ports/IPromptTemplateRepository.mjs` | ❌ MISSING | Port interface |
| `journalist/domain/entities/QuizQuestion.mjs` | ❌ MISSING | Domain entity |
| `journalist/domain/entities/QuizAnswer.mjs` | ❌ MISSING | Domain entity |

### Missing from Phase 5 (Integration)

| Item | Status | Notes |
|------|--------|-------|
| `adapters/http/CanvasReportRenderer.mjs` | ❌ MISSING | Infrastructure |
| `router.mjs` update (mount journalist) | ❌ INCOMPLETE | Missing journalist route |
| `nutribot/container.mjs` | ❌ MISSING | DI Container |
| Integration flow tests | ❌ MISSING | Full flow tests |

---

## Implementation Plan

### 5B.1 NutriBot Ports

```
nutribot/application/ports/
├── IReportRenderer.mjs
├── INutrilogRepository.mjs
├── INutrilistRepository.mjs
└── IUPCGateway.mjs
```

### 5B.2 NutriBot Core Use Cases (9 missing)

```
nutribot/application/usecases/
├── LogFoodFromImage.mjs
├── LogFoodFromText.mjs
├── LogFoodFromVoice.mjs
├── LogFoodFromUPC.mjs
├── AcceptFoodLog.mjs
├── DiscardFoodLog.mjs
├── ReviseFoodLog.mjs
├── ProcessRevisionInput.mjs
└── SelectUPCPortion.mjs
```

### 5B.3 Journalist Domain Entities

```
journalist/domain/entities/
├── QuizQuestion.mjs
└── QuizAnswer.mjs
```

### 5B.4 Journalist Ports

```
journalist/application/ports/
├── IQuizRepository.mjs
└── IPromptTemplateRepository.mjs
```

### 5B.5 Infrastructure

```
adapters/http/
└── CanvasReportRenderer.mjs

nutribot/
└── container.mjs
```

### 5B.6 Router Updates

```
router.mjs - Add journalist mount
```

### 5B.7 Integration Flow Tests

```
_tests/nutribot/integration/
└── FoodLoggingFlow.test.mjs

_tests/journalist/integration/
└── JournalingFlow.test.mjs
```

---

## Files to Create (27 total)

1. `nutribot/application/ports/IReportRenderer.mjs`
2. `nutribot/application/ports/INutrilogRepository.mjs`
3. `nutribot/application/ports/INutrilistRepository.mjs`
4. `nutribot/application/ports/IUPCGateway.mjs`
5. `nutribot/application/ports/index.mjs`
6. `nutribot/application/usecases/LogFoodFromImage.mjs`
7. `nutribot/application/usecases/LogFoodFromText.mjs`
8. `nutribot/application/usecases/LogFoodFromVoice.mjs`
9. `nutribot/application/usecases/LogFoodFromUPC.mjs`
10. `nutribot/application/usecases/AcceptFoodLog.mjs`
11. `nutribot/application/usecases/DiscardFoodLog.mjs`
12. `nutribot/application/usecases/ReviseFoodLog.mjs`
13. `nutribot/application/usecases/ProcessRevisionInput.mjs`
14. `nutribot/application/usecases/SelectUPCPortion.mjs`
15. `nutribot/container.mjs`
16. `journalist/domain/entities/QuizQuestion.mjs`
17. `journalist/domain/entities/QuizAnswer.mjs`
18. `journalist/application/ports/IQuizRepository.mjs`
19. `journalist/application/ports/IPromptTemplateRepository.mjs`
20. `journalist/application/ports/index.mjs`
21. `adapters/http/CanvasReportRenderer.mjs`
22. `_tests/nutribot/usecases/CoreLogging.test.mjs`
23. `_tests/nutribot/integration/FoodLoggingFlow.test.mjs`
24. `_tests/journalist/integration/JournalingFlow.test.mjs`
25. `_tests/journalist/domain/QuizEntities.test.mjs`

## Files to Update (3 total)

1. `router.mjs` - Mount journalist router
2. `nutribot/application/usecases/index.mjs` - Export new use cases
3. `journalist/domain/entities/index.mjs` - Export quiz entities
