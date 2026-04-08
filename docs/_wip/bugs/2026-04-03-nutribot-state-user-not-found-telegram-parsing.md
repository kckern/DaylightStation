# Bug: Nutribot state fails to resolve Telegram user — `conversation.state.user_not_found`

**Date:** 2026-04-03  
**Severity:** Medium (functional degradation — state falls back to `_unknown` dir)  
**Module:** `nutribot-state` / `YamlConversationStateDatastore`

---

## Symptoms

The warning `conversation.state.user_not_found` fires on **every** Telegram nutribot interaction:

```json
{
  "event": "conversation.state.user_not_found",
  "data": {
    "conversationId": "telegram:b6898194425_c575596036",
    "userId": "c575596036"
  },
  "module": "nutribot-state"
}
```

Meanwhile, the direct image route resolves the **same user** correctly as `kckern`.

## Impact

- Conversation state files are written to the `_unknown/` fallback directory instead of `users/kckern/conversations/`
- State isolation per user is broken — all unresolved Telegram users share the same fallback path
- Every nutribot request produces a noisy warning log

## Root Cause

**Off-by-one prefix in conversationId parsing.**

`TelegramChatRef.toConversationId()` produces the format:

```
telegram:b{botId}_c{chatId}
```

For example: `telegram:b6898194425_c575596036`

`YamlConversationStateDatastore.#resolveUsername()` at line 85-87 parses it as:

```javascript
const identifier = conversationId.substring('telegram:'.length);
// identifier = "b6898194425_c575596036"

const userId = identifier.includes('_') ? identifier.split('_')[1] : identifier;
// userId = "c575596036"  ← BUG: includes the 'c' prefix
```

The identity mapping table has the **raw numeric ID**:

```javascript
{ telegram: { '575596036': 'kckern' } }
```

So looking up `"c575596036"` fails — it should be `"575596036"`.

## Why the direct image route works

`directInput.mjs` takes the opposite path: it starts with the **username** (`kckern`) from the request params, resolves it via `TelegramIdentityAdapter` to get the platform ID, and **constructs** the conversationId from scratch. It never needs to parse the conversationId back into a user ID.

## Affected Code

| File | Lines | Issue |
|------|-------|-------|
| `backend/src/1_adapters/messaging/YamlConversationStateDatastore.mjs` | 85-87 | Splits on `_` but doesn't strip the `c` prefix from the chatId segment |
| `backend/src/1_adapters/telegram/TelegramChatRef.mjs` | 96-101 | Defines the `b{botId}_c{chatId}` format (this is correct) |

## Fix

The parsing in `#resolveUsername` needs to understand the `b{botId}_c{chatId}` format. Either:

**Option A — Parse the structured format:**

```javascript
const identifier = conversationId.substring('telegram:'.length);
const match = identifier.match(/^b[^_]+_c(.+)$/);
const userId = match ? match[1] : identifier;
```

**Option B — Use `TelegramChatRef.fromConversationId()` if it exists** (keeps parsing logic in one place).

Option A is minimal. Option B is cleaner if the static factory already exists.

## Verification

After fix, the log should stop producing `user_not_found` warnings for known Telegram users, and conversation state files should appear under `users/kckern/conversations/nutribot/` instead of `_unknown/`.

```bash
# Confirm current behavior (warning present)
sudo docker logs daylight-station 2>&1 | grep user_not_found | tail -5

# After fix: should produce zero results for known users
```
