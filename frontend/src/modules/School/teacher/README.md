# Teacher console — code map

**Live URL:** `/school/teacher` (prod: `{prod_host}` → `daylightlocal.kckern.net/school/teacher`)

This file exists so "where does the thing I'm looking at on screen come from?"
is a lookup, not an investigation. Start here before grepping.

---

## Screen → file

The dashboard the URL lands on is the **Today tab**. Reading down the page:

| What you see | Component | File |
|---|---|---|
| "HOUSEHOLD SCHOOL / Today at a glance" heading + "Open action queue" | `TeacherConsole` | `TeacherConsole.jsx` |
| The "Today" card, its loading/empty/error frame | `TodayTab` → `PanelFrame` | `tabs/TodayTab.jsx`, `panels/PanelFrame.jsx` |
| One collapsed row per learner (avatar, name, "6 / 6 correct", day dots, agenda icon, chevron) | `RosterEntry`, `DayDots` | `panels/RosterStrip.jsx` |
| The expanded grid of lesson cards under a learner | `LearnerDayGrid` | `panels/RosterStrip.jsx` |
| **One lesson card** — subject header band, breadcrumb, poster, title, footer chip/score/paper icons | `LessonCard` | `panels/RosterStrip.jsx` |
| A card that says "This program can't start" / "Locked behind work nothing can reach" (red header/foot) | `LessonCard` (`teacher-lesson-card--faulted`) | `panels/RosterStrip.jsx` |
| The muted excuse sentence / "Open Courses" / "School → Operations" link in a card's footer | `LessonCard` (`GROWN_UP_ACTION`, `MUTED_EXCUSE_FALLBACK`) | `panels/RosterStrip.jsx` |
| Green ✓ / red ✗ marks + percent | `ScoreMarks` | `panels/RosterStrip.jsx` |
| The PDF / receipt square buttons | `ArtifactButtons` | `panels/RosterStrip.jsx` |
| "CIVILIZATION" / "SCRIPTURE & GOSPEL" subject label + icon | `SubjectIdentity` | `CurriculumIdentity.jsx` (labels: `../home/subjects.js`, icons: `../home/icons/svg/*.svg`) |
| "· N to review / N prints / N quiz requests →" strip | `BacklogStrip` | `tabs/TodayTab.jsx` |
| "N subjects need a grown-up →" strip, above the roster | `GrownUpStrip` | `tabs/TodayTab.jsx` (tally reported up from `panels/RosterStrip.jsx`'s `onNeedsGrownUp`) |
| The Records tab, day record, session detail | `RecordsTab`, `WorkspaceViews` | `tabs/RecordsTab.jsx`, `WorkspaceViews.jsx`, `panels/LearnerDayView.jsx` |

**Decides Done / Not started / Deferred / Blocked / Extra, and which session
belongs to which planned lesson:** `learnerDay.js` (`joinLearnerDay`). Pure
function, no fetching — this is where card status and titles are actually
decided, *not* in the JSX. Status copy: `DAY_STATUS_LABEL` in the same file.

**All styling:** `Teacher.scss` (single file, ~1500 lines). Card bands are
`.teacher-lesson-card__header / __body / __foot`; grid is
`.teacher-lesson-grid`; roster row is `.teacher-roster__*`.

---

## The two API reads behind the Today tab

Everything on that screen comes from exactly two GETs. Curl them first — most
"the UI is wrong" questions are answered by the payload without opening a file.

```bash
# 1. The digest: one row per learner, with RECORDED sessions, scores, artifacts.
curl -s https://daylightlocal.kckern.net/api/v1/school/teacher/today \
  | jq '.[] | select(.learnerId=="learner-1")
        | {effectiveScoreTotals, pendingReview,
           sessions: [.sessions[] | {sessionId, subject, unitId, lessonTitle,
             courseTitle, moduleTitle, posterUrl, state, reviewStatus,
             effectiveScore, outcome, artifacts}]}'

# 2. The plan: one section per subject — what was OFFERED today.
#    Fetched lazily per learner (RosterEntry), GET-only and non-recording.
curl -s "https://daylightlocal.kckern.net/api/v1/school/lifecycle/learners/learner-1/agenda/preview?format=json&studyDay=$(date +%F)" \
  | jq '.sections'
```

Client wrappers: `schoolApi.teacherToday()` and `schoolApi.agendaPreview()` in
`../schoolApi.js`. Fetch/retry/empty-state wrapper: `usePanelFetch.js`.

### Field cheat-sheet (the ones that drive what renders)

**Digest session** — `state` is the progress source of truth (`created` =
minted, never worked · `issued` = paper is out · `submitted` = awaiting a mark ·
`rewarded`/`graded` = finished); `effectiveScore` (`null` when nothing was
machine-scored — a score outranks a missing `state`); `reviewStatus`
(`pending` | `complete` | `null`, null until there is something reviewable);
`outcome` (`null` until it lands); `artifacts.worksheet.originalPdfUrl` /
`artifacts.receipt.originalUrl` (both `null` ⇒ no paper icons — and a missing
`artifacts` key is not the same as an empty one).

**Agenda section** — `next` (the offer: `taxonomy`, `posterUrl`, `unitId`;
**`null` once the subject is served**), `servedToday`, `servedWork[]`,
`progressLabel`, `progressRows[]`, `suppressed`, `lockedRemedy`,
`obligation: { state, reason }` (see `docs/reference/school/teacher.md` §4 for
the full 4-state/11-reason ladder).

`joinLearnerDay` matches a session to a section by `unitId` first, subject
second, then decides progress from `servedToday` → score → `state`. `status` is
always progress (`done` | `in-progress` | `planned` | `deferred` | `blocked`);
provenance rides beside it as the `unplanned` / `carriedOver` flags. The join
also authors the footer's explanatory sentences, so the card places copy it
does not write.

**`row.obligation`** is the planner's verdict carried through unchanged, plus
one thing the join computes: `needsGrownUp` (`true` for exactly four reasons —
the two that fault, `caught_up`, and `awaiting_grown_up`). `status` and
`obligation` are two separate facts shown together, never merged into one
badge — a row can be `planned` under `excused`. `RosterStrip.jsx` reads
`needsGrownUp` to decide the fault card treatment, the action link, and the
collapsed row's dot tone; it does not re-derive the classification. A `null`
obligation (an older payload, or a subject the planner never judged) renders
nothing extra.

`LessonCard` reads its title/course/poster from `session` first, then
`row.offer` (= `section.next`, which is `null` once a subject is served), then
`row.served` (`servedWork` / `progressLabel` / the module `progressRows` label).

---

## Verifying against what is actually deployed

⚠️ Local `main` is routinely **behind** prod. Prod builds from a worktree on
the homeserver, on a feature branch that is often unpushed.

```bash
# Which tree built the running container?
ssh homeserver.local 'cd /opt/Code/DaylightStation && git worktree list'
ssh homeserver.local 'docker exec daylight-station md5sum \
  /usr/src/app/frontend/src/modules/School/teacher/panels/RosterStrip.jsx'
md5 -q frontend/src/modules/School/teacher/panels/RosterStrip.jsx   # compare

# Pull that branch locally so you can read/diff it properly
git fetch homeserver.local:/opt/Code/DaylightStation \
  'refs/heads/<branch>:refs/remotes/deployed/<branch>'
```

The served CSS is a code-split chunk, **not** `assets/index-*.css` — grep
`assets/TeacherConsole-*.css` instead, or you will conclude a rule is missing
when it ships fine.

**The nested-SCSS grep trap.** `Teacher.scss` nests heavily, so a compiled class
name never appears literally in the source: `.teacher-roster__dot--passed` is
written `&--passed` inside `&__dot` inside `.teacher-roster`. Grepping the
source for the flat name returns nothing and reads exactly like "this rule was
never committed." Grep for the nested form, or search the selector's parent
block. (This cost a full investigation on 2026-08-26 and produced a wrong
conclusion that the live CSS had been built from an uncommitted tree.) The `dist/` in the image can also be ahead of the `src/` in
the image; trust `dist/` for "what the browser got".

Logs: `context.app:school` in the log store (see root `CLAUDE.md` → Reading Logs).

---

## Related docs

- `docs/reference/school/teacher.md` — the flow model: every lifecycle, every
  state, and the teacher's move out of each one. Start there when the question
  is "the work is sitting in X — what can a grown-up do about it?"
- `docs/reference/school/README.md` — the school reference index
- `docs/reference/school/agenda-and-completion.md` — how `sections`, `servedToday`, and completion are derived
- `docs/reference/school/print-documents.md` — worksheets, receipts, OMR grading
