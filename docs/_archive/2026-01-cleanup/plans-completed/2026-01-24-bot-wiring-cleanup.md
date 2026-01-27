# Bot Wiring Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix remaining low-priority wiring issues identified in bot audit to eliminate technical debt and hardcoded values.

**Architecture:** Fix four isolated issues across three bot modules - each is independent and can be done in any order. All changes are within the existing DDD layer boundaries.

**Tech Stack:** Node.js ES Modules, Express adapters, DDD use cases

---

## Summary of Issues

| # | Bot | Issue | Severity |
|---|-----|-------|----------|
| 1 | Journalist | `HandleSlashCommand` and `InitiateJournalPrompt` hardcode `'kckern'` fallback | Medium |
| 2 | Journalist | `JournalistContainer` hardcodes `'kckern'` in multiple places | Medium |
| 3 | Homebot | `ProcessGratitudeInput.set()` uses wrong argument order | Low |
| 4 | Homebot | `ToggleCategory.set()` uses wrong argument order | Low |

---

## Task 1: Fix Journalist Hardcoded Username Fallbacks

**Files:**
- Modify: `backend/src/3_applications/journalist/usecases/HandleSlashCommand.mjs:68`
- Modify: `backend/src/3_applications/journalist/usecases/InitiateJournalPrompt.mjs:75`
- Modify: `backend/src/3_applications/journalist/JournalistContainer.mjs:146,178-179`
- Modify: `backend/src/2_adapters/journalist/JournalistInputRouter.mjs:214-217`

**Context:**
The journalist bot has `'kckern'` hardcoded as a fallback username in several places. This should use proper user resolution from the conversation ID via the config's `getUserIdFromConversation` function or a dedicated user resolver.

**Step 1: Update JournalistInputRouter to pass userId to HandleSlashCommand**

Current code at line 214:
```javascript
return useCase.execute({
  chatId: conversationId,
  command: fullCommand,
});
```

Change to:
```javascript
return useCase.execute({
  chatId: conversationId,
  command: fullCommand,
  userId: metadata?.senderId,
});
```

**Step 2: Update HandleSlashCommand to use passed userId with proper fallback**

Current code at line 68:
```javascript
username: userId || 'kckern', // TODO: proper user resolution
```

Change to:
```javascript
username: userId || 'unknown',
```

Note: The `userId` is now properly passed from the router. Using `'unknown'` as fallback makes failures visible rather than silently using wrong user.

**Step 3: Update InitiateJournalPrompt fallback**

Current code at line 75:
```javascript
const username = this.#journalEntryRepository?.getUsername?.(chatId) || 'kckern';
```

Change to:
```javascript
const username = this.#journalEntryRepository?.getUsername?.(chatId) || 'unknown';
```

**Step 4: Update JournalistContainer fallbacks**

Line 146 - change:
```javascript
username: this.#config.username || 'kckern',
```
To:
```javascript
username: this.#config.username || 'unknown',
```

Lines 178-179 - This is a data path that includes username. Change:
```javascript
const dataPath = process.env.path?.data
  ? `${process.env.path.data}/users/${this.#config.username || 'kckern'}/lifelog/journalist`
  : '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStationdata/users/kckern/lifelog/journalist';
```

To:
```javascript
const configUsername = this.#config.username;
if (!configUsername) {
  throw new Error('JournalistContainer requires config.username to be set');
}
const dataPath = process.env.path?.data
  ? `${process.env.path.data}/users/${configUsername}/lifelog/journalist`
  : null;

if (!dataPath) {
  throw new Error('JournalistContainer requires process.env.path.data to be set');
}
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/journalist/usecases/HandleSlashCommand.mjs \
        backend/src/3_applications/journalist/usecases/InitiateJournalPrompt.mjs \
        backend/src/3_applications/journalist/JournalistContainer.mjs \
        backend/src/2_adapters/journalist/JournalistInputRouter.mjs
git commit -m "fix(journalist): remove hardcoded 'kckern' fallbacks

- Pass userId from router to HandleSlashCommand
- Change fallbacks to 'unknown' to surface missing user issues
- Make JournalistContainer fail fast if username not configured

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix Homebot ProcessGratitudeInput State Store Call

**Files:**
- Modify: `backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs:89-97`

**Context:**
The `YamlConversationStateStore.set()` signature is:
```javascript
async set(conversationId, state, messageId)
```

But `ProcessGratitudeInput` calls it with wrong argument order at line 89:
```javascript
await this.#conversationStateStore.set(conversationId, {
  activeFlow: 'gratitude_input',
  flowState: { ... }
}, messageId);
```

Wait - this is actually correct! The signature is `(conversationId, state, messageId)` and that's exactly how it's called. Let me re-verify.

Looking at YamlConversationStateStore.mjs:128:
```javascript
async set(conversationId, state, messageId) {
```

And ProcessGratitudeInput.mjs:89:
```javascript
await this.#conversationStateStore.set(conversationId, {
  activeFlow: 'gratitude_input',
  ...
}, messageId);
```

This is **correct**. The audit finding was a false positive.

**No changes needed for this task.**

---

## Task 3: Fix Homebot ToggleCategory State Store Call

**Files:**
- Modify: `backend/src/3_applications/homebot/usecases/ToggleCategory.mjs:70`

**Context:**
Same check as Task 2. Looking at line 70:
```javascript
await this.#conversationStateStore.set(conversationId, messageId, updatedState);
```

This IS incorrect. The signature is `(conversationId, state, messageId)` but this passes `(conversationId, messageId, updatedState)`.

**Step 1: Fix argument order**

Current code at line 70:
```javascript
await this.#conversationStateStore.set(conversationId, messageId, updatedState);
```

Change to:
```javascript
await this.#conversationStateStore.set(conversationId, updatedState, messageId);
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/homebot/usecases/ToggleCategory.mjs
git commit -m "fix(homebot): correct ToggleCategory state store argument order

YamlConversationStateStore.set() signature is (conversationId, state, messageId)
but ToggleCategory was calling with (conversationId, messageId, state)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Verify AssignItemToUser websocketBroadcast Issue

**Files:**
- Review: `backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs`
- Review: `backend/src/3_applications/homebot/HomeBotContainer.mjs`

**Context:**
The audit mentioned `websocketBroadcast` is received but never stored/used. Let me verify.

Looking at `AssignItemToUser.mjs`, there is no `websocketBroadcast` in the constructor or anywhere in the file. This was likely a confusion with how the container wires things up.

Checking `app.mjs:742`:
```javascript
websocketBroadcast: broadcastEvent,
```

This is passed to `createHomebotServices()`, not directly to `AssignItemToUser`. The container decides whether to use it.

**No changes needed for this task.** The `websocketBroadcast` is available at the container level for use cases that need it - `AssignItemToUser` simply doesn't need it. This is not a bug.

---

## Final Summary

Only **2 tasks** actually require changes:

| Task | Description | Status |
|------|-------------|--------|
| 1 | Remove hardcoded `'kckern'` in Journalist | Needs fix |
| 2 | ProcessGratitudeInput state store call | False positive - correct |
| 3 | ToggleCategory state store argument order | Needs fix |
| 4 | AssignItemToUser websocketBroadcast | False positive - by design |

**Actual work required:**
1. Journalist hardcoded username fixes (4 files)
2. ToggleCategory argument order fix (1 file)
