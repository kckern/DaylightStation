# Teacher View Information-Architecture Audit — Are the Teachers Right?

**Date:** 2026-08-25 · **Surface:** `/school/teacher` (`frontend/src/modules/School/teacher/`)
**Method:** code-level read of the workspace shell, views, tabs, and panels; six production screenshots (dashboard, dashboard drill-in, session inspector `ses_f1eJJS0u`, and a Civilization session detail) supplied by the operator.
**Prior art:** `2026-08-24-teacher-console-ux-audit.md` (39 findings, remediated same day).

---

## Verdict

**The teachers are right, and this is a different class of problem than yesterday's audit fixed.** The 2026-08-24 remediation addressed itemized defects — leaked internals, unconfirmed destructive actions, dead code, copy drift, broken thumbnails. Those fixes are visible and real. But every complaint the teachers raise today is *structural*: the workspace is architected as vertical stacks of independent, independently-fetched panels (`PanelFrame` per fetch, pages defined as panel lists in `WorkspaceViews.jsx`), and no amount of per-panel polish fixes a page whose composition is "everything we have about this scope, stacked." The complaints map one-to-one onto identifiable architectural decisions, itemized below.

What the teachers are *not* right about: the underlying operational discipline is genuinely good — five-state fetch contract, preview-before-apply on every write, attribution on every correction, destructive verbs demoted below the fold. The raw material for a good workspace is all here. It is the composition layer that is missing.

---

## IA1 — One lesson renders in up to four framings; the repetition is architectural

**HIGH.** Follow one completed lesson (Monday · Psalms 49, 50, 51, 61) through the dashboard drill-in and inspector:

1. Session card under **Today** (`RosterStrip.jsx:79-82`) — title, course, week range, date, score.
2. Possibly again under **Processed today** (`RosterStrip.jsx:83-86`) with near-identical chrome.
3. Again under **Today's paper and results** (`LearnerDay.jsx`) — a *second full fetch of the same session* (`SessionArtifacts` calls `teacherWorkspaceApi.session()` per session, N+1) to render worksheet + receipt cards.
4. In the **Session inspector**, the five questions render **twice on one page**: "Worksheet and questions" (`WorkspaceViews.jsx:604-613`) prints every prompt with lettered choices, then "Answers and result" (`:614-626`) reprints every prompt verbatim with the answer appended.

The score is equally repeated: roster row ("10 / 10 correct across 2 assignments"), per-session card ("5 of 5 correct · 100%" — the percent restates the fraction), then the inspector's **Marked score 100% / Current score 100%** — two score concepts shown side-by-side that are identical in the common case (no teacher correction exists). Teachers reading "unnecessary repetition" are describing this precisely.

**Fix shape:** one graded-worksheet view in the inspector (question · choices · their answer · verdict, one list); one score with a "corrected from X%" annotation only when an adjustment exists; artifact cards folded into the session card as a footer row instead of a third dashboard section.

## IA2 — "Today" means three different things and nothing explains the difference

**HIGH.** The taxonomy mixes three time concepts with no gloss:

- **Calendar today** — the dashboard's "Today" panel (sessions graded today).
- **Study day** — the curriculum day. A card titled "**Monday** · Psalms 49…" carries right-side meta "**Tuesday, Aug 25**" (RosterStrip renders `humanDate(session.studyDay)`; the lesson's *name* carries the curriculum weekday). A teacher cannot tell at a glance whether Student A did Monday's work a day late or two days' work in one sitting.
- **Processed today** — work from an *earlier* study day graded today (`RosterStrip.jsx:83`), presented as a sibling section with only its header as explanation.

Then "2 assignments" and "2 sessions" appear side by side on the same roster row (`RosterStrip.jsx:48,57`) as parallel unexplained counts. This is the "taxonomy not well thought through" complaint, verbatim.

**Fix shape:** pick one primary axis (study day), label completion dates explicitly ("done Tue Aug 25", "late — planned Mon"), merge Processed-today into the same list with a badge, and drop one of assignments/sessions.

## IA3 — Plan, current state, and history are three disjoint surfaces; retracing a day is a scavenger hunt

**HIGH.** The teachers' hardest complaint — "going back in time … what was the agenda, what have they done, combining current states with history, with plans" — maps to this split:

- The **agenda (plan)** exists only on Learner Overview as `AgendaPreview`, framed as a *planning* tool with the disclaimer "Planning preview only — this never creates a session, agenda artifact, print record, working QR, or digit code" (`WorkspaceViews.jsx:99`) — five nouns of internal jargon reassuring the teacher about failure modes she never imagined.
- **Done-that-day** lives beside it in `SessionList` scoped to the picked study day — Overview is *already* a de-facto day view (plan + actuals share `studyDay`), but nothing presents it as the way to retrace a day.
- **History** is a separate tab with a *different* data source (`teacherWorkspaceApi.timeline`) and **no day picker** — it cannot answer "what was planned that day," only list sessions.
- The **dashboard drill-in** is a third disjoint rendering of the same sessions with different chrome.

So "what was Student A supposed to do Tuesday, what did he do, what's left" requires Overview (re-pick the date, mentally reframe a 'planning preview' as a historical record), cross-check History, and open the inspector per session. The join the teacher wants — plan vs. actual per subject — is *already computed* (`completedBySubject`, `WorkspaceViews.jsx:85-90`) but presented as a planning aside.

**Fix shape:** promote Overview's day view to the canonical **Learner Day** record: agenda sections joined with outcomes, navigable to any date, linked from dashboard rows and from History (which becomes day-grouped). One surface, three tenses.

## IA4 — Interventions are scattered across four homes under five names, with duplication instead of navigation

**HIGH.** The override/repair vocabulary and placement:

| Intervention | Name in UI | Lives at |
|---|---|---|
| Grade fix | "Correct grade…" | Session inspector |
| Retake | "Offer retake" | Session inspector (conditional) |
| Completion credit / attestation | "Attestation" | Learner Operations ("Repair X's record") |
| Move a session | "Reassign" | Learner Operations |
| Skip/defer/replace curriculum | "Curriculum exceptions" | **Three renders of the identical form**: Curriculum landing (`WorkspaceViews.jsx:399`), Curriculum course drill-in (`:395`), School Operations (`:407`) |
| Gate/lesson overrides | "Active overrides" | School Operations only |
| Bulk regrade | "Systematic regrade" | School Operations |

Same-panel duplication extends beyond exceptions: `StaleSessions` renders on Learner Operations *and* School Operations; `MilestonesPanel` on Overview *and* Courses. Duplication is being used as a substitute for navigation — the module copes with "where does this live?" by rendering it everywhere plausible. Meanwhile "Exceptions," "Overrides," "Attestations," "Corrections," and "Repair" are five words for one concept-family with no index anywhere that says which tool matches which situation — despite `LearnerOperationsView`'s own heading copy ("Use the narrowest intervention that matches what actually happened") promising exactly that guidance.

**Fix shape:** one Interventions taxonomy page (or drawer) listing every tool with a one-line "use when…", each form rendered in exactly one home, linked (not duplicated) from context. The session inspector links to it with session context prefilled.

## IA5 — CTAs are haphazard; the complaint is confirmed

**MED.**

- The inspector's action row (`WorkspaceViews.jsx:601`) mixes a conditional button (Offer retake), a disclosure form trigger ("Correct grade…"), and **a cross-page link styled as a peer control**: "Completion credit — Student operations" — an `<a>` wearing the *back-link* class (`teacher-back`), labeled noun-dash-noun so it reads as a form label, not an action. No primary/secondary distinction anywhere in the row.
- "Print another copy…" renders *outside* the artifact card it belongs to, right-aligned in the gutter between two cards (screenshot: it sits ambiguously between the worksheet card above and receipt card below).
- Dashboard: the page's single primary button ("Open action queue") and the `BacklogStrip` ("0 to review · 0 prints · 0 quiz requests →") are **two CTAs to the same destination**, and the strip renders even when every count is zero (`TodayTab.jsx:27-32` — `0 != null`), so the emptiest possible state still advertises two routes into an empty queue.
- "nothing yet today" rows (Student B, Student C) are dead ends — no affordance toward "what *should* they be doing," which is one click of agenda data away.
- "Preview not available" renders as underlined link-styled text inside the thumbnail slot — it reads as a broken link, and in the screenshots it is the *majority* worksheet-preview state, so the first visual impression of the paper-records feature is failure.

## IA6 — Flat visual hierarchy: every fact at the same volume

**MED.** `PanelFrame` gives every panel an identical `h2` and identical beige card regardless of importance, and pages are stacks of them. The session inspector stacks seven co-equal panels: Outcome · Worksheet and questions · Answers and result · Answer card · Issued materials · Grade corrections · Event history. Within them:

- The **Answers** list center-aligns question prose in a ragged middle column with the verdict — the one token a teacher scans for — in small right-aligned gray text, undifferentiated from "Their answer" (screenshots 4 and 6; the lone "Incorrect" on the Civilization page is nearly invisible).
- The **Answer card** panel (Student No. 2487270 · 16 of 50 rows used · 34 contiguous slots · next row 17) is OMR print-infrastructure state placed mid-page in a pedagogical review — the audience taxonomy is wrong; it belongs with print operations, behind a disclosure at most.
- **Event history** gives nine lifecycle rows — six sharing the identical timestamp "2:03 PM" — the same visual weight as the outcome.
- Raw internals still leak at the pedagogy layer: "Their answer: **B,D** · Correct" (multi-select rendered as bank letters while every sibling row shows answer text).

**Fix shape:** three visual tiers on the inspector — outcome + graded worksheet (primary), paper records (secondary), audit trail + OMR card (collapsed tertiary). Left-align question text; color/weight the verdict; hide machine-vs-effective score unless they differ.

---

## Why yesterday's "all remediated" audit didn't catch this

The 2026-08-24 audit was a *defect* audit: each finding was a falsifiable, locally-fixable item (a 500, a leaked slug, a missing confirmation), so each fix was local. Its own calibration note praised the bones and blamed the exceptions. Today's complaints live in the layer that audit never examined: **page composition** — what deserves to be on a page, in what order, at what volume, and how a teacher's real task (retrace a day, fix a record) threads across pages. The panel-stack architecture makes local fixes easy and structural fixes invisible: no single panel is wrong; the assembly is.

## Recommended remediation order

1. **Learner Day as the organizing unit** (IA3 + IA2): one day-scoped view joining agenda, sessions, outcomes, and paper for any date; dashboard rows and History both land on it. This single change answers the teachers' hardest workflow complaint.
2. **Session inspector recomposition** (IA1 + IA6): merged graded-worksheet list, one score, tiered sections, OMR card and event log demoted.
3. **Interventions index** (IA4): one home per form, a "which tool when" map, duplication removed.
4. **CTA hygiene pass** (IA5): primary/secondary button system, reprint action inside its card, backlog strip hidden at zero, agenda link on "nothing yet" rows.
5. Visual-design pass (typography scale, verdict color, alignment) — last, because it will otherwise be repainting a structure that's about to move.
