# Architecture Refactor: JSON Guardrails → Adapter Layer

**Date:** 2026-02-14  
**Type:** Architectural improvement (DDD Layer separation)

## Before (Use Case owns parsing)

```
LogFoodFromText (Layer 3)
├── Retry loop (3 attempts)
├── JSON repair logic
├── Parse error handling
└── Call aiGateway.chat()
    └── OpenAIAdapter returns raw string

❌ Problems:
- Use case handles infrastructure concerns
- Logic duplicated across LogFoodFromImage, LogFoodFromUPC
- Hard to test JSON repair independently
- Violates Single Responsibility
```

## After (Adapter owns parsing)

```
LogFoodFromText (Layer 3)
└── Call aiGateway.chatWithJson()
    └── OpenAIAdapter (Layer 1)
        ├── Retry loop (2 attempts)
        ├── JSON repair logic
        ├── Parse error handling
        └── Returns structured object

✅ Benefits:
- Clean separation of concerns
- Reusable across all use cases
- Testable in isolation
- DDD compliant
```

## Code Comparison

### Before
```javascript
// LogFoodFromText.mjs - 60 lines of parsing logic
const maxAttempts = 3;
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  response = await this.#aiGateway.chat(prompt, { maxTokens: 1000 });
  const parsed = this.#parseFoodResponse(response); // complex parsing + repair
  // ... error handling, retry logic, status updates
}

#parseFoodResponse(response) {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  let data = JSON.parse(jsonMatch[0]); // might fail
  // ... repair logic, error handling
}
```

### After
```javascript
// LogFoodFromText.mjs - 10 lines, business logic only
try {
  const data = await this.#aiGateway.chatWithJson(prompt, { maxTokens: 1000 });
  const { items, date } = this.#parseFoodResponse(data);
} catch (aiError) {
  // Show user-friendly error message
}

#parseFoodResponse(data) {
  // Just transforms structured data - no parsing!
  return { items: data.items.map(...), date: data.date };
}
```

## Files Modified

| File | Change | Lines +/- |
|------|--------|-----------|
| `OpenAIAdapter.mjs` | Added JSON repair + retry | +135 |
| `AnthropicAdapter.mjs` | Added JSON repair + retry | +135 |
| `LogFoodFromText.mjs` | Removed parsing, use chatWithJson | -85 |
| **Net change** | | **+185** |

## Architecture Alignment

Follows DDD principle from [backend-architecture.md](../reference/core/backend-architecture.md):

> **Layer 1 (Adapters)**: "Implement ports defined by application layer. Handle external service complexities, retries, data format conversion."

> **Layer 3 (Applications)**: "Orchestrate domain entities without infrastructure concerns. Should not know about HTTP, databases, or external APIs."

## Migration Path for Other Use Cases

These still manually parse and should migrate to `chatWithJson`:
- [ ] `LogFoodFromImage.mjs` (line 349)
- [ ] `LogFoodFromUPC.mjs` (lines 277, 312)  
- [ ] `ProcessRevisionInput.mjs` (line 217)

Simple migration:
```diff
- const response = await this.#aiGateway.chat(prompt, options);
- const data = JSON.parse(response); // fragile!
+ const data = await this.#aiGateway.chatWithJson(prompt, options);
```
