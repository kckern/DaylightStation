# Piano Reference-Unit Exemption + Descending-Unit Ordering — Design Spec

**Date:** 2026-06-29
**Status:** Approved, pending implementation plan

---

## Problem

Sequential piano courses (Plex `sequential` label) lock every lecture after the
first unwatched one, and multi-unit courses reveal later units only as the prior
one completes. But some units inside a course are **not progressive lesson
content** — they are exercise banks, practice drills, repertoire walkthroughs, or
utility guides that a student should be able to open **anytime**, in any order,
without "spending" them against the lesson sequence.

Example — *The Better Piano System* (`plex:676075`, 18 units) has clearly
reference/practice units mixed in with lessons:

| Kind | Units (by title) |
|------|------------------|
| Pure reference / practice | Exercise Module – C Position, Exercise Module – Reading Rhythms, Exercise Module – Both Hands Together, Practice Guides, Full Piece Walkthroughs, 30-Day Challenge – Finger Fumblers |
| Mixed (lesson intro → drills) | The Keyboard & 5-Finger Exercises, Sharps Flats & Reading Accidentals |
| Pure lesson | Welcome & Basics, The INSTANT Piano Player, Intro to Chords, Chord Cheat Codes 1–4, Music Theory, Reading & Writing Rhythms |

We need a way to mark reference units so they are **never locked, give no
progression credit, and don't gate the sequence** — while keeping the core
lessons gated. This spec also folds in the previously-requested
**descending-unit ordering** for multi-unit courses, since both change the same
`CourseDetail` render path and the approved UI mockup combines them.

### Constraint that drives the design

**Plex labels are show-level only.** A label can mark a whole course sequential
but cannot mark an individual season/unit or episode. The only reliable sub-show
metadata is the unit (season) **title** and **index** — and the
reference-vs-lesson signal already lives in those titles ("Exercise Module …",
"Practice Guides", "… Walkthrough", "30-Day Challenge"). So the exemption is
driven from **config**, matching on unit titles, not from Plex metadata.

---

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Granularity | **Unit-based** (a unit is reference or it isn't). Episode-level is out of scope. |
| Flagging mechanism | **Config** in `piano.yml`, per course. |
| Match signal | **Title patterns** (case-insensitive substring), with an explicit **`unitIds`** escape hatch unioned in. |
| Credit | Reference units give **no progression credit** and are **never locked**. |
| Reveal | Reference units are **always visible**, independent of the progressive reveal. |
| Co-progress | Reference episodes are **excluded** from both users' completed counts. |
| Mixed units (3, 16) | **Not auto-exempt.** They stay gated unless explicitly listed in `unitIds`. (A unit titled "Exercise Module …" matches a pattern; a mixed unit whose title doesn't match stays a lesson unit.) |
| Display | **Bottom "Practice & Reference" section** beneath the gated lesson units. |

---

## Config Structure

New `reference_units` key under `videos`, parallel to `sequential_labels` and
`co_progress`:

```yaml
videos:
  sequential_labels: [sequential]
  reference_units:
    - courseId: plex:676075          # matches the playable compoundId
      titlePatterns:                 # case-insensitive substring vs UNIT (season) title
        - "Exercise Module"
        - "Practice Guide"
        - "Walkthrough"
        - "30-Day Challenge"
      unitIds: []                    # optional explicit season ratingKeys, unioned with patterns
```

- `courseId` — the course `compoundId` (e.g. `plex:676075`).
- `titlePatterns` — list of substrings; a unit is reference if its title contains
  any pattern (case-insensitive). Optional (may be empty/absent).
- `unitIds` — optional list of season ratingKeys that are reference regardless of
  title. Unioned with the pattern matches. The precision override for units the
  naming doesn't catch (or to exempt a mixed unit).
- Multiple entries (different courses) supported.
- A course need not be `sequential` for the grouping to apply (see edge cases),
  but the *gating* exemption only matters when the course is sequential.

---

## Backend Changes

**File:** `backend/src/4_api/v1/routers/piano.mjs`
**Route:** `GET /api/v1/piano/courses/{courseId}/playable?userId={userId}`

After the existing `isSequential` / `coProgressLock` computation:

1. Read `videos.reference_units` and find the rule whose `courseId === compoundId`.
2. Build a `referenceUnitIds` set from `playable.parents`:
   - For each unit `(id, parent)`, add `id` if `parent.title` contains any
     `titlePatterns` entry (case-insensitive) **or** `id` is in `rule.unitIds`.
3. Tag each item: `isReference = referenceUnitIds.has(String(item.parentId))`.
4. **Co-progress exclusion** — when counting completed episodes (both the
   requester's `myCount` and each partner's enriched count), exclude reference
   items:
   ```js
   .filter((it) => it.userWatched && !referenceUnitIds.has(String(it.parentId)))
   ```
5. Append to the response:
   ```json
   {
     "items": [ { "...": "...", "isReference": false }, ... ],
     "isSequential": true,
     "coProgressLock": null,
     "referenceUnitIds": ["676183", "676149", "676137", "676076", "676081", "676235"]
   }
   ```
   `referenceUnitIds` is `[]` when no rule applies. `isReference` is always
   present on each item.

The co-progress block must run its count exclusion using `referenceUnitIds`, so
`referenceUnitIds` is computed **before** the co-progress count (reorder if
needed) or the count is recomputed with the filter.

---

## Frontend Changes

**Files:**
- `usePianoCoursePlayable.js` — expose `referenceUnitIds` (default `[]`).
- `CourseDetail.jsx` — partition units, descending lesson order, bottom reference section.

### Hook

Add `referenceUnitIds: state.data?.referenceUnitIds ?? []` to the return (mirrors
the existing `coProgressLock` passthrough).

### CourseDetail — partitioning

Derive a `referenceUnitIdSet = new Set(referenceUnitIds)`. Partition `seasons`:

- **lessonSeasons** — `seasons.filter((s) => !referenceUnitIdSet.has(s.id))`
- **referenceSeasons** — `seasons.filter((s) => referenceUnitIdSet.has(s.id))`

All sequencing computations operate on **lesson episodes only** (episodes whose
`parentId` is not in `referenceUnitIdSet`):

- **`lockedIds`** — scan only lesson episodes in linear order; the first unwatched
  *lesson* episode closes the gate. Reference episodes are never added to
  `lockedIds` and never close the gate.
- **`currentId`** — the first unwatched **lesson** episode (goldenrod "play next").
- **`visibleSeasons`** — computed over **lessonSeasons**; reveal stops at the first
  incomplete lesson unit. Reference units are not part of this list.
- **`coProgressLockedId`** — unchanged logic, but it already points at the first
  unwatched lesson episode via `currentId`'s rule, so reference episodes can never
  be the co-progress-gated one.

### CourseDetail — rendering

The episode column renders in two zones:

1. **Lesson zone (top)** — `visibleSeasons` rendered in **descending unit order**
   (latest/highest-index unit on top), episodes **ascending** within each unit.
   Implementation: `[...visibleSeasons].reverse()` at render; episode sort
   unchanged (`itemIndex` ascending). Gating, locks, goldenrod-current,
   co-progress icon/toast all behave as today.

2. **Reference zone (bottom)** — a single `Practice & Reference` section
   (header: e.g. "Practice & Reference · open anytime"), containing
   `referenceSeasons` (ascending by index), each with its unit sub-title and an
   ascending episode grid. Reference episodes render with **no lock chrome, no
   goldenrod-current, always clickable** (`onPlay` fires directly). A watched ✓
   may still show (the student's own tracking) but progress bars/locks are
   suppressed. The section is **always fully visible**, regardless of sequential
   reveal.

For a **non-multi-season** course (single unit) the partition is a no-op and the
view is unchanged. For a **non-sequential** multi-unit course, lesson units are
all visible already; the descending order + bottom reference grouping still apply
(no locks exist, so the reference zone simply declutters the optional units).

### Descending-unit ordering (companion change)

Folded into the lesson-zone render above: units descend, episodes ascend within.
This applies to **all** multi-unit courses, sequential or not. The progressive
reveal for sequential courses is preserved — only the *display order* of the
revealed units is reversed; the "first incomplete" computation stays ascending.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No `reference_units` rule for the course | `referenceUnitIds = []`; behavior identical to today plus descending ordering. |
| Non-sequential course with a rule | Reference units pulled into the bottom section; no gating exists to exempt. |
| `titlePatterns` matches a lesson unit by accident | That unit becomes reference (no credit, never locked). Fix by tightening the pattern; `unitIds` cannot *force* a pattern-matched unit back to lesson — so patterns must be specific. |
| Mixed unit (lesson intro + drills) | Stays a **lesson** unit unless its title matches a pattern or it's in `unitIds`. The drills inside it remain gated as part of the lesson flow. |
| All of a reference unit watched | Does **not** count toward course completion or reveal of the next lesson unit. |
| Reference unit is the only unwatched content left | Course's lesson sequence is complete; reference stays open. No goldenrod-current (nothing gated remains). |

---

## Files Touched

| File | Change |
|------|--------|
| `piano.yml` (data volume) | Add `videos.reference_units` array |
| `backend/src/4_api/v1/routers/piano.mjs` | Compute `referenceUnitIds`, tag `isReference`, exclude reference from co-progress counts, append to response |
| `backend/src/4_api/v1/routers/piano.courses.test.mjs` | Tests: reference detection by pattern + by unitId, co-progress excludes reference, no-rule no-op |
| `usePianoCoursePlayable.js` | Expose `referenceUnitIds` |
| `usePianoCoursePlayable.test.js` | Test passthrough |
| `CourseDetail.jsx` | Partition lesson/reference units; descending lesson order; bottom Practice & Reference section; reference episodes ungated |
| `CourseDetail.test.jsx` | Tests: reference units excluded from gate/reveal, render in bottom section, descending lesson order, reference episode plays directly |

---

## Out of Scope

- Episode-level reference flagging (only unit-level).
- Forcing a pattern-matched unit back to lesson (patterns must be specific).
- Per-user choice of which units are reference.
- Admin UI for managing `reference_units`.
- Reference-unit display order options (fixed ascending).
- Plex-metadata-driven flagging (decided against; config only).
