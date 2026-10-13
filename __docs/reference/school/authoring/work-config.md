<!-- Canonical copy, pulled into git 2026-08-06 (admin advocacy A1/#2). The
     data-volume copy at data/content/school/WORK-CONFIG.md mirrors this; edit
     HERE and sync there, not the other way round. -->

# `work.yml` — the standard work config

One per curriculum, at `content/school/{subject}/{work}/work.yml`.

This is the file the code reads to understand a work it has never seen, without
special-casing it. Validator: `2_domains/school/curriculum/workValidation.mjs`.

| the question | the field |
|---|---|
| what is this | `work` `title` `subject` `category` `medium` |
| how is it structured | `structure.shape`, `structure.items.from` |
| how is it graded | `grading.gate` `.scope` `.pass_percent` `.exit` |
| where is the material | `material.adapter` + `material.root` |
| what media is attached | derived per item, or `modules[].media` |
| what gets printed | `printables[]` — each with `when` and `scan` |

## It is not a table of contents

`structure.items.from` names a **strategy**; the code derives the list.
Enumerating 79 Shakespeare chapters — or 3,567 Khan banks — would be a second
source of truth that drifts the moment a chapter is re-cut.

`modules[]` is the one exception, and only when order is **editorial**.
Shakespeare Tales lists its 16 plays because the order follows a curated Plex
album sequence that cannot be computed (the folders sort alphabetically).
I Survived does not, because its folders are already numbered — filename order
*is* publication order, so 19 entries would say nothing the directory doesn't.

## Fields

```yaml
work: shakespeare-tales      # must equal the directory name
title: Shakespeare Tales
subject: english             # must equal the shelf; one of the nine
category: course             # course | reference | listening
medium: audio                # audio | video | paper | app | mixed | none

material:                    # omit when medium is none/paper/app
  adapter: plex-album        # plex-album | plex-show | plex-label | manifest
  root: plex:619778

structure:
  shape: modules             # modules | flat | topics | package
  module: play               # required for `modules`, forbidden otherwise
  item: chapter
  items:
    from: quizzes            # quizzes | units | plex | package
    order: sequence          # sequence | filename | plex | none

grading:
  gate: quiz                 # quiz | omr | review | mixed | none
  scope: item                # item | module | work
  pass_percent: 80           # required unless gate is none; forbidden when it is
  completion_threshold_percent: 90
  exit: every chapter played to threshold and its quiz passed   # required, prose

printables:                  # omit when nothing is printed
  - document: us-capitals-omr
    when: checkpoint         # study | checkpoint | remediation
    scan: omr                # omr | none
```

## The four shapes, each with a live example

| shape | example | what it means |
|---|---|---|
| `modules` | `english/shakespeare-tales` | two levels — modules of items (a play of chapters, a book of chapters) |
| `flat` | `history/us-capitals` | one level — items directly |
| `topics` | `math/algebra` | banks grouped by topic, no media, no order, nothing sequenced |
| `package` | `scripture/bom` | a generated body with its own internal shape |

`package` earns its place: BoM's items are lessons computed by segmenting a
6,604-verse spine, and which lessons exist depends on the segmentation a program
picks (49 for cfm2024, 134 for arcs). Neither `quizzes` nor `units` can
enumerate that.

`mixed` as a gate is similar honesty — math-fractions gates unit 01 with an
on-screen bank, 02 with a parent grading a worksheet, 03 with the mark reader.
Claiming a single gate would be false, so `mixed` says "read it off each unit".

## What the validator refuses

Each of these is a real failure it catches, not a hypothetical:

```
subject is "history" but the shelf is "math"
work is "x" but the directory is "other"
grading.gate is omr but no printable declares scan: omr
grading.pass_percent is meaningless when gate is none
structure.module is meaningless when shape is flat
medium is "audio" but no material block says where it lives
grading.exit is required — say what finishing means
```

The `exit` requirement is deliberate. Everything else can be defaulted; "what
does finishing mean" cannot, and a work that will not answer it is a work nobody
can complete.

## Vocabulary

`work` is the level a parent thinks in. It is **not** called `unit` because
`unit` already means one lesson-sized thing carrying a bank or document
(`math-fractions.01`), and it is not called `manifest` because a manifest is a
media *locator* with repair aliases. Both words were taken before this format
existed.

```
work    Shakespeare Tales   this file
module  one play            a Plex album
item    one chapter         a Plex track + its quiz
```

Renaming the code's `unit` to `item` so `unit` could mean this level is a live
option — it touches `unitId`, `unitValidation`, `listUnits`, the `units/`
directories and the `unit:` binding inside 4,620 banks.
