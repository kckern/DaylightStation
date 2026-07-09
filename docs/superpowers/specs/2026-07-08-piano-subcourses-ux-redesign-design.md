# Piano video-course UX redesign — "curriculum to resume"

**Date:** 2026-07-08
**Area:** `frontend/src/modules/Piano/PianoKiosk/modes/Videos/` (+ small backend progress/reference support)
**Status:** Design approved (mockup-validated) — ready for implementation plan
**Mockup:** the annotated 4-frame direction (deepening rail, prefix-fade cards, rings, resources, lesson thumbnails, lesson-end hand-off), real Piano-With-Jonny content.

---

## Problem

The Videos mode — especially the new `subcourses` drill-in — is built as a **catalog to browse**: three grids of the *same repeated program poster*, four levels deep, with progress shown as raw `0/32` text. But the learner's mental model is a **curriculum to resume**. Two moments they live in aren't served at all — **Continue** on arrival and **Up next** at lesson-end — and the browsing they do hit is made of interchangeable posters that carry no identity. A separate gap: reference material (e.g. "Practice Essentials") is rendered as if it were a graded, completable course.

## Locked design decisions

1. **Tiles where art exists, cards/rows where it doesn't.** Cover tiles only at the top-level program grid. Inside a program, everything is cards/rows (type + progress). Lesson rows use the per-lesson **Plex thumbnail** with a state overlay.
2. **A deepening context rail is the anchor.** A persistent left rail carries identity, a progress ring, a **Continue / Up-next** action, and tappable ancestors. It deepens Program → Season → Course as you drill. The rail — not a breadcrumb — is the primary "you are here."
3. **Breadcrumb demoted** to a thin top path (mode + current level); depth lives in the rail.
4. **Progress is always a ring**, never `0/32`. One radial mark reused at program / season / course / lesson-end (partial arc → teal ✓ when complete).
5. **Typographic identity (prefix-fade wordmarks).** Where a season's courses share a prefix ("Pop Soloing with …"), fade the shared prefix and set the distinguisher in the display serif; pair with an **ordinal index** and a **quiet per-season tint wash**. Untitled groups (Season 3) degrade to the ordinal alone — honest structure, not placeholder text.
6. **Resources ≠ courses.** Items flagged reference (a season, course, or unit — e.g. Practice Essentials) are **always-on**: no progress ring, never gated, **excluded from the "X of N courses" denominators**, and rendered as a dashed "open anytime" affordance.
7. **Guidance, not gates.** The existing sequential engine stays, but its voice flips: the current lesson is the one loud (brass) thing with a Play button; later lessons read as a quiet "later" (soft lock), not an error.
8. **Lesson-end hand-off with cancellable auto-roll.** When a lesson ends, show "Up next: <next lesson>" with a short, cancellable countdown ("Back to course" / not-tapping opts out) — momentum without forcing practice.
9. **Continue on arrival.** Entering a program surfaces the learner's furthest in-progress lesson as a one-tap Continue in the rail.

## Information architecture

```
Program (Plex show w/ `subcourses`)      ← top grid: cover TILE
  rail: program identity · program ring · Continue · —
  pane: Seasons  (rows: ordinal · tint · ring · course-count)      [reference seasons → dashed "Resources · open anytime"]
   └ Season                                ← rail deepens (Program▸Season, tappable)
       pane: Courses (cards: ordinal · prefix-fade wordmark · ring · lesson-count·runtime · tint)   [reference courses → resource card]
        └ Course                            ← rail deepens (Program▸Season▸Course); Continue → Up-next
            pane: Lessons (rows: thumbnail+overlay · title · duration · current=Play, later=soft-lock)   [reference units → always-open, no lock]
             └ Lesson → full-screen Player → lesson-end hand-off ("Up next", cancellable auto-roll)
```

- **Single-course seasons collapse** (as today) straight to their lessons.
- **Non-`subcourses` shows** keep today's flat/multi-unit `CourseDetail` — but adopt the same rail + ring + lesson-thumbnail language so the whole mode is consistent.

## Data / model needs (backend, minimal)

The existing platform already supplies most inputs (`/playable` items carry `parentId`, `itemIndex`, `title`, `image/thumbnail`, and per-user `userWatched/userPercent`; `subcourses.js` partitions floors; `reference_units` already marks never-gated/no-credit units). This redesign needs:

1. **Reference at season/course granularity.** Generalize the existing `reference_units` concept so a whole season (e.g. Specials → Practice Essentials) or a course (floor) can be flagged reference. Config-first (piano.yml `videos.reference_units` / a `reference_labels` Plex label), consistent with existing patterns. Reference items: excluded from all denominators, never gated, never carry a ring.
2. **Progress aggregation** (client-derivable from the flat `/playable` per-user fields, or a thin endpoint):
   - course: watched lessons / total lessons (excluding reference units).
   - season: courses complete / total courses (excluding reference courses).
   - program: courses complete / total courses (excluding reference seasons/courses).
3. **Continue pointer** (per user, per program): the furthest in-progress-or-next lesson — the deepest not-yet-watched lesson in linear order across seasons/courses. Derivable from the same watched fields; may be memoized server-side later, client-derived first.
4. **Display strings, not dev shorthand.** Course label = prefix/tail split via `subcourses.deriveCourseLabel` (+ a `splitCoursePrefix`-style tail); season chapter name from content where present, else ordinal.

No change to the sequential engine, the `screen/*` device routes, or `FullyKioskContentAdapter`.

## Visual system

- **Palette (instrument-dark, chosen):** ground `#141210`, panels `#1d1a16`/`#262019`, ivory text `#efe7d8`, warm grey `#9c9184`, single accent **brass `#c99a4e`** (Continue / current / Up-next / progress fill only). Four **desaturated per-season tints** (slate/teal/plum/sage) as a faint card wash + hairline rule. Semantic teal for "done" ✓ (separate from the accent).
- **Type:** recital-program pairing — serif display (`Georgia/Hoefler/Palatino`) for titles-as-wordmarks; humanist sans (`system-ui`) for UI; mono w/ tabular-nums for ordinals, durations, fractions. (No webfont link — CSP; system stack, deliberately not Inter/Space Grotesk.)
- **Progress ring:** conic radial; center shows % (season/program) or fraction (course/lesson); teal filled ✓ when complete.
- **Icon system (role/state, not subject):** level trio (program/season/course), Continue/resume, Up-next, progress ring, soft-lock, resource/bookmark, done ✓ — inline SVG, `currentColor`, em-sized, matching existing hand-drawn weight. Do NOT map course *names* to skill icons.

## Component structure (frontend)

Reuse and extend the real `.piano-course__*` language rather than the bare poster grid:

- `PianoContextRail.jsx` — the deepening rail (identity, ring, Continue/Up-next, tappable ancestors). Shared by the flat and subcourses paths.
- `ProgressRing.jsx` — the single ring primitive.
- `SeasonList.jsx` / `CourseCards.jsx` / `LessonList.jsx` — per-level content panes (replacing the current `SeasonMenu`/`CourseList`/`CourseLessons` clones). `CourseCards` implements prefix-fade + ordinal + tint; `LessonList` implements thumbnail + overlay + current/soft-lock.
- `LessonHandoff.jsx` — the lesson-end "Up next" card with cancellable auto-roll.
- `subcourses.js` — extend with prefix/tail split, reference detection at season/course level, and Continue-pointer derivation (pure, tested).
- `useContinue` — resolves the program's resume target from per-user watched fields.
- `SubcourseNavigator.jsx` — rebuilt around the rail + panes.

## Out of scope (YAGNI)

- No new Player internals; the hand-off wraps the existing player's end event.
- No server-side Continue memoization initially (client-derive first).
- No AI/skill-icon inference for course identity.
- No change to non-video piano modes.

## Testing

- Pure: prefix/tail split, reference exclusion from denominators, progress aggregation (course/season/program), Continue-pointer selection, single-course collapse — all against real 676490 fixtures (incl. untitled Season 3 and the Practice-Essentials reference season).
- Component: rail deepens + Continue target; resource season renders dashed/no-ring/uncounted; lesson list shows thumbnails + correct overlay per state; current lesson is the only Play; lesson-end hand-off shows next + cancels; non-subcourses course still renders (now with rail/ring/thumbnails).

## Reference data (captured 2026-07-08)

- `676490` Piano With Jonny — seasons: `676540` Specials → **Practice Essentials (reference)**; `676507` Season 1 → Pop Soloing (7 courses); `676491` Season 2 → 2‑5‑1 Soloing (8); `676576` Season 3 → 9 untitled courses.
- Courses are `itemIndex // 100` floors; lessons `itemIndex % 100`; each lesson carries `image/thumbnail`, `duration`, and per-user `userWatched/userPercent`.
