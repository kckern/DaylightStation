# A session can be permanently unprintable: "already issued" + "doesn't exist"

**Date:** 2026-08-25
**Severity:** High — a dead end with no recovery, hit by a child mid-lesson
**Status:** diagnosed; fix specified, not yet implemented
**Surface:** `backend/src/3_applications/school/usecases/IssueDocument.mjs`

Learner referred to as **F\*\*\*\***.

---

## What happened

12:00–12:03 local. F\*\*\*\* scanned his card, got an agenda, typed his panel code, and pressed
print. The panel told him the sheet was already issued. He tried again and was told the worksheet
does not exist. He could not proceed, and there was no path forward from either message.

Verbatim from the log store:

| Local | Event |
|---|---|
| 12:00:57.031 | `omr.ingest.nfc` uid `048BA600CC2A81` — single clean tap |
| 12:01:02.934 | `thermalPrinter.job.complete` — 66,683 B, drain 1820 ms |
| 12:01:02.941 | `school.card.agenda-printed { offers: 2, created: 1 }` ✅ |
| 12:01:48.326 | `school.selfservice.code.resolved { state: "issued", subject: civilization, unitId: atlas-us-p012-midwest }` |
| 12:01:48.327 | `school.session.stale-resume { ageDays: 2, firstIssuedAt: '2026-08-23T18:59:58.790Z', sessionId: ses_GxBZiBqG }` |
| 12:01:52.307 | `school.issue.exact-artifact-unavailable { artifactId: 'civilization/young-peoples-atlas-us/ws-ses-gxbzibqg' }` |
| 12:01:52.309 | `school.selfservice.action.use-case-failed` — *"The original worksheet was not retained, so we cannot print a substitute as though it were the same sheet."* |
| 12:02:26 → 12:02:30 | He tried the whole sequence again. Identical failure. |

**The two messages are individually true and jointly a trap.** The session really did issue a sheet
(on 2026-08-23). The artifact really is gone. Nothing reconciles them.

---

## Root cause

`IssueDocument.mjs:302-303`:

```js
if (state.issuedArtifacts.length > 0) {
  return this.#reprintExact({ sessionId, nowIso, state });
}
```

**Any session that has ever issued an artifact is routed to exact-reprint, unconditionally, as the
only option.** `#reprintExact` then hard-fails when the bytes are absent (`:403-411`):

```js
const retained = await this.#issuedArtifacts?.get?.(artifactId) ?? null;
if (!retained) {
  this.#logger.warn?.('school.issue.exact-artifact-unavailable', { … });
  return this.#unavailable(sessionId, 'original-unavailable',
    'The original worksheet was not retained, so we cannot print a substitute as though it were the same sheet.');
}
```

There is no fallback to issuing a fresh sheet. The session is permanently unprintable.

**The integrity rule is right; the routing is wrong.** Refusing to pass a substitute off *as the
original* is correct — that guarantee protects grading. But `issuedArtifacts.length > 0` means
*"this session issued something once,"* not *"a reprintable copy exists."* Those diverge the moment
retention is absent, and the code treats them as synonyms.

### Why this artifact is missing

The retention store is real and working. `YamlIssuedArtifactStore` (`#root()` =
`school/artifacts/issued`) currently holds:

```
civilization%2Fyoung-peoples-atlas-us%2Fws-ses-eveclakh.pdf   Aug 25 08:13   30,020 B
receipt%2Fses_eveClAKh%2Fout%3Ases_eveClAKh.png               Aug 25 09:31   86,481 B
scripture%2Fcome-follow-me-ot-2026%2Fws-ses-f1ejjs0u.pdf      Aug 25 12:03   30,167 B
```

**Every retained artifact dates from 2026-08-25.** Nothing from 08-23 exists. F\*\*\*\*'s session
was issued on 08-23, before retention was capturing worksheets — so his `issued` event names an
artifact that was never stored.

Note the separate directory tree `school/artifacts/print/documents/**` holds `document.yml` +
`answers.yml` per revision (9 of them, including `ws-ses-gxbzibqg/310bf29fb/`). **That is a
different store.** The *content* of F\*\*\*\*'s worksheet still exists there; only the rendered PDF
is missing. This matters for the fix — a fresh sheet can be regenerated from the retained document.

### Blast radius

Any session whose `issued` event predates artifact retention — or whose retention ever failed — is
permanently unprintable on resume. This is not specific to one learner or one course. It is latent
in every session old enough to predate the store, and it surfaces exactly when a child returns to
finish earlier work.

---

## Relationship to the morning's incident

Same family, opposite direction. This morning the printer reported success for paper that never
came out; here the system reports an issuance whose artifact never persisted. Both are the system
**trusting a record instead of the artifact**, and both strand a child holding nothing.

It is also the same principle the agenda-integrity spec is built on: *a surface that names work must
be able to hand it over.* Here the panel names a worksheet it cannot produce.

---

## Fix

**When the exact artifact is unavailable, issue a fresh sheet — clearly labeled as a replacement —
instead of refusing.**

1. In `#reprintExact`, on `!retained`, do not return `#unavailable`. Fall through to the normal issue
   path, passing a flag that marks the result a **replacement**, not a reprint.
2. The printed sheet must say so. A replacement is not the original, and the grading path must record
   it as a new issuance (new `artifactId`, new `issued` event) so the audit trail stays honest. This
   preserves the integrity rule — we never claim a substitute *is* the original — while removing the
   dead end.
3. Regenerate from the retained `document.yml` under `artifacts/print/documents/**` when present, so
   the child gets the *same questions*, not a different variant. Only when that is also missing
   should a fresh variant be issued, and the sheet should say that too.
4. Log the substitution at `warn` with the old and new artifact ids — a replacement is a real event a
   teacher may need to see when reconciling a gradebook.

### Guardrail

Never let a `state.issuedArtifacts.length > 0` check stand in for "a reprintable copy exists." The
condition to branch on is whether `issuedArtifacts.get(artifactId)` actually returns bytes.

---

## Tests

1. A session with an `issued` event whose artifact is **absent** produces a printed replacement, not
   `status: 'unavailable'`. Fails against current code — this is the regression net.
2. The replacement carries a **new** `artifactId` and appends a new `issued` event.
3. When the retained `document.yml` exists, the replacement contains the **same questions** as the
   original revision.
4. A session whose artifact **is** retained still takes the exact-reprint path unchanged (no
   behavioural change to the healthy case).
5. The substitution is logged at `warn` with both artifact ids.
6. The printed document states it is a replacement.

---

## Incidental findings

- **Scripture prints end to end.** `scripture/come-follow-me-ot-2026/ws-ses-f1ejjs0u.pdf` was
  retained at 12:03, after this morning's re-enrollment. The course now works from agenda through
  panel code to paper.
- **`school.session.stale-resume { ageDays: 2 }`** already fires for exactly this case. The system
  knows the session is stale and resumes it anyway. Worth deciding separately whether a session
  older than N days should be resumed at all, or closed out and re-offered fresh — that would have
  prevented this independently.
- **`school.language-reels.daily-none-approved`** for F\*\*\*\* still fires every 5 minutes. Left
  from the earlier noise findings; unrelated to this bug.

---

# Addendum — two further defects on the first successful scripture print

Reported 2026-08-25 ~12:05 local, on the worksheet that finally printed
(`scripture/come-follow-me-ot-2026/ws-ses-f1ejjs0u`).

## A. The sheet's questions are numbered by CARD ROW, not by question

**Observed:** the printed worksheet "started at question number seven instead of question number
one," and the student number was unfamiliar.

**Both are explained by the issued manifest** (`artifacts/issued/scripture%2F…ws-ses-f1ejjs0u.yml`):

```yaml
allocation:
  cardId: '2487270'
  recordId: scripture/come-follow-me-ot-2026/ws-ses-f1ejjs0u@9cf9b849b:v0:7-11
  rowRange: { start: 7, end: 11 }
```

The document itself numbers its questions correctly — `number: 1` … `number: 5`
(`document.yml:31,49,67,85,103`). But the OMR bubbles occupy **card rows 7–11**, because rows 1–6 of
card `2487270` were already consumed by an earlier worksheet. `planRows`
(`allocation.mjs:151,195`) assigns `row: startRow + index`, and the sheet prints the **row**.

So the child reads "7, 8, 9, 10, 11" on a five-question worksheet whose own numbering is 1–5.

**`cardId: '2487270'` is not a student number.** It identifies the physical OMR card, and a new card
mints a new id. The expectation that it identifies the learner is reasonable and the sheet should
not present it in a way that invites that reading.

**This is a design collision, not a coding error.** One physical card carries several worksheets'
row ranges so cards aren't wasted; the bubble genuinely must be at row 7. But "question number" and
"bubble row" are then two different things wearing one label.

Three ways out, and the choice is the household's:

1. **Print both** — question number prominent ("Question 1"), bubble row as a small cue beside the
   bubble ("row 7"). Keeps card reuse, removes the ambiguity. Most paper-efficient.
2. **Always allocate from row 1 of a fresh card per worksheet.** Row and question number always
   coincide; nothing to explain. Costs a card per worksheet.
3. **Renumber the printed questions to match the rows** (start the sheet at 7). Internally
   consistent, but a five-question worksheet labelled 7–11 reads as though six questions are
   missing.

Recommendation: **(1)**. It preserves the existing card economics and fixes the confusion where it
actually lives — the label, not the allocator. It also keeps `recordId`'s `:7-11` meaningful for
scanning.

Separately, `cardId` should be labelled on the sheet as a card/sheet id, never adjacent to the
learner's name where it reads as a student number.

## B. "Unit 0" on the agenda — fixed in the repo, NOT deployed

**Observed:** the agenda printed "unit zero."

Two distinct issues:

**B1 — the off-by-one is already fixed but not shipped.** `BuildAgenda` rendered
`Unit ${moduleIndex}` straight from `moduleOrder.indexOf()`, which is zero-based, while
`lessonIndex + 1` in the same template was one-based. Fixed 2026-08-25 in commits `c74c13bc2`
(progressLabel) and `f997c0fae` (the sibling taxonomy label), both now sharing one
`moduleOrdinal()` helper so they cannot drift apart again.

**The container is running commit `11c42760`, built 00:07 PDT — before any of today's work.**
Nothing fixed today is live. This is why the defect is still visible.

**B2 — the ordinal is the wrong number anyway.** Even fixed, `moduleOrder.indexOf() + 1` yields the
module's **position within the enrollment** (w35 → 1). The requirement is that units read as **week
numbers**: week 35 is `sequence: 35` on the module's own `_index.yml`.

So the label should read `Unit 35` (or better, the module's own title, `Aug 24–30 · Psalms 49–86`),
not `Unit 1`.

**Do not derive it from the module id.** `w35-aug24` looks parseable, but taking `35` out of an
identifier is the brittleness rejected earlier in this investigation. `sequence` is explicit data on
the module unit; read it.

**Open, needs verification before implementing:** the enrollment carries `moduleOrder` as bare ids
and does not carry `sequence`. Confirm whether the module unit (`moduleRole: module`) is present in
`BuildAgenda`'s `unitsById` catalog — if it is, `unitsById.get(entry.module)?.sequence` is the
lookup. If it is not, the module's `sequence` must be threaded into the enrollment at
materialization time, which is a larger change and should be its own task.
