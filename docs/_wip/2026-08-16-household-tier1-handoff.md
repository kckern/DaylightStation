# Handoff — Household Tier 1 domain moves (for the prod agent)

**Written:** 2026-08-16, from the laptop, by an agent with no prod deploy authority.
**For:** whoever runs this on `homeserver.local`, with the container in reach.
**Plan this executes:** `docs/plans/2026-08-15-household-reorganization.md` — Tier 1.
Read that plan's **"THE DEPLOY HAZARD"** section before anything else here.

---

## STOP — two blockers, both must clear first

### 1. Prod is 107 commits behind, and none of yesterday's work is deployed

At time of writing:

| | |
|---|---|
| laptop `main` | `ea0a08dca` |
| `/opt/Code/DaylightStation` (prod deploy tree) | `0fe9a745b` — **107 commits behind** |
| laptop vs `origin/main` | **6 commits ahead, unpushed** |

Nine merges from 2026-08-15 are not on prod, including changes to the exact
code that reads these paths (`UserDataService`, `IssueDocument`,
`GradeSubmission`, `RecordCardScanOutcome`, the print renderer).

**Moving data before prod runs that code guarantees breakage.** Prod would be
looking for `household/common/…` while the directory has become
`household/finances/…`.

**Do not start Tier 1 until prod is running current `main`.** Push, deploy,
verify healthy, *then* come back to this document.

### 2. The data directory is Dropbox-synced and shared with the laptop

`/root/Dropbox` → symlink → `/media/kckern/DockerDrive/Dropbox`
Container mount: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data` → `/usr/src/app/data`

That is the **same Dropbox account** the laptop syncs. A directory renamed in
either place propagates to the other within seconds. So:

- Do this work **on the server**, with the container stopped — not on the laptop.
- Assume the laptop may be syncing. If someone is editing there mid-move, you
  will get a conflicted copy rather than a clean rename.
- **`rm -rf` is forbidden in the data tree** (project rule). Move to
  `_deleteme/` instead; the user empties it.

---

## Context — why this is being done at all

`household/` has five roots holding domain-named folders (`apps/`, `common/`,
`shared/`, `history/`, plus a lone `automotive/`), with no rule that sorts a
domain into one rather than another. Four names currently exist in two places
at once: `komga`, `fitness`, `gaming`, `piano`.

This is not cosmetic. The ambiguity has already produced two real bugs, both
fixed on 2026-08-15 in Tier 0:

- `getHouseholdSharedPath` hardcoded `'shared'`, so **every household calendar
  read returned null** — the file is in `common/`.
- The gratitude seed script wrote to `shared/gratitude`, which nothing reads.

**Target rule:** `household/<domain>/` owns everything for that domain, and
inside a domain `log/` is the one reserved name — append-only, date-keyed,
prunable. Everything else in the folder is live state. `config/` and `auth/`
stay at the root (the bootstrap loads them before any path resolver exists);
`screens/` and `assets/` stay (different scope, not domains).

---

## What Tier 1 covers

Only the cheap moves — each resolves through `getHouseholdPath()` /
`dataService.household.read`, so the code change is a key string.

| Current | Target | Notes |
|---|---|---|
| `apps/media/queue.yml` | `media/queue.yml` | state |
| `apps/gaming/games` | `gaming/games` | may be empty; Tier 0 may have removed it |
| `common/cost` | `cost/` | **start here** — lowest traffic |
| `common/feedback` | `feedback/` | **then here** |
| `common/finances` | `finances/` | 5.9 MB, real household money data — go slow |
| `common/feed` | `feed/` | |
| `common/gratitude` | `gratitude/` | also update `YamlGratitudeDatastore.mjs:60,70` |
| `common/komga/toc` | `komga/cache/toc/` | derived cache — could be discarded and regenerated instead |
| `state/gameshow` | `gameshow/` | |
| `history/newsreporter` | `newsreporter/log/` | |
| `history/weather` + `common/weather.yml` | `weather/log/` + `weather/current.yml` | two sources, one domain |
| `cli-transcripts/` | `cli/log/` | one consumer, `cli/_bootstrap.mjs:259` |

**Explicitly NOT in Tier 1** — do not touch these here:
`common/weekly-review` (8 hardcoded joins, Tier 2), `history/media_memory`,
`history/hardware/volLevel`, `history/fitness` (~19 CLI scripts bypass
ConfigService), anything under `config/` or `auth/`, and the School print
artifacts (`published/`, `derived-banks/`, `allocations/` — Tier 4, own plan,
because a card scan resolves published documents **by path at grade time**).

---

## Procedure, per domain — one domain per commit

Do **`common/cost` first, alone, end to end**, and stop to confirm it worked
before touching a second. If the pattern is wrong, you want to find out on the
smallest thing in the list.

**1. Confirm the call-site count before editing.**
```bash
grep -rn "common/cost" backend/src cli scripts --include="*.mjs" | grep -v test
```
Tier 1 assumes one or two hits. **If you find more, stop** — that domain
belongs in Tier 2 and the audit under-counted it. Report rather than pressing on.

**2. Change the key string(s)**, and any test that pins the old path.

**3. Stop the container.**
```bash
sudo docker stop daylight-station
```

**4. Move the data — copy, verify, then relocate the original. Never a bare `mv`.**
```bash
D=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household
cp -Rp "$D/common/cost" "$D/cost"
diff -r "$D/common/cost" "$D/cost" && echo IDENTICAL
mkdir -p /opt/Code/DaylightStation/_deleteme
mv "$D/common/cost" /opt/Code/DaylightStation/_deleteme/household-common-cost
```

> **Dropbox trap:** a folder can read as *empty* when its contents are
> online-only. Never conclude "nothing here" from `find -type f | wc -l`.
> Confirm with `ls -laR`: a genuinely empty directory shows only `.` and `..`
> at 64 bytes; an online-only placeholder still appears as an entry with a size.
> Getting this backwards deletes data.

**5. Deploy the code and restart.**

**6. Verify on prod, not locally.** Container healthy, and the feature that
reads that domain actually works — not just "it booted." Several relays create
a missing directory rather than erroring, so a healthy boot proves nothing.

**7. Commit.** `refactor(household): move cost to cost/`

Then repeat for the next domain.

---

## Verification after each domain

```bash
sudo docker ps --filter name=daylight-station --format "{{.Status}}"
sudo docker logs --tail 50 daylight-station 2>&1 | grep -iE "error|ENOENT|not found"
```

And prove the data is being read from the new place — an empty directory
silently created at the *old* path is the exact failure this is guarding
against, and it looks identical to success from the outside.

---

## Rollback

Nothing is deleted, so every step reverses:

1. `git revert` the domain's commit
2. move the directory back from `_deleteme/`
3. redeploy, restart

Do not empty `_deleteme/` until the whole reorganization has run clean for a
week.

---

## Already done — do not redo

- **Tier 0** (merged, on laptop `main`, **not yet on prod**): both live bugs
  fixed; 125 junk files (backups, Dropbox conflicted copies, macOS artifacts)
  staged to `_deleteme/`.
- **Tier 3's prerequisite sweep** — ran on this server against the real tree.
  8 hits, of which only **4 are real values**, exactly the ones Tier 3 already
  names: `config/scales.yml:21`, `config/vehicles.yml:26`, `config/games.yml:54`,
  `config/retroarch.yml:49`. The rest are comments and one git log pasted inside
  a journal entry. **No hidden blockers** — but those four must be edited in the
  same commit as their directory move, or the relay writes into a new empty tree
  without complaining.

---

## Known hazards nearby — not yours, don't get drawn in

- **`data/agents/` is a live SQLite DB inside the Dropbox tree.** 4 KB main
  file, 3.2 MB uncheckpointed WAL, two Dropbox conflicted `-shm` copies, a live
  process holding it. **Do not run `dropbox exclude add` on it** — selective
  sync removes the directory from local disk and would destroy it. It needs a
  `PRAGMA wal_checkpoint(TRUNCATE)` before any move. Separate job.
- **Duplex printing is unverified against the physical printer.** The PJL
  envelope is inferred from spec, never measured on the HL-L2460DW. If you are
  at the printer anyway: short paper stack, panel visible.
- `users/kckern` holds 158 Dropbox conflicted copies (78 in `current/feed`).
  Not Tier 1. They need the same evidence-per-file treatment the gaming session
  conflicts got — every one of those was proven superseded before removal.
