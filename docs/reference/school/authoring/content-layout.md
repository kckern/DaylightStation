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
| `household/apps/school/print-documents/` | published revisions, derived banks, allocations | `school-docs publish` |
| `household/apps/school/ti86-packs/` | SchoolCalc device builds | the pack publisher |
| `household/config/school/surfaces/` | surface profiles | a person |

`content/_staging/` is a **sibling** of `content/school/`, not a child. That is
what keeps it out of `ContentTreeManifest`, which walks the school content tree
with no skip list.

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

## Hierarchical course packages (v2)

`school.course/v2` is the package layout for courses whose real hierarchy is
course → instructional unit → lesson → artifact. It coexists with the flat v1
layout above:

```text
civilization/atlas/
├── index.yml
└── units/
    └── northeast/
        ├── index.yml
        └── lessons/
            └── maine/
                ├── index.yml
                ├── worksheet.yml
                └── flashcards.yml
```

The root index carries course policy and bibliography. A unit index owns the
unit's ordering policy. A lesson index is projected through the existing unit
catalog port for agenda and progress compatibility. Every other YAML file in a
lesson folder is a typed gradable artifact; its filename is the final bank-id
segment (`civilization/atlas/maine/worksheet`, `…/flashcards`). Artifact discovery is
open-ended rather than limited to a fixed worksheet/quiz list. Existing v1
`work.yml`, `units/`, and `quizzes/` works continue to load unchanged.

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
| `content/school/{subject}/{course}/…` (courses, units, lessons, documents, quizzes) | lifecycle curriculum | `node cli/school-catalog.cli.mjs validate` — parses, cross-resolves references, checks the bank↔unit seam (duplicate `unit:` claims and dead curriculum backlinks are refusals), and prints history drift |
| `content/school/learning-catalog/…` (`school.catalog/v1` Learning Catalog) | Learning Catalog | `npm run school:certify` — catalog + surface certification |
| `content/school/learning-catalog/documents/…` | print document SOURCES (`school.document-source/v1`) **and** learning documents (`school.learning-document/v1`) — one shelf, told apart by schema | `node cli/school-docs.cli.mjs validate` (print sources; skips learning documents) / `npm run school:certify` (learning documents) |
| `household/apps/school/print-documents/…` | print ARTIFACTS — published revisions, derived banks, allocations | `node cli/school-docs.cli.mjs audit` |

`school:certify` does NOT cover the lifecycle curriculum; run the
school-catalog CLI before mounting new works.

## Related

- Banks bind to a unit by carrying `unit:` (a unitId, or `plex:<ratingKey>` for
  media); the bank index resolves from there rather than from any list.
- Per-student progress: `data/users/{id}/apps/school/`
- Household-scoped school state: `data/household/apps/school/`
- Policy and enrolment: `data/household/config/school.yml`, `config/works/`
