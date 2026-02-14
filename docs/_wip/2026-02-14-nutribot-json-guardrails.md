# NutriBot JSON Parsing Guardrails

**Date:** 2026-02-14  
**Status:** Implemented  
**Architecture:** Adapter Layer (Layer 1)

## Problem

Production logs showed voice food logging failures due to malformed JSON from AI responses:
```
logText.parseError: "Expected ',' or ']' after array element in JSON at position 2583"
```

The voice transcription worked correctly, but downstream JSON parsing in LogFoodFromText failed, causing poor UX.

## Solution Architecture

**Moved guardrails to the adapter layer** where they belong, following DDD principles:
- **Adapters (Layer 1)** handle external service complexities
- **Use Cases (Layer 3)** focus on business logic
- Reusable across all use cases (LogFoodFromText, LogFoodFromImage, LogFoodFromUPC)

### Implementation: `chatWithJson()` Method

Enhanced `IAIGateway.chatWithJson()` in both OpenAI and Anthropic adapters with:

#### 1. JSON Repair Utility (`#repairJSON`)
Automatically fixes common AI JSON malformations:
- Trailing commas before closing brackets
- Missing commas between array elements (most common issue)
- Missing commas between object properties  
- AI-generated comments

#### 2. Retry Logic with Parse Attempts
- **2 parse attempts** by default (configurable via `maxParseAttempts`)
- Each retry calls AI again with explicit instructions
- Adapter handles retries transparently - use cases just call `chatWithJson`

#### 3. Detailed Error Context
On final failure, throws `InfrastructureError` with:
- Original parse error message
- Repair attempt error  
- Sample of problematic JSON
- Number of attempts made

## Files Changed

### Adapters (Layer 1)
- [OpenAIAdapter.mjs](../../backend/src/1_adapters/ai/OpenAIAdapter.mjs)
  - Added `#repairJSON()` - Common JSON repair patterns
  - Added `#extractAndParseJSON()` - Parse with repair fallback
  - Enhanced `chatWithJson()` - Retry loop with detailed logging

- [AnthropicAdapter.mjs](../../backend/src/1_adapters/ai/AnthropicAdapter.mjs)
  - Same enhancements as OpenAI adapter
  - Handles markdown code blocks (Anthropic-specific)

### Use Cases (Layer 3)
- [LogFoodFromText.mjs](../../backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs)
  - **Simplified**: Now calls `chatWithJson()` instead of `chat()`
  - **Removed**: JSON parsing, repair logic, retry loop
  - **Kept**: Business logic (empty items check, user feedback)

## Parsing Flow

```
Use Case
  ↓
  calls chatWithJson(messages)
  ↓
AI Adapter
  ↓
  Attempt 1: Call AI → Extract JSON → Try parse → Success? Return
  ↓ (if parse fails)
  Attempt 1: Try repair → Parse → Success? Return
  ↓ (if repair fails)
  Attempt 2: Call AI with explicit instructions → Extract → Parse → Repair if needed
  ↓ (if all fail)
  Throw InfrastructureError with details
```

## Logging Events

### OpenAI Adapter
- `openai.json.attemptRepair` - First parse failed, trying repair
- `openai.json.repairSucceeded` - Repair worked
- `openai.json.parseError` - Parse attempt failed (includes attempt number)
- `openai.json.parseRecovered` - Retry succeeded after initial failure
- `openai.json.exhausted` - All attempts failed (includes full error context)

### Anthropic Adapter
- `anthropic.json.attemptRepair`
- `anthropic.json.repairSucceeded`
- `anthropic.json.parseError`
- `anthropic.json.parseRecovered`
- `anthropic.json.exhausted`

### Use Case (simplified)
- `logText.ai.failed` - Adapter threw error after exhausting retries
- Business logic proceeds as normal with structured data

## Benefits

1. **Single Responsibility**: Adapters own external service reliability
2. **Reusability**: All use cases get JSON guardrails automatically
3. **DDD Compliance**: Clean separation between infrastructure and application layers
4. **Testability**: Can test JSON repair logic in adapters independently
5. **Maintainability**: JSON parsing logic in one place, not scattered across use cases

## Future Work

Consider similar patterns for:
- Other use cases still using `chat()` + manual parsing
- Vision responses (already using `chatWithImage`)
- Embedding validation

## Testing

Test malformed JSON handling:
```javascript
const adapter = new OpenAIAdapter(config, deps);

// Missing comma between array elements
await adapter.chatWithJson([
  { role: 'user', content: 'List two foods' }
]);
// Adapter handles: {"items": [{"name":"apple"}{"name":"banana"}]}
// Returns: {"items": [{"name":"apple"},{"name":"banana"}]}
```

## Deployment

Deploy with standard process:
```bash
./deploy.sh
```

Monitor logs for:
```bash
ssh homeserver.local 'docker logs -f daylight-station' | grep 'json\.'
```

Success indicators:
- `json.repairSucceeded` - Repair logic worked
- `json.parseRecovered` - Retry succeeded
- Decreased `logVoice.complete success:false` rate
