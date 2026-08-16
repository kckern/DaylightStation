# School content reorganization — design

**Date:** 2026-08-15
**Scope:** directory structure only. No file renames, no schema changes, no
vocabulary changes, no authoring-workflow changes.

## Goal

`content/school/` holds **abstract, uninstantiated coursework** — the nine
subject shelves and the course packages on them. Nothing else. Instances,
printed artifacts, device builds, staging material, and infrastructure config
move out to trees that match their lifecycle.

## Why now

Three answers to "how is coursework organized" were built in 24 days, and all
three are still mounted:

| era | built | files | status today |
|---|---|---|---|
| Quizzes — banks derived from books/transcripts/audio | Jul 22–30 | 4,656 | parked in `_inbox`, plus Shakespeare on a live shelf; nothing assigned |
| Catalog / SchoolCalc — a second taxonomy for offline delivery | Aug 2–6 | 21 | one live consumer (`anatomy`, generated from the Fitness corpus) |
| Course packages — `school.course/v2`, units → lessons → artifacts | Aug 12–14 | 1,196 | atlas + elements conform (341); six Big Fat Notebook attempts (855) never got a `course.yml` |

Of ~5,900 files under `content/school/`, the **125 atlas files are the only
ones a learner is assigned to.** Both learners (`felix`, `milo`) are enrolled in
`young-peoples-atlas-us` and nothing else; `math-fractions` is commented out of
`felix.yml`.

Each era ended by starting the next one rather than by closing itself out. This
spec closes out the first two.

### Two defects the reorganization repairs

**Shakespeare's 79 banks are unreachable.** `YamlSchoolDatastore#quizzesDir()`
builds `content/school/<subject>/<work>/quizzes` with **no `curriculum`
segment**, while `#works()` unions both `content/school/<subject>/` and
`content/school/curriculum/<subject>/`. A v1 work living under `curriculum/` is
therefore listed but never resolved. No root-level subject directory exists
today, so every v1 work under `curriculum/` is in this state.

**`_inbox` dominates the drift report.** `ContentTreeManifest#walk()` has no
skip list — it hashes every YAML and MD file under `content/school/`. `_inbox`
is 78% of that tree, so the nightly content-drift diff is mostly noise about
material the system cannot reach.

## Target layout

```
data/
├── content/
│   ├── school/                          ABSTRACT COURSEWORK — authored, live
│   │   ├── civilization/
│   │   │   └── young-peoples-atlas-us/   (125 files, assigned)
│   │   ├── science/
│   │   │   └── the-elements-ted-gray/    (216 files, built, unassigned)
│   │   ├── english/  writing/  math/  scripture/  language/  skills/  arts/
│   │   │                                 (empty shelves — the normal state)
│   │   └── learning-catalog/             the school.catalog/v1 authoring shelf
│   │       ├── catalogs/  documents/  question-banks/
│   │       └── schoolcalc-content-sources.yml
│   └── _staging/
│       └── school/                       NOT LIVE — imports, drafts, unfinished
│           ├── _inbox/                   the Jul 22–30 quiz import (4,576)
│           ├── shakespeare-tales/        (80)
│           └── big-fat-notebook-*/       six unfinished courses (855)
└── household/
    ├── apps/school/
    │   ├── print-documents/              published/ derived-banks/ allocations/
    │   ├── sessions/  worksheet-instances/  tokens/  history/  assignments/
    │   └── ti86-packs/                   SchoolCalc device builds
    └── config/school/
        └── surfaces/                     surface profiles
```

Subject shelves sit at the **root** of `content/school/`. This is what
`docs/reference/school/authoring/content-layout.md` has documented all along
(`<subject>/<work>/<kind>/`) and what `#quizzesDir()` already expects — doc,
code, and disk converge instead of drifting.

The nine subject ids are unchanged: `english writing math civilization
scripture science language skills arts`.

## Disposition

| current path | files | destination | rationale |
|---|---|---|---|
| `curriculum/civilization/young-peoples-atlas-us/` | 125 | `civilization/young-peoples-atlas-us/` | conforming, live |
| `curriculum/science/the-elements-ted-gray/` | 216 | `science/the-elements-ted-gray/` | conforming |
| `curriculum/english/shakespeare-tales/` | 80 | `_staging/school/` | quizzes era — stubs, unreachable today, not anchored to |
| `curriculum/{math,science,civilization,history}/big-fat-notebook-*/` | 855 | `_staging/school/` | no `course.yml`; invisible today, so nothing regresses |
| `curriculum/_inbox/` | 4,576 | `_staging/school/_inbox/` | already not live; removes 78% of the drift report |
| `curriculum/history/` | (0 after move) | delete | `history` is not in `SUBJECT_IDS`; the datastore never walked it |
| `print-documents/` | 11 | `household/apps/school/print-documents/` | machine-written artifacts; joins sessions/instances/tokens |
| `catalog/ti86-packs/` | 7 | `household/apps/school/ti86-packs/` | device build output, not coursework |
| `catalog/surfaces/` | 2 | `household/config/school/surfaces/` | device capability config, not coursework |
| `catalog/{catalogs,documents,question-banks}/`, `schoolcalc-content-sources.yml` | 12 | `learning-catalog/` (rename in place) | live subsystem; `catalog` is too generic a name beside the school catalog generally |
| `README.md`, `WORK-CONFIG.md` | 2 | rewrite to match | the data-volume copies mirror `docs/reference/school/authoring/` |

**`content/_staging/` is a sibling of `content/school/`, not a child.** That is
what takes it out of the manifest walk without a skip list, and it makes the
invariant absolute: everything under `content/school/` is live coursework.

### The one judgment call

Moving the six Big Fat Notebook courses to staging is the only disposition that
isn't forced by the code. They are 855 files representing real authoring work,
currently invisible because none has a `course.yml`. Keeping them on live
shelves would mean `content/school/` contains material no learner can reach —
the exact condition this spec exists to end. They return via the authoring
workflow once that spec lands; nothing is deleted.

## Code changes

Four roots resolve into the moved trees. Two are hardcoded and one of those
bypasses config entirely — they must change together.

| file:line | current | change |
|---|---|---|
| `YamlSchoolDatastore.mjs:98-105` | `#curriculumWorks()` reads `curriculum/<subject>` | delete; `#works()` already unions the root layout |
| `YamlSchoolDatastore.mjs:107-111` | `#workDir()` prefers `curriculum/<subject>/<work>` when it holds a v2 `index.yml` | delete the branch; return `<subject>/<work>` |
| `schoolLifecycle.mjs:540` | `path.join(dataDir, 'content/school/print-documents')` — hardcoded | point at `household/apps/school/print-documents` |
| `RenderPrintDocument.mjs:108` | `path.resolve(dataDir, 'content/school/catalog/question-banks')` — hardcoded, **bypasses `catalog.content.root`** | point at `content/school/learning-catalog/question-banks` |
| `schoolCatalog.mjs:31` | `config.content?.root ?? 'content/school/catalog'` | change the default to `content/school/learning-catalog` |

`RenderPrintDocument.mjs:108` is the trap: the Learning Catalog's root is
configurable, but this second hardcode of the same path is not. Moving the shelf
by config alone would leave rendering reading a directory that no longer exists,
and bank-select questions would fail at print time rather than at boot.

`app.mjs:4152` (`contentDir: content/school`) is unchanged — the manifest keeps
walking the same root, which is the point.

## Migration sequence

Each step is independently safe and independently verifiable. Steps 1–2 require
no code change at all, because the datastore already reads both layouts.

**1 — Move the two conforming courses to root shelves.** No code change; the
union in `#works()` covers it. Verify: atlas resolves and both learners' agendas
still build.

**2 — Move the quizzes era and the BFN attempts to `content/_staging/school/`.**
Verify: nothing in the live tree changed for atlas or elements. Shakespeare was
already unreachable, so no capability is lost.

**3 — Move `_inbox` to `content/_staging/school/_inbox/`.** Then **regenerate
the manifest baseline immediately** — this move removes ~4,600 files and would
otherwise produce a nightly diff of pure noise.

**4 — Move `print-documents` to `household/apps/school/`,** with the
`schoolLifecycle.mjs:540` change in the same deploy. Verify: reprint an existing
worksheet instance and confirm the published revision and allocation both
resolve.

**5 — Rename `catalog/` to `learning-catalog/`,** with the `schoolCatalog.mjs`
default and the `RenderPrintDocument.mjs` hardcode changed in the same deploy.
Move `surfaces/` to household config and `ti86-packs/` to household apps.
Verify: the anatomy shelf still lists, and a bank-select question still renders.

**6 — Delete the `curriculum/` code branches** and the empty `curriculum/` and
`history/` directories. Verify: full school test suite.

**7 — Rewrite `content/school/README.md`** and retire `WORK-CONFIG.md`'s
data-volume copy in favour of `docs/reference/school/authoring/`.

Move directories with `git mv`-equivalent semantics on the data volume — a
plain `mv`, since the volume is Dropbox-synced and not under version control.
Back up `content/school/` and `household/apps/school/` together before step 4;
neither tree resolves without the other.

## Risks

**Dangling attempt history.** Attempt records reference bank ids by path, and
some already resolve into `_inbox` (`history/i-survived/…` is the known case).
Moving `_inbox` does not worsen this — those references dangle today. Bank ids
are `<subject>/<work>/<rest>` and contain **no directory prefix**, so moving a
shelf changes zero ids.

**Dropbox sync churn.** ~5,500 files move. Expect a large sync window; do it
when nobody is printing.

**A one-time manifest diff of ~4,600 removals.** Mitigated by regenerating the
baseline in step 3.

## Out of scope

Deferred deliberately, each to its own spec:

- **Standards** — vocabulary (`work`/`module`/`item` vs `course`/`unit`/`lesson`),
  the triple `index.yml`, the `school.unit/v1` schema serving both legacy units
  and v2 lessons, collapsing `medium` + `material.adapter` + `source` into one
  `sources[]` list, and a closed-contents rule for course packages.
- **The authoring and review workflow** — where the blind/approval loop lives,
  per-item hashing, the lint tier, and the promote gate. The review-tier
  decision (whether `gate: omr` material gets a model review pass by default) is
  open and blocks that spec, not this one.
- **Promoting the six Big Fat Notebook courses** — they park in staging until
  the authoring workflow exists.
- **Rolling quizzes-era material into proper courses** — possible later; not
  anchored to.
