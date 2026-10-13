# Status Indicator Abstraction

## Overview

Standardize the "loading/working" UX pattern across all long-running use cases in nutribot and journalist applications. Currently, status messages are implemented inconsistently (some update, some delete+recreate, some missing entirely).

## Goals

1. Consistent UX: Users always see feedback during long operations
2. Prefer update over delete+recreate (smoother UX, no flicker)
3. Optional cycling animation (`Analyzing.` → `Analyzing..` → `Analyzing...`)
4. Clean DDD separation: application layer doesn't know adapter implementation details

## Design

### Port Interface

Extend `IResponseContext` with one new method:

```javascript
/**
 * Create a status indicator for a long-running operation
 * @param {string} initialText - Initial status text (e.g., "🔍 Analyzing")
 * @param {Object} [options] - Options
 * @param {string[]} [options.frames] - Animation frames to cycle (e.g., ['.', '..', '...'])
 * @param {number} [options.interval=2000] - Animation interval in ms
 * @returns {Promise<IStatusIndicator>}
 */
async createStatusIndicator(initialText, options = {}) {}
```

Application defines the animation (frames + interval), adapter executes it.

The returned `IStatusIndicator` handle:

```javascript
/**
 * @typedef {Object} IStatusIndicator
 * @property {string} messageId - The underlying message ID
 * @property {function(string, Object?): Promise<string>} finish - Complete with final content, returns messageId
 * @property {function(): Promise<void>} cancel - Abort without final message (deletes status)
 */
```

### Adapter Implementation

**Telegram** (supports message updates):
- `createStatusIndicator()` sends initial message, optionally starts animation timer
- `finish()` stops animation, updates message in place, returns same messageId
- `cancel()` stops animation, deletes message

**Future adapters without update support**:
- `finish()` would delete + send new message, return NEW messageId

The use case doesn't know which pattern is used - it just gets back a messageId.

### Use Case Pattern

**For text results:**
```javascript
const status = await messaging.createStatusIndicator('🔍 Analyzing...', { animate: true });
// ... long operation ...
const messageId = await status.finish(`${result}`, { choices: buttons });
```

**For photo/different message type results:**
```javascript
const status = await messaging.createStatusIndicator('🔍 Analyzing image...', { animate: true });
// ... long operation ...
await status.cancel();
const { messageId } = await messaging.sendPhoto(photo, caption, { choices: buttons });
```

## Implementation Plan

### Phase 1: Infrastructure

1. Update `IResponseContext` port interface
2. Implement `createStatusIndicator` in `TelegramResponseContext`

### Phase 2: Migrate Existing Status Messages

| Use Case | Current | Change |
|----------|---------|--------|
| `LogFoodFromImage` | send → delete → sendPhoto | status indicator + cancel |
| `LogFoodFromText` | send → update | status indicator |
| `LogFoodFromUPC` | send → delete → sendPhoto | status indicator + cancel |
| `GenerateDailyReport` | send → delete | status indicator + cancel |

### Phase 3: Add Missing Status Messages

| Use Case | Latency Source |
|----------|----------------|
| `LogFoodFromVoice` | Transcription + AI |
| `ProcessVoiceEntry` | Transcription + AI |
| `ProcessTextEntry` | 2x AI calls |
| `GenerateTherapistAnalysis` | AI with large context |
| `GenerateOnDemandCoaching` | AI call |
| `ProcessRevisionInput` | AI call |

### Not Migrating

- Instant operations: `AcceptFoodLog`, `DiscardFoodLog`, callback handlers
- Background/orchestration: `GenerateMorningDebrief` (not user-facing)

## Files Changed

**New/Modified:**
- `__backend/src/3_applications/nutribot/ports/IResponseContext.mjs`
- `__backend/src/1_adapters/telegram/TelegramResponseContext.mjs`
- 10 use case files (listed above)

## Testing

- Unit test `TelegramResponseContext.createStatusIndicator()` with mock adapter
- Verify animation cleanup on both `finish()` and `cancel()`
- Integration test: send status, finish, verify single message updated (not two messages)
