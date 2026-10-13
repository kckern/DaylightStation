# Office Course Sequence Design

Date: 2026-10-06
Status: Approved design; awaiting written-spec review

## Purpose

The office program has one daily course slot. Today that slot points directly at
one Plex collection. Plex correctly advances through the collection's lessons,
but after every lesson is watched the list fallback returns the first lesson and
the completed course starts again.

The slot should instead treat courses as a sequence. It should finish the
current course, move to the next declared course, and eventually choose another
unfinished course from the office lecture menu.

The initial sequence is:

1. `plex:649182` — Economics of Human Flourishing (the Abundance course)
2. `plex:447151` — Nietzsche and the Postmodern Condition
3. Maps of Meaning — resolved to its Plex collection identifier when the menu
   configuration is reconciled; configuration loading must reject a missing or
   non-container identifier rather than silently selecting another title

Nietzsche and the Postmodern Condition also replaces the Bob Iger course in the
office lecture menu.

## User-visible behavior

- The office program keeps a single course slot at 2x playback.
- Within a course, the next partially watched or unwatched lesson plays in the
  collection's existing source order.
- A course is complete only when it has no partially watched or unwatched
  playable lessons.
- A completed course is skipped. It never falls back to its first lesson while
  another course is available.
- The three explicitly ordered courses are considered first.
- After Maps of Meaning is complete, the system selects the first unfinished
  course from the office lecture menu, excluding Bob Iger and courses already
  completed.
- If every configured and menu course is complete, the course slot produces no
  queue item. The rest of the office program continues normally.
- Manual playback of a completed course remains possible from normal media
  browsing; this policy affects only the course-sequence program slot.

## Configuration contract

The office program course item will use a list source rather than embedding
selection policy in frontend code:

```yaml
- label: Masterclass
  playbackrate: 2
  input: course-sequence:office-lectures
```

The named course sequence will be stored with the content-list configuration,
beside programs and menus:

```yaml
title: office-lectures
courses:
  - plex:649182
  - plex:447151
  # followed by the canonical Plex collection for Maps of Meaning
fallback:
  menu: office-lectures
  strategy: first-unfinished
on_exhausted: skip
```

The implementation must resolve Maps of Meaning by exact title in the Plex
Lectures library and persist the returned canonical collection identifier before
committing the runtime configuration. A title match outside that library, or a
non-container result, is not accepted.

The office lecture menu remains the user-editable candidate pool. Its Bob Iger
entry is removed and its Nietzsche entry uses `plex:447151`. Course-sequence
resolution deduplicates identifiers, so a course may appear in both the ordered
prefix and the menu without being evaluated twice.

## Selection model

Selection is hierarchical:

1. Load the ordered course containers.
2. For each container, resolve all playable children and enrich them with media
   progress.
3. Select the first container with an unfinished child.
4. Within that container, select an in-progress child first; otherwise select
   the first unwatched child in source order.
5. If the ordered prefix is exhausted, perform the same test over the office
   lecture menu in menu order.
6. Return no item when both pools are exhausted.

This is deliberately different from the existing generic `sequential`
strategy. That strategy operates within one collection and has a useful generic
fallback. A course sequence owns the additional container-completion boundary
and must not relax its watched filter when a container is exhausted.

Completion uses the existing duration-aware watched rules and shared media
progress store. No second course-progress ledger is introduced.

## Components

### Course-sequence definition adapter

Loads and validates named sequence YAML. It exposes a listable container and
resolves one playable child using the selection service. Validation requires:

- at least one course or a fallback menu;
- canonical, listable container identifiers;
- a supported fallback strategy;
- a supported exhausted action.

Invalid configuration is logged with the sequence name and omitted from the
program; it must not quietly restart a completed course.

### Course selection service

A focused application/domain service determines whether a course has unfinished
children and returns the next lesson. It depends on existing content resolution
and media-progress ports, not Plex-specific APIs, so the contract can later
support another listable course source.

### List/program integration

The content registry recognizes `course-sequence:` as a list source. The normal
program builder asks it for one playable item. Playback rate, queue order, and
screen delivery remain unchanged.

### Office configuration

The data change creates the `office-lectures` sequence, rewires the Masterclass
slot, resolves Maps of Meaning to its canonical Plex collection, and replaces
Bob Iger with Nietzsche in the menu consumed on the office screen.

## Failure behavior

- A missing Plex collection is skipped with a structured warning containing the
  sequence and content identifier; later courses remain eligible.
- A collection that resolves but has no playable children is treated as
  unavailable, not complete, and emits a warning so a metadata outage cannot
  permanently advance the sequence.
- Progress read failure fails the slot closed for that build: no course is
  queued, because treating unknown progress as unwatched would restart courses.
- A malformed sequence is rejected during load and does not affect other office
  program entries.

## Tests

Domain/application tests will prove:

- an unfinished lesson in the first course is selected;
- a fully watched first course advances to the second;
- partially watched lessons win over later unwatched lessons;
- three completed ordered courses fall through to the first unfinished menu
  course;
- ordered/menu duplicates are considered once;
- completed courses never relax to their first lesson;
- a wholly exhausted pool returns no item;
- missing and empty collections follow the failure rules above;
- progress failure does not restart a course.

Adapter/configuration tests will prove parsing, validation, menu replacement,
and the concrete office sequence. An integrated program-resolution test will
exercise the office slot with fixture progress showing Abundance complete and
verify that Nietzsche is selected next.

## Documentation

The content configuration and progress references will document the
`course-sequence:` source, its YAML schema, completion semantics, fallback menu,
and exhausted behavior. The office instance remains in household/content data;
reference documentation uses generic identifiers and contains no host-specific
paths.

## Out of scope

- A new course-management UI
- Automatically ranking or recommending courses beyond menu order
- Changing Plex watched state
- Changing manual media browsing behavior
- Migrating unrelated program slots
