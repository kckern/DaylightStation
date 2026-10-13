# Keypad Telemetry

> Historical planning record preserved during the 2026-10-08 integration. Current reference docs and implementation supersede older UI and timing details here. Keypad telemetry uses the existing self-service logger and never records code digits; current stray-input, submit-settle, and screen-off guards remain authoritative.

**Date:** 2026-08-21
**Component:** `frontend/src/modules/School/selfService/Keypad.jsx`
**Facade:** `frontend/src/modules/School/schoolLog.js`

## Problem

The Keypad component has zero logging. The self-service hook (`useSelfService`) logs decision-point events (resolve success/failure, actions, idle timeout) but the entire input side — every keystroke, every clear, every submit attempt — is invisible.

## Approach

Extend the existing `schoolLog` facade with `keypad` / `keypadDebug` categories. Events appear as `school.keypad.*` in the log store, filterable alongside the existing `school.selfservice.*` stream. No new files, no new dependencies.

Codes are not sensitive — they are disposable one-time identifiers printed on worksheets. Full digits are logged in every event.

## Events

| Event | Level | Data | When |
|-------|-------|------|------|
| `digit.pressed` | debug | `{ digit, position, entry }` | Any digit tap. `position` is 0-indexed slot being filled; `entry` is the post-press string. |
| `backspace` | debug | `{ position, entry }` | Backspace tap. `position` is the slot removed; `entry` is post-backspace string. |
| `clear` | info | `{ entryLength }` | Clear tap when entry has digits. |
| `clear.reload` | info | `{}` | Clear on empty entry triggered panel reload. |
| `reject.cancelled` | debug | `{ phase, byKey }` | Keypress interrupted a playing reject animation. `byKey` is `'clear'`, `'digit'`, or `'backspace'`. |
| `submit` | info | `{ code }` | Go pressed, code sent to `onSubmit`. |
| `submit.blocked` | debug | `{ reason, entryLength }` | Go pressed but `busy` or entry incomplete. `reason` is `'busy'` or `'incomplete'`. |
| `reject.start` | info | `{}` | Reject animation begins (bad code, not degraded). |
| `reject.complete` | debug | `{}` | Reject animation ran to natural completion (not cancelled). |
| `retry` | info | `{}` | Retry button pressed during degraded state. |

## What is NOT logged here

- `code.resolved` / `code.rejected` — already logged by `useSelfService` in the hook.
- `keypad.reload` — already logged by `useSelfService` when it handles the reload callback.
- `idle.timeout` — already in `useSelfService`.

No duplication with existing hook-side telemetry.

## Changes

### 1. `schoolLog.js` — add two emitters

```js
keypad: (detail, data) => emit('keypad', detail, data),
keypadDebug: (detail, data) => emit('keypad', detail, data, 'debug'),
```

### 2. `Keypad.jsx` — add log calls at each interaction point

- **`press(digit)`** — `keypadDebug('digit.pressed', ...)` after `stopReject()`.
- **`backspace()`** — `keypadDebug('backspace', ...)` after `stopReject()`.
- **`clearEntry()`** — one log per branch: `reject.cancelled` / `clear.reload` / `clear`.
- **`submit()`** — `keypad('submit', ...)` before `setEntry('')`; `keypadDebug('submit.blocked', ...)` on early return.
- **`playReject()`** — `keypad('reject.start', {})` at the top.
- **Reject animation final timer** — `keypadDebug('reject.complete', {})`.
- **`stopReject()` from digit/backspace** — `keypadDebug('reject.cancelled', ...)` when `reject` is non-null.
- **Retry button** — wrap `onRetry` to log `keypad('retry', {})`.

### Closure note

`press`, `backspace`, and `clearEntry` use functional updaters (`setEntry(current => ...)`), so the `entry` in the callback closure is the pre-update value. Log calls compute post-update state from the closure value (e.g. `entry + digit` for press, `entry.slice(0, -1)` for backspace).
