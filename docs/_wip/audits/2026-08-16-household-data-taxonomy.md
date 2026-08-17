# Household Data Taxonomy Audit

**Date:** 2026-08-16
**Scope:** `data/household/` — 257M, 41 top-level entries
**Trigger:** post-reorganization review; folders grew and root-level files accumulated

---

## Principles

Four rules fall out of the existing design intent plus the stated preferences. Every
finding below is an application of one of them.

1. **A top-level folder names a domain** — not a device, not a lifecycle stage, not a
   vendor. `UserDataService.getHouseholdSharedPath` already states this ("Household-wide
   stores are domains at the top of `household/`").
2. **Devices are a sub-key of a domain, not a peer of one.** The established shape is
   `{domain}/log/{deviceId}/{date}.yml`. Device-scoped state that belongs to *no* domain
   (telemetry, calibration, volume) goes under `hardware/`.
3. **`data/` is what you would commit to GitHub.** This is the operative test, and it is
   stricter than "text only". `data/` must stay light enough to zip into one file, diff,
   and back up often. `media/` holds everything heavy — binaries, assets, renders, **and
   big fat logs** — and is never source-controlled, with sparser backups.

   > **Being text is not sufficient.** A 109 MB tree of YAML fails this test exactly as a
   > video file does. Ask "would I commit this?", not "is this text?".

   The practical split:
   - `data/` — configuration and curated state: things a person authors, edits, and reads
     in a diff.
   - `media/` — accumulated output: logs, renders, caches, generated corpora, binaries.
4. **No lifecycle-stage roots.** `history/`, `assets/`, `cache/` describe *when* or *what
   kind*, not *what about*. They belong inside the domain they serve.

### Domain vs. kind — why the tree is hybrid, and why that's correct

There are two competing axes, and only one can be the top level:

- **Domain** (nutrition, piano, school) — the *navigation* axis. What the data is about.
- **Kind** (config, log, static asset, cache) — the *policy* axis. What you do to it.

Kind is real and worth distinguishing, because kinds differ operationally:

| Kind | Authored by | Growth | Back up? | Safe to delete? |
|---|---|---|---|---|
| config | human | fixed | yes | no |
| log | machine, appended | unbounded | maybe | no — rotate |
| static asset | human/vendor | fixed | yes | no |
| cache / derived | machine | bounded | **no** | **yes** |

Domain tells you nothing about those columns. But kind makes a poor top level for
navigation. The resolution is a test:

> **Does a single mechanism own every instance of this kind?
> If yes, centralize by kind. If each domain owns its own, keep it with the domain.**

- **Config → centralize.** `ConfigService.getHouseholdAppConfig` resolves
  `<folder>/config/<app>` and caches at boot. One loader, one place. `config/` being
  kind-first is *correct*, not a drift.
- **Logs → keep with the domain.** Each has its own relay, schema, and retention need
  (`app.mjs:710/731/749/779` inject four different dirs). No single owner.
- **Static assets → keep with the domain.** Each has one consuming domain.

The tree's hybrid shape is this rule already applied; it simply was never written down,
which is why it drifts at the edges.

**Corrected:** an earlier draft of this audit called `media/logs/{app}/` (kind-first) an
inconsistency against `{domain}/log/` (domain-first). That was backwards. Under rule 3,
`media/logs/` is the CORRECT destination and `household/{domain}/log/` is the
misplacement — a log is accumulated output and does not belong in the committable tree at
all. The domain-vs-kind question does not arise for logs, because they leave `data/`.

The same correction applies to `fitness/log/` (109 MB) and `weekly-review/log/` (38 MB),
which this audit first filed under "text, but pathological density — worth a retention
policy". They do not need a retention policy to stay; they need to move.

**Known gap:** nothing marks regenerable data. `komga/cache`, `school/cache`,
`vidangel-catalog.json`, `weather/current.yml` are all rebuildable, but nothing says so.
Given the standing "never `rm` in the data tree" rule, a consistent `{domain}/cache/`
convention is what makes it safe to ever clear one.

---

## P0 — FIXED 2026-08-16 (`5e19b0d0b`) — piano MIDI was split-brained

> **Resolved.** The writer now targets `piano/log`; eleven stranded takes were
> moved there and the empty `history/` root was parked in `_deleteme`. Two things
> this left behind, both worth carrying forward:
>
> 1. **`npm run audit:paths` cannot see this class of bug.** It verifies that
>    every resolved path exists and every domain has a reader. Both roots existed
>    and both had readers, so it reported clean. A writer and a reader disagreeing
>    about which root is canonical is invisible to it. Any move below can fail the
>    same way and the tool will still say OK.
> 2. **The guard was dead.** `piano.history.test.mjs` had been failing with
>    `createPianoRouter: pianoContainer required` since the router took a
>    container, so its path assertions had not run in a long time. It now builds
>    the real datastore, and was checked to fail when the path is wrong.
>
> The original analysis is kept below because every move in this document can
> reproduce it.

## The original P0 write-up

**This shipped today in `babc705c3` ("retire the last old-root readers") and is live in
production now.**

The commit message asserts "No code reads apps/, common/, shared/, history/ or state/ any
more." That is not true — two piano call sites were missed:

| Component | Path | File |
|---|---|---|
| MIDI **writer** | `history/piano/{user}/{date}/{take}.mid` | `1_adapters/piano/YamlPianoStudioDatastore.mjs:236` |
| MP3 render job **reader** | `piano/log` | `5_composition/bootstrap.mjs:3522` |
| PNG render job **reader** | `piano/log` | `5_composition/bootstrap.mjs:3540` |
| `FsMidiLibrary` doc comment | says `history/piano` (stale; sourceDir is injected) | `1_adapters/pianoaudio/FsMidiLibrary.mjs:2` |

**Disk confirms the split:**

- `piano/log/{user}/` — the migrated corpus, 2,673 `.mid` files, dates run through **2026-08-15**
- `history/piano/{user}/` — **only `2026-08-16`** (today), 4 users, created after the deploy

**Consequence:** every piano recording made since today's deploy lands in `history/piano/`,
which neither render job reads. Those takes will never be converted to MP3 or piano-roll
PNG, and won't surface in the MIDI library. It is silent — nothing errors.

**Fix:** point `YamlPianoStudioDatastore` at `piano/log`, update the stale `FsMidiLibrary`
comment, then merge the stranded `history/piano/*` files into `piano/log/*` and retire the
`history/` root. This is also the strongest argument for rule 4 — `history/` had no reason
to exist as a peer of `piano/`, and its existence is exactly what let the migration miss it.

---

## Findings by rule

### Rule 1 — top-level folders must be domains

| Current | Should be | Why | Call sites |
|---|---|---|---|
| `quizzes/` | `school/quizzes/` | Quiz scans are school output; `quizzes` is a pipeline stage of school, not a peer domain | `app.mjs:766` + `omr-readers.yml` override |
| `retroarch/` | `gaming/retroarch/` | Vendor name, not a domain. RetroArch is one emulator backend under gaming | `getHouseholdPath('retroarch/thumbnails')`, `'retroarch/catalog'` |
| `gameshow/` | `gaming/gameshow/` | Judgment call — see note below | `getHouseholdPath('gameshow/sessions')` |
| `komga/` | `media/` (data) + `media/img/` (heroes) | Vendor name. Komga is a comics *source*, parallel to plex under media | `komga/cache`, `komga/hero` |
| `content-filter/` | `media/content-filter/` | Every artifact is keyed to a media item (`contentId: plex:349222`); it's per-item playback *policy*, sibling to `media/memory/`'s per-item playback *position*. No `2_domains/content-filter` exists — the router is a thin yaml reader | `contentFilter.mjs:20`, `cli/contentfilter.cli.mjs:89` |
| `livestream/programs/` | `config/livestream/` | Hand-authored state machines, fixed and never appended — and `config/livestream.yml` already declares them (`programs: demo-tour: {path: demo-tour.yml}`). Matches the existing authored-collection precedent (`config/works/`, `config/lists/`, `config/school/surfaces/`) | `app.mjs:1250` |

**Note on `gameshow`:** the backend keeps `2_domains/gameshow` and `2_domains/gaming` as
genuinely separate bounded contexts, and that separation is correct — a buzzer/team quiz
show is not a game session with a pinned definition. But *folder nesting is not the same
claim as domain merging*. Nesting the data under `gaming/gameshow/` groups the play
surfaces without touching the code's context boundary, and it's a one-line move. Worth
doing; just don't let it become a reason to merge the domains later.

### Rule 2 — devices belong under a domain, or under `hardware/`

The `{domain}/log/{deviceId}/` convention is already working well and should be the
template: `automotive/log/family-car/`, `nutrition/log/kitchen-food-scale/`,
`omr/log/study-omr/`, `barcode/log/nutribot-upc/`.

The good news: **these are cheap to move.** Every relay had its `DEFAULT_DIR` deliberately
removed and the path injected from the composition root — `app.mjs:710/731/749/779` each
pass the directory as a single string to `relayDayLog(...)`. The relay source comments say
so explicitly. Relocating a log tree is a one-string change per domain, plus a data move.

| Current | Should be | Why |
|---|---|---|
| `pressure-mats/log/garage-step-mat/` | `hardware/pressure-mats/log/…` | A step mat serves no domain — it's raw device I/O. Domain-less device → `hardware/` |
| `eink/telemetry.yml` | `hardware/eink/telemetry.yml` | Panel telemetry is device health, not a domain |
| `hardware/volLevel.yml` | stays | Already correct — domain-less device state |
| `screens/*.yml` | `config/screens/` *(recommended)* or `hardware/screens/` | See note |

**Note on `screens/`:** these five files are *layout configuration* read at page load, not
device state or logs. `config/` already holds the sibling concept (`config/devices.yml`)
plus nested config trees (`config/school/`, `config/triggers/`, `config/lists/`). So
`config/screens/` is the more consistent home than `hardware/screens/` — screens are
configured, not measured. Flagging because `hardware/` was the instinct; either works, but
consistency argues for `config/`.

**`barcode/` — leave at top level.** It looks device-shaped but there is a real
`2_domains/barcode`, and `TriggerEvent` treats it as a *modality* peer to `nfc`. It earns
its place. The wrinkle is that `barcode/log/nutribot-upc/` is nutrition traffic — that's
fine, the device is the sub-key exactly as rule 2 wants.

### Rule 3 — `data/` is text only

Current file-type census across `data/household/`:

| Type | Count | Verdict |
|---|---|---|
| `.yml` | 5,251 | correct |
| `.mid` | **2,673** | **binary — move to `media/`** |
| `.json` | 192 | correct |
| `.svg` | 27 | text — fine to stay |
| `.csv` / `.md` / `.ndjson` | 18 | correct |
| `.jpg` | **8** | **binary — move** |
| `.86s` | **6** | **binary — move** |
| `.pdf` | **1** | **binary — move** |

**Violations:**

- **`piano/log/**/*.mid` — 2,673 files, ~63M.** The single largest violation. `media/midi/`
  already exists, and the render jobs already write MP3/PNG to `media/audio/piano/`. The
  MIDI source should live beside its renders, not in `data/`.
- **`komga/hero/*.jpg` — 1.4M.** Cover images. → `media/img/komga/`.
- **`retroarch/thumbnails/`.** → `media/games/retroarch/` (`media/games/` exists).
- **`school/ti86-packs/*.86s` — 6 files.** Verified binary (`TI-86 Graphing Calculator`).
  → `media/apps/school/ti86-packs/`.

**Not violations — verified text, just bulky:**

- `content-filter/edl/` (20M) — ASCII text `.edl.yml`. Stays.
- `strava/strava-webhooks/` (2.3M) — ASCII yaml. Stays.
- `gaming/log/` (5.5M) — UTF-8 yaml. Stays.
- `assets/icons/*.svg` — text. Stays in `data/` (but relocates by rule 4, below).

**Separate concern — text, but pathological density.** These don't break rule 3 but do
undercut "lightweight":

| Path | Size | Note |
|---|---|---|
| `fitness/log/` | **109M** | single sessions up to **3.2M** (`2026-07-20/20260720063117.yml`) |
| `weekly-review/log/` | 38M | |
| `finances/finances.yml` | 2.8M | single compiled file |
| `fitness/exercise-index.yml` | 2.7M | single index file |

Worth a retention/rollup policy of its own. The fitness session index (`_index/{YYYY-MM}.json`)
already proved the pattern works; the raw per-session yaml is what's oversized.

### Rule 4 — no lifecycle-stage roots

| Current | Should be | Why |
|---|---|---|
| `history/piano/` | `piano/log/` | Lifecycle stage as a root. **This is the P0 above** |
| `assets/icons/` | `nutrition/icons/` | Only consumer is the nutrition sheet icon loader (`app.mjs:2294`); contents are `food/`, `vessel/`, `control/` icons |
| `media/memory/` | fine | `memory` here means playback position — domain data, not a stage |

### Loose root-level files

Three YAML files sit at the household root with no folder. All three are read through
`loadFile`, which roots at `householdDir` (`app.mjs:2991`) — so each move is a one-string
change at the call site.

| File | Size | Should be | Call sites |
|---|---|---|---|
| `calendar.yml` | 40K | `calendar/calendar.yml` | `routers/calendar.mjs:47` (`readHouseholdSharedData`) |
| `events.yml` | 13K | `calendar/events.yml` | `routers/homeAutomation.mjs:344` |
| `youtube.yml` | 2.3K | `media/sources.yml` | `admin/media.mjs:30,62,107`, `FreshVideoJobHandler.mjs:34` |

`calendar.yml` and `events.yml` are consumed together by `EventAggregationService` (both
surface as `type: 'calendar'`), so a shared `calendar/` folder is the natural home.
`youtube.yml` is a media *source list* — it belongs with `media/`, which already holds
`queue.yml` and `menu-memory.yml`.

---

## Cruft to clear

Per the standing rule, **never `rm` inside the data tree** — move to `data/_deleteme/`.
(`docker exec` runs as root, so `rm` will always appear to "work.")

| Path | Why |
|---|---|
| `piano/config.yml` (4K) | Stale duplicate. `config/piano.yml` (27K) is the live one |
| `piano/producer.backup-v1-2026-08-10T16-28-39-643Z/` | Dated backup dir |
| `config/untitled folder/` | Empty, accidental |
| `config/entropy.yml.bak` | Backup file in config |
| `media/memory/plex/14_fitness.yml.bak.*` | 3 stray backups (2 timestamped + 1 named) |
| `finances/tmp.yml` | Scratch file |
| `gratitude/split-scripture-stories-scenes.sh` | A shell script living in the data tree |
| `.DS_Store` | macOS junk (1 in household, more in `media/`) |

---

## Correct as-is

Worth stating so the sweep doesn't churn what already works: `auth/`, `config/`,
`finances/`, `fitness/` (structure, not size), `school/`, `nutrition/`, `automotive/`,
`omr/`, `gaming/`, `feed/`, `feedback/`, `gratitude/`, `notifications/`, `triggers/`,
`weather/`, `livestream/`, `content-filter/`, `newsreporter/`, `cli/`, `weekly-review/`
(structure, not size), `strava/`, `media/`.

---

## Proposed end state

```
household/
  auth/            config/            # + screens/
  calendar/        # calendar.yml, events.yml
  automotive/      barcode/           cli/
  content-filter/  economy?           feed/
  feedback/        finances/          fitness/
  gaming/          # + retroarch/, gameshow/
  gratitude/       hardware/          # + eink/, pressure-mats/, volLevel.yml
  livestream/      media/             # + sources.yml (was youtube.yml), komga data
  newsreporter/    notifications/     nutrition/    # + icons/ (was assets/)
  omr/             piano/             # + log/ absorbs history/piano
  school/          # + quizzes/
  strava/          triggers/          weather/      weekly-review/
```

Gone from root: `assets/`, `history/`, `quizzes/`, `retroarch/`, `gameshow/`, `komga/`,
`eink/`, `pressure-mats/`, `screens/`, `calendar.yml`, `events.yml`, `youtube.yml`.

---

## The rule for every move below

Today's piano regression happened because a migration moved data and left a writer
pointing at the old root. Nothing failed loudly; the corpus just forked. The same
failure is available to every move in this document, so each one is done as a single
unit of work:

1. Change the code path **and** move the data in the same step — never one without
   the other.
2. Grep for the old path across `backend/src`, `frontend/src`, `cli`, **including
   constructor defaults and inline string arguments** — those are what the earlier
   greps missed twice (`YamlObservedStateStore`, `YamlPianoStudioDatastore`).
3. Confirm a **reader actually returns data** from the new location. `audit:paths`
   passing is necessary, not sufficient — see the P0 note above.
4. Park the old location in `data/_deleteme/`, never `rm`.

## Suggested order

1. ~~**Fix the piano split-brain**~~ — done, `5e19b0d0b`.
2. **Clear the cruft** — zero risk, shrinks the surface before moving anything.
3. **Move the binaries to `media/`** — biggest size win (~65M out of `data/`).
4. **Fold the strays** — root yaml files, `assets/`, `quizzes/`, `retroarch/`, `gameshow/`,
   `komga/`, `content-filter/`, `livestream/`, and the `hardware/` consolidation. Each is
   a small, injected-path change.
5. **Then** take up fitness/weekly-review log density as its own piece of work.

## Measured against rule 3 — `data/` is 1.7 GB

Measured 2026-08-16. The committable-tree test is failed by far more than the binaries
this audit originally chased; binaries turned out to be a rounding error, and volume of
generated YAML is the real weight.

| Tree | Size | Verdict |
|---|---|---|
| `content/readalong/scripture/` | **649M** | generated word-timing YAML → `media/` |
| `users/kckern/lifelog/` | **208M** | includes a 68.8M `.yml.migrated` in `archives/_trash/` |
| `household/fitness/log/` | **109M** | log → `media/logs/fitness/` (which already exists) |
| `household/piano/log/` | **60M** | 2,673 `.mid` — log AND binary → `media/` |
| `household/weekly-review/log/` | **38M** | see `.webm` below |
| `household/content-filter/edl/` | 20M | 499 generated EDL files → `media/` |
| `household/gaming/log/` | 5.5M | log → `media/` |
| `household/strava/strava-webhooks/` | 2.3M | captured webhook bodies → `media/` |
| smaller `*/log/` dirs | ~2.7M | weather, automotive, newsreporter, barcode, nutrition, omr, pressure-mats, cli |

**The most flagrant single violation:** `household/weekly-review/log/*/.drafts/*.webm` —
actual recorded audio/video sitting in the committable tree, including one **25.8 MB**
file. That is most of what makes weekly-review 38M.

**Also inside `data/`, not counted above:** `_deleteme/` at 263M and `_trash/` at 42M.
Retired data is parked correctly, but it is parked inside the tree that is supposed to zip
small.

**What is genuinely fine:** every binary this audit originally flagged. `komga/hero` was 8
orphans against a 531-file live cache in `media/img/komga/hero` (retired). `retroarch/
thumbnails` is empty with a no-op downloader. `school/ti86-packs` is 6 hand-placed files.
`assets/icons` is 27 SVGs. Together they are under 2 MB — the binaries were never the
problem.

**Rough arithmetic:** moving the logs and generated corpora takes `data/` from 1.7 GB to
roughly 30–40 MB. That is the difference between "cannot be committed" and "zips into one
file", which is the whole point of the rule.

## Relationship to `household/tier1`

That branch is **fully merged into main** and has no unique commits. Its work was the
*code-side* refactor — routers and relays stopped building their own storage paths,
`getHouseholdSharedPath` was rerooted, and `audit:paths` was added. It was never the
taxonomy reorganization proposed here, which is why the disk layout still shows every
item below. The two are complementary: tier1 made these moves cheap by centralizing
path construction; this document is what to do with that.
