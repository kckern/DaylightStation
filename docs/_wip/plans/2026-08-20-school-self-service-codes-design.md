# School self-service access codes — design

**Date:** 2026-08-20
**Status:** design agreed; revised after adversarial review (same day). Not implemented.
**Related:** `docs/reference/school/README.md`, `docs/reference/school/print-documents.md`, `docs/reference/donow/README.md`

> **Revision note.** The first draft claimed three things the code does not support: a one-tap
> print+play composite, code expiry inherited free from the token record, and a read-only
> `/resolve`. All three were wrong and are corrected below. Where a claim was verified against
> the code, the citation is given inline.

---

## Problem

Today there is exactly one way to start school work, and it needs a parent.

Every trigger — print a worksheet, dispatch media, launch a DoNow — comes from scanning a `sch:`
token off a printed receipt (`ResolveScanAction.mjs`). The scanner is parent-controlled, so a child
who finishes one thing must find a grown-up to start the next. The agenda in their hand already
says what is next; they cannot act on it.

Separately, the School SPA is wide open. `SchoolApp.jsx` boots into a browsable home grid — subject
shelves, library, catalog, print centre, typing, chess — and nothing scopes a child to *their*
assigned work. Fine as a browsing surface, wrong as a "go do your maths" surface.

## What we are building

An **optional, config-gated** self-service path that closes the loop without handing children a
scanner:

1. A 6-digit code minted per subject at agenda-build time, printed beside the lesson on the receipt.
2. The School app, on a designated panel, renders a **locked keypad** instead of the browsable home.
3. A correct code opens a **launch card** — buttons appropriate to the lesson type, plus an exit —
   which drives the same physical outcomes a scan drives.

The Portal panel lives in the **school room**. Video dispatches to the living room.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Codes are a **router with a fence**, not authentication | The lock keeps a child on task, not out of a vault. No throttling, no lockout, no audit alarm. A guessed sibling code means doing your sibling's maths — annoying and self-correcting. |
| D2 | The code is an **alias for an existing token**, stored in `ITokenRegistry` | Scope (learner + subject) becomes structural. **Expiry does NOT come free** — see D5. |
| D3 | New `offeredActions()` **beside** `nextMove()`, not a widening of it | Keeps the scan path byte-identical, and lets the card speak in screen words where `nextMove`'s consumers speak in paper words. |
| D4 | Destination from **`school.yml` default only** | No picker UI, no occupancy logic. The button names the destination so the child knows where to walk. **The per-unit override this decision originally allowed does not exist** — see below. |
| D5 | Codes die at the **study-day rollover**, via their own `accessCodeExpiresAt` | The underlying token deliberately lives 7 days; the code must not. See "Two clocks" below. |
| D6 | Lock mode is **per-screen config** on `portal.yml`, not household-wide | A parent's browser stays browsable, so no master code or profile bypass is needed — i.e. no auth model sneaks back in. Real home: `data/household/screens/*.yml` + `surfaceProfile`. |
| D7 | **Do not refactor `ResolveScanAction`.** Share only two small judgements | Revised — see "Parity, revisited". |
| D8 | **No composite actions.** The card offers one action and recomputes | Forced by the session state machine — see "Why there is no print+play button". |

---

## Three constraints that shaped the design

### Printing never retires work

From `offerSession.mjs` (2026-08-14 investigation): *"printing a worksheet must never retire it.
Only an OMR/grade event does that"* — so a lost, destroyed or printer-garbled sheet can be
reprinted as many times as needed. `ISSUABLE = {created, media_completed, issued, reprinted}`
(`IssueDocument.mjs:48`) accepts exactly that. Therefore "close out the code" means "this keypad
interaction is finished", never "this work is done". Two separate lifecycles: the **session**
(created → issued → graded, untouched by the keypad) and the **code**.

### Why there is no print+play button (D8)

The obvious feature — one tap that prints the worksheet *and* starts the video — is forbidden by
the event schema in **both** orders (`sessionEvents.mjs:178-189`):

```
created:          ['issued', 'media_dispatched', 'launch_dispatched', 'abandoned']
issued:           ['submitted', 'reprinted', 'failed', 'abandoned']    <- no media edge
media_dispatched: ['media_completed', 'media_stalled', 'abandoned']
media_completed:  ['issued', 'submitted']
```

- Print first: the session moves `created → issued`, and `DispatchMedia.mjs:22` dispatches only
  from `DISPATCHABLE = {created, media_stalled}`. The dispatch is refused.
- Play first: `media_dispatched` is not in `ISSUABLE`, so an immediate print returns `already_done`.

Video-with-worksheet is two scans today because the **state machine serializes it**
(`media_dispatched → media_completed → issued`), not because the scanner is limited. The keypad
inherits that ordering. The card offers `[Play in living room]`; when the video completes and the
session reaches `media_completed`, re-entering the same code yields a card offering
`[Print the questions]`. Two keypad visits, no parent, no schema change.

Making it one tap means adding transitions to the schema every existing session replays through.
That is a separate work item with its own migration and test burden, deliberately not taken here.

### Two clocks (D5)

`subject_next` tokens are minted with a **7-day TTL** — `BuildAgenda.mjs:40`,
`DEFAULT_SUBJECT_TOKEN_TTL_HOURS = 168`, applied at lines 218-224 — because the printed QR must
outlive the day. `resolveTokenState` (`tokens.mjs:222`) checks only `record.expiresAt`.

So a code that simply rides the token record is valid for a **week**: yesterday's printed
"Fractions 3 — code 481920" would resolve to whatever that subject offers today, and the card would
contradict the paper. Revoking the token to kill the code would also kill the QR printed beside it.

The record therefore carries its own `accessCodeExpiresAt`, set to the next study-day boundary
(`studyDay.mjs`, 4am rollover). The QR keeps its week; the code gets its day. Live-code volume is
one per subject per learner per agenda build, expiring daily — small, but not the "roughly 30"
the first draft assumed from a shared expiry.

---

## Section 1 — the code

New pure domain module, `2_domains/school/sessions/accessCode.mjs`:

```js
export const SCHOOL_ACCESS_CODE_DIGITS = 6;
mintAccessCode({ random, taken })   // randomness INJECTED — no clock, no Math.random
normalizeAccessCode(value)          // '481920' | throws
```

Random, not derived.

**Storage.** Token records gain optional `accessCode` and `accessCodeExpiresAt`; `ITokenRegistry`
gains `getByAccessCode(code)`. `YamlTokenRegistry` keys records by token, so this needs a secondary
index (or a scan) plus a `taken` check at mint — cheap, but it is real work, not free.

**Minting.** `BuildAgenda` mints a code beside each `subject_next` token, only when config enables
it. Collision space is 1,000,000 against a day's worth of live codes; `mintAccessCode` still checks
`taken` and retries.

**Printing.** `agendaDocument()` gains an optional code line on the lesson card — see the code
collision section below for how it must be labelled.

### Three 6-digit code systems, two of them on the same sheet of paper

This is the part most likely to bite a child in the school room.

| System | Typed into | Nature |
|---|---|---|
| `continuationCode.mjs` | a **calculator** | reversible affine encoding of `learnerSlot x moduleCode`; permanent, enumerable, "not authentication" by its own header |
| SchoolCalc **study code** | a **calculator** — already printed on the agenda beside the lesson with "Enter on calculator." (`BuildAgenda.mjs:203-209`, `receipts.mjs` `schoolcalcHandoff`) | random, minted `% 1_000_000` (`schoolCalc.mjs:85`) |
| **access code** (this design) | the **Portal keypad** | random, study-day scoped |

"Different input surface, no ambiguity" is not good enough: an agenda can carry a SchoolCalc study
code and an access code, visually identical, on the same page, each naming a different device.
They must be printed with distinct treatment — e.g. **`PANEL CODE 481920`** vs the existing
calculator handoff wording — and the access code should never be derived from `continuationCode`'s
scheme, which is enumerable by design.

**SchoolCalc subjects are excluded from the keypad.** A schoolcalc entry mints no `subject_next`
token at all (`token: null, tokenClass: 'schoolcalc_study'`, `BuildAgenda.mjs:210-215`), so under
D2 there is nothing to hang an access code on. Either mint tokens for those entries (out of scope
here) or accept the exclusion — this design accepts it, and the card never offers them.

## Section 2 — the launch card's action set

New pure domain module, `2_domains/school/selfService/offeredActions.mjs`, consuming a
`ResolveSubjectNext` **resolution** so it never re-derives state:

```js
offeredActions(resolution, { mediaSurface, bankPrintable }) -> Action[]
```

Non-`move` resolutions produce **zero actions plus a sentence**:

| Resolution | Card shows |
|---|---|
| `served` | "You already did this today" |
| `locked` | the existing `lockedRemedy` |
| `empty` / `unavailable` | "Tell a grown-up" |

For `move`, one action, mirroring `nextMove`'s ladder:

| Unit at `created` | Action |
|---|---|
| `launch:` | `[launch]` → DoNow, `unit.launch.surface` |
| `media` (with or without `document`) | `[play]` → `mediaSurface` |
| `document` | `[print]` |
| `bank`, `bankPrintable === true` | `[print]` |
| `bank` | `[screen]` — runs on the panel |
| `program` resolution | `[program]` — opens in place |

Later states reuse the same builder: `media_completed` → `[print]` or `[screen]`;
`issued`/`reprinted` → `[print]` labelled "Print it again"; `media_stalled` → `[play]`.

**`bankPrintable` is passed in, never decided here.** The print-vs-screen call for a bank unit is
`IssueDocument.canIssueBank` (`IssueDocument.mjs:212-220`), which needs `worksheetInstances`,
`assignments` and a bank reader — unreachable from a pure domain module. Hardcoding
`subject === 'civilization'` instead is precisely the duplicated judgement that
`offerSession.mjs:133-145` records deleting after it drifted. The application layer calls
`canIssueBank` once and hands the boolean down.

Every card ends with an exit. The paper path's never-dead-end rule applies here unchanged.

## Section 3 — the flow on the panel

**Locked idle → keypad.** Six large digit buttons. No learner name (the code names the learner), no
home grid, no breadcrumb, no deep links.

**Wrong code → "Try again."** That is the entire failure path — no throttle, no lockout, no dead
keypad. It still emits `school.selfservice.code.rejected`, because a code that never works is a
minting or expiry bug and there is no other way to see it.

**Valid code → the card.** Subject, lesson title, one button, exit:

```
[Print] / [Print it again]
    -> IssueDocument fires
       status 'debounced'?  -> "It's already on its way — give it a minute."
       otherwise            -> "Did it print?"
                                 [Yes] -> lock screen
                                 [No]  -> [Print it again]

[Play in living room] / [Go do this]
    -> DoNow dispatch, sentence verbatim
         [Done] -> lock screen
       (when the video completes, the same code offers [Print the questions])

[Answer on the screen] -> mount QuizRunner/Flashcards, scoped
[Open <program>]       -> mount the program, in place
                          finish or exit -> lock screen
```

**The debounce must be rendered, not swallowed.** A print whose job resolved confirmed arms
`lastPrintedAt`; a retry inside `printCooldownMinutes` (default 10) returns `status:'debounced'`
with `document:null` and `message:''` (`IssueDocument.mjs:253-283`). That silence was designed for
thermal slips. On a screen it means a child taps "Print it again" and nothing happens and nothing
explains why — so the card renders the debounced status in words.

**Escape anywhere → lock screen, code still valid.** Same on idle timeout, which a wall panel needs
or it sits open on one child's maths all afternoon.

**`pending_approval` comes free.** DoNow returns exactly `dispatched | pending_approval | denied |
failed`, each carrying a human sentence the caller shows verbatim (`DoNowService.mjs:113`). If a
surface needs a grown-up, DoNow sends the notification and hands back the sentence; the card shows
it and the child taps Done.

### Locked panel vs. the `portal` DoNow surface — RESOLVED

Scanned bank work dispatches surface `portal` through DoNow; `PortalSurface.dispatch` broadcasts
`school.launch` to every screen with School mounted, and `SchoolApp.jsx:321-348` subscribes and
starts the quiz.

**`data/household/screens/portal.yml` is the only screen in the house that mounts School**
(`children: [{ widget: school, grow: 1 }]`, `route: /screen/portal`). Its own comment: *"The Portal
IS the school device, the way living-room IS the TV."* So the broadcast has exactly one recipient,
and it is the panel we intend to lock.

That settles it: **a locked panel must accept `school.launch`.** Ignoring it would break the QR
"answer on the screen" path outright — the printed slip promises "Starting on the school screen"
and there is no other screen to catch it. The consequence, that a sibling's scan can start work on
the panel, is consistent with D1 and is the status quo anyway.

Two details the same file settles:

- The mount is a **widget with no `clear` prop**, so `SchoolApp` already omits its exit affordance
  — "there is nothing behind this screen to exit to." Lock mode is a narrowing of a surface that
  is already terminal, not a new cage.
- `actions.escape` when idle is `reload` — the kiosk's only refresh affordance, since FKB has no
  address bar. Lock mode must not swallow it.

Remaining obligation: `PortalSurface.occupancy()` reads `SchoolService.activeSittings()`, so a
keypad-mounted QuizRunner must open its sitting through the same `SchoolService` path the SPA's
`start()` uses. Otherwise DoNow's clobber protection — the reason `#onScreen` was routed through
DoNow at all — is blind to keypad quizzes and will interrupt a child mid-quiz.

## Section 4 — backend wiring

Two endpoints, in a new `4_api/v1/routers/school.selfservice.mjs`:

```
POST /api/v1/school/self-service/resolve  { code }
  -> { learner, subject, title, sentence, actions[] }
POST /api/v1/school/self-service/act      { code, action }
  -> { outcome, sentence }
```

**`/resolve` must not open a session.** `ResolveSubjectNext.execute` calls `ensureSession`
(`ResolveSubjectNext.mjs:136-138`), which appends a `created` event when the plan entry has no
session (`offerSession.mjs:34-42`). `BuildAgenda` pre-creates the session for the entry it prints
(`BuildAgenda.mjs:385-389`), so the first resolve usually reuses — but once the day advances (first
unit graded, the subject's `next` is a fresh unit) or `continueToday` is set, typing a code opens a
work session. A curious child, or one typing a sibling's code, would write `created` sessions into
another learner's history, flip plan entries to `in_progress`, and accumulate opened-never-touched
sessions on the parent board (`WorkSessionReporter`) — with no abandoned-session sweeper found.

Fix: `/resolve` computes `nextMove(unit, syntheticCreatedState)` without persisting — a `created`
state needs no real session to predict the move — and only `/act` calls `ensureSession`.

### Parity, revisited (D7)

The first draft proposed extracting `ResolveScanAction`'s private helpers so both callers produce
byte-identical outcomes. **That is the wrong goal.** Extraction is mechanically feasible — the
helpers take `sessionId`, `sessionState`, `unit`, `learnerId`, `tokenClass` as parameters and close
only over injected collaborators — but every helper's exit is *paper-shaped*: `#slip` prints a
thermal notice, `#play` prints "When it finishes, scan your card for the questions." Byte-identical
means the keypad spits a thermal slip on every tap; suppressing them means the outcomes differ by
construction anyway.

So: **leave `ResolveScanAction` untouched.** `RunSelfServiceAction` calls the same use cases
(`IssueDocument`, `DispatchMedia`, `DoNowService`, `OpenRemediation`) directly, and only two
judgements are extracted as shared pure functions:

1. `#print`'s `canIssueBank` print-vs-screen fallback.
2. `#dispatchLaunch`'s DoNow call + `launch_dispatched` append + honour-close.

The parity test below asserts the thing that actually matters and needs no edit to the file with
the highest blast radius in the subsystem.

### Config — three switches, and a master one that already exists

```yaml
# school.yml (household app config)
selfService:
  enabled: true                 # mint codes at agenda build
  mediaSurface: livingroom-tv   # household-wide; there is NO per-unit override
  idleTimeoutSeconds: 120

# NOTE (found building Task 6): earlier drafts promised a per-unit `media.surface`
# override. No such field exists and a unit cannot carry one — `unitValidation.mjs`
# types `media` as a bare reference into `manifestIds`, not an object, so
# `unit.media?.surface` is permanently undefined. Config is the only destination
# source. Per-unit destinations would need a unit-schema change first.

# data/household/screens/*.yml
school-room-portal:
  school: { mode: locked }      # this panel shows the keypad
```

Minting and locking are independent so rollout is staged: codes print on paper before any panel
locks, and a locked panel is testable before codes circulate. **Both off is today, exactly** — no
`accessCode` minted, no card, receipts unchanged.

The third switch is pre-existing and easy to forget: `schoolLifecycle.mjs:174` leaves the entire
lifecycle inert (routers unmounted) unless `lifecycle.enabled === true`. A panel configured
`mode: locked` against a disabled lifecycle shows a keypad whose `/resolve` 404s. Because D6 puts
lock mode in per-screen config that ships independently of `school.yml`, this **will** happen.

### Printer locality — a deployment precondition, not a knob

"Did it print?" only makes sense if the printer is in the room with the panel. But worksheets do
not route per job: they print through **one household laser adapter** injected into `IssueDocument`
at construction (`schoolLifecycle.mjs:307-323`, host from `school.yml printing.host`, falling back
to the `kitchen-printer` device), and `IssueDocument.execute({sessionId})` accepts no location
argument. `donow.yml`'s `thermalPrinterLocation` routes the DoNow *thermal surface*; school receipt
slips use `lifecycle.receiptPrinter`. Neither touches worksheets.

So there is no `selfService.printerLocation` to set. Either the laser is in earshot of the panel —
a stated deployment precondition — or per-job printer routing gets designed through `IssueDocument`
as separate work. If the laser stays in the kitchen, the confirm step should say
"Go and fetch it from the kitchen" rather than ask a question the child cannot answer.

### Degraded states

A wall kiosk loses its backend sometimes. Defined behaviour, not an accident:

- `/resolve` unreachable or 404 → "The school computer isn't answering. Tell a grown-up." plus a
  retry, and never a silently dead keypad.
- Lifecycle disabled → same message; a locked panel must never strand a child with no way forward.

## Section 5 — tests, rollout, risks

**Pure domain first.** `accessCode.mjs` and `offeredActions.mjs` take injected randomness and
injected state, read no clock and touch no I/O, so they test as tables in
`tests/isolated/domain/school/` the way `agenda.test.mjs` already does. Highest-value cases: the
zero-action rows (`served` / `locked` / `unavailable`), `bankPrintable` both ways, and the
`media_completed → [print]` handoff that replaces the dropped composite.

**Parity test.** For a given unit and state, assert the keypad path and the scan path call the same
use cases with the same arguments.

**Session-write test.** Assert that `/resolve` appends **no** events for an entry with no session —
the regression guard on the `ensureSession` hole.

**Expiry test.** Assert an access code minted before a 4am boundary is rejected after it, while its
`subject_next` token still resolves.

**Logging from the start**, on `context.app: school`: `code.rejected`, `code.resolved`,
`action.run`, `print.confirmed`, `print.debounced`, `print.retried`, `idle.timeout`.

**Rollout order:** codes print on paper (panel still open) → confirm codes resolve → lock the
school-room panel.

**Risks**

- Keypad quizzes must register occupancy through `SchoolService`, or DoNow will interrupt a child
  mid-quiz. This is the one place the keypad path can corrupt an existing guarantee.
- An unattended laser and a bored child. The debounce is the real backstop; the card now surfaces
  it, which also makes it discoverable rather than mysterious.
- Sibling code guessing is accepted (D1), and now explicitly extends to a sibling starting work on
  the panel via `school.launch`.

## Open questions

- Does the keypad need an "I don't have a code" affordance, or is the exit enough?
- Should a `served` resolution let a child re-open finished work, or is the sentence terminal?
- Does the idle timeout also close a running quiz, or only the card?
- Should SchoolCalc entries eventually mint `subject_next` tokens so they are keypad-reachable?
