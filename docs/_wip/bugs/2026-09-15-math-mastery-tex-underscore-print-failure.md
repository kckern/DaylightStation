# 2026-09-15 — Math mastery worksheet failed to print; answer card burned two ranges and rolled over

## What the child saw

At 07:19 PDT a learner scanned the agenda card at the Portal and asked for all
four sheets. Civilization, scripture and science printed. Math came back
"We could not make that sheet. Tell a grown-up, then scan the ticket below."
Two retries (07:21, 07:22) failed identically.

## Root cause (content)

`scripts/school/elementary-math-mastery.mjs` authored two prompts as
`'What comes next? $230, 240, 250, \_\_\_$'` inside a JavaScript
single-quoted string. JavaScript drops the backslash of an unrecognised
escape, so the generated bank held `$230, 240, 250, ___$`; MathJax reads a
bare `_` in math mode as a subscript and refused with
`Missing open brace for subscript`. A third prompt in
`scripts/generate-elementary-math-course.mjs` (`125, 150, 175, 200, ___`)
had the same bug. A throwaway scan of every generated bank (343 files, 579
inline TeX segments) found exactly these three.

The skip-counting unit that printed fine on 9/11 writes its blanks as plain
text with no `$`.

## Root cause (ledger)

`IssueDocument` publishes, then `RenderPrintDocument` allocates card rows
**before** measuring/rendering (the record is the numbering truth). A render
failure orphans the allocation (`release` → `status: released`,
`deliveryState: cancelled`), but `cardOccupiedThrough` counted every record's
`rowRange.end` regardless of delivery, so released rows were never reused.
Three attempts on card `5278294`: rows 22-27 dead, the three good sheets at
28-33 / 34-36 / 37-42, rows 43-48 dead, and the third attempt (43+6 > 50)
rolled the card over to `1007998`, whose only record is also cancelled.

## Fixes

| Piece | Change |
|---|---|
| Content | The three escapes are `\\_` in JS. The two affected bank files were regenerated on the host, diffed against the live tree (only the intended prompt lines differed) and shipped into the data volume. |
| Guard, generator | `auditElementaryMathBank` runs `lintTex` over every item; a regenerated course cannot carry a non-rendering segment. |
| Guard, runtime | `PublishPrintDocument` takes an optional `texLint`; the composition root wires `lintTex`. Publish precedes allocation, so a bad segment is refused before the ledger. `IssueDocument` catches the refusal as a `stage: publish` render failure (session `failed` event, recovery ticket, same sentence) instead of letting it climb to the router's generic net. `inlineGrammar.mjs` shares the `$…$` grammar between `measure.mjs` and the lint; a drift-guard test compares the two. |
| Ledger | `cardOccupiedThrough` ignores `deliveryState: cancelled` records; `allocateNext` re-arms a cancelled record of the identical render context in place instead of appending a duplicate `recordId`. `describeCard` uses the same rule. |
| Docs | `print-documents.md` §3 (TeX pre-flight) and §5 (reclaim invariant); school runbook entry. |

## Making the learner whole

The failed session never persisted a worksheet instance (that happens after a
successful print), so after the bank fix and a container restart (banks are
cached in memory) the next print builds a fresh instance from the corrected
bank at a new content-hash revision. With the reclaim rule the sheet lands on
rows 43-48 of card `5278294`, the card in the learner's hands. Rows 22-27
stay a gap: allocation never returns below a delivered range. Card `1007998`
is an inert ledger file (no non-cancelled record, so never a learner card).

**Verified 2026-09-15 08:56 PDT, after deploy of 064363d17:** the print action
was fired with the day's math code; `laser-printer.job-outcome` reported job
1369 `completed`, one impression; the ledger for card `5278294` gained
`…@c3d955d8f:v0:43-48` (`delivered`, `live`) beside the two cancelled records;
the session record's events read `created, failed ×3, issued`; the persisted
worksheet instance carries `\_\_\_`.

## Not changed

The generator's repo copy of `em23-07-90-problem-solving-challenge` carries
a scrubbed placeholder name where the live bank has the child's name (PII
guard). That file was deliberately not shipped.
