# Teacher console · Today dashboard — UX remediation plan

**Date:** 2026-08-26
**Branch:** `school/teacher-roster-header` (branched from `deployed/school-scan` @ `97ccb1f0c`). All file:line references below are against that branch. Local `main` has an older `RosterStrip.jsx` (card design, no day dots) — do not read or patch `main`.
**Scope:** 13 reported UX defects on the Today tab of the teacher console (`/school/teacher`). This plan groups them into five frontend work items plus a backend follow-up set.

**Status: ALL ITEMS IMPLEMENTED (2026-08-26).** W0 · W1 `ff316dee7` · W2
`84f1c74a2` · W3 `822537816` · W4 `e07af2b15` · B1+B3 `437ceef36` · B2
`cd14582f7`. 1476 tests pass across the school domain, applications, and
frontend. Verified by feeding the live payloads from §0 through the new join:

```
civilization  | Done         | passed(green)   | Ohio
scripture     | Not started  | idle(faint)     | Tuesday · Psalms 62–66, 69
arts          | Done         | passed(green)   | Rhythm Improvisation with Chords
              | detail: Completed in its own program
ROW SUMMARY: "2 of 3 lessons done"      "Not graded" anywhere: no
```

Two notes for whoever deploys this. The arts card renders the clean lesson
name only once B2's backend change is live; until then the frontend chain
falls back to `progressLabel` and shows the whole "Done today — … · 35/366"
sentence, which is correct-but-clunky rather than wrong. And three
`rubiksCube` test files fail to load on this branch for unrelated reasons
(no test suite in the file) — they fail identically with these changes
stashed.

Deviations from the plan as written, all discovered while implementing:

1. **A recorded score outranks an absent `state`.** Marks exist only for work
   that happened, so a scored session is done even when the payload omits
   `state`. Without this a real fixture (5/5, 100%, no state) classified as
   "Not started". Cannot resurrect the original bug: the untouched session has
   no score at all.
2. **A missing `artifacts` field is not an empty one.** The "no worksheet"
   note fires only when the field is present and both members are empty —
   announcing it on silence would invent a fact.
3. **`'Not on the day's plan'` moved out of `detail` entirely** and became the
   `unplanned` tag, which is what removes the need for a precedence rule when
   a row is both unplanned and paperless.
4. **The poster fallback is not a `SafeImg` fallback prop** (which wraps its
   argument in a `<p>`): the subject glyph sits in the frame and the image
   covers it, so a missing URL and a 404 render identically.
5. **B2 went further than "improves copy with zero frontend rework".** The
   launcher was formatting the lesson name into a sentence and discarding the
   structure; it now returns both, and the card prefers the name.

**Three open questions settled by brainstorm on 2026-08-26** — the plan below
reflects the resolutions, and the superseded first drafts are gone rather than
left alongside:

1. **`extra` is retired as a status.** `status` describes progress for every
   row; provenance rides beside it as `unplanned: true`, mirroring the existing
   `carriedOver` flag. §2.3.
2. **No "No paper" caption.** The join authors every explanatory sentence and
   the footer's existing state slot renders it; the artifacts slot stays empty
   when there is nothing to link. §2.4.
3. **Status keys are kebab** (`in-progress`), matching `teacher-day-chip--${row.status}`
   and every other class in `Teacher.scss`. §2.3.

---

## 0. Evidence base (verified 2026-08-26)

Two GETs drive the screen. Re-run before starting; the learner-1 case exercises every defect at once:

```bash
curl -s https://{env.prod_host_public}/api/v1/school/teacher/today \
  | jq '.[] | select(.learnerId=="learner-1")'
curl -s "https://{env.prod_host_public}/api/v1/school/lifecycle/learners/learner-1/agenda/preview?format=json&studyDay=2026-08-26" \
  | jq '.sections'
```

Observed state, condensed:

| Subject | Agenda section | Digest session | Rendered card (wrong) |
|---|---|---|---|
| civilization | `servedToday:true`, `next:null`, `servedWork:[{unitId:atlas-us-p088-ohio, title:"Ohio"}]` | `ses_0rvg4nlj0i` `state:rewarded`, `effectiveScore` 6/6 100%, both artifacts | "Ohio / 6 checks / 100%" — correct |
| scripture | `servedToday:false`, `obligation.state:"obligated"`, `next` present (full taxonomy, poster, **and `sessionId:ses_gcu1tjn870`, `state:"created"`, `status:"in_progress"`**) | `ses_gcu1tjn870` `state:created`, `issuedAt:null`, `processedAt:null`, scores null, artifacts null, `reviewStatus:"complete"` | "DONE / Not graded" on work never started |
| arts | `servedToday:true`, `next:null`, `servedWork:[]`, `progressLabel:"Done today — Rhythm Improvisation with Chords · 35/366"`, `progressRows` incl. module label "Unit 2 · Chords & the Grand Staff" | no session | "No work offered / DONE / Completed — no session record", empty grey poster frame |

Collapsed row: "Learner 1 · 6 / 6 correct" with three all-green subject circles.

Two findings from this pass that extend or contradict the issue list:

1. **Issue 13(b) is disproven.** The roster/dot rules DO exist in committed source: `Teacher.scss:559-612`, nested SCSS under `.teacher-roster` (`&__card`, `&__identity`, `&__name`, `&__stats`, `&__sessions`, `&__dots`, `&__dot` with `&--passed/failed/idle`, `&__dot-initial`, `&__badge`), introduced by commit `fc9883ea8` which is in this branch's history. The shipped chunk (`assets/TeacherConsole-DJ2qIiXU.css` fetched from the live site) matches the source byte-for-byte on the distinctive values (`width:26px`, `border-color:#7fae7c`, `padding:8px 78px 8px 12px`). The original "missing from git" conclusion came from grepping for the *compiled* flat class names (`teacher-roster__dot--passed`), which never appear literally in nested SCSS. A rebuild from this branch ships the styles fine. There is no recovery prerequisite. See item **W0** for the one small documentation change this still earns.
2. **`gradePercent:1000` on the arts section** — `agenda.mjs:94-106` (`gradeFor`) multiplies a program status `score` by 100; the arts program evidently reports a score that is already 10× or percent-scaled. Nothing on this dashboard renders `gradePercent` today, so this is logged as a backend follow-up (B3), not one of the 13.

Also confirmed for design use: the agenda's scripture `next` already carries `sessionId` and `state`. The two payloads agree with each other; only the frontend join misreads them.

---

## 1. Root-cause map — 13 issues, 5 work items

Several issues are one bug seen from different angles. The grouping:

| Item | Issues | One-line root cause | Layer |
|---|---|---|---|
| **W0** | 13b | False alarm; document the grep trap | docs only |
| **W1** | 1, 2, 7, 9, (8) | `joinLearnerDay` collapses session existence into `done`; footer copy then has to invent vocabulary to paper over the missing state | frontend (`learnerDay.js`, `RosterStrip.jsx`, `Teacher.scss`) |
| **W2** | 3, 4 | The join throws away a served section's identity (`servedWork`, `progressLabel`, `progressRows`), so the card has no title and no poster to fall back to | frontend; optional backend enrichment (B2) |
| **W3** | 5, 10 | Card information hierarchy: header band promotes the breadcrumb over the title; subject icon ships at `opacity:.25` | frontend (markup + SCSS) |
| **W4** | 6, 11, 12, 13a | Collapsed roster row: headline stat is lesson-scoped arithmetic wearing day scope; resolved `studyDay` not passed down; stacked absolute-positioned tap targets | frontend (`RosterStrip.jsx`, `Teacher.scss`) |
| **B1–B3** | server-side halves of 2, 3, plus the gradePercent anomaly | `reviewStatus` defaults to `complete` pre-submission; served sections carry no course identity; `gradeFor` double-scales program scores | backend |

Dependency: **W1 is the foundation.** W2 and W4 consume its status model; W3 is independent. Details in §7.

---

## 2. W1 — Truthful status semantics + one footer vocabulary

Covers issues **1** (DONE on unstarted work), **2** (the "Not graded" conflation, frontend half), **7** (green dots for unstarted work), **9** (three state vocabularies in one grid), and the display rule for **8** (artifact absence copy — the rendering itself is finished in W2's card pass, but the rule is defined here).

### 2.1 Root cause

`learnerDay.js:113-121`: any session claimed by a section produces `status:'done'`, unconditionally. `ses_gcu1tjn870` is `state:"created"` (minted when the agenda was built, never issued, never worked) and the section itself says `servedToday:false`, `obligation.state:"obligated"` — both payloads state the truth; the join ignores them.

Downstream, everything else compensates:

- `RosterStrip.jsx:168-171` (`outcomeNote`): fires "Not graded" on any session with no `effectiveScore`, which covers both "never worked" and "this lesson type has no score". `reviewStatus:"complete"` on the unworked session makes the "Awaiting review" branch unreachable for it — the backend field answers a different question than the frontend asks (mechanism and fix in B1, §6).
- `RosterStrip.jsx:268-277` (`dotTone`): `status==='done'` with no percent → `'passed'` (green). With issue 1 upstream, an untouched lesson paints a green circle.
- `RosterStrip.jsx:190-197` (`scored`/`showChip`): because "done" spans everything from rewarded to untouched, the footer needs three different presentations (marks+%, chip+"Not graded", chip+"Completed — no session record") and nothing aligns across the grid.

### 2.2 Session-state vocabulary (the data this depends on)

The authoritative state machine is `backend/src/2_domains/school/sessions/sessionEvents.mjs:281-295` (`TRANSITIONS`). The digest's `sessions[].state` is that derived state verbatim (`GetTeacherToday.mjs:158`). Classify into three groups in `learnerDay.js`:

```js
// Terminal-or-evidence states: the work happened.
const DONE_STATES = new Set([
  'graded', 'outcome_recorded', 'rewarded', 'media_completed', 'external_activity_assessed',
]);
// The work is out in the world: paper printed, media playing, program launched,
// or a submission waiting on grading/review.
const IN_FLIGHT_STATES = new Set([
  'issued', 'reprinted', 'media_dispatched', 'media_stalled',
  'launch_dispatched', 'program_dispatched', 'external_activity_dispatched', 'submitted',
]);
// Everything else — 'created' (minted at agenda build, untouched), 'abandoned',
// 'failed' — confers no progress. The row keeps the session (for the drill-in
// link) but the status reads from the section.
```

Keep the sets in `learnerDay.js` next to `DAY_STATUS_LABEL`, with a comment naming `sessionEvents.mjs` as the source of truth. Do NOT import from the backend (the frontend has no path to `backend/src`); the property that guards drift is a test (§2.6).

### 2.3 Designed fix — the join

**Settled 2026-08-26 (brainstorm):** `status` describes PROGRESS and nothing
else, for every row. Provenance rides beside it as a flag. The plan's first
draft kept `extra` as a status value, which made `status` mean progress for
five values and provenance for one — the same conflation issue 9 exists to end,
reappearing one layer down. `carriedOver` already solves this exact shape in
this file; `unplanned` follows it.

Row shape:

```js
{ key, subject, status, planned, offer, served, session, detail,
  unplanned?: true,    // replaces status:'extra'
  carriedOver?: true,  // unchanged — the precedent this follows
  matchedOn }
```

```js
export const DAY_STATUS_LABEL = {
  done: 'Done',
  'in-progress': 'In progress',
  planned: 'Not started',
  deferred: 'Deferred',
  blocked: 'Blocked',
};   // `extra` retires — it was never a progress state

// One function, every row. `section` is null for the unplanned sweep.
function statusForSession(session, section) {
  if (section?.servedToday) return 'done';           // the planner's own verdict wins
  if (DONE_STATES.has(session?.state)) return 'done';
  if (IN_FLIGHT_STATES.has(session?.state)) return 'in-progress';
  return 'planned';                                   // created / abandoned / failed / unknown
}
```

The status key is kebab (`in-progress`), not snake. The chip class is composed
as `teacher-day-chip--${row.status}`, so kebab keeps it consistent with every
other class in `Teacher.scss` and needs no translation layer.

In `joinLearnerDay` (`learnerDay.js:113-121`), the matched branch becomes:

```js
matched.forEach((session, index) => rows.push({
  key: session.sessionId ?? `${rowKey('done')}:${index}`,
  subject, status: statusForSession(session, section),
  planned: index === 0 ? planned : null, offer, session, detail: null,
  matchedOn: index === 0 ? matchedOn : null,
}));
```

And the unplanned sweep (`learnerDay.js:167-176`) calls the same function with
no section, flagging provenance rather than encoding it as a status:

```js
rows.push({
  key: session?.sessionId ?? `${key}:extra:${index}`,
  subject: session?.subject ?? null,
  status: statusForSession(session, null),
  unplanned: true, planned: null, offer: null, session, detail: null,
});
```

Note `detail` is no longer `'Not on the day's plan'` — that sentence becomes the
`unplanned` tag (§2.4), which frees the detail slot for the paper copy and
removes any need for a precedence rule when a row is both unplanned and
paperless.

Rules that fall out and must hold in tests:

- The observed learner's scripture row: session `created` + `servedToday:false` → `status:'planned'`, session attached. The card reads "Not started" and still links to the session record.
- A session claimed in `submitted` → `in-progress` (the one case where "Awaiting review" is legitimate footer copy — §2.4).
- An unclaimed session in `created` → `planned` + `unplanned:true`: a session minted for work never planned and never begun. It reads "Not started · not on the plan" and paints a faint dot, rather than green.
- An unclaimed session in `rewarded` → `done` + `unplanned:true`: a green dot with a tag, which is the truth.
- The carried-over branch (`learnerDay.js:138-150`) is unchanged: `done` is guaranteed there by the section's `servedToday`, and `carriedOver` already flags its provenance.
- Order guarantee unchanged: rows still emit in section order; the join stays pure.

### 2.4 Designed fix — one footer vocabulary (issue 9, frontend half of 2, and issue 8)

**Settled 2026-08-26 (brainstorm):** the join authors every explanatory
sentence; `LessonCard` only places them. There is no "No paper" caption and no
new slot. The first draft put that caption inside `ArtifactButtons`, gated on a
session — which misses the case it was written for: `RosterStrip.jsx:250` guards
the whole component with `{session && …}`, and the served-by-program card (the
arts card, the one that reads as broken) has no session at all. Routing the
explanation through the state slot, which already renders `row.detail`, covers
every case and touches neither the call site nor the component.

`outcomeNote` is deleted and the string "Not graded" leaves the codebase.

**Detail authorship in `joinLearnerDay`:**

| Row | `detail` |
|---|---|
| served, no session | `'Completed in its own program'` (replaces "Completed — no session record") |
| `done`, session present, both artifact refs null | `'No worksheet for this one'` |
| `planned` | `section.timingNotice` (unchanged) |
| `deferred` / `blocked` | unchanged |
| unplanned | *(none — the flag renders as a tag, see below)* |

The paper sentence is set only on `done` rows: an `in-progress` session that has
been issued does have a worksheet, and a `planned` row is not expected to.
Reading `session.artifacts?.worksheet?.originalPdfUrl` keeps the join pure — it
is input inspection, not I/O.

**The one footer vocabulary:**

| Row status | Primary (left of foot) | Secondary line (only when it informs) | Artifacts slot |
|---|---|---|---|
| `done`, scored | `ScoreMarks` (marks + %) — no chip | `row.detail` when set | buttons, else empty |
| `done`, unscored | chip "Done" | `row.detail`; **never "Not graded"** | buttons, else empty |
| `in-progress` | chip "In progress" | `session.state==='submitted'` and `reviewStatus` pending → "Awaiting review"; `issued`/`reprinted` → "Worksheet out"; otherwise none | worksheet button when the PDF ref exists; no receipt yet |
| `planned` | chip "Not started" | `row.detail` (timing notice) | none — nothing is expected, absence is not news |
| `deferred` / `blocked` | chip (existing) | `row.detail` (existing) | none |

Two flags compose with any status above: `carriedOver` makes the chip read
"Done (earlier day)"; `unplanned` adds a small "not on the plan" tag beside the
chip. A tag rather than a tone, so it can sit on a green card without fighting
it.

`RosterStrip.jsx:250` keeps its `{session && <ArtifactButtons …/>}` guard
untouched. `ArtifactButtons` keeps its `return null`. No component gains a
status prop.

The string "Not graded" is deleted. `AWAITING`/`reviewStatus` is consulted only when `session.state` is `submitted` or later — which sidesteps the `reviewStatus:"complete"` default on unworked sessions entirely, and demotes **B1 from a correctness fix to optional cleanup**.

### 2.5 Designed fix — dot tones (issue 7)

`dotTone` (`RosterStrip.jsx:268-277`) becomes status-first, and — because
`status` now means progress for every row — loses its special case entirely:

```js
function dotTone(row) {
  const pct = row.session?.effectiveScore?.percent;
  if (pct != null) return pct >= PASS_PERCENT ? 'passed' : 'failed';
  if (row.status === 'done') return 'passed';
  if (row.status === 'in-progress') return 'active';
  if (row.status === 'blocked') return 'failed';
  return 'idle';   // planned, deferred
}
```

There is no `extra` branch. An unplanned lesson tones by its own progress like
any other row; the `unplanned` flag is not a tone, and the dot's existing
`title`/visually-hidden label is where it gets named.

New SCSS tone in the `.teacher-roster__dot` block (`Teacher.scss:591-599`) plus a chip tone:

```scss
&--active { border-color: #c9a35c; border-style: dashed; background: #fdf7e8; color: #8a6a2a; }
```

```scss
.teacher-day-chip--in-progress { background: #f6eed9; color: #8a6a2a; }
.teacher-day-chip--extra { /* DELETE — `extra` is no longer a status */ }
```

State must not ride on colour alone (issue 13a cross-check): the tones are also shape-coded — `passed`/`failed` solid fill, `active` dashed border, `idle` faint solid border on near-background fill. The existing `title` attribute and visually-hidden label (`RosterStrip.jsx:286-303`) already speak the status; they pick up "In progress" for free from `DAY_STATUS_LABEL`, and gain the "not on the plan" tag text where the flag is set.

The `unplanned` tag needs one rule of its own, beside the chip:

```scss
.teacher-day-chip__tag { margin-left: 6px; color: #7a7161; font-size: 11px;
  font-weight: 600; text-transform: none; letter-spacing: 0; }
```

### 2.6 Data dependencies

- `sessions[].state` — already on the wire (`GetTeacherToday.mjs:158`), already in the test fixtures (`TodayTab.test.jsx:59` uses `state:'graded'`).
- `sections[].servedToday`, `obligation.state` — already on the wire.
- No new fetches, no payload changes required. W1 is frontend-only.

### 2.7 Test changes

`learnerDay.test.js`:

- **Amend** `marks a planned subject with a recorded session as done` and every fixture that expects `done` from bare session existence: the `session()` factory must set `state:'graded'` (or `'rewarded'`) so existing done-assertions keep passing for the right reason.
- **New:** claimed session `state:'created'`, section `servedToday:false` → `status:'planned'`, session attached (the learner-1 scripture case, verbatim shapes from §0).
- **New:** claimed session `state:'issued'` → `in-progress`; `state:'submitted'` → `in-progress`.
- **New:** claimed session `state:'created'` but section `servedToday:true` → `done` (planner verdict wins).
- **Amend** every existing assertion of `status:'extra'` → `unplanned:true` plus the row's real progress status. The `emits unplanned work as extra` case splits in two: an unclaimed `rewarded` session → `{status:'done', unplanned:true}`; an unclaimed `created` session → `{status:'planned', unplanned:true}`.
- **New:** no row anywhere in the output carries `status:'extra'` (guards the retired value from creeping back).
- **New:** `detail` is null on unplanned rows — the provenance is the flag, not the sentence.
- **New:** a `done` row whose session has both artifact refs null gets `detail:'No worksheet for this one'`; an `in-progress` issued row does NOT.
- **New (drift guard):** a table-driven test asserting `DONE_STATES ∪ IN_FLIGHT_STATES ∪ {created, abandoned, failed}` covers every key of a locally-listed copy of the transition map's states, with a comment pointing at `sessionEvents.mjs` — if the backend grows a state, this test names the file to update.

`tabs/TodayTab.test.jsx`:

- `shows the day as a grid…` (line ~124): unchanged assertions still pass (fixture session is `graded`).
- **New:** a fixture learner with a `created` session claimed by an unserved section → grid card shows "Not started", no "Not graded" anywhere (`queryByText(/Not graded/)` is null), dot for that subject is not `--passed` (assert on the class of the dot span).
- The existing `says a session is awaiting review…` test (line ~196): fixture must set `state:'submitted'` on the pending session, or the new gate hides the label — this is the test that documents the gate.

`panels/LearnerDayView.test.jsx`: `LearnerDayView.jsx:114-115` renders the same `DAY_STATUS_LABEL` chips, so it is a second consumer of BOTH decisions — it must render the `unplanned` tag and stop expecting an `extra` label in the same commit, or the day record and the dashboard diverge. Add one case for an `in-progress` row and one for an unplanned row.

Harness `tests/_infrastructure/harnesses/teacher-roster-grid/check.mjs`: add one `in-progress` card to its fixture set; assert it renders a chip and no score marks. (Geometry assertions unchanged.)

---

## 3. W2 — Served-section identity (title, breadcrumb, poster)

Covers issues **3** ("No work offered" on a DONE card) and **4** (empty poster frame).

### 3.1 Root cause

`learnerDay.js:109`: `const offer = section?.next ?? null`. A served section's `next` is null **by construction** (`agenda.mjs:280`: `const next = !servedToday ? candidate : null`). The served-no-session branch (`learnerDay.js:152-157`) pushes `planned:null, offer:null`, so `LessonCard`'s title chain (`RosterStrip.jsx:186`) falls through to the literal `'No work offered'` and the poster chain (`:188`) to null. The section is holding the answer the whole time: `servedWork[]` (curriculum subjects), and `progressLabel`/`progressRows[]` (program subjects — arts: `progressLabel:"Done today — Rhythm Improvisation with Chords · 35/366"`, `progressRows[1].label:"Unit 2 · Chords & the Grand Staff"`).

### 3.2 Designed fix — pass the served identity through the join

`joinLearnerDay` attaches a `served` object to every row born of a `servedToday` section (both the carried-over branch and the no-session branch; harmless on the matched branch too, where the session outranks it):

```js
const served = section?.servedToday ? {
  work: Array.isArray(section.servedWork) ? section.servedWork : [],
  progressLabel: section.progressLabel ?? null,
  moduleLabel: (section.progressRows ?? []).find((r) => r.scope === 'module')?.label ?? null,
} : null;
// …rows.push({ …, served })
```

`LessonCard` derivation chains become:

```js
const title = session?.lessonTitle ?? session?.title
  ?? offer?.taxonomy?.lesson ?? row.planned
  ?? row.served?.work?.[0]?.title      // "Ohio" — curriculum served
  ?? row.served?.progressLabel         // "Done today — Rhythm Improvisation with Chords · 35/366"
  ?? 'No work offered';                // now reachable only when nothing anywhere names the work
const crumbs = [
  session?.courseTitle ?? offer?.taxonomy?.course,
  session?.moduleTitle ?? offer?.taxonomy?.unit ?? row.served?.moduleLabel,
].filter(Boolean);
```

`progressLabel` is used verbatim, never parsed: it is presentation copy authored by the program status (`agenda.mjs:51-56`, `progressLabelFor`), and slicing "Done today — " off it would rot with the next wording change. If the duplication of "Done today" against the Done chip grates, the right fix is B2 (backend supplies a clean title), not string surgery here.

When the served row also has `detail:'Completed — no session record'` (`learnerDay.js:155`), reword to **"Completed in its own program"** (this is the string §2.4's detail-authorship table refers to; change it in one place or neither) — the current copy reads as an error; the actual meaning is that the subject's program (piano/arts) owns completion outside a work session (per `docs/reference/school/agenda-and-completion.md`, obligation `served` via "the program's own daily evidence").

### 3.3 Designed fix — poster fallback (issue 4)

Keep the always-reserved 2:3 frame (`Teacher.scss:349-351`) — that is deliberate and stays. When `posterUrl` resolves null, render the subject's icon centered in the frame instead of leaving bare `#ece5d8`:

```jsx
<span className="teacher-lesson-card__poster">
  {posterUrl
    ? <SafeImg src={posterUrl} alt="" fallback="" />
    : <Icon name={subject ?? 'school'} className="teacher-lesson-card__poster-glyph" />}
</span>
```

```scss
&__poster-glyph { width: 26px; height: 26px; margin: auto; opacity: .45; color: #8a8070; }
// &__poster gains display:grid; place-items:center when no img — or unconditionally,
// grid centring does not disturb the block img.
```

Same fallback applies when `SafeImg` errors (it already collapses to nothing via `fallback=""`; switch to rendering the glyph on error so a 404 and a missing URL look identical). Card 2's poster, incidentally, already works — the offer carries one — and card 1's rides the session; only the served-no-session card needs this, plus any future 404.

### 3.4 Data dependencies

- `sections[].servedWork[]`, `progressLabel`, `progressRows[]` — already on the wire (verified §0; producer `agenda.mjs:355-380`).
- No poster URL exists for a served program section today. The icon fallback is the complete frontend answer; a real course poster needs **B2**.

### 3.5 Test changes

`learnerDay.test.js`:

- **Amend** `trusts servedToday when the planner says the day is complete…`: additionally assert `rows[0].served.work`/`progressLabel` pass-through.
- **New:** served section with empty `servedWork` but a `progressLabel` and a module `progressRows` entry → row carries both.

`tabs/TodayTab.test.jsx`:

- **New:** agenda fixture gains a served arts-shaped section (`servedToday:true, next:null, servedWork:[], progressLabel:'Done today — X', progressRows:[{scope:'module',label:'Unit 2'}]`), no matching session → the card shows the progressLabel as its title, the module label in the crumb, no "No work offered", and the poster frame contains an SVG (assert by class `teacher-lesson-card__poster-glyph`).
- **New:** served curriculum section with `servedWork:[{title:'Ohio'}]` claimed against nothing (empty sessions) → title "Ohio".

Harness: add a poster-less card to the fixture; assert the frame keeps its 2:3 box AND contains the glyph (extends the existing no-rug-pull geometry assertions).

---

## 4. W3 — Card hierarchy: the lesson outranks its shelf

Covers issues **5** (breadcrumb outranks the lesson) and **10** (icon opacity split).

### 4.1 Root cause

- `RosterStrip.jsx:225-230`: the header band stacks `SubjectIdentity` and the full course › unit breadcrumb — the least specific facts — in a tinted, uppercase, full-width band; the lesson title sits in the body at 15px (`Teacher.scss:352`). On the scripture card the crumb ("Come Follow Me — Old Testament 2026 › Unit 35: Aug 24–30 · Psalms 49–86") wraps to two clamped lines and visually outweighs "Tuesday · Psalms 62–66, 69".
- `Teacher.scss:377`: `.teacher-subject-identity__icon { opacity:.25 }` is the default; the day-dot context overrides to `opacity:1` (`:595`). At 18px and 25% opacity the header mark is near-invisible.
- Card 3's missing breadcrumb entirely is issue 3's root cause (fixed by W2's crumb chain); after W2 every card has at least a subject header and usually a crumb, so the hierarchy fix applies uniformly.

### 4.2 Designed fix

Reshape the card's reading order to: **subject (small, one line) → title (dominant) → locator (small)**.

Markup (`LessonCard`):

- Header band keeps only `SubjectIdentity` — one line, never wraps. The crumb moves out of the header.
- The crumb renders in the body, under the title, as a muted single-line locator: `<span className="teacher-lesson-card__crumbs">` after `<strong className="teacher-lesson-card__title">` inside `__identity`'s text column (the grid column already exists; make the text cell `display:grid; gap:3px`).

SCSS (`Teacher.scss:327-364` region):

```scss
&__header { padding: 6px 10px; }               // slimmer: one line now
&__title  { font-size: 17px; font-weight: 700; line-height: 1.18; }
&__crumbs { font-size: 11.5px; color: #8a8070; line-height: 1.3;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
```

One-line clamp on the crumb (was 2): after demotion it is a locator, and the fixed-height card budget goes to the title instead. `min-height` on the card likely drops from 200px to ~185px — re-derive with the harness rather than guessing; the invariant is footers aligned across the grid (`grid-auto-rows:1fr` unchanged).

Icon opacity (issue 10): delete the `.25` default at `Teacher.scss:377` — `opacity: 1` everywhere, with the mark's colour carried by the existing muted `color:#756b5d` on `.teacher-subject-identity`. Audit the other full-label usages before landing (they are: lesson cards here, `LessonIdentity` in `CurriculumIdentity.jsx`, day-record rows in `LearnerDayView.jsx`) — all want a visible mark; the dots' own override (`:595`) becomes redundant and can be dropped.

### 4.3 Data dependencies

None — pure presentation. Depends on W2 only in that card 3 gets a crumb worth positioning; there is no code dependency, W3 can land before or after W2.

### 4.4 Test changes

- `tabs/TodayTab.test.jsx` `drill-in names the lesson…` asserts the crumb text `'United States Regions and States › Midwest'` exists — keeps passing; add an assertion that the crumb is NOT inside `.teacher-lesson-card__header` (query within the header element).
- Harness `check.mjs`: add assertions that the computed font-size of `__title` exceeds that of `__crumbs` and of the subject label (a direct hierarchy check jsdom cannot do), and update any min-height expectations.

---

## 5. W4 — The collapsed roster row: circles first, truthful, tappable

Covers issues **6** (headline stat removed), **13a** (dots become the primary content), **11** (day-record link loses the date), **12** (stacked tap targets).

### 5.1 Root causes

- `RosterStrip.jsx:376`: `scored = (row.effectiveScoreTotals?.total ?? row.attemptsToday) > 0` — a lesson-scoped numerator/denominator presented at day scope; `:389-397` renders it as "6 / 6 correct". KC's instruction, verbatim: "the X out of Y correct is not meaningful at all… so let's just remove that entirely", and "the main thing is going to be those circles that represent assigned lessons for the day labeled by subject". `scored` also gates the "See today's plan →" link at `:424`.
- `RosterStrip.jsx:446` passes `studyDay={row.studyDay ?? undefined}` into `LearnerDayGrid` and `:426` builds the plan link the same way, even though `:364` already resolved `const studyDay = studyDayProp ?? row.studyDay ?? localDay()`. `row.studyDay` is absent on v1 digest rows (verified: the live payload has no top-level `studyDay`), so "Open the full day record →" navigates dateless.
- `Teacher.scss:285-288`: agenda link absolutely positioned at `right:32px`, disclosure at `right:12px`, both over the full-surface toggle button; the 78px right padding on the button (`:574`) reserves the lane but the interactive agenda anchor still sits ON the button, 20px from the (decorative) chevron, and `.teacher-roster__plan-link` has no rule of its own — it falls into flow below the card with whatever `teacher-btn` gives it.

### 5.2 Designed fix — the row's content

Collapsed row layout, left to right: **avatar · name · day circles · review badge · agenda button · chevron**.

- **Delete the stat line** (`:389-397`), both branches ("6 / 6 correct" and "nothing yet today"). The secondary line under the name becomes a lesson-scoped summary derived from the join, which is the only day-scoped truth available: `“{counts.done ?? 0} of {counts.total − (counts.extra ?? 0)} lessons done”`, plus `“ · {n} extra”` when extras exist. Render it only after the agenda read settles (same guard the dots already use at `:402`); while loading, name alone. When the agenda read fails, fall back to nothing — the dots degrade the same way today.
- **Promote the circles.** They already answer "which subjects are assigned today" (one dot per row, subject icon inside) — after W1 they also answer state truthfully: solid green passed, solid amber fell short, dashed amber in progress, faint not started, with the icon-in-disc carrying subject identity and the title/hidden-label carrying words. Size up: 30px discs, 16px icons, 6px gap (`Teacher.scss:590-600`). They wrap (existing `flex-wrap`), so a 1-lesson day is one disc and an 8-lesson day is a legible row; at 12+ they become two rows, which the SCSS comment at `:585` already accepts. No count caps or overflow affordances — the household roster's realistic ceiling is single digits.
- **Truthfulness dependency:** this item MUST NOT land before W1. Promoted circles that paint green for untouched work would enlarge issue 7, not fix it.

### 5.3 Designed fix — the plan-link gate (issue 6's second half)

`scored` at `:376` currently means "any machine-graded attempt today". After the stat line dies its only job is gating "See today's plan →". Replace with the join: show the link when the settled join has no `done` and no `in-progress` rows (`!(counts.done || counts['in-progress'])`), i.e. the learner has not begun the day. While the agenda is loading, suppress the link (it appears one beat later; acceptable, and it prevents a flash-then-vanish). Give it its own rule:

```scss
.teacher-roster__plan-link { margin: 2px 12px 4px 58px; justify-self: start; }
```

(58px aligns under the name column past the avatar; verify against the avatar's real width in the harness shots.)

### 5.4 Designed fix — studyDay pass-through (issue 11)

Two one-line changes in `RosterEntry`, using the already-resolved `studyDay` const from `:364`:

- `:446` → `studyDay={studyDay}`
- `:426` → `href={teacherDayPath(learnerId, studyDay, base)}`

`teacherDayPath` (`teacherUrl.js:83-87`) appends the segment only when truthy — with `localDay()` as the resolved fallback the link now always names the day it was showing. This pair is independent of everything else in W4 and may be cherry-picked ahead as a standalone fix.

### 5.5 Designed fix — tap targets (issue 12)

Take the two absolutely-positioned elements out of the stack. `.teacher-roster__entry` becomes a grid:

```
[ button (avatar · name+summary · dots · badge) | agenda-link | disclosure ]
```

- The **agenda link** leaves absolute positioning (`Teacher.scss:288` deleted) and becomes a grid sibling of the button: its own 44×44 cell with a 8px gutter, no longer overlapping the toggle surface. Markup order in `RosterEntry` already has it as a sibling — only the CSS moves.
- The **disclosure chevron** stays decorative (`pointer-events:none`, `aria-hidden`) but moves INSIDE the button as its last flex child, so it visually belongs to the surface it describes and stops sharing a corner with the agenda link. Delete `:285` and the 78px padding hack at `:574` (the lane no longer needs reserving — the grid does it).
- Entry rule sketch:

```scss
.teacher-roster__entry { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 8px; }
.teacher-roster__card  { grid-column: 1; padding: 8px 12px; }          // chevron now inside
.teacher-roster__agenda-link { grid-column: 2; align-self: center; }
.teacher-roster__plan-link, .teacher-roster__reflections, .teacher-roster__details { grid-column: 1 / -1; }
```

Result: two discrete ≥44px targets (row toggle, agenda) with real separation, matching the repo's stated touch rule ("touch UI: discrete, ≥40px", `Teacher.scss:367`).

### 5.6 Data dependencies

`joined.counts` (already returned by `joinLearnerDay`; gains `in-progress` in W1). No API changes.

### 5.7 Test changes

`tabs/TodayTab.test.jsx`:

- `joins digest rows… shows the day numbers` (`:92-97`): the `5 / 7` assertion inverts — assert `queryByText(/\d+\s*\/\s*\d+\s*correct/)` is null; assert the lesson summary ("1 of 2 lessons done" for the learner-a fixture) appears after the agenda settles.
- `points an idle learner at their plan…` (`:189`): keeps passing — learner-b joins to zero done rows; amend to also assert learner-a (who has a done row) does NOT get the link.
- **New (issue 11):** assert `Open the full day record` href ends with `/day/2026-08-26`-style segment when the fixture digest row carries `studyDay` on sessions but not on the row — mock `localDay` or inject `studyDay` via the `RosterStrip` prop path (`TodayTab` passes `studyDay={…today.data?.studyDay…}`; the array-shaped fixture passes null, exercising the `localDay()` fallback — pin the date with `vi.setSystemTime`).
- **New (issue 12):** agenda link and roster button are separate accessibility-tree targets and the link is not a descendant of the button (it never was in markup; the regression this guards is someone "simplifying" the layout by nesting it).

Harness `check.mjs`: assert the two targets' bounding boxes do not intersect and each is ≥44px; assert dot diameter ≥30px; refresh screenshots.

`panels/LearnerDayView.test.jsx`: untouched by W4 (the day-record view has its own header).

---

## 6. Backend follow-ups (separate, none block the frontend items)

**B1 — `reviewStatus` tri-state.** `GetTeacherToday.mjs:164`: `reviewStatus: pending.some(…) ? 'pending' : 'complete'` — the field answers "is this session in the pending-review queue", so a never-worked session reads `"complete"`. That is what made issue 2's "Awaiting review" branch look dead. W1's frontend gate (consult reviewStatus only from `submitted` onward) makes the display correct regardless, so this is **optional cleanup, not a correctness fix** (settled 2026-08-26); the cleaner contract is `reviewStatus: null` (or `'none'`) until the session has something reviewable — i.e. when `state` has not passed `submitted`. Wire-compatible for this dashboard once W1 lands (the frontend accepts `'pending' | 'complete' | null`). Update `GetTeacherToday.test.mjs` alongside.

**B2 — served-section identity enrichment.** `agenda.mjs:379-381` populates `servedWork` only from curriculum entries (`passedTodayIds`); program-served subjects (arts, piano) contribute nothing, leaving the frontend to display `progressLabel` verbatim (W2). Enrichment: when `programDone` made the section served, emit a `servedWork` entry (or a sibling `servedProgram: { title, courseId?, posterUrl? }`) from the program status that set `doneToday` — the status already carries `progressLabel` (`agenda.mjs:207`); whether it carries a clean lesson title and course identity needs a look at the program-status producers before committing to a shape. Frontend W2 is written to prefer `servedWork[0].title` first, so B2 improves copy with zero frontend rework. Also the natural home for a served-section poster (issue 4's ideal endgame; the icon fallback remains for subjects that will never have cover art).

**B3 — `gradePercent` double-scaling.** `agenda.mjs:101`: `values.push(s.score * 100)` produced `gradePercent:1000` for arts (observed §0). Either the program status's `score` contract is 0–1 and the arts producer violates it, or the contract is percent and `gradeFor` should not scale. Nothing on this dashboard renders the field, so this is an audit-and-fix with its own test, not part of the 13 — but do it before anything starts trusting `gradePercent`.

---

## 7. Work breakdown, sequencing, and what lands together

```
W0 (docs note)         — independent, any time
W1 (status semantics)  — FIRST. Foundation for W2 footer interplay and W4 dots.
W2 (served identity)   — after W1 (same files; §2.4's detail table names W2's rewording,
                          authored in §3.2 — the two must agree on the exact string)
W3 (card hierarchy)    — independent of W1/W2 logic; touches the same JSX/SCSS regions,
                          so schedule to avoid textual conflicts, but no ordering constraint
W4 (collapsed row)     — after W1 (truthful dots are the precondition for promoting them);
                          §5.4 (issue 11, studyDay) is a 2-line independent fix, cherry-pickable first
B1/B2/B3               — independent of each other and of the frontend items; B2 best after W2
                          so the frontend fallback chain is already in place to receive it
```

**Must land together (atomic units):**

- W1 is one commit/PR: join + footer + dots + chip/dot SCSS + **`LearnerDayView.jsx`** + all its tests. Three reasons it cannot be split:
  - Splitting the join change from the footer change ships an incoherent middle state ("Not started" chip beside a "Not graded" note on the same card, because `outcomeNote` fires on any session with no score).
  - Retiring `status:'extra'` is a breaking change to the row contract. `LearnerDayView.jsx:114-115` is a second consumer of `DAY_STATUS_LABEL`; if it lands a commit later, the day record renders `undefined` where the dashboard renders a tag.
  - Moving `'Not on the day's plan'` from `detail` to the `unplanned` tag means provenance vanishes from the UI in any interval where the join has changed and the card has not.
- W4's §5.2 (delete stat line) and §5.3 (plan-link gate) land together — the gate's only input dies with the stat line.
- Everything else is a coherent standalone step.

**Parallelizable across two engineers:** {W1 → W4} as one lane, {W3, W0, B1, B3} as another; W2 and B2 slot behind their prerequisites in either lane.

**Verification gates per item:** vitest suites named in each section (run directly with `npx vitest`, not the Jest-routed `--only=domain` path), plus one run of `node tests/_infrastructure/harnesses/teacher-roster-grid/check.mjs` after each of W3/W4 with screenshots reviewed. End with the learner-1 curls from §0 against a dev build: the expected render is — civilization "Ohio / marks / 100%"; scripture "Tuesday · Psalms 62–66, 69 / Not started" with poster and no review copy; arts "Done today — Rhythm Improvisation with Chords · 35/366 / Done / Completed in its own program" with icon-in-frame; collapsed row "Learner 1 · 2 of 3 lessons done" with green/faint/green circles.

---

## 8. W0 — Close out the 13b false alarm

No recovery work (see §0, finding 1). Two small edits so the next reader does not re-derive it:

- `frontend/src/modules/School/teacher/README.md`, "Verifying against what is actually deployed": add one line — compiled class names (`teacher-roster__dot--passed`) never appear in nested SCSS; grep the source for the nested form (`&__dot` under `.teacher-roster`) before concluding a rule is missing from git.
- No harness or build change: source, git history, and shipped CSS agree.

---

## Appendix — file:line index

| Ref | What |
|---|---|
| `frontend/src/modules/School/teacher/learnerDay.js:36-42` | `DAY_STATUS_LABEL` (extend, W1) |
| `learnerDay.js:109` | `offer = section?.next ?? null` (issue 3 seed) |
| `learnerDay.js:113-121` | matched branch — unconditional `done` (issue 1) |
| `learnerDay.js:136-157` | servedToday branches (W2 pass-through; detail copy) |
| `panels/RosterStrip.jsx:168-171` | `outcomeNote` (issue 2) |
| `panels/RosterStrip.jsx:186-197` | title/poster chains, `scored`, `showChip` (issues 3, 4, 9) |
| `panels/RosterStrip.jsx:210, 225-230` | crumbs + header band (issue 5) |
| `panels/RosterStrip.jsx:268-277` | `dotTone` (issue 7) |
| `panels/RosterStrip.jsx:364, 426, 446` | studyDay resolution vs raw pass-through (issue 11) |
| `panels/RosterStrip.jsx:376, 389-397, 424-429` | `scored`, stat line, plan-link gate (issues 6, 13a) |
| `Teacher.scss:285-288, 574` | absolute-positioned targets + padding lane (issue 12) |
| `Teacher.scss:377` | icon `opacity:.25` default (issue 10) |
| `Teacher.scss:559-612` | roster card/dot rules — present and shipped (13b disproof) |
| `panels/LearnerDayView.jsx:114-115, 146` | second consumer of the join + labels |
| `backend/src/2_domains/school/sessions/sessionEvents.mjs:281-295` | session state machine (W1 source of truth) |
| `backend/src/3_applications/school/usecases/GetTeacherToday.mjs:158, 164` | `state` pass-through; `reviewStatus` default (B1) |
| `backend/src/2_domains/school/agenda.mjs:277-283, 355-381` | `servedToday`/`next`/`servedWork` derivation (W2, B2) |
| `backend/src/2_domains/school/agenda.mjs:94-106` | `gradeFor` double-scaling (B3) |
