# School persisted-state taxonomy — recommendation

**Date:** 2026-08-25
**Scope:** `data/household/school/` (and a new `media/household/school/`), plus the
adapters/use-cases that name those paths. Proposal only — no code or data changed.

The operator's brief: `data/` holds only data; materialized binaries belong on the
media side; naming (URL-encoding, colons, repeated session ids) is ugly; the *concepts*
are right, the *arrangement* is not; nothing is frozen.

---

## 1. Audit

Ranked. Items 1–5 are correctness hazards; 6–10 are ugliness/arrangement.

### 1.1 One session, two spellings (case drift) — the most important finding

A work session id is minted mixed-case:
`schoolLifecycle.mjs:552` → `` `ses_${shortId(8)}` `` with `shortId`'s 62-char
alphabet (`backend/src/2_domains/core/utils/id.mjs:12`). The same identity then
appears in the tree in **two spellings**:

- Mixed case, verbatim: `records/worksheets/ses_hmSsHlJR.yml`,
  `records/session-results/ses_hmSsHlJR.machine.png`, receipt artifact ids
  (`receipt/ses_hmSsHlJR/out:ses_hmSsHlJR`).
- Lower-cased, via `slugify` (`2_domains/school/documents/receipts.mjs:32-37`, called
  from `IssueDocument.mjs:549` and `IssueComposedWorksheet.mjs:138`):
  `ws-${slugify(sessionId)}` → `ws-ses-hmsshljr`, which becomes the worksheet
  document id, the `artifacts/print/documents/.../ws-ses-hmsshljr/` directory, and the
  issued-worksheet artifact id.

Consequences:

- **Lossy fold.** `slugify` case-folding maps 62^8 session-id space onto ~36^8. Two
  sessions differing only in case would mint the **same** worksheet document id and
  publish into the same `documents/<id>/<rev>/` directory. Probability is low at
  household volume (birthday bound ≈ n²/2·36⁸), but the failure mode is silent
  identity merge of two children's worksheets — the worst kind of failure this system
  can have.
- **Case-insensitive sync targets are in the loop.** This exact data tree syncs
  through Dropbox to a macOS checkout — proven by
  `artifacts/calculator/ti-86/manifest.json` recording
  `contentRoot: /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/...`.
  On APFS (default case-insensitive), any two file names distinct only by case
  collide. Every mixed-case filename (`ses_GxBZiBqG.yml`) is betting nothing ever
  mints its case-twin.
- **Joins require a case-insensitive scan.** Given `ws-ses-hmsshljr` you cannot
  reconstruct `ses_hmSsHlJR`; the reverse join only works through the worksheet
  instance record or the artifact manifest's `sessionIds`. Anything that tries to go
  from a document id back to a session by string transform will fail.

**Fix (forward-only):** mint session ids from a lowercase alphabet so `slugify`
becomes injective over them, and adopt a lowercase-only path grammar. Do **not**
rewrite existing session/outcome ids — `out:ses_X` is the `EconomyService.earn()`
ref (`2_domains/school/sessions/outcome.mjs`), so those ids have crossed a domain
boundary into the coin ledger and are frozen evidence.

### 1.2 Percent-encoded flat directory for issued artifacts

`YamlIssuedArtifactStore.mjs:20` — `#stem(id) { return encodeURIComponent(id); }` —
flattens a genuinely hierarchical id into names like:

```
artifacts/issued/receipt%2Fses_hmSsHlJR%2Fout%3Ases_hmSsHlJR.png
artifacts/issued/agenda%2Flearner-one%2F2026-08-26T01%3A56%3A59.577Z.png
```

The ids are fine; the storage mapping is what is ugly. Hazard beyond aesthetics: the
directory is unbrowsable, `%` in filenames trips shell tooling, and the flat dir will
grow without bound (28 files after a few weeks of light use).

### 1.3 Binary bytes inside `data/`

- `artifacts/issued/*.pdf|*.png` — 1.4 MB of the tree's 3.7 MB, growing with every
  issued worksheet, agenda, and receipt.
- `records/session-results/ses_X.machine.png` (`YamlSessionResultArtifactStore.mjs:15`)
  — rendered OMR evidence PNGs inside `records/`.
- `artifacts/calculator/ti-86/*.86s` + `manifest.json` — TI-86 provisioning binaries.

`data/` is the Dropbox-synced, greppable, "a parent must preserve this" tree. Bytes
belong on the media volume (precedent: `media/logs/{app}`, the 400-day school ledger,
`media/apps/fitness/...`). This is the operator's complaint 1, and it is structural,
not cosmetic: every future byte-producing feature will copy whatever pattern exists.

### 1.4 Duplicated legacy OMR day files

`records/assessments/omr/2026-07-30.yml … 2026-08-18.yml` (7 files) sit at the
parent level **and** the same dates exist under
`records/assessments/omr/study-omr/` (which continues past them to 2026-08-25).
The recorder (`app.mjs:835` → `createQuizScanRecorder`, outRoot
`school/records/assessments/omr`) now writes per-reader subdirectories; the
parent-level files are pre-reader-id leftovers. Any consumer that scans the parent
recursively double-counts those seven days.

### 1.5 Stale derived file at the tree root

`content-manifest.yml` (374 KB, mtime 2026-08-22) at the school root is an orphan:
the writer moved to the machine-local runtime cache
(`app.mjs:4639` → `configService.getRuntimeCachePath('school/content-manifest.yml')`;
`1_adapters/school/content/ContentTreeManifest.mjs:15` documents the cache location).
Nothing reads the data-tree copy; it will silently rot and mislead.

### 1.6 Redundant session id in receipt artifact ids (ugliness)

`CloseSessionOutcome.mjs:407` — `` `receipt/${sessionId}/${outcome.outcomeId}` `` —
but `outcomeIdFor` is deterministic: always `out:` + sessionId
(`sessions/outcome.mjs:32-35`). So `receipt/ses_X/out:ses_X` says "ses_X" twice and
carries zero extra information. `IssueCorrectedResultReceipt.mjs:33` is already the
better shape: `receipt/<sessionId>/correction/<correctionId>`.

### 1.7 Colons and full ISO timestamps in ids (ugliness with teeth)

`ResolvePersonalCard.mjs:52` — `` `agenda/${learnerId}/${issuedAt}` `` with a full
ISO-8601 timestamp (`2026-08-26T01:56:59.577Z`), and `out:` in outcome ids. `:` is
illegal in macOS Finder and Windows filenames; today only `encodeURIComponent` saves
it. Any naming scheme that puts id segments into real paths must ban `:` in new ids.

### 1.8 `artifacts/` mixes three unrelated lifecycles (arrangement)

- `artifacts/print/{documents,cards,forms}` — append-only **published revisions** and
  card registers (`YamlPrintDocumentRepository`, `YamlFormMapStore`); canonical,
  never deletable.
- `artifacts/issued/` — **evidence** (what was physically handed to a child); records.
- `artifacts/calculator/ti-86/` — a **regenerable export drop** produced manually by
  `_extensions/ti86-app/tools/build-catalog-packs.mjs` on the macbook (default output
  is the extension's own `dist/`; someone pointed `--output` here). No backend code
  reads this path. Also the only JSON manifest in a YAML tree.
- `artifacts/captures/` — virtual-printer debug captures, dev-only
  (`schoolLifecycle.mjs:228,335,343`); empty in prod.

Four different answers to "may I delete this?" under one name.

### 1.9 `plans/learners/` vs `records/plans/learners/` (not a bug, bad name)

This is a **real authored-vs-derived split**, not duplication:
`YamlAssignmentStore.mjs:66` (current plan, mutable) vs `:72` (`#historyRoot`,
append-only plan revisions). Correct concept, confusing name — `records/plans/`
reads like a mirror of `plans/`. Rename the history root so the tree self-describes.

### 1.10 Naming convention is unstated

Nothing declares the path grammar, so every store invented one: mixed-case stems,
date-sharded dirs, slugs, uppercase token filenames (`runtime/tokens/26HTNHKHTQYP95A5.yml`),
percent-encoding. The layout needs one written rule.

---

## 2. Principles

1. **`data/` is text records; `media/` is bytes.** Every persisted byte payload
   (PDF, PNG, `.86s`, future audio) lives under `media/household/school/`. Its
   YAML manifest — the *record* — stays in `data/`, carries `sha256` + `byteLength`,
   and is the authority. Bytes are the exhibit; YAML is the ledger.
2. **Three lifecycles, three roots, one question each:**
   - `plans/` — authored intent. Mutable, human-meaningful, edited on purpose.
   - `records/` — evidence. Append-only; never deleted, never rewritten (house rule:
     mistakes get correcting records, not edits).
   - `runtime/` — revocable machine state. Deletable at worst-cost inconvenience.
   Published print revisions get a fourth root, `print/`, because they are
   append-only *derived canon* (content-hash-addressed), neither authored intent nor
   session evidence.
3. **Caches never live in `data/` or `media/`.** Anything regenerable at zero
   information loss (content manifest, material snapshots, thumbnails, virtual-print
   captures, TI-86 packs if we chose not to keep them) goes to
   `getRuntimeCachePath()` — the pattern `YamlMaterialSnapshotStore` already follows.
4. **Path grammar:** every path segment matches `[a-z0-9._-]+`; no `%`, `:`,
   spaces, or case-significant identity. Hierarchical ids map to real directories,
   segment by segment. **New** ids are minted inside this grammar; **existing** ids
   are never rewritten (they are referenced from append-only session events and the
   economy ledger) — the store's id→path mapping handles the legacy characters.
5. **Bytes that were issued to a child are immutable and are never silently
   substituted.** A missing or digest-mismatched payload degrades the artifact to the
   already-defined honest availability states (`deterministic-replay`,
   `semantic-reconstruction`, `unavailable` — print-documents.md §"Teacher history");
   it never becomes a fresh render pretending to be the original.

---

## 3. Proposed layout

### 3.1 Target tree

```
data/household/school/
  school.yml                        # policy (unchanged)
  README.md                         # updated to describe this layout
  plans/                            # authored intent (unchanged shape)
    learners/  syllabi/
    periods.yml  milestones.yml  pass-overrides.yml  timing-anchors.yml
  print/                            # append-only published print canon (was artifacts/print/)
    documents/<subject>/<course>/<doc>/<rev>/{document.yml,answers.yml}
    cards/  forms/
  records/                          # append-only evidence — YAML ONLY
    sessions/<yyyy-mm>/
    worksheets/<sessionId>.yml
    companions/
    plan-history/learners/          # was records/plans/learners/
    issued/<artifactId-as-dirs>.yml # manifests only (was artifacts/issued/*.yml)
    assessments/omr/<reader-id>/<yyyy-mm-dd>.yml
    print/{jobs.yml,archive/}
    attestations.yml  enrichment.yml  reassignments.yml
    curriculum-exceptions.yml  teacher-notes.yml  teacher-action-receipts/
  runtime/                          # revocable machine state (unchanged shape)
    agenda-cooldown/  review/  tokens/  remediation/
    queues/{print,quiz-requests}/  fitness-course-projections/
  surfaces/                         # render-policy profiles (unchanged)

media/household/school/             # NEW — byte payloads only
  issued/<artifactId-as-dirs>.<ext> # pdf/png twins of records/issued manifests
  results/<sessionId>.machine.png   # was data records/session-results/
  packs/ti-86/                      # was data artifacts/calculator/ti-86/

<runtime cache>/school/             # existing getRuntimeCachePath — unchanged
  content-manifest.yml  materials/  captures/{laser,thermal}/
```

Gone entirely: `artifacts/` (split into `print/`, `records/issued/` + media, packs,
cache), root `content-manifest.yml` (stale orphan), parent-level OMR day files.

### 3.2 Old → new mapping (every current path)

| Current (`data/household/school/`) | New | Notes |
|---|---|---|
| `school.yml`, `plans/**`, `surfaces/**`, `runtime/**` | unchanged | concepts already right |
| `README.md` | unchanged path | rewrite contents for new layout |
| `content-manifest.yml` | **delete** (→ `data/_deleteme/`) | writer already moved to runtime cache (app.mjs:4639) |
| `records/sessions/`, `records/worksheets/`, `records/companions/`, `records/print/jobs.yml` | unchanged | |
| `records/plans/learners/` | `records/plan-history/learners/` | same files, honest name |
| `records/assessments/omr/<date>.yml` (7 parent-level files) | **delete** after byte-diff vs `study-omr/` twins (→ `_deleteme/`) | pre-reader-id leftovers |
| `records/assessments/omr/study-omr/**` | unchanged | |
| `records/session-results/ses_X.machine.png` | `media/household/school/results/ses_X.machine.png` | bytes out of data |
| `artifacts/issued/<enc>.yml` | `records/issued/<artifactId path>.yml` | e.g. `records/issued/scripture/come-follow-me-ot-2026/ws-ses-hmsshljr.yml` |
| `artifacts/issued/<enc>.pdf/.png` | `media/household/school/issued/<artifactId path>.<ext>` | e.g. `.../issued/receipt/ses_hmSsHlJR/out%3Ases_hmSsHlJR.png` (legacy `:` stays segment-encoded; see §3.3) |
| `artifacts/print/documents/**` | `print/documents/**` | inner shape unchanged |
| `artifacts/print/cards/**` | `print/cards/**` | |
| `artifacts/print/forms/**` (code path, may be empty) | `print/forms/**` | |
| `artifacts/captures/**` (dev-only, empty in prod) | `<runtime cache>/school/captures/**` | debug output is cache |
| `artifacts/calculator/ti-86/**` | `media/household/school/packs/ti-86/**` | regenerable export; kept because physical-transfer tooling may want it, but it is declared disposable |

### 3.3 Naming convention

- **Grammar:** segments `[a-z0-9._-]+`, `/` is a real directory separator, max depth
  guarded by the store (reuse `validId`'s existing segment checks in
  `YamlIssuedArtifactStore.mjs:8-10`).
- **Id → path mapping:** per-segment sanitize, not whole-id encode. Characters in
  `[A-Za-z0-9._-]` pass through; anything else percent-encodes *within its segment*.
  New-grammar ids therefore map to themselves; the six legacy receipt files keep a
  `%3A` in their leaf name (`out%3Ases_X.png`) as a visible, bounded legacy tail.
  The mapping is deterministic and injective for all ids, old and new.
- **New session ids:** lowercase mint — `` `ses_${shortIdLower(10)}` `` (alphabet
  `a-z0-9`, length 10 ≥ entropy of the old 62⁸). `slugify` is then injective over
  them and the case-drift class of bugs dies at the source. Existing mixed-case ids
  remain valid forever; they are ids, not files to fix.
- **New receipt artifact ids:** `receipt/<sessionId>/original` (replaces
  `receipt/<sessionId>/out:<sessionId>` — the outcome id is deterministic from the
  session id, so the second copy said nothing; `original` mirrors the existing
  `correction/<id>` sibling and the docs' own vocabulary). Corrections keep
  `receipt/<sessionId>/correction/<correctionId>`.
- **New agenda artifact ids:** `agenda/<learner>/<yyyymmddThhmmssmmmZ>` — ISO basic
  format, no colons.
- **Timestamps in filenames** anywhere else: `yyyy-mm-dd` for day shards (as today),
  ISO basic for instants.

---

## 4. Regenerability decision: keep the bytes, move them to media — option (c) with (a)'s spine

**Recommendation: (c)/(a) hybrid.** Issued bytes move to `media/household/school/`
but are **not** a disposable cache — they remain the authoritative exhibit. The YAML
manifest in `data/records/issued/` is the record of truth (it already embeds
`sourceDocument` for v3, `sha256`, `byteLength`). On read, the store verifies the
digest exactly as it does today (`YamlIssuedArtifactStore.mjs:34`); a missing or
mismatched payload surfaces as the honest availability downgrade
(`deterministic-replay` when `sourceDocument` permits a *labelled* replay, else
`unavailable`) — reported, never hidden.

Why not (b), drop bytes and re-render on demand:

- **The renderer drifts constantly.** A re-render after any renderer change will not
  reproduce the recorded `sha256`. At that moment option (b) has only bad choices:
  show different paper than the child was handed while calling it the original
  (forbidden — print-documents.md §"Teacher history and artifact lineage" is explicit
  that a replay "never replaces, overwrites, or claims to be the retained original"),
  or degrade *every* artifact to replay status, which deletes the "Exact issued
  file" guarantee the teacher UI and reprint flow are built on
  (`school.mjs:1435-1478` serve retained bytes; reprint sends *those same bytes* —
  print-documents.md §9).
- **A digest mismatch after a renderer change means nothing is wrong** — and that is
  precisely the problem: it makes the integrity check unable to distinguish
  "renderer evolved" from "file corrupted". Retained bytes keep `sha256` meaningful.
- **The cost is trivial.** 1.4 MB after weeks of use; call it tens of MB/year.
  The media volume already durably holds the 400-day school ledger and rides the
  same Dropbox app folder as `data/` (same host mount,
  `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/{data,media}`), so moving
  sideways loses no durability. (Verify media/ is not excluded from Dropbox sync
  before migrating — risk §7.)

What **is** (b)-style disposable: previews, thumbnails, postview renders, frozen
replays, virtual-print captures, the content manifest, material snapshots, TI-86
packs. None of these are issued paper; all go to (or stay in) the runtime cache and
may be deleted freely.

---

## 5. Code changes

### 0_system

- `ConfigService.mjs` — **add** `getHouseholdMediaPath(relativePath, householdId)`
  → `<mediaDir>/household[-hid]/<relativePath>`, mirroring `getHouseholdPath`'s
  folder-name resolution. Today there is no media-side household helper (only
  `getMediaDir()`, app.mjs:568 etc.); this is the one new primitive everything else
  uses.
- `2_domains/core/utils/id.mjs` — add `shortIdLower(length)` (lowercase alphabet).
  Existing `shortId` untouched (other domains depend on it).

### 1_adapters

- `persistence/yaml/YamlIssuedArtifactStore.mjs` — the centerpiece.
  Now: flat `artifacts/issued/` + `#stem = encodeURIComponent`, bytes beside
  manifest. Then: manifests under `records/issued/` via per-segment mapping; bytes
  under `getHouseholdMediaPath('school/issued/...')`; **dual-read** fallback to the
  legacy flat path on ENOENT (see §6); writes go to new paths only. Digest
  verification and immutability (`wx`, write-chain) unchanged.
- `persistence/yaml/YamlSessionResultArtifactStore.mjs:15` — root
  `records/session-results` → `getHouseholdMediaPath('school/results')`; dual-read.
- `persistence/yaml/YamlAssignmentStore.mjs:72` — `#historyRoot`
  `school/records/plans/learners` → `school/records/plan-history/learners`.
- `persistence/yaml/YamlFormMapStore.mjs:34` — `school/artifacts/print/forms` →
  `school/print/forms`.
- `1_adapters/school/documents/YamlPrintDocumentRepository.mjs` — no code change;
  its `directory` is injected. Update the doc-comment path references.

### 3_applications

- `school/usecases/CloseSessionOutcome.mjs:407` — mint
  `receipt/${sessionId}/original` instead of `receipt/${sessionId}/${outcome.outcomeId}`.
  (Idempotency is unaffected: the capture is keyed by artifactId and the id is still
  deterministic per session.)
- `school/usecases/IssueCorrectedResultReceipt.mjs:33` — unchanged shape; confirm
  `correctionId` conforms to the new grammar.
- `school/usecases/ResolvePersonalCard.mjs:52` (and its doc comment at :38) — agenda
  ids use ISO-basic timestamps (no colons).
- `school/usecases/IssueDocument.mjs:549`, `IssueComposedWorksheet.mjs:138,151,169`
  — no change needed once session ids mint lowercase; `slugify(sessionId)` becomes
  injective. (Deliberately *not* removing `slugify`: subject/course segments still
  need it.)
- Session mint sites switch to `shortIdLower`: `schoolLifecycle.mjs:552`,
  `SchoolService.mjs:356`, `BuildAgenda.mjs:105`, `OpenRemediation.mjs:36`,
  `RunSelfServiceAction.mjs:136`.

### 5_composition

- `modules/schoolLifecycle.mjs:228` — `captureRoot` →
  `getRuntimeCachePath('school/captures')` (dev-only virtual printers).
- `modules/schoolLifecycle.mjs:719` — `printDocumentsRoot`
  `school/artifacts/print` → `school/print`.
- `modules/schoolLifecycle.mjs:742` — pass nothing new; the issued store reads both
  helpers from `configService`.
- `app.mjs:835` (quiz scan recorder) — path unchanged
  (`school/records/assessments/omr`); no code change.

### 4_api / frontend

- **None.** Routes take `:artifactId` (URL-encoded by
  `teacherWorkspaceApi.js:84-92`) and resolve through the store; ids are unchanged,
  so every existing teacher link keeps working. This is the payoff of changing the
  mapping, not the ids.

### Tests / docs

- `YamlIssuedArtifactStore.test.mjs` — new path expectations + dual-read cases.
- `docs/reference/school/README.md` §"Household data taxonomy",
  `print-documents.md` §10 — update path tables.

---

## 6. Migration

Small enough to do in one sitting: 166 YAML, 19 binaries, 3.7 MB. All moves are
computable from manifests; nothing is guessed from filenames alone.

**Order matters: code first (dual-read), then files.**

1. **Inventory (before touching anything).**
   `find data/household/school -type f | sort` + `sha256sum` of every file → keep the
   listing outside the tree. Also enumerate every `artifactId` from
   `artifacts/issued/*.yml` manifests (the manifest's own `artifactId` field, not the
   decoded filename — and assert the two agree, which doubles as a corruption sweep).
2. **Deploy the code** (all of §5) with dual-read in the two byte stores:
   - `get()`: try new manifest/payload paths; on ENOENT, try legacy flat/old paths;
     digest-verify wherever found.
   - `put()`: new paths only.
   From this moment new issues land in the new layout while old artifacts still
   resolve. Run the deploy gate first (`./scripts/deploy-gate.sh`), as always.
3. **Backfill script** (`cli/school/migrate-taxonomy.mjs`, one-shot, idempotent):
   - For each issued manifest: parse → verify `sha256` against its payload → **copy**
     manifest to `records/issued/<path>.yml` and payload to
     `media/household/school/issued/<path>.<ext>` → re-verify the copies' digests →
     move the originals to `data/_deleteme/school-taxonomy-2026-08-25/<original
     relative path>` (house rule: never `rm` in the data tree).
   - `records/session-results/*.png` → media `results/`, same
     copy-verify-then-park pattern (digest = self-hash recorded in the inventory).
   - Directory renames (`artifacts/print`→`print`,
     `records/plans/learners`→`records/plan-history/learners`,
     `artifacts/calculator/ti-86`→media `packs/ti-86/`): plain moves, then verify
     file counts.
   - Parent-level OMR day files: byte-compare each against its `study-omr/` twin;
     identical → park in `_deleteme`; different → **stop and report** (do not pick a
     winner silently).
   - `content-manifest.yml` → `_deleteme`.
   - Because the data volume is root-owned on this host, the script runs via
     `docker exec` inside the container (and must `chown node:node` anything it
     creates — known docker-exec-as-root gotcha).
4. **Verify.**
   - Counts: YAML count unchanged (±0 in records/plans/print), binary count in
     `data/` = **0**, media count = 19.
   - Digests: every `records/issued/*.yml` `sha256` matches its media payload.
   - API smoke: for **every** enumerated artifactId,
     `GET /api/v1/school/teacher/artifacts/<enc>` → 200 and
     `/original` bytes hash to the manifest's `sha256`. For each of the 10 sessions,
     open teacher history in the UI (paper record panel renders, thumbnail or honest
     no-thumbnail state).
   - `grep -r '%2F' data/household/school` returns nothing.
5. **Settle, then drop dual-read** (a later commit, after a quiet week). Optionally
   leave it — it is ~10 lines and makes rollback trivial forever.

**Dropbox note:** run the file phase while nobody is at the Portal (the same gate as
deploys); Dropbox sees moves as delete+add and a mid-scan sync race is the one way
this gets messy.

**Rollback:** originals are parked, not gone. Reverse-copy from
`_deleteme/school-taxonomy-2026-08-25/` restores the old tree byte-for-byte
(verified against the step-1 inventory), and reverting the code commit restores the
old paths. Dual-read means even a *partial* rollback (old code, new files half-moved)
still resolves every artifact from whichever location holds it.

---

## 7. Risks

1. **A teacher-facing artifact link 404s.** Highest-consequence. Mitigations:
   ids never change; dual-read spans the transition; step-4 smoke test enumerates
   every artifact id rather than sampling. Residual risk ≈ a manifest whose stored
   `artifactId` disagrees with its filename — step 1 detects exactly that before
   anything moves.
2. **Media volume sync/backup parity.** Both volumes sit under the same Dropbox app
   folder on this host, but **verify `media/` is actually syncing** (it holds bulky
   fitness video elsewhere — check for selective-sync exclusions) before declaring
   issued bytes durable there. If media/ turns out to be excluded, the fallback is a
   `media/household/` carve-out added to sync — not putting bytes back in `data/`.
3. **Case collision on the macOS checkout during migration.** The new nested layout
   creates dirs like `issued/receipt/ses_GxBZiBqG/`; no two current ids differ only
   by case (step-1 inventory asserts this), and all *new* ids are lowercase, so the
   window never reopens.
4. **Immutability during the move.** The issued store refuses divergent re-puts
   (`ARTIFACT_IMMUTABLE`); the migration bypasses `put()` and copies files directly,
   so digest re-verification after copy is the only integrity guarantee — which is
   why step 3 makes it mandatory, not optional.
5. **Something reads the TI-86 pack path.** Backend grep shows no reader; the pack is
   produced by a macbook-side CLI with an explicit `--output`. If a physical-transfer
   workflow has the old path memorized, the fix is re-running the builder with the
   new `--output` — the pack is fully regenerable from content (its manifest even
   records the content root and digests).
6. **Session-event `artifactId`s referencing old receipt ids** (`out:` form) must
   keep resolving forever. They do: ids are never rewritten and the per-segment
   mapping handles `:` by segment-encoding. The six legacy receipt payloads keep an
   encoded character in their leaf filename — accepted as a bounded, honest scar
   rather than risking an evidence rewrite that would also have to touch the economy
   ledger's `out:ses_X` refs.
7. **Watchtower nightly revert / stale-deploy class of failures** on this host:
   land the code on `main` and confirm the container `/build.txt` matches origin tip
   before running the backfill, or the dual-read code may not actually be running
   when files start moving.
