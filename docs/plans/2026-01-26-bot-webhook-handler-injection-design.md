# Bot Webhook Handler Injection Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `createBotWebhookHandler` adapter import from bot routers by injecting pre-built handlers from bootstrap.

**Architecture:** Move webhook handler construction from API layer to bootstrap layer, passing fully-built Express handlers to router factories.

**Tech Stack:** Express.js, existing bootstrap pattern

---

## The Problem

Three bot routers import `createBotWebhookHandler` from `2_adapters/telegram/`:
- `nutribot.mjs`
- `journalist.mjs`
- `homebot.mjs`

Per DDD guidelines, API layer should not import from adapters.

## The Solution

Move `createBotWebhookHandler` call to bootstrap. Pass pre-built handler to routers.

---

## Task 1: Update nutribot router

**Files:**
- Modify: `backend/src/4_api/v1/routers/nutribot.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Update router to receive webhookHandler**

In `nutribot.mjs`:
- Remove import: `import { createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs'`
- Change options to receive `webhookHandler` instead of `webhookParser` and `inputRouter`
- Replace `createBotWebhookHandler(...)` call with just mounting `webhookHandler`

**Step 2: Update bootstrap to create webhook handler**

In `bootstrap.mjs`, in `createNutribotApiRouter`:
- Add import for `createBotWebhookHandler` (if not already present)
- Create `webhookHandler` using `createBotWebhookHandler({ parser, inputRouter, ... })`
- Pass `webhookHandler` to router instead of `webhookParser` and `inputRouter`

**Step 3: Verify**

```bash
grep -E "2_adapters" backend/src/4_api/v1/routers/nutribot.mjs
# Expected: No output

node --check backend/src/4_api/v1/routers/nutribot.mjs
# Expected: No errors
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/nutribot.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(nutribot): inject pre-built webhook handler"
```

---

## Task 2: Update journalist router

**Files:**
- Modify: `backend/src/4_api/v1/routers/journalist.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

Same pattern as Task 1:
- Remove adapter import from router
- Receive `webhookHandler` in options
- Mount pre-built handler
- Create handler in bootstrap

**Commit:** `refactor(journalist): inject pre-built webhook handler`

---

## Task 3: Update homebot router

**Files:**
- Modify: `backend/src/4_api/v1/routers/homebot.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

Same pattern as Task 1:
- Remove adapter import from router
- Receive `webhookHandler` in options
- Mount pre-built handler
- Create handler in bootstrap

**Commit:** `refactor(homebot): inject pre-built webhook handler`

---

## Task 4: Verify full compliance

**Step 1: Check no adapter imports in API layer**

```bash
grep -r "2_adapters" backend/src/4_api/ --include="*.mjs" | grep -v "^\s*\*" | grep -v "// "
```
Expected: No output (excluding comments/JSDoc)

**Step 2: Run tests**

```bash
cd backend && npm test
```
Expected: All tests pass

---

## Summary

| Router | Current | After |
|--------|---------|-------|
| nutribot | imports createBotWebhookHandler | receives webhookHandler |
| journalist | imports createBotWebhookHandler | receives webhookHandler |
| homebot | imports createBotWebhookHandler | receives webhookHandler |

Total: 3 routers, 4 tasks (3 refactors + 1 verification)
