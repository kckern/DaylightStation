# Nutribot UPC — broken error feedback (edit-after-delete) audit

**Date:** 2026-06-03
**Status:** Root cause identified (code analysis). Latent; trigger currently masked by a separate fix. Not yet fixed.
**Component:** `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
**Related fix:** commit `641c5f361` — `fix(nutribot): upload remote photo URLs as buffers; surface Telegram error description`

## Summary

While diagnosing the primary UPC failure (Telegram rejecting OpenFoodFacts photo
URLs — fixed in `641c5f361`), prod logs showed a **secondary** error: every
`sendPhoto` 400 was immediately followed by a `telegram.api.error` for
`editMessageText` (also 400). The consequence is that when UPC logging fails, the
user gets **no error message at all** — the status indicator vanishes silently.

## Evidence (prod logs, 2026-06-03 15:32–15:33)

For each failed scan, the sequence was:

```
direct.upc.received            (GET /upc, user=user_1)
upc.lookup.found               (OpenFoodFacts, hasImage:true)
telegram.api.error  method=sendPhoto        "Request failed with status code 400"
logUPC.error
telegram.api.error  method=editMessageText  "Request failed with status code 400"
http.response  /upc → 500
```

The `editMessageText` 400 fired in the **direct `/upc` path**, where there is no
`responseContext` (the barcode scanner posts to the HTTP endpoint, not through a
Telegram bot message).

## Root cause (confirmed via code analysis)

In the direct path, `#getMessaging()` returns the plain gateway wrapper, which has
**no** `createStatusIndicator` / `createPhotoStatusIndicator`. So:

1. **Step 2** — status indicator falls through to `messaging.sendMessage(...)`, a
   plain **text** message. `status` is `null`; `statusMsgId` is set.
2. **Step 9** ("cancel status indicator before sending photo"):
   ```js
   if (status) { await status.cancel(); }
   else { await messaging.deleteMessage(statusMsgId); }   // <-- deletes the status message
   ```
3. **Step 10** — `sendPhoto(product.imageUrl, ...)` throws (the primary bug).
4. **catch** (error feedback):
   ```js
   if (status || statusMsgId) {
     ...
     if (status) { await status.finish(errorMsg); }
     else { await messaging.updateMessage(statusMsgId, { text: errorMsg }); }  // <-- edits a deleted message
   }
   ```

`statusMsgId` was **already deleted in step 9**, so `updateMessage` →
`editMessageText` hits a non-existent message → `400 message to edit not found`.
The error never reaches the user.

This is **path-specific**: the `responseContext` path uses a `status` object
whose `cancel()`/`finish()` are coherent (and `finish()` correctly uses
`editMessageCaption` for photo status indicators — verified in
`TelegramResponseContext.createPhotoStatusIndicator`). The bug is only in the
no-`status`-object branch, which deletes-then-edits the same message id.

## Why it isn't firing right now

The trigger was the `sendPhoto` failure at step 10. With `641c5f361`, remote photo
URLs are downloaded and uploaded as buffers, so step 10 now succeeds and the catch
is no longer entered for this flow. The edit-after-delete bug therefore stops
manifesting in the UPC happy path — but it remains **latent** for any failure
between step 9 and the photo send, and the error-feedback path is still wrong.

Note: the observability half of `641c5f361` (logging `error.response.data.description`
in `callApi`) means that if this *does* recur, the log will now name the real
Telegram reason instead of the generic "status code 400".

## Recommended fix (not yet implemented)

The error-feedback branch must not edit a message it already deleted. Options:

1. **Send a fresh message on error** when there is no live `status` object:
   in the catch, replace `messaging.updateMessage(statusMsgId, { text })` with
   `messaging.sendMessage(errorMsg)` (the status message is already gone by step 9).
2. **Defer the delete**: don't delete the status message at step 9; on success
   delete it just before/after sending the photo, and on failure reuse it for the
   error text (no delete-then-edit).

Option 1 is the smaller, lower-risk change. Either should ship with a use-case test
asserting that a `sendPhoto` failure produces a user-visible error message (and does
**not** call `updateMessage`/`editMessageText` on the deleted `statusMsgId`).

## Repro plan (if live confirmation wanted)

Characterize `editMessageText` failure modes against the live bot (token in
`data/system/auth/telegram.yml`, key `nutribot`; send + delete to keep the chat
clean):

- text msg → `editMessageText` (new text) → expect ok (baseline).
- text msg → `deleteMessage` → `editMessageText` → expect `400 message to edit not found` (matches prod).
- photo msg → `editMessageText` → expect `400 there is no text in the message to edit` (the other classic mode, not this bug).
