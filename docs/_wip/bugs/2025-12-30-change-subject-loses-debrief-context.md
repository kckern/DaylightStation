# Bug: "Change Subject" Loses Debrief Context

**Date:** 2024-12-30  
**Status:** Diagnosed  
**Severity:** Medium  
**Component:** `backend/chatbots/bots/journalist/`

---

## Problem Statement

When a user clicks "🎲 Change Subject" during a **morning debrief interview** (`💬 Ask` flow), the new question has no awareness of the debrief context and generates generic, context-free questions instead of asking about a different topic from the same debrief.

### Expected Behavior
1. User receives morning debrief with data (commits, weather, calendar events, etc.)
2. User clicks `💬 Ask` → Starts debrief interview with context-aware question about **Topic A**
3. User clicks `🎲 Change Subject` → Should ask about **Topic B** from the *same debrief data*

### Actual Behavior
1. User receives morning debrief
2. User clicks `💬 Ask` → Context-aware question: "What motivated you to spend so much time enhancing the WebSocket features..."
3. User clicks `🎲 Change Subject` → Generic question: "As you transition from day to evening, what is something positive or meaningful..."

The new question has **zero awareness** of the debrief data (commits, activities, calendar, etc.).

---

## Root Cause Analysis

### The Flow Diagram

```
User clicks "💬 Ask"
    │
    ▼
InitiateDebriefInterview.execute()
    │
    ├── Gets debrief from debriefRepository ✅
    ├── Builds context from debrief.summary, debrief.summaries ✅
    └── Generates question WITH context ✅

User clicks "🎲 Change Subject"
    │
    ▼
HandleSpecialStart.execute()
    │
    └── Calls initiateJournalPrompt.execute({ chatId, instructions: 'change_subject' })
            │
            ▼
        InitiateJournalPrompt.execute()
            │
            ├── Skips history (instructions === 'change_subject') ❌
            ├── Has NO debrief context ❌
            └── Generates GENERIC question ❌
```

### The Bug Location

**File:** [HandleSpecialStart.mjs](backend/chatbots/bots/journalist/application/usecases/HandleSpecialStart.mjs#L59-L70)

```javascript
if (isRoll) {
  // Roll - initiate new topic
  if (this.#initiateJournalPrompt) {
    const result = await this.#initiateJournalPrompt.execute({ 
      chatId, 
      instructions: 'change_subject',  // ← Only passes this
    });
    // ...
  }
}
```

**Problem:** `HandleSpecialStart` always routes to `InitiateJournalPrompt` regardless of the current `activeFlow`. It doesn't:
1. Check if `activeFlow === 'morning_debrief'`
2. Pass any debrief context
3. Route to `InitiateDebriefInterview` instead

### Additional Issues in InitiateJournalPrompt

**File:** [InitiateJournalPrompt.mjs](backend/chatbots/bots/journalist/application/usecases/InitiateJournalPrompt.mjs#L66-L70)

```javascript
// 2. Load history (skip if change_subject)
let history = '';
if (instructions !== 'change_subject' && this.#journalEntryRepository?.getMessageHistory) {
  const messages = await this.#journalEntryRepository.getMessageHistory(chatId, 10);
  history = formatAsChat(messages);
}
```

When `change_subject` is passed:
1. History is explicitly **skipped** (empty string)
2. The prompt builder receives no context
3. The AI generates a completely random question

---

## Evidence from Logs

```
[DEBUG] journalPrompt.initiate.start {"chatId":"telegram:580626020_575596036","instructions":"change_subject"}
[DEBUG] openai.api.request {"endpoint":"/chat/completions","model":"gpt-4o","messageCount":2}
```

Note: `messageCount: 2` means only system + user prompt, with **no context injected**.

Compare to the debrief interview:
```
[DEBUG] debriefInterview.initiate.start {"conversationId":"telegram:580626020_575596036"}
[DEBUG] openai.api.request {"endpoint":"/chat/completions","model":"gpt-4o","messageCount":1}
```

The debrief interview uses a single detailed prompt with the full debrief context embedded.

---

## Proposed Solution

### Option A: Flow-Aware Routing (Recommended)

Modify `HandleSpecialStart` to check `activeFlow` and route appropriately:

```javascript
// In HandleSpecialStart.execute()
if (isRoll) {
  // Check current flow state
  const state = await this.#conversationStateStore?.get(chatId);
  
  if (state?.activeFlow === 'morning_debrief' && this.#initiateDebriefInterview) {
    // Stay in debrief flow - ask about different topic from same data
    const result = await this.#initiateDebriefInterview.execute({
      conversationId: chatId,
      instructions: 'change_subject',  // Pass flag to avoid duplicate topic
    });
    return { success: true, action: 'roll', promptResult: result };
  }
  
  // Default to generic journal prompt
  if (this.#initiateJournalPrompt) {
    const result = await this.#initiateJournalPrompt.execute({ 
      chatId, 
      instructions: 'change_subject',
    });
    return { success: true, action: 'roll', promptResult: result };
  }
}
```

Then modify `InitiateDebriefInterview` to track asked topics and avoid repeats.

### Option B: Pass Context Through

Modify `HandleSpecialStart` to fetch and pass debrief context to `InitiateJournalPrompt`:

```javascript
if (isRoll) {
  const state = await this.#conversationStateStore?.get(chatId);
  
  const result = await this.#initiateJournalPrompt.execute({ 
    chatId, 
    instructions: 'change_subject',
    debriefContext: state?.debrief || null,  // Pass debrief if available
  });
}
```

Then modify `InitiateJournalPrompt` to use the debrief context if provided.

---

## Files to Modify

| File | Change |
|------|--------|
| [HandleSpecialStart.mjs](backend/chatbots/bots/journalist/application/usecases/HandleSpecialStart.mjs) | Add dependency injection for `conversationStateStore` and `initiateDebriefInterview` |
| [InitiateDebriefInterview.mjs](backend/chatbots/bots/journalist/application/usecases/InitiateDebriefInterview.mjs) | Add `instructions` parameter to vary topics, track previous questions |
| [JournalistFactory.mjs](backend/chatbots/bots/journalist/infrastructure/JournalistFactory.mjs) | Wire new dependencies |

---

## Missing Functionality: Delete Previous Bot Message

The logs show:
```
[DEBUG] telegram.api.request {"method":"deleteMessage","params":{"chat_id":"575596036","message_id":6900}}
```

This deletes the **user's** "🎲 Change Subject" message, but the **previous bot question** (message 6899: "💬 What motivated...") is NOT deleted.

`HandleSpecialStart.#deleteRecentBotMessages()` exists but may not be working correctly, or the message may be outside the 1-minute window.

---

## Summary

| Issue | Cause | Fix |
|-------|-------|-----|
| Generic question after "Change Subject" | Wrong use case is called | Route to `InitiateDebriefInterview` when `activeFlow === 'morning_debrief'` |
| No debrief context | Context not passed | Either route to correct use case OR pass context through |
| Previous bot message not deleted | Timing/logic issue in `#deleteRecentBotMessages` | Investigate separately |
