# Bulk-Print Access Code

> Historical planning record preserved during the 2026-10-08 integration. Current reference docs and implementation supersede older UI and timing details here. Keypad telemetry uses the existing self-service logger and never records code digits; current stray-input, submit-settle, and screen-off guards remain authoritative.

**Date:** 2026-08-21
**Status:** Design (revised after adversarial review)

## Problem

The school agenda thermal receipt prints per-subject QR codes that a parent scans to trigger a lesson (print a worksheet, play a video, launch an app). A parallel self-service path lets the child type a 6-digit access code on the portal keypad instead of needing a parent to scan. Both paths already exist and are paired — same token record, shared lifecycle.

What's missing is a way for a child to print all of today's worksheets at once. Currently each subject requires its own code. A child with four printable subjects must type four codes and confirm four print jobs. The aggregate code lets them type one code and pick up a stack.

## Scope

This feature adds:

1. A **bulk-print token** (`agenda_print`) that references the per-subject tokens for all printable subjects.
2. A **bulk-print access code** (6 digits) paired with that token.
3. A **bulk-print card on the thermal receipt** — QR + 6-digit code at the bottom.
4. A **bulk-print launch card** on the portal keypad — lists the subjects, one "Print all sheets" button.
5. Backend resolution and fan-out for the bulk print action.
6. **Scan-path resolution** — the printed QR must also resolve, not just the access code.

Out of scope: non-print actions (media, apps, screen quizzes) are individual-code-only. The aggregate code is strictly for printing.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| What the aggregate covers | Printable subjects only | Media/app launches can't be batched — they need device routing, screen mounts, etc. |
| Receipt placement | Bottom, after all per-subject cards | Per-subject cards are the primary affordance; the bulk code is a convenience shortcut |
| Served-today filter | Exclude completed/graded subjects | The bulk code prints what's left, not what's done |
| Minimum threshold | 2+ printable subjects required | A bulk code for one item is redundant with the per-subject code |
| Token class | New `agenda_print` class | Clean separation from `subject_next` — unambiguous resolution, distinct expiry rules, clear logging |
| Data model | Flat reference list (Approach A) | The bulk token stores references to per-subject token strings. No data duplication; per-subject tokens remain the source of truth. Dead references filtered at read time. |
| Exhausted bulk code | Friendly "all done" card, not TRY_AGAIN | A child typed a real code off real paper. Telling them "wrong code" with a shake animation violates the system's founding principle (tokens.mjs header: expired tokens get a friendly already-done, never an error). |

## Design

### 1. Token Layer

**New token class** `agenda_print` added to `TOKEN_CLASSES` in `tokens.mjs`.

**Subject shape:**

```js
{ learnerId, tokenRefs: ['sch:ABC...', 'sch:DEF...', ...] }
```

`tokenRefs` is an array of `subject_next` token strings. Must be non-empty; no duplicates; every element must start with the `sch:` prefix.

**Validation changes in `createTokenRecord` (`tokens.mjs`):**

1. **Subject validation (line ~147):** Add a new branch for `agenda_print` in the class-specific validation ladder. Required fields: `learnerId` (non-empty string), `tokenRefs` (non-empty array of `sch:`-prefixed strings, no duplicates). No `sessionId` required — `agenda_print` is sessionless like `identify` and `learning_action`.

2. **Access-code whitelist (line ~155-159):** The existing guard `if (accessCode != null && tokenClass !== 'subject_next') throw ...` must be broadened to allow `agenda_print`: `tokenClass !== 'subject_next' && tokenClass !== 'agenda_print'`.

**Expiry:**

- `expiresAt`: Same as every per-subject token in the batch (they all share the same `nowIso + ttlMs` from one `BuildAgenda.execute()` call — "earliest" is identical in practice, but the code should still compute `Math.min(...refs.map(r => Date.parse(r.expiresAt)))` for correctness if TTLs ever diverge).
- `accessCodeExpiresAt`: Computed by the same `#accessCodeExpiryFor(nowIso, expiresAt)` used for per-subject codes — study-day rollover boundary, clamped to not exceed `expiresAt`.

**`isAccessCodeLive` (`tokens.mjs`, line ~246):** Broaden the class check to accept `agenda_print` alongside `subject_next`. Note: this also makes bulk codes visible to `liveAccessCodes()` and `getByAccessCode()`, which is correct — they must participate in collision avoidance.

**`SEMANTICS` table (`tokens.mjs`, line ~259-320):** Add an `agenda_print` entry:

```js
agenda_print: {
  actionable: () => true,
  alreadyDone: () => false,
}
```

Same as `subject_next` — the token itself is always actionable while alive; "done" is determined by the planner at resolution time, not by the token record.

**Sessionless short-circuit (`tokens.mjs`, line ~352):** Add `agenda_print` to the list of classes that skip the `sessionState` guard, alongside `identify`, `subject_next`, and `learning_action`.

**Lifecycle:**
- Revoking or expiring a referenced `subject_next` token does not revoke the bulk token. Resolution filters dead references at read time.
- The bulk token expires on its own clock.
- Revoking the bulk token does not revoke the individual tokens — per-subject codes remain usable independently.

### 2. Minting in BuildAgenda

After all per-subject tokens and offers are collected, a second pass determines whether to mint a bulk token. This pass only runs when `this.#selfService` is truthy (the same gate that controls per-subject access codes).

**Determining printable subjects:** The offers array carries `subject`, `unitId`, `sessionId`, and `token` per subject. To determine which are printable, use the same `nextMove()` logic that `#offerFor` already calls — specifically, check whether `move.kind` produces a print action. This requires threading `move.kind` through to the offer shape (add a `moveKind` field to each offer entry). Printable move kinds: `'document'` and `'bank'` when the bank is printable (`IssueDocument.canIssueBank` — this dependency must be injected into `BuildAgenda` or the printability check must be made at offer time and stored on the offer).

**Alternative (simpler):** Rather than injecting `IssueDocument.canIssueBank` into `BuildAgenda`, store `printable: true|false` on each offer at the point where `#offerFor` already knows the move kind. The second pass then filters on `offer.printable`.

**Minting the bulk token:**

```js
const printableOffers = offers.filter(o => o.printable);
if (printableOffers.length >= 2) {
  const bulkAccessCode = mintAccessCode({ rng: this.#rng, taken: mintedCodes });
  mintedCodes.add(bulkAccessCode);
  const tokenRefs = printableOffers.map(o => o.token);
  const bulkRecord = mintToken({
    tokenClass: 'agenda_print',
    subject: { learnerId, tokenRefs },
    at: nowIso,
    rng: this.#rng,
    expiresAt,
    accessCode: bulkAccessCode,
    accessCodeExpiresAt: this.#accessCodeExpiryFor(nowIso, expiresAt),
  });
  await this.#tokens.put(bulkRecord);
}
```

Pass `bulkToken` and `bulkAccessCode` (or `null` when < 2 printable) to `agendaDocument()`.

### 3. Resolution Layer

**`ResolveAccessCode.execute({ code })` changes:**

The existing guard at line ~186-195 requires `record.subject.subject`. For `agenda_print`, `subject.subject` is absent. The guard must branch earlier on `tokenClass`:

```js
if (record.tokenClass === 'agenda_print') {
  return this.#resolveBulk(record, { now });
}
// existing subject_next path continues below
const subject = record?.subject?.subject;
if (!record || !learnerId || !subject) ...
```

**`#resolveBulk(record, { now })` — new private method:**

1. Extract `learnerId` and `tokenRefs` from `record.subject`.
2. Look up each ref via `this.#tokens.get(tokenRef)`.
3. For each ref that is still alive (`resolveTokenState` returns `'actionable'`), run the same planner-based resolution the single-subject path uses: call `planLearnerWork` once for this learner (one planner run covers all subjects), then check each subject's `servedToday` and `offeredActions` to confirm the action is `print`.
4. Collect surviving printable subjects with their titles and session info.
5. **If 0 remain:** Return a friendly all-done card (NOT `TRY_AGAIN`):
   ```js
   {
     ok: true,
     learner: learnerId,
     subject: null,
     title: null,
     bulk: true,
     items: [],
     sentence: "You're all done for today!",
     actions: [{ kind: 'exit', label: 'Go back' }],
   }
   ```
6. **If 1+ remain:** Return the bulk card:
   ```js
   {
     ok: true,
     learner: learnerId,
     subject: null,
     title: 'Print all sheets',
     bulk: true,
     items: [
       { subject: 'maths', title: 'Lesson 5: Fractions' },
       { subject: 'reading', title: 'Chapter 5' },
     ],
     sentence: null,
     actions: [
       { kind: 'print', label: 'Print all sheets' },
       { kind: 'exit', label: 'Go back' },
     ],
   }
   ```

Note: `items[].title` is the unit title (from the entry), not the `progressLabel`. The exit action is always present (matching the existing `offeredActions` contract).

**Resolution object** returned alongside the card (for `RunSelfServiceAction`):

```js
{
  kind: 'bulk_print',
  learnerId,
  refs: [
    { token: 'sch:ABC...', subject: 'maths', sessionId: 'sess_123', entry: { ... } },
    { token: 'sch:DEF...', subject: 'reading', sessionId: 'sess_456', entry: { ... } },
  ],
}
```

A new `resolution.kind` value `'bulk_print'` — `RunSelfServiceAction` branches on this.

### 4. Action Execution

**`RunSelfServiceAction.execute({ code, action })` changes:**

The existing flow at line ~242-247 refuses anything with `resolution.kind !== 'move'`. Add a branch before that guard:

```js
if (resolution.kind === 'bulk_print' && action.kind === 'print') {
  return this.#bulkPrint(resolution);
}
```

**`#bulkPrint(resolution)` — new private method:**

For each ref in `resolution.refs`:
1. Call `ensureSession({ entry: ref.entry })` to get a real session ID (the ref's `sessionId` may be null/synthetic — `ensureSession` is the authority, per the file's own Rule 1).
2. Call `IssueDocument.execute({ sessionId })`.
3. Collect the result.

**Outcome aggregation** (full `IssueDocument` status vocabulary):

| Scenario | Outcome | Sentence |
|----------|---------|----------|
| All `issued` or `reprinted` | `done` | "{n} sheets printed." |
| Some succeeded, some `debounced` | `done` | "{n} sheets printed." (debounced ones were already in flight) |
| Some succeeded, some failed (`print_failed`, `render_failed`, `unavailable`) | `done` | "{success} of {total} sheets printed — {fail} could not print." |
| All `debounced` | `debounced` | "They're already on the way — give it a minute." |
| All failed | `failed` | "The printer did not answer. Try that again in a minute." |
| All `already_done` | `refused` | "Those are all finished." |

The effect carries `{ results: [{ subject, status, artifactId, pageCount }] }` for logging/debugging.

**Why `debounced` maps to `done` in the mixed case:** A bulk tap shortly after an individual print hits `debounced` for one subject and `issued` for the rest. The child should see "Did it print?" — the debounced sheet is already printing.

### 5. Scan-Path Resolution

The printed QR carries the `agenda_print` token. When a parent scans it, it goes through `ResolveScanAction` (not `ResolveAccessCode`).

**`ResolveScanAction` changes:** Add a branch for `tokenClass === 'agenda_print'` that runs the same planner-based resolution as `#resolveBulk` above, then fans out to `IssueDocument` for each printable subject. The scan path prints immediately (no launch card — the parent scanning is the authorization).

**If all subjects are already done:** The scan resolves to a friendly "all done" receipt rather than an error.

### 6. Receipt Layout

**Per-subject cards:** Unchanged. Each subject section renders a `scan_action` block (QR) followed by `panelCodeBlocks` (6-digit code as text).

**Bulk-print card (new, at the bottom):** After all per-subject sections, `agendaDocument()` appends a new block group.

**Block validation (`blocks.mjs`):** Add `'bulk_print'` to the allowed `presentation` values for `scan_action` blocks. Add a validator for the `subjects` array field (array of non-empty strings).

The `scan_action` block shape:

```js
{
  type: 'scan_action',
  action: bulkToken,
  presentation: 'bulk_print',
  label: 'Print all sheets',
  hideCode: true,
  subjects: ['maths', 'reading', 'science'],
}
```

Followed by `panelCodeBlocks(bulkAccessCode)`.

**Visual treatment for `bulk_print` presentation in `DocumentReceiptRenderer`:**

New branch in `actionOp` (alongside the existing `presentation === 'lesson'` branch at line ~214):
- A horizontal rule or extra gap separates it from the last per-subject card.
- No subject icon. A heading line: "PRINT ALL SHEETS".
- A compact list of the subject names included in the batch.
- The QR code (same 132px area).
- The 6-digit code beneath via `panelCodeBlocks`.

**`DocumentEscPosRenderer`:** Handle `bulk_print` in the `scan_action` branch — heading text, subject list as text items, then the QR/barcode item.

**Conditional emission:** The bulk block is only emitted when `BuildAgenda` passes a `bulkToken` and `bulkAccessCode`, which only happens when 2+ printable subjects exist.

### 7. Launch Card Frontend

**`LaunchCard.jsx`** gains a bulk variant, triggered by `card.bulk === true`.

**Bulk card view:**
- **Title:** "Print all sheets" (from `card.title`).
- **Subject list:** Each `card.items` entry rendered as a line — subject name and unit title. Compact, read-only, no per-item buttons.
- **Action buttons:** Rendered from `card.actions` as usual. The bulk card includes `{ kind: 'print', label: 'Print all sheets' }` and `{ kind: 'exit', label: 'Go back' }`. No synthesised exit needed — the backend includes it.
- **All-done variant:** When `card.items` is empty and `card.sentence` is present ("You're all done for today!"), the card shows the sentence and exit button only.

**Confirm and sentence views:** Unchanged. After the bulk print fires:
- `outcome: 'done'` → "Did it print?" confirm flow.
- `outcome: 'failed'` → sentence + Done button.
- `outcome: 'debounced'` → sentence + Done button.
- `outcome: 'refused'` (all already done) → sentence + Done button.
- Confirm "No" → `useSelfService` re-resolves the bulk code. On re-resolve, already-printed subjects may now be `debounced` or `already_done`, so the card may show fewer items or the all-done variant.

**CSS:** A `school-selfservice-card--bulk` modifier on the root when `card.bulk`. The item list uses `school-selfservice-card__items` with `school-selfservice-card__item` children.

**`useSelfService` changes:**
- `code.resolved` log: `subject` will be `null` for bulk cards. This is fine — the log already tolerates null subjects.
- `claim(learnerId)`: Works unchanged — `card.learner` is present on the bulk card.
- No new branches needed in the hook itself.

### 8. Logging

New structured log events:

| Event | Layer | When |
|-------|-------|------|
| `agenda.bulk-print.minted` | BuildAgenda | Bulk token + code minted. Data: `{ learnerId, tokenRefCount, subjects, accessCode }` |
| `agenda.bulk-print.skipped` | BuildAgenda | < 2 printable subjects. Data: `{ learnerId, printableCount }` |
| `selfservice.bulk.resolved` | ResolveAccessCode | Bulk code resolved. Data: `{ learnerId, liveRefCount, totalRefCount }` |
| `selfservice.bulk.exhausted` | ResolveAccessCode | All refs dead/done — all-done card returned. Data: `{ learnerId }` |
| `selfservice.bulk.print.start` | RunSelfServiceAction | Fan-out starting. Data: `{ learnerId, refCount }` |
| `selfservice.bulk.print.ref` | RunSelfServiceAction | Per-ref result. Data: `{ subject, status, artifactId }` |
| `selfservice.bulk.print.done` | RunSelfServiceAction | Fan-out complete. Data: `{ succeeded, failed, debounced, outcome }` |

### 9. Error Handling

**Single-ref failure during fan-out:** If one `IssueDocument.execute()` throws (not a status, an actual exception), catch it, log it as `selfservice.bulk.print.ref` with `status: 'error'`, and continue with the remaining refs. The aggregated outcome treats it as a failure for that subject.

**Registry lookup failure:** If `this.#tokens.get(tokenRef)` throws during resolution, the entire bulk resolve falls back to `NOT_ANSWERING` ("The school computer isn't answering. Tell a grown-up.") — same as any other backend fault.

**Concurrent bulk taps:** Two devices typing the same bulk code concurrently. Each fan-out calls `ensureSession` per subject, which is idempotent (returns the existing session). Each then calls `IssueDocument`, which has its own debounce. The second tap's subjects hit `debounced` status — mapped to `done` in the mixed case, or `debounced` if all are debounced. No duplicate paper.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/2_domains/school/sessions/tokens.mjs` | Add `agenda_print` to `TOKEN_CLASSES`; new subject validation branch (learnerId + tokenRefs); broaden access-code whitelist; add `SEMANTICS` entry; add to sessionless short-circuit; update `isAccessCodeLive` class check |
| `backend/src/2_domains/school/documents/blocks.mjs` | Add `'bulk_print'` to allowed `scan_action` presentations; validate `subjects` array field |
| `backend/src/3_applications/school/usecases/BuildAgenda.mjs` | Store `printable` flag on each offer; second pass: filter printable, mint `agenda_print` token + access code if 2+ qualify; pass `bulkToken`/`bulkAccessCode` to `agendaDocument()` |
| `backend/src/2_domains/school/documents/receipts.mjs` | `agendaDocument()` accepts `bulkToken`/`bulkAccessCode`; emits `bulk_print` scan_action block + panel code blocks at the end |
| `backend/src/3_applications/school/usecases/ResolveAccessCode.mjs` | Early branch on `agenda_print` tokenClass before the `subject.subject` guard; new `#resolveBulk` method with planner-based filtering; friendly all-done card for exhausted refs |
| `backend/src/3_applications/school/usecases/RunSelfServiceAction.mjs` | New `resolution.kind: 'bulk_print'` branch before the `move`-only guard; `#bulkPrint` method with per-ref `ensureSession` + `IssueDocument` fan-out; full outcome aggregation table |
| `backend/src/3_applications/school/usecases/ResolveScanAction.mjs` | Branch for `agenda_print` tokenClass; planner-based resolution + immediate print fan-out |
| `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs` | New branch in `actionOp` for `bulk_print` presentation: separator, heading, subject list, QR |
| `backend/src/1_rendering/school/documents/DocumentEscPosRenderer.mjs` | Handle `bulk_print` presentation in text fallback |
| `frontend/src/modules/School/selfService/LaunchCard.jsx` | Bulk variant: render `card.items` list when `card.bulk`, `--bulk` CSS modifier, all-done variant |
| `frontend/src/modules/School/School.scss` | Styles for `school-selfservice-card--bulk`, `__items`, `__item` |
