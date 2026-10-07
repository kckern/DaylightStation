# Independent scoped fix review

Read-only inspection of the current korean-full worktree, the prior final review, enrollment CLI/helper and regressions, CardLadderSittingService access/pool paths and appended regressions, and the generated teacher guide. No tests, live writes, or checkout edits were performed.

## Approved fixes

- Enrollment preservation now recognizes only an exact durable existing record before narrow service validation. Changed records invoke the normal validator or explicitly fail when no validator exists; new unknown program IDs still fail in SetAssignments. The final store wrapper also checks preservation and concurrent assignment changes.
- The importer reads the real curriculum catalog for existing linked enrollments. The mixed-enrollment CLI regression covers an unrelated linked deck, language-reels, rubiks-cube, preservation, and refusal of a mismatched old linkage.
- Existing sitting operations now check current assignment and course readiness through #context. courseEvidence retains its assignment-only read path, avoiding access/evidence recursion; the new pool filter preserves learned status.
- Unit 1 grammar/source/register notes are present in both the guide generator and docs/reference/school/korean-3-2.md.

## Important residual finding

**Touched shared rounds bypass a later lesson lock through another allowed deck.** CardLadderSittingService.mjs:230–246 filters only the new-card pool; open at lines 589–597 passes the existing package day into openDay. In cardLadder/engine.mjs:64–65, an active round is discarded only when untouched. All sixteen decks share the package day. Reproducer by code path: open Lesson 2 while allowed; answer its first intro step so its round is touched; relock Lesson 2 through a prerequisite correction or pause; open the allowed Lesson 1 deck. The touched Lesson 2 round survives and currentItem continues serving its remaining unseen cards. #context:395 checks the Lesson 1 sitting's deck, so subsequent answers also pass authorization. This remains an introduction/mutation bypass, despite the direct Lesson 2 sitting now being refused.

Repair the shared active-round path as well as future planning: hold/remove unauthorized pending introductions without erasing completed item evidence or learned status, or reject serving/responding to such an item until its owning course permits it. Add a cross-deck regression with a touched round, a relock, and remaining unseen cards. The current pool regression starts from decksSeen/status only and therefore does not exercise this path.

## Verdict

**With fixes.** Enrollment compatibility and guide findings are resolved. The shared touched-round bypass remains Important. No Critical issues identified in this scoped pass.

Declined to judge: wider course content, media, physical hardware, and rollout state, all outside this scoped fix review.

## Final scoped re-review — residual fix

Inspected the added #deferUnavailableIntroductions reconciliation and its execution before openDay in both open and #context, plus the two cross-deck regressions (new allowed-deck sitting and resuming a prior allowed-deck sitting).

The residual bypass is resolved: the active introduction round now removes only still-new cards absent from the current eligible pool, adjusts the introduction cursor, and resumes introduced work or settles the round. Existing status and answered day.items are preserved. The tests explicitly retain the first card's learned state and response evidence, traverse the remaining work, and assert that the locked unseen card is never served or introduced. The direct locked-sitting guard and assignment-only courseEvidence path remain intact.

**Final verdict: Approved for this scoped fix review. No remaining Critical or Important findings identified.** This supersedes the earlier with-fixes verdict above. The reported 88 passing service tests are executor evidence; I did not rerun tests or perform live writes.
