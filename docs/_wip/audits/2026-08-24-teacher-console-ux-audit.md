# Teacher Console UX Audit — Design & Usability Failures

> **OUTCOME (2026-08-24):** All findings remediated the same day across five
> waves (Truth / Safety / Structure / Polish / Kiosk split home) — spec
> `docs/superpowers/specs/2026-08-24-teacher-console-ux-remediation-design.md`,
> plan `docs/superpowers/plans/2026-08-24-teacher-console-ux-remediation.md`.
> Verified via vitest (module fully green) + Playwright against deployed prod.

**Date:** 2026-08-24 · **Surface:** `/school/teacher` (`frontend/src/modules/School/teacher/`) · **Build audited:** `ea19b453f` (deployed prod)
**Method:** headless Playwright screenshots of all 10 routes at 1280×800 and 390×844, direct API probes, and a full code-level read of the module.

---

## A. Broken or information-free surfaces (highest priority)

1. **HIGH — Session history is unidentifiable.** Every row on the student History tab renders "Lesson title unavailable / Course unavailable" (all four of Learner-Three's sessions). The teacher's only distinguishing signal is the date; two same-day sessions are indistinguishable. The completed-session detail page *can* resolve the title ("Illinois"), so the list view's resolution path is broken, not the data.
2. **HIGH — "Feedback delivered" is a noise wall.** 20+ visually identical rows: `Correct · Lesson feedback · Aug 23, 2026 — engine`. No lesson name, no feedback content, no way to tell any row from another. "engine" is an internal source id shown as if it were a person.
3. **MED — Legacy artifact URLs die badly.** `…/sessions/:id/results/machine.png` → 404 `Not Found`; `…/sessions/:id/worksheet.thumbnail.png` → **500** `{"error":"internal"}`. Both routes were deliberately removed at `ea19b453f` (replaced by `/api/v1/school/teacher/artifacts/:artifactId/{original.pdf,thumbnail.png,original}`), but the old thumbnail path 500s instead of 404ing. Adjacent live risk: the new thumbnail route (`school.mjs:1360-1394`) calls `renderPdfFirstPagePng` with no try/catch — a corrupt retained PDF becomes a 500 — and **no `<img>` in the module has an `onError` handler** (5 usages), so failures degrade to the browser's broken-image glyph.
4. **MED — "Original print was not archived" is a dead end.** The Issued-materials card explains nothing (why not? will future ones be?) and offers no action; text wraps awkwardly ("was not / archived").

## B. Raw internals leaking to the teacher

5. **HIGH — Unit codes as titles.** Reports → Curriculum history shows "Atlas Us P044 Illinois", "Atlas Us P062 Michigan", "Atlas Us P012 Midwest", "Atlas Us P006 United States" — internal page/unit codes plus "Us" mis-casing. Course title renders as "Young Peoples Atlas Us" (mangled: missing apostrophe, "US" downcased).
6. **HIGH — Question ids as item names.** Tutor insights lists items literally named "Q1"–"Q10" alongside real titles ("Illinois Labor Unions"). "Q2 · Review instruction" is unactionable — review instruction for *what*?
7. **MED — Internal policy/algorithm ids in UI copy.** "scored by best-of-unit-mean-v1", "Policy school.instructional-review/v1 · reassess when evidence changes".
8. **MED — Raw slug in a warning.** Courses-page pink alert: "**Learner-Four**: come-follow-me-ot-2026" — un-labelized course slug, and a *Learner-Four* warning shown on *Learner-Three's* page.
9. **LOW — "Assigned by kckern"** — raw username, not a display name.

## C. Scale & layout failures

10. **HIGH — Curriculum page is a 38,262px single scroll.** Every lesson of every course rendered flat, each with its own `pass 80% [%] [Set]` micro-form — hundreds of identical inputs. No collapse, search, filter, pagination, or virtualization. Unusable for finding anything; hazardous for mis-clicking a Set on the wrong row.
11. **MED — "The whole school" matrix is unreadable.** Column headers are full course titles wrapped one-word-per-line into 8-line towers ("Molecules: / The / Elements / and the / Architecture / of / Everything"). Cells hold cryptic glyphs (`— · upper ⚑`) with no legend. Rows for unenrolled students are blank with no empty-state. The whole matrix is duplicated on both the Curriculum page and every student's Courses tab.
12. **MED — Tutor insights is a card wall.** ~34 near-identical cards ("Review instruction" / "More evidence needed" / "On track") with no grouping, sorting explanation, or aggregation; only the first is expanded.
13. **LOW — "Nobody is enrolled in: [11 full course titles]"** — a run-on bold text wall instead of a list or count.

## D. Session detail (ses_a6NVUhN9) copy sins

14. **MED — Question numbering mismatch.** "Worksheet and questions" numbers 1–6; "Answers and result" numbers the same six questions 19–24 (bank-global indices). Same page, same questions, two numbering schemes.
15. **MED — "Correct answer: C" with no lettered options.** Worksheet options are rendered as an inline `·`-separated string with no A/B/C/D labels, so the letter is undecodable; it's also redundant next to the actual answer text and the "Correct" verdict ("Answer: 1818 · Correct answer: A · Correct").
16. **LOW — Answers table centers question text** ragged in a middle column; questions duplicated wholesale from the section directly above.
17. **LOW — "Marked score 100% / Current score 100%"** — two unexplained score concepts shown side-by-side with identical values.
18. **LOW — Permanently disabled "Completion credit…" ghost button** (`WorkspaceViews.jsx:587`) whose only explanation is a hover tooltip — a dead affordance instead of a link to Student operations.

## E. Dangerous interactions

19. **HIGH — Enroll/Re-materialize/Unenroll fire with zero confirmation** (`EnrollmentDrawer.jsx:72-79`), despite the drawer's own copy warning that enrolling "will replace its order" — the one outlier against the module's otherwise consistent arm→confirm pattern.
20. **MED — "Close this period"** — the app's most destructive action — is a red button above the fold on the *default* Reports view, desktop and phone.
21. **MED — Destructive defaults preselected.** Curriculum-exceptions form defaults to Decision="Paused globally", Reason="Broken" — the most drastic choices are the zero-interaction path. Form duplicated verbatim on Curriculum and Operations pages.
22. **MED — `window.prompt()` for retraction reasons** (`WorkspaceViews.jsx:325`) — native blocking prompt, unstyled, no maxLength, inconsistent with the inline reason inputs used everywhere else.

## F. Consistency & duplication

23. **MED — Dates formatted five different ways:** `teacherDates.js` (en-US), `WorkspaceViews.jsx:33-46` own helpers (en-US), `RosterStrip.jsx:13-19` (browser locale — can render *differently from the list beneath it*), plus ad-hoc `toLocaleString()` at `WorkspaceViews.jsx:617` and `RosterStrip.jsx:93`. Native `mm/dd/yyyy` date inputs sit alongside humane "Tuesday, Aug 25" copy.
24. **MED — Seven panels hand-roll PanelFrame's loading/error chrome** (`AttestationPanel`, `PeriodsTimeline`, `EnrichmentPanel`, `MilestonesPanel`, `AssignmentsView`, `PianoProgramsPanel`) with already-drifted copy ("Couldn't load Assignments." vs "Couldn't load piano programs.").
25. **MED — Dead code shadows live views.** `tabs/PlanningTab.jsx` and `tabs/RepairTab.jsx` are orphaned (nothing imports them) yet duplicate seven live panels — future edits aimed at "the Repair tab" can land in dead code silently.
26. **MED — Vocabulary drift in navigation.** Dashboard workspace cards promise "Agenda, courses, history, reports, and repair" but the tabs are Overview/Courses/History/Reports/Operations — two of five names don't match. "Operations" also means two different pages (school-level sidebar vs. student tab). Phone bottom bar abbreviates to "Ops".
27. **LOW — Wholesale page duplication.** Action-queue page is exactly the dashboard's three cards again; dashboard "Student workspaces" cards duplicate the sidebar STUDENTS nav.
28. **LOW — Report card mixes formats** — first course "100%", siblings "0 / 12 units" in the same list.
29. **LOW — Study day defaults to tomorrow** (Aug 25 on Aug 24) with no "next school day" explanation.

## G. Phone (390px)

30. **MED — Matrix columns clip off-screen** mid-word with no visible scroll affordance.
31. **MED — Bottom tab bar truncates its own labels** ("Opera" for Operations in the student tab strip) and overlaps content headings mid-scroll.
32. **LOW — Tutor-insight titles truncate** ("Midwest Kansa…", "More evidence need…") with no touch affordance to read the full text.

## H. Error handling, a11y, lifecycle (code-level)

33. **HIGH — `main.jsx:48-51` ships 🔥 debug `console.error` on every prod page load** ("PHASE 4 CODE LOADED", "VERSION: Added EFFECTIVE_ROSTER…") — violates the structured-logging rule, fires at error level app-wide, and gets forwarded to the backend log store as intercepted console noise.
34. **MED — `EnrollmentDrawer` dialog has no `aria-modal`, focus trap, initial focus, or Escape-to-close** — while `PinPrompt.jsx` in the same module does it right.
35. **MED — `PrintPendingView`/`QuizRequestBacklog` omit `notFoundAs: 'unavailable'`** — on a 404 they show a permanent "Couldn't load" + Retry that can never succeed, unlike sibling panels.
36. **MED — Back from a session always routes to History** (`TeacherConsole.jsx:109`) regardless of whether the teacher arrived from the Today digest.
37. **LOW — `usePanelFetch` retry blanks good data** back to a skeleton instead of stale-while-revalidate.
38. **LOW — Backlog poll runs every 60s forever** regardless of `visibilityState` or active section.
39. **LOW — Ellipsis-truncated context in the header has no `title`** attribute; "1 learners" pluralization bug in tutor-insight rationale.

---

## Calibration

The module's bones are good — `usePanelFetch`'s five-state contract, `useTeacherWrite`'s busy/step-up flow, `TabErrorBoundary`, and the `labelize` discipline are consistently applied in most panels. The failures above are the exceptions, and they cluster: **catalog-resolution gaps** (A1, B5–B8) make whole surfaces useless while the chrome around them stays polished, and **flat-render-everything** (C10–C12) is the layout sin repeated on every dense page.

**Top 5 by impact:** History "unavailable" rows (A1) · curriculum 38k-px flat render (C10) · unconfirmed Unenroll/Re-materialize (E19) · unit codes & Q-ids as user-facing names (B5/B6) · prod console.error spam (H33).
