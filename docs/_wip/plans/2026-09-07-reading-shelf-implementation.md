# Reading Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Status:** Implementation complete; final release checks recorded in the [acceptance audit](../audits/2026-09-07-reading-shelf-experience.md).

**Goal:** Reduce reading-flow taps, retain recent accomplishments, identify rereads, and show optional reading credit independently from Story time.

**Architecture:** Keep the shelf as the persistent reading workspace. Use persisted book evidence for an additive day-digest projection and refresh the board after successful writes. Preserve authorization and existing required-program completion semantics.

**Tech Stack:** React, SCSS design tokens, Node ES modules, YAML persistence, Vitest and Playwright.

**Spec:** `docs/_wip/plans/2026-09-07-reading-shelf-experience-design.md`

## Global Constraints

- Preserve server-side code validation, signed learner grants, and ownership checks.
- Legitimate rereads must remain possible, including on the same day.
- Preserve all existing reading records. This work does not merge or delete the two observed entries.
- Supplemental circles do not change required totals, completed-required counts, daily-completion gates, or the **Done for the day** state.
- Story time never absorbs book-log credit.
- Keep the board noninteractive and static.
- Use the effective finish date for **Last finished ...** and day attribution.
- Legacy records without recording time display date-only context; do not infer precise times or require a historical migration.
- Perform write-based verification with isolated test learners/data rather than modifying production reading records.
- Follow CLAUDE.md; use structured logging and existing icons/tokens. Update related reference docs with code. No new dependencies.
- Work only in the reading-shelf-experience worktree. Each task owns its listed files and associated tests/docs; do not commit unrelated changes. The controller handles integration and deployment.

## File responsibilities and execution order

1. Backend evidence and recording metadata: domain projection, teacher day integration, composition wiring, post-save invalidation.
2. Shelf UI: add/update tasks, recent shelf, inline feedback, reread context, focused pad/date views, and stylesheet.
3. Entry and board: self-service direct launch and identity decision; supplemental board model and refresh.
4. Scanned book entry: existing barcode book handler, Portal wake/pending intent, learner selection and seeded shelf entry.
5. Browser verification: update the existing disposable reading-flow harness, add full-flow assertions, inspect screenshots and fix integration issues.

### Task 1: Persisted reading activity and recording time

**Files:**
- Create: `backend/src/2_domains/school/readingActivity.mjs` and `.test.mjs`.
- Modify: `backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs` and tests.
- Modify: `backend/src/3_applications/school/usecases/GetTeacherToday.mjs` and tests.
- Modify: `backend/src/4_api/v1/routers/schoolBooks.mjs` and tests, `backend/src/app.mjs`, and composition wiring as needed.
- Reference: `backend/src/2_domains/school/bookShelf.mjs`, `usecases/GetBookShelf.mjs`, `usecases/OpenBookShelfItem.mjs`, `usecases/RecordBookProgress.mjs`.
- Docs: `docs/reference/school/agenda-and-completion.md` (backend evidence subsection).

**Interfaces:**
- Produce `projectReadingActivity(items, { studyDay, dayOf })` returning `{ studyDay, hasActivity, progressCount, finishedCount, bookCount }`. Pure function; all time interpretation injected.
- Add `readingActivity` to each v2 teacher-day learner row: projection plus `status: 'ok'`; on unavailable/unreadable store use `{ status: 'unavailable', studyDay, hasActivity: null }` and log an actual read failure. Inject optional `bookLog` into GetTeacherToday and wire the real lifecycle store in app composition. Leave v1 contracts unchanged.
- Add server-generated `recordedAt` to newly persisted book events, including start events. Do not overwrite timestamps when an entryId retry returns an existing event. Do not accept a client-supplied recording timestamp. Existing event arrays already travel through GetBookShelf.
- School bus payload after persisted mutation: `{ event: 'book-log-changed', learnerId }`. Inject a narrow `onBookLogChanged` callback at the router/composition seam; do not import a generic event bus into application/domain code. Notification failure must not turn a saved write into a failed response. Scope identity to the verified grant. Board consumers will reread, so broad learner invalidation covers Undo/backdates.

- [x] Write RED tests for unenrolled progress/check-in/finish, started-only, multiple writes collapsed to one activity, selected day boundaries, backdated finish, finish followed by reopened (undo), preserved independent progress, and legacy records. Example:
  ```js
  expect(projectReadingActivity([{bookId: 'b', events: [
    {kind: 'started', at: '2026-09-07T15:00:00Z'},
    {kind: 'finished', at: '2026-09-07T12:00:00Z'},
    {kind: 'reopened', at: '2026-09-08T15:00:00Z'},
  ]}], { studyDay: '2026-09-07', dayOf: iso => iso.slice(0, 10) }).hasActivity).toBe(false);
  ```
  Use append order to resolve finished/reopened history, not lexical `at` sorting, because effective finish dates can precede actual creation. A subsequent set-aside does not undo a legitimate finish; only the undo/reopened relationship does. Deduplicate by event identity when present; distinct reread records remain distinct evidence. Validate progress according to existing domain evidence semantics.
- [x] Run the domain test before implementation with `npx vitest run backend/src/2_domains/school/readingActivity.test.mjs --maxWorkers=2` and record expected failure.
- [x] Implement the pure projection and wire a once-per-learner log read into v2 day rows. Use the requested study day and the same timezone/boundary used by GetTeacherToday. No enrollment or catalog lookup is necessary to acknowledge activity.
  ```js
  const activity = projectReadingActivity(items, {
    studyDay: selectedStudyDay,
    dayOf: iso => studyDayForInstant(Date.parse(iso), {
      timezone: this.#timezone, boundaryHour: this.#boundaryHour,
    }),
  });
  // v2 learner row: readingActivity: { status: 'ok', ...activity }
  ```
- [x] Add RED tests for original recordedAt surviving retry, distinct intentional opens, grant-scoped notifications, notification-after-success ordering, rejected writes producing no notification, and notification failure leaving a saved result successful. Implement within current persistence/write seams, retaining existing entryId deduplication.
- [x] Run changed domain/store/teacher-day/router tests plus OpenBookShelfItem, RecordBookProgress, GetBookShelf, and composition-contract tests. Update docs, self-review, commit scoped changes, and report RED/GREEN evidence and exact interfaces delivered.

### Task 2: Shelf-centered add, progress, finish, and reread experience

**Files:**
- Modify: `frontend/src/modules/School/books/{BookShelf,AddBook,UpdateBook,DayPicker,SaveReceipt,ShelfTile,History}.jsx`, `useBookShelf.js`, presentation helpers and tests.
- Create small local helper/component files in `books/` if useful for completed-book details, inline feedback, and prior-read projection; keep the hook focused rather than duplicating logic.
- Modify: reading-only rules in `frontend/src/modules/School/School.scss`.
- Docs: create `docs/reference/school/reading-shelf.md` and link it from School README.

**Interfaces:**
- Consume existing shelf fields: `items[].events` including optional new `recordedAt`, `projection`, book facts, `studyDay`, `earliestFinishDay` and obligation. Do not require timestamp presence for old records.
- Retain BookShelf public props `{ learnerId, grant, idleTimeoutSeconds, onExit }`.
- Keep existing schoolApi shelf/write methods and idempotency IDs. No frontend-only reading-credit counters.
- Task 3 changes launch and board; this task owns only reading UI and its stylesheet portion.

- [x] Add/update RED component and hook tests for direct ISBN on initial truly empty records, finished-only shelf, combined cover/actions, wrong-book correction, inline post-save receipt, one-tap finish, completed detail/reread, retry, and read-after-write failure. Example behavior assertions:
  ```jsx
  expect(screen.getByRole('button', {name: 'Finished today'})).toBeVisible();
  expect(screen.getByRole('button', {name: 'Update page'})).toBeVisible();
  expect(screen.queryByTestId('number-pad')).not.toBeInTheDocument();
  // After saving: shelf remains rendered, recent finish and Undo are visible.
  ```
  Inspect NumberPad's actual test ID before using it. Use real hook tests with mocked transport, not only mocked component callbacks, for write counts and state transitions.
- [x] Run targeted changed tests and record intended RED failures. Implement initial empty-shelf routing only on the initial successful load, not after explicit Back or every read.
- [x] Combine ISBN cover and action choice. Allocate write identities before the first write and retain them across retries. Provide Start reading / Update page / Finished today and Finished on another day; existing active/unread matches open the existing item. Prior finished matches show date-only last-finished context (plus separately labeled trustworthy recording time if present), use Read again, and permit same-day rereads without an extra dialog.
  ```js
  // The selected action accepts the displayed book; no cover-confirm step.
  // Existing active item => enterUpdate(existing).
  // New/reread => choose('starting'|'partway'|'finished') with stable operation IDs.
  ```
- [x] Make UpdateBook start with compact details and side-by-side illustrated progress/finish actions. Show the pad only in a progress task. Check mode saves its check-in directly; minutes gets Save minutes. Date picker names the actual save action/date, preserves allowed-day limits, and is only needed for an alternate date.
- [x] Return to shelf after persisted saves with inline result and Undo. Preserve receipt item ID independently of current update selection so Undo targets the right finish. On post-write read failure retain success and offer read retry rather than encouraging a repeated write; preserve typed values for actual write failures. Prevent late responses after close/learner change and double-tap writes. All input activity must rearm idle closure.
- [x] Render Reading now and Recently finished rows, active/unread and finished respectively, with cover/title/progress/date information, recent finish ordering, and See all history. A compact finished-only shelf must still show useful books. Completed tiles open completed details with Read again, not the active finish action. Legacy dates never masquerade as exact save times. Use existing book icons and SCSS tokens; no board animation.
- [x] Run `npx vitest run frontend/src/modules/School/books --maxWorkers=2`, preserving coverage for wrong ISBN, missing metadata, active duplicates, backdates, keyboard/scanner, and idempotency. Update docs, self-review, commit only this task's changes, report exact UI labels and state decisions for downstream browser tests.

### Task 3: Direct reading launch and separate agenda acknowledgment

**Files:**
- Modify: `frontend/src/modules/School/selfService/useSelfService.js`, `LaunchCard.jsx`, and relevant tests.
- Modify: `frontend/src/modules/School/status/{AgendaStatusBoard.jsx,agendaStatusModel.js}` and tests.
- Modify: `frontend/src/modules/School/SchoolApp.jsx` only if needed to refresh a still-mounted board after shelf exit; use existing lifecycle or a narrow refresh signal.
- Modify: board-only styles in `frontend/src/modules/School/School.scss` if needed.
- Docs: update `docs/reference/school/reading-shelf.md` and `agenda-and-completion.md` for entry/board behavior.

**Interfaces:**
- Consume `teacherDay(...).data.learners[].readingActivity` as defined in Task 1.
- Consume School event `{ event: 'book-log-changed', learnerId }`, rereading without filtering it to today's timestamp (undo/backdate can affect another day).
- Extend `summarize(sections, sessions, entries = [], readingActivity = null)` with supplemental segment data. Keep `total`/`done` based on required/existing assignment semantics. Add optional `{ supplemental: true, programId: 'book-log', label: 'Reading', state: 'passed', unitId: 'book-log:activity:<day>' }` segment; do not identify reading solely by subject.
- BookShelf public props remain unchanged except an optional narrow parent refresh callback if required; coordinate with controller if that seam is needed.

- [x] RED tests: server-authorized matching profile enters book-log directly; identity-needed displays Open <name>'s books and one click launches; deny launches nothing; unrelated program/print flows unchanged. Use the real runAction path and server-issued book grant; no synthesized grant.
- [x] Implement direct launch only for the reading program action (target book-log), retaining server identity requirement. Avoid stale closures/card state: pass the resolved code/card to the launch action or schedule the direct action once after its authoritative state is installed, guarded against duplicate dispatch. Reject stale responses on exit.
  ```js
  const readingAction = card.actions?.find(a => a.kind === 'program' && a.target === 'book-log');
  // If identity is required, the identity button is the launch action.
  // Otherwise run the existing authenticated self-service action immediately.
  ```
- [x] Add met-obligation servedWork to BookLogProgramLauncher (and focused launcher-to-agenda regression), using BOOK_LOG_SHELF_UNIT_ID as the assignment identity. The existing launcher has doneToday without servedWork, so the required completed disc currently disappears. Preserve no-obligation/unmet/unenrolled semantics and all gates.
- [x] RED model/board tests: optional reading with no assignments displays a completed circle; Story time remains pending; multiple reading events make one supplemental circle; no activity or unavailable evidence makes no invented credit; progress toward a larger required book-log target is not a pass; an already completed required book-log disc avoids redundant supplemental credit; counts/Done for day unchanged. Example:
  ```js
  const summary = summarize([], [], [], {status: 'ok', studyDay: '2026-09-07', hasActivity: true, progressCount: 1, finishedCount: 0, bookCount: 1});
  expect(summary.total).toBe(0);
  expect(summary.done).toBe(0);
  expect(summary.segments).toEqual([expect.objectContaining({supplemental: true, state: 'passed', programId: 'book-log'})]);
  ```
- [x] Implement supplemental circles independent of `summary.total > 0` rendering gates; include them in layout segment count, not required numerator/denominator. Retain static/noninteractive behavior and accessible program-specific descriptions. On missing plan data, authoritative reading evidence must still be displayable rather than dropping the entire row.
- [x] For the live board, remove SchoolApp browser-calendar statusDay and derive the day from teacherDay() response.studyDay. Preserve explicit historical day props. Fetch per-learner agenda previews after the shared digest names the day; test browser calendar next day versus server prior study day.
- [x] Add board refresh tests for book-log-changed, backdated undo invalidation, unrelated learner suppression, and return from shelf. Ensure persisted reads, not local optimism, supply the circle. Run focused self-service, SchoolApp, board/model suites; update docs, self-review, commit, report interfaces/test evidence.

### Task 4: Scanned ISBN → Portal → learner → existing reading flow

**Context:** Read `scan-entry-research.md` in this plan's ignored workspace for traced source evidence. The old `_extensions/barcode-scanner` is retired; no firmware changes are needed. Existing ScanCode claims ISBN13 Bookland shape before nutrition fallback; add its missing book handler. Preserve that ownership rule, validate checksum with parseBookIdentifier before lookup, and show invalid-book feedback without food fallback. Non-book barcodes retain their existing routes. Auto routing remains ISBN13-only; typed ISBN10 support remains.

**Files and boundaries:**

1. `backend/src/3_applications/scan/ScanIngressCoordinator.mjs`: injected `book` handler and dependency contract; retain event identity; preserve all other routes.
2. New `backend/src/3_applications/school/usecases/PrepareBookScan.mjs` or one clearly named service holding receive/read/select/dismiss of bounded pending intents; inject resolveBook, roster, launch-target issuer, wake, notifications, clock/id source. A separate small pending-store class only if it materially simplifies concurrency.
3. New `backend/src/4_api/v1/routers/schoolBookScans.mjs`: no-store pending/select/dismiss boundary; no generic grant minting. Compose alongside schoolBooks using existing app/lifecycle dependencies.
4. `backend/src/app.mjs` and appropriate `schoolLifecycle.mjs` exports: wire service once to the shared books resolver/grants/learner directory/wake. Resolve target from School/device config explicitly.
5. Add semantic book-scan notification to School realtime port/adapter (or a small dedicated adapter), rather than importing event bus into the use case. Ensure chosen event topic is actually deliverable even when the first Portal subscriber is absent; retained HTTP state supplies reconnect recovery.
6. New `frontend/src/modules/School/books/BookScanEntry.jsx` plus hook/API methods for pending preview, safe selection, target filtering, replay and dismissal; use existing ProfileAvatar and School logging.
7. `SchoolApp.jsx`, `books/BookShelf.jsx`, `books/useBookShelf.js`: safe mount handoff and one-time initial scan selection; existing add/update/finish reducers and actions remain the mutation path.
8. Update `docs/reference/barcode-scanning/README.md` (remove missing-book-handler gap, describe bad checksum and nutrition fallback) and relevant School/reading reference; do not update superseded transport docs as if active.


**Exact interface/default decisions:**

Engineering defaults, within the approved household LAN trust model:

- Scope config under `school.bookScan.targetDeviceId`; compose the actual Portal screen id separately from the device id by resolving the configured screen route. If omitted, resolve the unique configured School Portal device; ambiguous/missing target is a visible service refusal, never a guessed arbitrary screen.
- Keep a random 32-byte base64url pending intent id/capability server-side for **5 minutes** from receipt. Expire without any shelf write. Bound records to **32** including recently claimed/dismissed tombstones. Keep source-event dedupe tombstones for **10 minutes**; no book dedupe changes to nutrition. Coalesce same-ISBN scans against a still-pending intent without extending it indefinitely.
- `GET /api/v1/school/book-scans/pending?screenId=<id>` returns `{intent: null}` or `{intent:{id,screenId,isbn13,receivedAt,expiresAt,status,book,error}}` under `Cache-Control: no-store`. This is a scoped household kiosk pending-intent read, not strong device authentication. The server alone creates ids on the scanner path. Metadata status is `loading|ready|not-found|unavailable|invalid`.
- Broadcast on `school` only `{type:'school.book-scan',screenId,intentId}` as an invalidation; no learner, book grant, or sensitive shelf facts. Portal fetches pending on that event and mount/reconnect. No need to redesign general eventbus acknowledgements.
- `POST /api/v1/school/book-scans/:id/claim` body `{screenId,learnerId}` validates target match, live unclaimed intent, valid ISBN, and the current eligible School roster; returns `{intentId,launchTarget:{kind:'program',program:'book-log',learnerId,bookGrant},bookEntry:{isbn13,book}}`. Missing/expired intent or ineligible learner refuses before minting. Keep the successful response in the same record until original expiry so retry by the same learner returns the same grant; different learner refuses. Do not issue a grant for invalid ISBN; not-found metadata may continue through the existing manual-metadata confirmation flow.
- `POST /api/v1/school/book-scans/:id/dismiss` body `{screenId}` marks the intent dismissed idempotently; it does not clear a different/newer scan. No need for an independent acknowledgement endpoint: claiming/dismissing gives the server terminal presentation state, while replay of the same id is idempotent on the client.
- Keep one current pending intent per target plus at most one latest deferred intent. Frontend shows immediately only from anonymous idle keypad (no digits/card), otherwise a small “Book scanned — open when ready” notice. Never automatically claim, navigate, or replace active School/shelf work. When active work closes, show the latest nonexpired deferred preview. A current preview may be replaced by a newer ISBN only before avatar selection starts; once a claim is in flight, generation guards prevent late replacement. Retry and expiry copy should invite rescanning.
- Use existing scoped book grant as-is after selection. No new device provisioning, global scanner authentication, generic queue system, cross-app busy registry, or hardware firmware changes belong in this task.

**Implementation and verification:**
- [x] Add RED scan-dispatch tests for valid 978/979 on nutrition/default content readers; ordinary UPC/EAN, ISBN10 and explicit nutrition/content/School tokens unchanged; eventId forwarding and unwired refusal. Preserve shape-owner tests; test checksum rejection in the book service without lookup or food write.
- [x] Add RED pending-service/HTTP tests for no writing on scan/claim, real scoped grant after current-roster validation, idempotent same-learner claim, rejected cross-learner/missing/expired/target-mismatched claims, same-event/coalesced-ISBN delivery, bounded retention, late lookup after replacement/dismissal, metadata failure, and wake failure. Use dependency injection and the real book-grant issuer in boundary tests.
- [x] Implement service/router/composition wiring with narrow semantic notification and wake dependencies. Do not broadcast grants or trust learner objects from the client. No production data edits or scan injection during implementation.
- [x] Add RED component and real-hook tests for target-filtered preview, mount/reconnect read, avatar handoff using returned grant, dismissal, stale claim/metadata responses, and busy quiz/book draft/save/keypad/card protection. An idle locked Portal can preview; ordinary School tabs cannot unexpectedly open scans.
- [x] Add optional scan-entry props to BookShelf/useBookShelf, processed once after a fresh successful shelf read. Existing active book goes directly to UpdateBook; prior finished book shows completed/read-again context; new book enters the combined cover/actions view. No new cover-confirm dialog and no automatic item creation. Preserve Task 2 needsRefresh protection and stable write IDs.
- [x] Run focused dispatch/service/router/School/shelf tests, update maintained barcode and School reference docs, self-review, commit scoped changes, and write task-4-report.md with RED/GREEN evidence and exact UI/API contract. Task 5 owns full browser acceptance; controller owns integration/deployment.

### Task 5: Portal browser acceptance and integration verification

**Files:**
- Modify: `tests/live/flow/school/reading-shelf-contract.runtime.test.mjs` and related disposable fixtures.
- Create: `docs/_wip/audits/2026-09-07-reading-shelf-experience.md` with commands, results, screenshots, and limitations.
- Fix integration defects only within previously touched reading/board/entry code and associated tests; preserve the approved spec.

**Interfaces:**
- Existing Playwright test provides a disposable API transport with no production data writes; adapt it to new UI/readingActivity contract and direct launch.
- Baseline fixture viewport is 1280x800. Controller will verify production Portal dimensions read-only; use the confirmed dimensions and document them.

- [x] Add isolated scan → avatar → seeded shelf → explicit finish → separate agenda-credit browser coverage, asserting no reading writes before an explicit action and no clobber of an existing draft.
- [x] Update the existing harness expectations from launch wizard and receipt views to the new flow. Add cases for initial ISBN entry, returning reader, finished-only shelf, reread context, one-tap finish/Undo, alternate date, progress pad and optional agenda circle after exit/reload.
- [x] Assert actual bounding boxes and hit targets, not merely DOM presence:
  ```js
  const box = await page.getByRole('button', {name: 'Finished today', exact: true}).boundingBox();
  expect(box).not.toBeNull();
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.height).toBeGreaterThanOrEqual(44);
  ```
  Verify the visible primary choices are hit-testable and screenshot active shelf, update choices, number task, date picker, finished shelf and agenda credit. No screenshots should expose real learner records; use disposable fixtures.
- [x] Run against an isolated local frontend with all reading writes intercepted. Do not start/restart an existing dev server or point writes at production. Record route, viewport, expected tap count and observed result.
- [x] Resolve any observed integration failures with a failing regression first, then rerun the amended flow. Run combined affected Vitest suites once after fixes and required repository gates via the normal commit hook. Run the frontend build to verify code/CSS bundling.
- [x] Write the acceptance audit and update spec/plan status, self-review, commit scoped changes, and report verification evidence. Controller performs independent whole-branch review and integrates/deploys under the project gate.


### Integration with updated main

The requested main pull includes the v2 reading-log migration and teacher editing
surfaces. Preserve those contracts while adapting supplemental activity and reread
history to v2 effective days. Preserve explicit recording provenance and identify
finish evidence so Undo cannot remove an independent check-in. Reconcile direct
launch into one authenticated dispatch. Verify the merged behavior before release.

The landscape acceptance pass covers all learner shelf task surfaces at 1280×800,
including loading/error variants, with book context and controls beside each other.
History may scroll; essential task choices and exit controls must remain visible.

All outgoing reading-flow commits were checked for personal identifiers. The
original design example and audit endpoint were anonymized in local history.


### Release verification

Updated main merged with the reading changes. The merged frontend suites passed
485 tests; final v2 integration suites passed 296 tests. All four browser contract
cases passed (one isolated Vite startup failure passed on targeted rerun). Normal
commit hooks and the production Docker/frontend build passed. Independent review
found no remaining integration blocker. The expanded landscape audit records its
measured coverage and any remaining unmeasured error variants separately.

Deployment is waiting on the activity gate: the post-build check reported an
active fitness session with one rider and recent School Portal traffic. No
production restart or tablet reload was performed while the gate was blocked.
