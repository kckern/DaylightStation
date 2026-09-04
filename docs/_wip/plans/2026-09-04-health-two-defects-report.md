# Health — two production defects, 2026-09-04

Two defects reported minutes apart. Branch `feat/health-usability`, merged from
`main` (`c21ba38b0`) at the start; the merge was a fast-forward because the
earlier usability phases were already in `main`.

---

## Defect 1 — capture ignored the day being viewed. **DONE** (`60c7e2f18`)

Food added while looking at yesterday landed on today. It was not one route: no
capture path accepted a date at all, and every service downstream computed one
from the server clock.

**Covered:** quick add, the typed sentence, voice, photo, barcode, the
unknown-UPC custom-food branch, and template instantiation (whose route already
took a `date` that nothing was sending). Absent still means today, never coerced
to null — Telegram, the coach and the scale are byte-identical.

**Text and voice get an ANCHOR, not an override.** They already had an
`asOfDate` seam (built so a revision's prompt stays pinned to the original log's
day). The viewed day reuses it, so "this morning" resolves against the day being
looked at while a date the model computes *from* that anchor still wins. Passing
the viewed day as `LogFoodFromText`'s existing `date` override would have done
the opposite — flattened "yesterday" onto the viewed day. Image and barcode have
no words to date anything from, so they take a plain `date`.

Only the LOGICAL date follows the view. `createdAt` / `settledAt` stay real
wall-clock instants.

**Validation:** one shared `isISODate`, extracted from `BudgetService` to
`shared/contracts/health/isoDate.mjs` (the only place the API, application and
domain layers may all import from — `api-no-domains` refuses a 4_api→2_domains
import). Its test lives under `backend/src/` because `shared/` is not a
gate-vitest ROOT and a test beside the module would silently never run.
`DATE_PATTERN` is gone: a regex accepts `2026-02-31` (silently becomes March 3)
and `2026-08-32` (Invalid Date → RangeError → a 500 where a 400 belongs).

**Bucket default (decision 2.41):** the clock speaks only for today; on any
other day the target is that day's FIRST meal, and the quick bar names the day
it will hit. Reasoning and the three rejected alternatives are in the decision
log.

---

## Defect 2 — a voice memo lost to a transient network failure. **CODE COMPLETE, NOT GATED**

### The reported cause did NOT hold

The hypothesis was a post-boot readable-content harvest saturating outbound
HTTP. Checked before acting on it, and falsified:

- The harvest is an **hourly `:25` cron**, not a boot job — it ran 23 more times
  in the same 24h at the same volume (~230 upstream errors per run, 6,953 total).
  `bootstrap.mjs` defines a `headlineHarvestJob`, but nothing invokes it.
- Outbound concurrency is hard-capped at **3** in-flight fetches
  (`HeadlineService.mjs`, `CONCURRENCY = 3`), serial across sources. Three
  sockets do not saturate a household egress link.
- Process impact was real but small: event-loop **p99 rose from ~80–130 ms to
  436–538 ms** across exactly those windows; p50 stayed at the 20 ms idle floor.
- The failure signature points **upstream**: two ECONNRESETs at 15055 ms and
  15142 ms — a near-identical 15 s cut, when our own timeout is 60 s — plus a
  1226 ms ETIMEDOUT.

So the feed harvest was **deliberately not throttled**. It is already capped,
and the evidence does not implicate it.

### What was actually broken, and is fixed

1. **Persist first, transcribe second.** New `VoiceMemoStore` writes to
   `users/{userId}/lifelog/nutrition/audio/{va_*}.{ext}` — a sibling of
   `PhotoStore`'s directory, mirroring its conventions rather than inventing new
   ones. Saving is best-effort and never blocks a transcription that could work.
2. **A longer, still-bounded retry budget.** `retryTransient` gained
   `maxElapsedMs` (checked BEFORE the sleep is paid for) and `jitter`.
   Transcription: 3 attempts / 2s-4s (~58s) → 5 attempts / 2s-4s-8s-16s ±25%
   under a 90s budget. The Telegram URL path, which wraps the adapter's own
   retry, got a budget too so the two cannot nest into minutes.
3. **The failure became a sentence.** It used to re-throw and reach the person
   as `HTTP 500: {"error":"socket hang up"}`. It now exits the way "no food
   detected" already exits and says the recording is saved — claimed ONLY when
   something actually was stored.
4. **The retry exists.** `/nutrition/input` takes an `audioRef` instead of
   `content`; the Today notice grows a "Try again" button when the failure
   carried a ref. A ref the store cannot find is a 404 with a sentence, matched
   on the error CODE so it cannot swallow real failures.

A transient code logs `warn`; anything else logs `error`, so the friendly
message cannot hide a genuine bug.

---

## Verification state — read this before trusting the above

| What | Result |
|---|---|
| Falsification, defect 1 | 14 mutations, **all 14** produced the matching failure |
| Falsification, defect 2 | 19 mutations, **all 19** produced the matching failure after two were repaired (see below) |
| Targeted suites (health, nutribot, adapters, frontend Health) | pass, exit 0 |
| `audit:fs` / `audit:layers` / `audit:ui` / `audit:links` / `check:parse` / `check:scss` | all exit 0 |
| `test:composition-contracts` | 9 pass, exit 0 |
| **Full `test:unit:vitest` gate** | **NOT COMPLETED** — see below |

**The full gate has no verdict for this branch.** Three attempts:
1. Foreground run — SIGKILLed at the 10-minute tool timeout. Not a verdict.
2. Background run — another agent's gate, running in the `catalog-density`
   worktree, **truncated the shared scratchpad log** it was writing to. Not a
   verdict.
3. Third run — killed on instruction when the session ended.

**Two tests were caught passing for the wrong reason and repaired**, which is
why the falsification count above is worth reading:
- `WebNutribotAdapter.voiceRecovery` wired `transcribeVoice` onto the response
  context. `LogFoodFromVoice#getMessaging` says explicitly that a response
  context never carries it, so every call was failing with a TypeError, not the
  network error under test.
- `VoiceMemoStore`'s traversal assertion named a file that did not exist, so it
  passed with **both** guards deleted. It now plants a real file one directory
  up: either guard alone holds, both gone fails.

**One test is known to fail, and it is not from this work.**
`backend/src/1_adapters/persistence/IconManifestStore.media.test.mjs` —
"every legacy nutribot slug still resolves". The `catalog-density` worktree's
gate reported the identical failure as its only new one, at a different commit.
The cause is a live data-volume change (the icon manifest was rewritten to a
hi-res-only set in another session), not code on either branch.

---

## Next step for whoever resumes

Run the full gate on this branch, alone in the tree, to a log path no other
session shares, and read the printed verdict rather than the exit code:

```bash
cd .claude/worktrees/health-usability
node scripts/gate-vitest.mjs > /tmp/gate-health-usability.$$.log 2>&1
echo "GATE_OWN_EXIT=$?" >> /tmp/gate-health-usability.$$.log
```

Expect `IconManifestStore.media.test.mjs` in the new-failure list and discount
it. Note `scripts/gate-vitest.mjs` on this branch has a `ReferenceError: outFile
is not defined` at line 377 that crashes the reporter *after* printing the
failing files — the verdict is readable, the exit code is not trustworthy.
