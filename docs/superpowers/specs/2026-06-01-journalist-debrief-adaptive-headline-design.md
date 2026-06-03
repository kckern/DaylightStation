# Journalist Morning-Debrief Adaptive Headline

**Date:** 2026-06-01
**Status:** Approved, pending implementation

## Problem

The daily morning-debrief Telegram message opens with a static, transactional header:

```js
const message = `📅 <b>Yesterday</b> (${formattedDate})\n\n${styledSummary}`;
```

Rendered: `📅 Yesterday (Sat, 31 May 2026)`. It reads as boilerplate noise, so the
message is easy to ignore, and the genuinely engaging part — the reflection prompts —
is buried at the bottom under facts and commentary. Engagement is sporadic (catch-up
responses every 3–7 days rather than daily).

## Goal

Replace the static header with an **adaptive hook** that makes the message worth
opening and creates a pull to respond: either a sharp, specific **question** about the
day's emotional/decision thread, or an intriguing **teaser** when the day is more
observational. The model chooses per day. No greeting.

## Design

### 1. Generation — `GenerateMorningDebrief`

The debrief already issues one LLM call with full facts plus the user's last-3-days
message context. Add a `SECTION 0: HOOK` instruction to that same prompt (no second
call, no added latency or cost):

> A single line that makes the message worth opening — either one sharp, specific
> question about the day's main emotional/decision thread, OR an intriguing teaser when
> the day is more observational. Model's choice. Specific to *this* day, never generic;
> draw on what the user has already told you. Emit it as the **first line**, prefixed
> exactly with `HOOK: `.

After the call, parse the first line:

- If it starts with `HOOK:`, split it into `debrief.headline` (trimmed, prefix removed)
  and strip that line from `summary`.
- Otherwise `headline` is null and `summary` is returned unchanged.

`summary` — and therefore what is persisted to `debriefs.yml` — stays exactly as today:
clean facts/commentary/questions, no `HOOK:` leakage. `applyTelegramStyling` continues
to run on that clean summary, unchanged.

### 2. Message assembly — `SendMorningDebrief`

```
{emoji} <b>{headline}</b>
<i>{Sun · 31 May · yesterday}</i>

{styled summary…}
```

- **Emoji** is deterministic: `💬` if `headline` ends with `?`, else `🔍`. No model work.
- **Date** is demoted to a small italic subordinate line: `{weekday} · {day} {month} ·
  yesterday`. Drops the year and the 📅 emoji as clutter.
- `headline` is HTML-escaped before insertion.

### 3. Fallback (required)

If `headline` is missing/empty (model omitted the prefix, or the existing-debrief
re-send path via `getDebriefByDate` which makes no LLM call), fall back to the current
header: `📅 <b>Yesterday</b> (${formattedDate})`. A headerless message is never shipped.

### 4. Scope boundaries (YAGNI)

- The headline is **not** persisted to `debriefs.yml` — it is an ephemeral send-time
  hook. (Trivial to add later if it's wanted in the Details/history view.)
- No changes to the user prompt-override file (`prompts.yml`); the hook lives in the
  inline debrief prompt.
- No second LLM call, no temperature/token changes.

## Testing

- **`SendMorningDebrief`** message assembly (new unit test): headline+date layout;
  `?`→💬 vs teaser→🔍; HTML escaping; no-headline fallback to the old header.
- **`GenerateMorningDebrief`** HOOK parsing (new unit test): strips the `HOOK:` line from
  `summary`, populates `headline`, and tolerates a missing prefix (null headline,
  summary intact).

## Files

- `backend/src/3_applications/journalist/usecases/GenerateMorningDebrief.mjs` — prompt
  section + parse, return `headline`.
- `backend/src/3_applications/journalist/usecases/SendMorningDebrief.mjs` — message
  assembly, emoji/date format, fallback.
- New tests under `tests/isolated/flow/journalist/usecases/`.

## Risk

Low. No existing test asserts the literal `📅 Yesterday (…)` header string. The change is
additive with a fallback to current behavior.
