# Reading shelf experience and optional agenda credit

Date: 2026-09-07
Status: Implemented, including scanned ISBN entry; release verification recorded in the acceptance audit.

## Purpose

Make logging reading a short, understandable task on the School Portal. Keep
finished books visible and acknowledge reading on the agenda whether or not
the learner has a reading assignment. Preserve separate Story time obligations.

## Evidence and problems

The reported experience required too many identity, launch, book-confirmation,
and save steps. The update screen renders a number pad before the finish action,
putting that action below the fold. A finished book leaves the main shelf and
appears only in History. The date control does not clearly name the save action.

Production investigation found two separate ISBN lookup/add/finish flows for the
same learner and book, roughly 29 minutes apart. These were distinct submissions,
not evidence that one request wrote twice. Legitimate rereads must remain possible,
including on the same day. Existing-book context should make them recognizable.

The board currently derives discs from plan sections, sessions, and served work.
Unenrolled book-log activity is absent from that projection. Its refresh event set
also does not include book-log saves. Adding a UI-only success circle would not
survive a reload and would leave the underlying evidence gap unresolved.

## Chosen approach

Use the shelf as the persistent home for reading, with focused task views for
ISBN input, number entry, and alternate dates. Return to the shelf after saving.
Retaining the wizard would preserve unnecessary transitions; displaying all its
controls together would recreate the crowding that hides finishing today.

## Entry and identity

- A valid reading code for the currently recognized learner opens their shelf
  directly. No additional launch card or program-choice step is needed.
- When identity confirmation is needed, show the learner portrait and a single
  action such as **Open this learner’s books**, plus a way to reject that identity.
  Confirmation performs the launch without another action screen.
- Identity rejection returns to code entry without opening another child's shelf.
- Preserve server-side code validation, signed learner grants, and ownership checks.
  A remembered frontend profile alone must never authorize a shelf request.
- With no book records, the initial destination is ISBN entry, with Back to shelf
  available. A shelf containing only finished books is not an empty shelf.
- Returning readers see their shelf and a prominent **Add book** action.
- Keep the learner visible and provide an always-accessible way back to the agenda.
  Existing idle-close behavior remains, with input interaction resetting activity.

## ISBN lookup and adding

ISBN entry retains validation, scanner/keyboard support, and digits after errors.
After lookup, show cover, title, author, and the three existing illustrated actions
together: **Start reading**, **Update page**, and **Finished today**. Selecting an
action accepts the displayed book; remove the separate cover-confirmation step.
**Wrong book?** returns to editable ISBN input without clearing it.

Start reading creates a shelf item and returns to the shelf. Update page opens
number entry and saves the item plus its initial progress using the existing
idempotent operation contract. Finished today saves the item and finish for the
household study day. **Finished on another day** opens the alternate-date task.
For an existing item, the progress action follows its page/minutes/check-in mode.
Retain the ability to record a physical page when catalog page-count data is absent.
Missing metadata remains an honest placeholder; provider failures remain retryable.

If the learner already has an unfinished item for that ISBN, direct them to that
record rather than creating another active copy. Match canonical ISBNs.

If the book was previously finished, display **Last finished September 7** beside
the book and label the starting action **Read again**. Starting, adding progress,
or recording another finish can still create a distinct reread. Show that context
for all three actions; do not introduce an extra confirmation dialog or a same-day
ban. An unfinished reread takes precedence over offering another new item.

## Updating and finishing

Opening an active book shows compact book details, existing progress, and two
large side-by-side icon actions: **Update page** and **Finished today**. Both must
be visible at the production Portal viewport without scrolling. Minutes and
check-in modes substitute their corresponding progress action in the same position.

The number pad appears only after choosing the progress action. Give it a focused
task view with **Save page** (or **Save minutes**) and Back. Keep mode changes and
set-aside available as secondary actions without displacing the primary choices.

**Finished today** saves immediately for the server's household study day.
**Finished on another day** opens a readable date picker with an explicit save
label, for example **Save finish — September 6**. Retain server-defined date limits
and study-day rollover behavior; do not substitute the browser's calendar date.

After a confirmed save, return to the shelf and show an inline success message.
A finish shows **Book finished!** and **Undo**; other writes name what was saved.
Remove the separate receipt view from the primary flow. Announce results through
an accessible status region. No timed dismissal or animation is required.

On failure, preserve the task, typed value, and operation identity, and show an
actionable inline error. Disable repeated submission while a write is pending.
If the write succeeded but the shelf reread failed, report that distinction and
retry the read without minting another write. Late responses after exit must not
reopen the task or apply state to another learner.

## Shelf and history

- **Reading now:** active/unread books with covers and meaningful progress.
- **Recently finished:** a single horizontal row, newest effective finish dates
  first, with covers, finish dates, and reread labels. Break same-date ties with
  trustworthy recording time when available, then a stable record order.
- **See all history:** opens the scrollable complete history, retaining existing
  history information and access to older records.
- Finished books remain visible after saving. If there are no active books, use
  a compact Reading now area and give the recent row room; do not display a
  misleading first-book invitation when history exists.
- Completed-book details expose prior reading context and Read again. They do not
  route through an active-book update screen that could accidentally finish the
  same record again. Undo remains associated with the finish it reverses.
- Preserve all existing reading records. This work does not merge or delete the
  two observed entries.

## Dates and reread metadata

An effective finish date and a recording timestamp are different facts. Existing
finish events may store a selected date normalized to noon UTC; that is not the
time the student submitted the finish. Never display it as an actual reading time.

Use the effective finish date for **Last finished ...** and day attribution. New
events should retain a server-generated recording timestamp separately from the
effective date so **Logged today at 8:10 AM** can be accurate when useful. Preserve
the original timestamp on retries. Legacy records without recording time display
date-only context; do not infer precise times or require a historical migration.
Reread presentation is derived from the learner's distinct reading records for
the canonical ISBN, accounting for undone finishes.

## Agenda credit contract

Derive reading activity from the persisted book log for the requested household
study day, independently of enrollment. A valid page update, minutes entry,
check-in, or effective finish earns activity credit. Merely adding, opening,
changing mode, or setting aside a book does not.

Expose that evidence as an additive reading-activity field on the board's existing
day-data response, with learner, study day, activity presence, and summary counts.
Use a shared backend projection rather than reading grant-protected shelf routes
from the locked board or reimplementing evidence rules in JSX. Keep metadata
lookups out of the critical agenda-credit path. Unreadable evidence is unknown,
not proof of zero activity; preserve the rest of the board and log the failure.

For a learner without a required reading disc that day, append one completed
supplemental **Reading** circle when evidence exists. Keep it distinct by program
identity from **Story time**, even though both can share the English subject.
Multiple readings enrich its accessible description without adding more circles.

If a required book-log disc already exists, retain its obligation semantics: a
single page update must not satisfy a multi-book or other unmet target. If today's
activity has not satisfied that obligation, show the supplemental activity circle
as well; once the required reading disc is complete, it carries the acknowledgment
without a redundant supplemental circle. Story time never absorbs book-log credit.

Supplemental circles do not change required totals, completed-required counts,
daily-completion gates, or the **Done for the day** state. A learner with no required
plan can still display a Reading circle without claiming all-day completion. Board
visibility and disc sizing must account for supplemental segments independently
of required totals. Keep the board noninteractive and static.

After a persisted reading change, publish a learner-scoped School invalidation
event. The board rereads authoritative data on that event, when returning from the
shelf, and through its existing fallback refresh. Handle both live-mounted and
remounted boards. Backdated finishes affect their effective day. Undo removes that
finish's contribution, including from a past day, but retains any independent
progress/check-in evidence. A broad learner invalidation is acceptable for changes
affecting multiple days. Publish no success event before persistence succeeds.

## Component boundaries

- `selfService/useSelfService.js` and the existing launch/identity presentation:
  direct reading launch with one conditional identity decision.
- `books/BookShelf.jsx` and `books/useBookShelf.js`: task navigation, active/recent
  shelf composition, stable write identities, and inline save feedback.
- `books/AddBook.jsx`, `UpdateBook.jsx`, `NumberPad.jsx`, and `DayPicker.jsx`:
  focused input and clearly named actions, reusing the existing book icons.
- Shelf presentation/projection and persistence: previous finish context,
  additive recording timestamps, and intentional rereads without retry duplicates.
- Backend reading-activity projection and day response: enrollment-independent
  evidence, requested-day attribution, and post-persistence invalidation.
- `status/agendaStatusModel.js` and `AgendaStatusBoard.jsx`: supplemental display
  separated from assignment totals, event refresh, and program-specific labels.

Keep changes scoped to this reading flow. Do not redesign unrelated programs,
make the agenda board interactive, or alter assignment/gating policy.

## Verification and acceptance

1. A matching recognized learner's valid reading code reaches the shelf with no
   launch confirmation. Unknown/different identity needs one combined identity
   action; denying it never opens or writes the named learner's shelf.
2. With no records, successful entry lands at ISBN input without a plus-button
   tap. Finished-only shelves still show recent books.
3. New ISBN lookup proceeds directly to illustrated actions; no separate Yes step.
   Incorrect ISBNs and failed lookups preserve correction/retry paths.
4. At the actual Portal viewport, Update page and Finished today are simultaneously
   visible without scrolling. Number entry has a visible save and back action.
5. Opening a book then pressing Finished today saves and returns to a visible
   recent-finish tile with inline success and Undo, without receipt dismissal.
6. Alternate dates display an unambiguous save label and obey backend date bounds
   and household study-day semantics, including rollover.
7. Prior finishes are visible during repeated ISBN entry; intentional same-day
   rereads remain distinct. Double taps, retries, and read-after-write failures
   do not produce duplicate items or progress events. Existing active items are
   reused, including an active reread.
8. Legacy normalized finish timestamps display dates rather than invented times.
   New recording timestamps are server-authored and stable on retry.
9. An unenrolled learner's reading update creates one supplemental Reading circle
   immediately and after reload. Adding a book alone creates none. Multiple writes
   produce one circle; required totals and Story time remain unchanged.
10. Required reading targets keep their real progress. Today's activity can be
    acknowledged without falsely completing a larger target. Optional credit is
    visible even when no required plan exists.
11. Backdated finishes and Undo recompute the correct day's credit; independent
    reading evidence remains. Missing evidence data does not blank other subjects.
12. Cover/title/date-rich recent books and full history remain accessible on touch
    and keyboard, with readable labels, visible focus, and announced save results.

Use meaningful domain/API tests for evidence attribution and idempotency, component
tests for navigation and circle accounting, and a browser flow at the actual Portal
dimensions for tap counts and below-fold visibility. Perform write-based verification
with isolated test learners/data rather than modifying production reading records.
Update the School reference documentation alongside implementation.


## Approved extension: scanned ISBN entry

The parent can scan the publisher's ISBN barcode to wake the School tablet, see
the book's cover/title with **This book was just scanned**, and select the learner
from tappable avatars. The selected learner enters the same reading actions with
the ISBN already supplied. The prompt should ask **Who's reading this?** so it
does not imply the book is already finished. A scan, metadata lookup, or avatar
selection alone must not create a reading record or award agenda credit.

The maintained scanner path is BLE relay → WebSocket ingest → scan vocabulary →
domain dispatch. The old `_extensions/barcode-scanner` USB/MQTT implementation is
retired. The scan vocabulary already recognizes a 13-digit `978`/`979` Bookland
shape before the scanner's nutrition fallback; its missing book handler is the
integration point. Preserve ordinary product/nutrition, content, and school-token
routing. Validate the ISBN checksum before metadata lookup. A malformed Bookland
scan gets clear correction feedback and cannot create a food or reading entry.
Do not broaden automatic routing to arbitrary ten-digit strings: the physical
publisher barcode uses ISBN-13, while typed ISBN-10 remains supported in School.

Use existing device wake/foreground wiring and a temporary, server-owned scanned
book intent. Broadcast no learner write grant. The avatar selection validates the
learner on the server and obtains the existing learner-scoped reading grant. The
selected book then enters the regular shelf lookup/action path, preserving active
book reuse, prior-finish context, and deliberate rereads. Do not implement another
book-writing workflow.

Wake/reconnect delivery must preserve the pending book without repeatedly opening
it. Transport retries must reuse the same intent; an intentional later scan is
allowed. Pending intents expire and cancellation does not save anything. If the
tablet is already editing or running an activity, present a pending-book notice
and preserve that work until the learner chooses to open the scan or exits.

Acceptance adds isolated tests for a book scanned on a nutrition-default reader,
an ordinary product still reaching nutrition, malformed book feedback, wake and
reconnect delivery, avatar selection without code/ISBN typing, server learner
validation, repeated transport delivery, cancellation/expiry, busy-screen draft
preservation, and scan → select learner → finish → independent agenda credit.


## Implementation record

Implemented in `feat/reading-shelf-experience`. See [acceptance audit](../audits/2026-09-07-reading-shelf-experience.md) for regression, browser, and hardware-wake evidence and release limitations.
