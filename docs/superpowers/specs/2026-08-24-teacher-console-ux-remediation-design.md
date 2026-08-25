# Teacher Console UX Remediation — Design

**Date:** 2026-08-24 · **Source audit:** `docs/_wip/audits/2026-08-24-teacher-console-ux-audit.md`
**Scope:** every finding in the audit, staged as four shippable waves. Each wave builds, deploys, and re-verifies via headless Playwright screenshots before the next starts.
**Locked decisions (user-approved):** curriculum page becomes a **course drill-in** (catalog → per-course route); enrollment matrix is **transposed** (courses as rows, students as columns), rendered **once** on the curriculum catalog page; staging is **four severity waves**.

## Principles

- Fix resolution at read time, never by rewriting stored records.
- Copy never shows an internal id (unit codes, Q-ids, slugs, algorithm/policy names, usernames) when a human name is resolvable; when it is not, show a labelized fallback, never the raw string.
- Follow existing module patterns: `usePanelFetch` five-state contract, `useTeacherWrite` arm→confirm, `PanelFrame`, `labelize`/`curriculumTitles`, `teacherLog`.
- Every wave leaves the console deployable; tests accompany each change (vitest component/unit; Playwright for layout claims — jsdom cannot see layout).

## Wave 1 — Truth (surfaces that lie or say nothing)

1. **History session titles.** The student History list renders "Lesson title unavailable / Course unavailable" for every session while the session detail page resolves the same session fine. Root-cause the list read-model's catalog resolution (likely the list endpoint lacks the material-snapshot join the detail path has) and fix at the read model so list rows show lesson title, course, and thumbnail like the detail header.
2. **Feedback lane roll-up.** "Feedback delivered" collapses to one row per session/day: lesson title, outcome, count of items ("6 correct · Illinois — Aug 24"). Engine-generated rows never display "engine" as a source; only human senders are named. Full item list behind an expand.
3. **Labelize sweep.** Curriculum-history unit names drop internal codes ("Atlas Us P044 Illinois" → "Illinois"; course "Young Peoples Atlas Us" → "Young People's Atlas of the US" via title/acronym handling in `curriculumTitles.js`). Tutor-insight items named "Q<N>" resolve to question text (truncated) with bank context; unresolvable items get "Question N · <unit>". Copy drops "scored by best-of-unit-mean-v1" (→ "scored by best unit average") and the raw policy id line (→ plain-English sentence). Courses-page warning labelizes slugs and appears only on the affected student's page (whole-school version lives on the curriculum catalog). "Assigned by kckern" resolves to display name.
4. **Session detail coherence.** Answers section numbers questions 1–N to match the worksheet section; options render lettered (A–D) in both sections; the answer line becomes "Their answer: Factories and stockyards (C) · Correct" — no undecodable letters, no triple redundancy. Pluralization fixed ("1 learner").
5. **Artifact failure handling.** Legacy `worksheet.thumbnail.png` path returns 404, not 500. The live artifact thumbnail route wraps `renderPdfFirstPagePng` in try/catch → 404 with a JSON reason on unrenderable PDFs. All five `<img>` usages in the module get `onError` fallbacks to the module's own "not available" treatment. "Original print was not archived" card explains the retention policy in one sentence.
6. **Console spam.** Delete the `🔥 PHASE 4` `console.error` block in `frontend/src/main.jsx` (app-wide, error-level, forwarded to the log store).

## Wave 2 — Safety (dangerous interactions)

7. **EnrollmentDrawer confirms.** Enroll/Re-materialize/Unenroll adopt the module's arm→confirm pattern; confirm copy states the consequence ("replaces its order").
8. **Neutral exception defaults.** The curriculum-exceptions form defaults Decision and Reason to "Choose…"; Preview stays disabled until both are chosen. Destructive options are not first in the list.
9. **Close-period placement.** The red Close button moves out of the default fold into the "Closed periods" section of Reports; costume and arm→confirm unchanged.
10. **No `window.prompt`.** Exception retraction uses the module's inline reason input (maxLength, styled) like StaleSessions/QuizRequestBacklog.
11. **Honest failure modes.** `PrintPendingView` and `QuizRequestBacklog` pass `notFoundAs: 'unavailable'` like their siblings, ending the permanent Retry-that-can't-succeed.

## Wave 3 — Structure (layout rebuilds and duplication)

12. **Curriculum drill-in.** `/school/teacher/curriculum` becomes a catalog: course cards (cover, title, lesson count, course pass bar), the transposed enrollment matrix, the exceptions form, and the "Unassigned courses" group (replacing the "Nobody is enrolled in:" text wall). New route `/school/teacher/curriculum/:courseId` shows one course: course-level pass bar (one edit control), lesson list with per-lesson override affordance only. The 38k-px flat render and per-lesson Set-form army are gone.
13. **Transposed matrix, once.** Courses as rows (full titles, left-aligned), four student columns, words not glyphs ("Upper track ⚑" with a one-line legend; "—" = not enrolled). Removed from student Courses tabs; the student page keeps only that student's enrollment summary.
14. **Tutor insights grouping.** Three collapsible groups with counts — "Review instruction (4)", "More evidence needed (28)", "On track (2)" — sorted by severity; only the first group opens by default.
15. **Dedupe queue/dashboard.** The three backlog cards become one shared component; the dashboard shows compact counts linking to the Action queue, which owns the full lists. "Student workspaces" cards drop (sidebar already navigates); dashboard keeps the Today digest.
16. **Delete dead code.** `tabs/PlanningTab.jsx`, `tabs/RepairTab.jsx`, their tests, and the stale doc-comment references.
17. **Vocabulary alignment.** One name per surface: tabs are Overview/Courses/History/Reports/Operations; all copy referencing "agenda"/"repair" updates to match; phone bottom bar and student tab strip render full labels without truncation (CSS: scrollable strip with fade, no mid-word clip).

## Wave 4 — Consistency & polish

18. **One date formatter.** All five date implementations collapse into `teacherDates.js` (en-US); `RosterStrip`'s browser-locale divergence and both ad-hoc `toLocaleString` calls removed.
19. **PanelFrame adoption.** PanelFrame gains the affordance the seven hand-rolling panels needed (render-prop for non-`ok` chrome context); AttestationPanel, PeriodsTimeline, EnrichmentPanel, MilestonesPanel, AssignmentsView, PianoProgramsPanel migrate; drifted error copy unifies.
20. **Dialog a11y.** EnrollmentDrawer matches PinPrompt: `aria-modal`, initial focus, focus trap, Escape-to-close.
21. **Retry keeps data.** `usePanelFetch` retry becomes stale-while-revalidate: existing data stays rendered with a refreshing indicator; errors only replace content when there was none.
22. **Polling discipline.** The 60s backlog poll pauses when `document.visibilityState` is hidden.
23. **Origin-aware back.** Session inspector back returns to the view that opened it (History or Today) via a `from` search param.
24. **Small copy/affordance fixes.** Marked vs Current score labeled with a one-line explanation; report card shows both percent and units per course; Study day input labeled "Next school day"; disabled "Completion credit…" ghost becomes a link to the Operations tab; truncated header context gets `title`; phone insight titles wrap instead of clipping.

## Error handling

Read-model resolution failures degrade to labelized fallbacks, never raw ids or "unavailable" walls. Image failures render the module's "not available" card. Legacy/removed routes 404 with JSON bodies. No new silent catches: failures log through `teacherLog`/backend logger.

## Testing

- Vitest component tests updated/added beside each changed panel (existing convention).
- Backend: route tests for the 404 behavior and the session-list read model join.
- Playwright: post-deploy screenshot sweep of the same 10 routes at 1280×800 and 390×844 per wave; curriculum page height asserted sane (< 5,000px at desktop after Wave 3); no "unavailable" strings on History after Wave 1.
- Gate: `npm run test:unit:vitest` green before each deploy (`test:backend` is a known-vacuous gate; do not rely on it).

## Out of scope

Student-facing surfaces, print/PDF rendering, gradebook logic, backend catalog architecture beyond the list read-model join, and the flashcard framework (separate plan).
