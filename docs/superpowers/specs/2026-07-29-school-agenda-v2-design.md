# School Agenda v2 — subject sections, daily servings, one QR per subject

**Date:** 2026-07-29
**Status:** Draft for review
**Builds on:** [`2026-07-27-school-physical-console-architecture.md`](2026-07-27-school-physical-console-architecture.md)

---

## 1. What this is

Today a card tap prints a flat agenda: the child's name, a timestamp, one
CODE128 barcode per offered unit action, a footer. It reads only the curriculum
catalog and the assignment file, so the language ladder, Plex courses and every
other School program are invisible on paper, and nothing on the tape says how
the child is doing.

Agenda v2 turns the tape into a **daily, per-subject checklist**:

```
            FELIX
     Wed 30 Jul, 9:05 am
--------------------------------
MATH               Unit 2 of 4
Grade so far: 88%
Next: Adding Unlike Denominators
      — print your sheet
        [QR: subject_next]
--------------------------------
LANGUAGE  ✓ done today    Day 61
--------------------------------
READING            Unit 1 of 6
Next: The Lion, the Witch...
      — watch on the Portal
        [QR: subject_next]
--------------------------------
Scan a code to start.
Scan your card for a fresh list.
```

Four decisions, made with the household and fixed here:

1. **Curriculum is the umbrella.** Programs (language ladder, Plex courses…)
   become schedulable *by* the curriculum via a new **program unit** kind. The
   assignment file remains the single statement of "what this child is doing."
2. **One QR per subject**, meaning "the next thing for this subject," resolved
   server-side **at scan time**. Yesterday's tape still routes to today's right
   next thing.
3. **Each subject section prints:** progress through the course, grade so far,
   the next task's title + what kind of thing it is, and a done-today mark.
4. **Daily serving per subject:** one completion per subject per study day
   (4am→4am household time, the language ladder's boundary). Once served, the
   subject rests until tomorrow — the agenda is a *completable* checklist.
5. **Scanning a subject whose next task is on-screen work auto-launches the
   Portal** into that runner, claimed as the child. Paper is the remote control.

## 2. Data model — where everything lives

Nothing new is stored. Every fact the agenda prints is derived on read, the
posture the whole subsystem already holds.

| Fact | Source (existing unless marked NEW) |
|---|---|
| Curriculum | `data/content/school/curriculum/{units,documents,manifests}/` |
| Program units | NEW unit kind in the same directory |
| Assignment | `data/apps/school/assignments/{learner}.yml` (`courses:` + `units:`) |
| Progress (curriculum units) | work-session events, reduced on read |
| Progress (program units) | the program's own records, via `IProgramLauncher.status()` (NEW port) |
| Grade so far | derived at print: latest outcome percent per unit, averaged per subject; blended with a program's score when it reports one |
| Done today | any session outcome recorded this study day in that subject, or `status().doneToday` for a program unit |

### 2.1 The program unit

```yaml
# data/content/school/curriculum/units/language-daily.yml
unitId: language-daily
title: Language — today's sentences
subject: language
program: language        # NEW: delegates to a registered program
cadence: daily           # NEW: re-offers every study day; never terminally completed
provenance:
  source: hand-authored
  author: parent
  reviewState: approved
  reviewedOn: '2026-07-29'
```

Rules, enforced by `validateUnit` at catalog load (never at scan time):

- A unit carries **exactly one** composition: `media` | `document` | `bank` |
  `program`. A program unit with a `bank` is rejected.
- `program:` values are a **closed set in code** — the ids of registered
  program launchers (same posture as `categories.mjs`). An unknown program is
  a load-time rejection with the unit named.
- `cadence:` is an enum: `daily` (re-offers each study day) or `once`
  (default; behaves like any other unit). Only program units may declare
  `daily` for now — a daily worksheet is a plausible future, not this project.
- Program units take no `passing`, `retry`, `review`, or `reward` blocks —
  the program owns its own pedagogy and its own rewards. Present → rejected.

### 2.2 The program launcher port

```js
// backend/src/3_applications/school/ports/IProgramLauncher.mjs
/**
 * id: string — matches a unit's `program:` value
 * launch({ userId }) → { dispatched: boolean, detail? }
 * status({ userId }) → { doneToday: boolean, progressLabel: string|null,
 *                        score: number|null }   // score is a 0–1 ratio
 */
```

Deliberately separate from `IProgramReporter`: the reporter *describes* for
the parent board (many metrics, many reports); the launcher *acts* and answers
exactly the three things the agenda needs. Language study implements it first
(`doneToday` = its day queue complete; `progressLabel` = `Day 61`;
`score` = null — the ladder does not grade). A registry in the composition
root maps id → launcher; `BuildAgenda` and token resolution both read it.

Launchers are called per assigned program unit at print time. A launcher that
throws contributes an "unavailable" line for its subject — it never blanks the
agenda (the reporter contract's one-failing-program rule, held here too).

## 3. The agenda planner — pure policy

A new pure module, `#domains/school/agenda.mjs`, exporting
`planDailyAgenda({ plan, unitsById, sessionOutcomesToday, programStatuses,
now, timeZone })`. It consumes the existing `planLearnerWork` output and
returns subject sections. `planLearnerWork` itself is unchanged except that it
must pass program units through (they are always `available` — never locked,
never completed; a `daily` unit is not `completed` by yesterday's outcome).

### 3.1 The study day

4am→4am in the household time zone, the language ladder's boundary, computed
with the same rule (a session at 1am belongs to yesterday's list). Exposed as
`studyDayOf(isoInstant, timeZone)` and used for exactly one thing: deciding
which session outcomes and program completions count as "today."

### 3.2 Sections

Group the plan's entries by `subject` (a unit with no subject groups under
`other`). Order: the subject wall's nine-subject order, then `other`. Only
subjects with at least one assigned entry print — an unassigned subject is
not a greyed shelf on paper; tape is too narrow for consolation rows.

Per subject, derive:

- **`servedToday`** — true when any curriculum unit in the subject has a
  session outcome recorded this study day, or any program unit's status says
  `doneToday`. A served subject prints its header, the ✓ mark and its progress
  numbers, **no QR**.
- **`next`** — the single entry the QR will act on, chosen exactly as the
  planner already orders work: first `in_progress` entry, else first
  `available`. A subject with only `locked` entries prints the nearest
  blocker's remedy line instead of a QR (this can only happen cross-subject —
  within a subject the planner always surfaces the blocker itself).
- **`progressLabel`** — `Unit {min(passed+1, total)} of {total}` over the
  subject's assigned course, or `Course complete` once every unit has passed;
  for a pure program subject, the launcher's `progressLabel`. Mixed subjects
  prefer the course numbers (they are the sequenced thing).
- **`grade`** — mean of each assigned curriculum unit's **latest** outcome
  percent (attempted units only — unattempted work is not a zero), blended
  with the launcher's `score` (as a percent) when non-null, weighted equally
  per contributing item. No contributing evidence → line omitted entirely.
  Never stored.

The planner returns plain data; it never sees tokens, printers or the clock
(`now` is injected and only compared against, never read).

### 3.3 What "done for today" does NOT do

It does not lock anything. A child who scans an old per-unit ticket, or walks
to the Portal and does more math, is doing more school — every existing path
still works and still records. The daily serving governs only what the
**agenda offers**: a served subject stops printing a QR until tomorrow. Pacing
is a property of the paper, not a gate in the domain — consistent with "No
second gate anywhere."

## 4. Tokens and scan flow

### 4.1 The `subject_next` token class

A new token class alongside `identify`/`select_unit`/…:

- **Subject:** `{ learnerId, subject }` — no session, no unit. The binding to
  an actual unit happens at *resolution*, not at mint.
- **TTL:** 7 days (a subject pointer stays correct as the work advances; the
  card is still the recovery path for everything).
- **Minting:** one per printed subject section, at agenda build, via the
  existing `mintToken`/`ITokenRegistry` machinery.

### 4.2 Resolution

`ResolveScanAction` gains one branch. Resolving `subject_next`:

1. Recompute the learner's plan and `planDailyAgenda` sections (same code
   path as printing — one implementation of "what is next," used twice).
2. If the subject is `servedToday` → notice slip: *"Math is done for today.
   Nice work — scan your card tomorrow."*
3. Else route the subject's `next` entry by its composition, reusing the
   existing flows — the subject token is an **indirection**, not a new
   lifecycle:
   - `document` unit → ensure/reuse the work session (BuildAgenda's
     `#offerFor` logic, extracted so both callers share it) → `IssueDocument`
     prints the sheet.
   - `media` unit → `DispatchMedia` to the default child-selectable target.
   - `bank` unit → **Portal launch** (§4.3) into the quiz runner — replaces
     today's "go to the school screen" pointer slip for this path.
   - `program` unit → `IProgramLauncher.launch()` → Portal launch into the
     program's runner.
4. Every failure path ends in a printed notice (scan never succeeds silently,
   §6.2 of the console architecture). Dispatch refused / Portal unreachable →
   slip says what to do by hand ("Go to the Portal and open Language").

Idempotency inherits from the underlying flows: re-scanning a subject QR
mid-video hits `DispatchMedia`'s already-dispatched refusal; re-scanning after
a pass lands in `servedToday`.

### 4.3 Portal launch

Backend broadcasts on the existing WS bus, topic `school`, message
`{ type: 'school.launch', learnerId, target }` where `target` names a runner
(`{ kind: 'bank', bankId, unitId, sessionId }` or
`{ kind: 'program', program: 'language' }`). The School frontend (mounted as
the Portal's widget) subscribes via the shared WS lib, claims the learner's
identity (the same soft-claim the touch flow uses), and navigates to the
runner. If the School app is not mounted anywhere, nothing receives it — which
is why the printed slip for on-screen work always names the fallback by hand.

Frontend scope is deliberately small: one subscription hook + routing into
runners that all already exist (quiz runner, language runner, course player).

### 4.4 Sessions for program units

Program units do **not** open work sessions. Their evidence lives in the
program's own append-only records (that is what makes the language queue
derivable), and a parallel session would be a second source of truth about
the same sitting. `doneToday` comes from the launcher; the dispatch itself is
logged (structured log, not a session event).

## 5. Document and rendering

### 5.1 The agenda document

`agendaDocument` is rebuilt to emit sections from `planDailyAgenda` output,
still composed entirely of **existing block types** (`rich_text`,
`scan_action`) — the closed block set does not grow:

- Subject header: `## MATH` with the status/progress on the same line
  (`## MATH — Unit 2 of 4` / `## MATH ✓ done today`).
- Grade line, next-task line: plain `rich_text`.
- One `scan_action` per unserved subject, `label` = the next-task sentence,
  `action` = the `subject_next` token.
- Footer unchanged in spirit: scan a code to start; card for a fresh list.

`resultDocument` and `noticeDocument` are untouched. The per-unit agenda shape
remains reachable (the builders are pure); v2 is what the tap prints.

### 5.2 Rendering — `##` and QR

Two renderer changes, both in the ESC/POS path (`DocumentEscPosRenderer`):

- `##` headings render **bold, normal size, left-aligned** (today every `#`
  is centered double-size; `#` keeps that — it is the child's name).
- `scan_action` emits `{ type: 'qrcode', content, label }` when the renderer
  is constructed with `symbology: 'QR'` (the new default for the school
  console; CODE128 stays available).

`ThermalPrinterAdapter` gains the `qrcode` item type: ESC/POS `GS ( k`
model-2 QR (store → set module size/EC → print), sized to the school
printer's 58mm tape. The **virtual** adapter already accepts `qrcode`, so the
virtual-hardware tests exercise the same item stream the real printer gets.
The console's DS2278-class 2D imager reads QR natively; first hardware verify
happens on deploy, same as the NFC path did.

The PNG receipt renderer (`DocumentReceiptRenderer`) keeps drawing its code
box + readable token text; it is the preview/archive surface, not the tape.

## 6. Error handling

- **Catalog:** every new rule (§2.1) rejects at load with the unit named —
  `school.curriculum.invalid-units`, the existing lane.
- **A launcher that throws** at print → its subject prints an "unavailable —
  try the Portal" line, everything else survives. At scan → notice slip.
- **Empty agenda** (nothing assigned) → unchanged: the existing
  "ask a grown-up" notice.
- **Plan errors** (assigned course with no units, etc.) → logged as today,
  and the agenda still prints what it can.
- **Portal dispatch failures** → the scan still ends in paper (§4.2 rule 4).

## 7. Testing

Pure domain first, hardware doubles for the rest — the console's established
pattern:

1. **`agenda.mjs` unit tests** — study-day boundary (1am belongs to
   yesterday; TZ-sensitive), grouping + nine-subject order, servedToday from
   both evidence kinds, next-selection, progress label, grade math (latest
   attempt only; no-evidence omission; program blend).
2. **Catalog validation tests** — program unit exclusivity, unknown program,
   cadence enum, forbidden blocks.
3. **Token resolution tests** — `subject_next` routing per composition,
   served-today slip, launcher failure slip, TTL.
4. **Renderer tests** — `##` styling, QR item emission; golden agenda tape
   via the virtual thermal printer (dimension-stable like existing goldens).
5. **End-to-end via virtual hardware** — tap → sectioned agenda with N
   subject QRs; scan math QR → worksheet prints; scan language QR → WS
   `school.launch` observed; scan again after outcome → done-today slip.
6. **Frontend** — subscription hook test (message → claim + navigate).

## 8. Out of scope (named deferrals)

- Authoring more curriculum content (only `language-daily` + the existing
  math course ship as seed; breadth is content work).
- Daily-cadence for non-program units.
- Per-subject pacing knobs (daily serving is the one policy).
- Any change to coins/rewards, the parent board, or worksheet grading.
- Printing the agenda anywhere but the thermal console printer.
