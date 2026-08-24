<!-- Canonical copy, pulled into git 2026-08-06 (admin advocacy A1/#2). The
     data-volume copy at data/content/school/README.md mirrors this; edit HERE
     and sync there, not the other way round. -->

# content/school — layout

```
<subject>/<work>/<kind>/
```

Nine subject shelves, fixed in code (`frontend/src/modules/School/home/subjects.js`
and its backend twin `SUBJECT_IDS` in
`2_domains/school/curriculum/unitValidation.mjs`):

```
english  writing  math  civilization  scripture  science  language  skills  arts
```

(The list once read `history` here while the code said `civilization`. That
drift is what produced a `history/` shelf the datastore never walked and 28
files nobody could reach.)

## Where each kind of thing lives

`content/school/` holds authored, live coursework and nothing else.

| tree | holds | written by |
|---|---|---|
| `content/school/<subject>/<course>/` | course packages | a person |
| `content/school/learning-catalog/` | `school.catalog/v1` catalogs, documents, question banks | a person |
| `content/_staging/school/` | imports, drafts, unfinished courses — **not live** | a person |
| `household/school/artifacts/print/` | published revisions, derived banks, allocations | `school-docs publish` |
| `household/school/artifacts/calculator/ti-86/` | SchoolCalc device builds | the pack publisher |
| `household/config/school/surfaces/` | surface profiles | a person |

`content/_staging/` is a **sibling** of `content/school/`, not a child. That is
what keeps it out of `ContentTreeManifest`, which walks the school content tree
with no skip list.

### Review state decides what a learner sees

A lesson reaches a learner only when `provenance.reviewState` is `approved` —
`isPublishable` checks exactly that field. A lesson may be structurally valid,
on the right shelf, with a resolving bank, and still be withheld; the catalog
reports it in `units` but not in `publishable`, and the units endpoint 404s it.

That is the intended fail-safe for material whose authoring is unfinished. The
six Big Fat Notebook courses promoted 2026-08-16 use it: 36 lessons whose final
approval round was clean are `approved`, and 41 still carrying a
`decision: rewrite` are `draft` — live on the shelf, invisible to a child.


Course packages resolve from the subject shelf directly. The
`content/school/curriculum/<subject>/` nesting is retired: both datastores read
`<subject>/<course>` and nothing else.

A **work** is one body of curriculum — Shakespeare Tales, I Survived, ap-biology,
us-capitals — and it is self-contained. Its units, documents, manifests and
quizzes all sit inside it, so a work can be read, moved or deleted as one thing:

```
history/us-capitals/
├── units/       us-capitals.01.yml   us-capitals.02.yml
├── documents/   us-capitals-study.yml   us-capitals-omr.yml
└── quizzes/     us-capitals-quiz.yml    us-state-capitals.yml

english/shakespeare-tales/quizzes/the-merchant-of-venice/01-a-risky-bond.yml
math/algebra/quizzes/functions/domain_and_range.yml
```

A kind directory exists only where there is something to put in it. Most shelves
are empty; that is the normal state, not a gap.

## Compact course packages (v2)

`school.course/v2` keeps the curriculum hierarchy but does not encode empty
wrapper layers in paths. The course root always has `_index.yml`; a normal
one-artifact lesson is one named YAML file. A directory exists only for a real
instructional group or a lesson that has several independent artifacts:

```text
civilization/atlas/
├── _index.yml
├── maine.yml                         # compact lesson + inline worksheet bank
└── northeast/                        # a real grouping, only when useful
    ├── _index.yml
    ├── vermont.yml
    └── new-hampshire/
        ├── _index.yml                # rich lesson manifest
        ├── worksheet.yml
        └── video.yml
```

A compact lesson remains a `school.question-bank/v2` document so worksheet
tools consume it unchanged. Its `lesson:` mapping contains the former
`school.unit/v1` metadata (identity, objectives, provenance, review state, and
bank reference). The filename is the author-facing lesson id and must agree
with `lesson.unitId`.

For a rich lesson, `_index.yml` is the `school.unit/v1` manifest and each other
YAML file is a typed artifact. The artifact's stable bank id, not its physical
path, is its address; moving between compact and rich forms therefore does not
invalidate progress. Existing legacy `units/<unit>/lessons/<lesson>/` packages
continue to load during migration, but new authoring must use this compact
form. Existing v1 `work.yml`, `units/`, and `quizzes/` works also continue to
load unchanged.

**`scripture/bom/`** is the exception — a generated package with its own internal
shape (`spine.yml`, `plans.yml`, `renditions.yml`, `coverage.yml`, `maps/`,
`tools/`) rather than kind directories. See its own `HANDOFF.md`.

## Two id schemes, deliberately different

**Curriculum ids (units, documents, manifests) are flat basenames.**
`CURRICULUM_ID_RE` forbids `/`, and everything refers to them bare —
`assignments/{learner}.yml` says `courses: [math-fractions]`, a unit says
`document: us-capitals-omr`. Neither the shelf nor the work appears in the id, so
moving a work between shelves does not touch a single reference.

**Bank ids are paths, and carry subject and work.**
`english/shakespeare-tales/the-merchant-of-venice/01-a-risky-bond` is the file
`english/shakespeare-tales/quizzes/the-merchant-of-venice/01-a-risky-bond.yml`.
The `quizzes/` container is **not** part of the id — it is inserted between the
work and the rest when resolving. Three segments are the minimum.

That omission is load-bearing: it is what let all 4,616 nested banks keep their
ids through the 2026-07-30 restructure. Only four loose banks, which had no work
segment at all, were renamed.

## What the datastores enforce

- **A curriculum id may not appear under two works.** A bare reference could not
  say which was meant, so the second copy is skipped and reported.
- **A unit's `subject:` must match its shelf.** Units carry the field and the
  domain validates it against the nine; documents and manifests have none and
  take their shelf from the folder.
- **Bank paths cannot escape.** Every segment must start alphanumeric, so `..`
  and hidden names cannot match. Dots are allowed after the first character —
  43 imported banks name a half-step that way (`multiplying_expressions_0.5`).

On the subject cross-check the **field wins**, not the folder: the domain owns
it, and Plex-sourced material is shelved from `school.yml` with no folder
anywhere. Storage only reports the drift, as an entry in the `errors` array,
which isolates a bad file instead of blanking the catalog.

## Where subject comes from, by content type

| content | subject declared in |
|---|---|
| units | `subject:` in-file (shelf must agree) |
| quizzes (banks) | the shelf — and the id's first segment |
| documents / manifests | the shelf |
| generated packages | the shelf |
| Plex media sources | `subject:` / `subject_overrides:` in `school.yml` |
| label-curated Plex items | a `subject:<x>` label on the item |

A `subject` naming anything outside the nine routes to the Library rather than
erroring — so a typo hides content instead of announcing itself. Check the shelf
after adding.

## Which validator owns which tree

Two parallel authored systems exist by design, each with its own validator —
know which one your content belongs to (admin advocacy #17):

| tree | system | validator / CLI |
|---|---|---|
| `content/school/{subject}/{course}/…` (courses, units, lessons, documents, quizzes) | lifecycle curriculum | `node cli/school.mjs catalog validate` — parses, cross-resolves references, checks the bank↔unit seam (duplicate `unit:` claims and dead curriculum backlinks are refusals), and prints history drift |
| `content/school/learning-catalog/…` (`school.catalog/v1` Learning Catalog) | Learning Catalog | `npm run school:certify` — catalog + surface certification |
| `content/school/learning-catalog/documents/…` | print document SOURCES (`school.document-source/v1`) **and** learning documents (`school.learning-document/v1`) — one shelf, told apart by schema | `node cli/school.mjs docs validate` (print sources; skips learning documents) / `npm run school:certify` (learning documents) |
| `household/school/artifacts/print/…` | print ARTIFACTS — published revisions, derived banks, allocations | `node cli/school.mjs docs audit` |

`school:certify` does NOT cover the lifecycle curriculum; run the
school-catalog CLI before mounting new works.

## Related

- Banks bind to a unit by carrying `unit:` (a unitId, or `plex:<ratingKey>` for
  media); the bank index resolves from there rather than from any list.
- Per-student progress: `data/users/{id}/apps/school/`
- Household-scoped school data: `data/household/school/` (see the taxonomy in the School reference).
- Policy and enrollment: `data/household/school/school.yml`, `plans/`
