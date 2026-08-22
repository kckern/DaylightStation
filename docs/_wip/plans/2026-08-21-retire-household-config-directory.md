# Retire `data/household/config/`

Status: design approved 2026-08-21, not yet implemented.

Finishes what task-13 (2026-08-16) started. That pass moved 11 app configs to the
colocated form and deliberately deferred step 7 — dropping the legacy fallback.
See `ConfigService.mjs:229`, which says so in a comment.

## Organizing principle

**`backend/src/3_applications/` is the naming authority for folders.**

Every one of the 26 remaining config files maps onto a name already in that
~50-entry list. `frontend/src/Apps/` is 13 surfaces (Media, Finance, Fitness,
Piano, Life, Health, Auto, Feed, Gaming, LiveStream, Admin, Call, Home) and every
one already has a same-named backend domain — so a surface never needs its own
top-level folder.

**Domain is the folder; the filename carries the facet.**

- `<domain>/config.yml` — domain policy and integration wiring
- `<domain>/app.yml` — surface config, and only when surface-only content exists

### The media pair proves the current names are backwards

- `household/media/config.yml` holds `browse:` and `searchScopes:` with labels and
  icons — that is the **MediaApp surface**.
- `household/config/media-app.yml` holds Plex host, protocol, and Infinity board
  IDs — that is **domain/integration wiring**.

The file named "app" is the domain config and the file named "config" is the app
config. They get swapped, not merged.

Applying the same test to everything else turns up only two surface-level
fragments in the whole directory: `art.yml`'s `quickTags` (Admin Library digit
shortcuts) and `artmode.yml`'s frames/presets. Two fragments do not justify a
surfaces tier.

## Mapping

| From `household/config/` | To | Note |
|---|---|---|
| `media-app.yml` | `media/config.yml` | existing `media/config.yml` → `media/app.yml` |
| `finance.yml` | `finance/config.yml` | rename data folder `finances/` → `finance/` |
| `art.yml` | `art/config.yml` | new folder |
| `artmode.yml` | `art/artmode.yml` | presentation facet |
| `scales.yml` | `hardware/scales.yml` | |
| `barcode.yml` | `hardware/barcode/config.yml` | dir exists |
| `barcode-relay.yml` | `hardware/barcode/relay.yml` | |
| `omr-readers.yml` | `hardware/omr/readers.yml` | dir exists |
| `pressure-mats.yml` | `hardware/pressure-mats/config.yml` | dir exists |
| `chess.yml` | `gaming/chess.yml` | |
| `games.yml` | `gaming/games.yml` | |
| `gameshow.yml` | `gaming/gameshow/config.yml` | dir exists |
| `retroarch.yml` | `gaming/retroarch/config.yml` | dir exists |
| `vehicles.yml` | `automotive/vehicles.yml` | dir exists |
| `keyboard.yml` | `triggers/bindings/keyboard.yml` | uid'd bindings list, same shape as nfc bindings — not config |
| `concierge.yml` | `agents/concierge.yml` | matches `3_applications/agents/concierge` |
| `ambient.yml` | `ambient/config.yml` | new folder |
| `donow.yml` | `donow/config.yml` | `approvalsToken` → `auth/donow.yml`, see decision 5 |
| `entropy.yml` | `entropy/config.yml` | new folder |
| `sheets.yml` | `sheets/config.yml` | new folder |
| `playback-hub.yml` | `playback-hub/config.yml` | new folder |
| `camera-archive.yml` | `camera/archive.yml` | new folder |
| `jamcorder.yml` | `hardware/devices.yml` entry | see decision 1 |
| `chatbots.yml` | `_deleteme/` | see decision 2 |
| `config/triggers/*` | `triggers/*` | merge; existing `nfc.observed.yml` → `triggers/state/` |
| `config/school/surfaces/` | `school/surfaces/` | fixes a live prod bug, see decision 4 |

## Decisions (audited 2026-08-21)

### 1. Jamcorder is a vendor name occupying a domain

`jamcorder` currently names a domain (`2_domains/jamcorder/JamCorderStone.mjs`),
an application (`3_applications/jamcorder/`), and its adapters. The concept is
harvesting MIDI performance recordings from a networked recorder;
`FsJamCorderArchive.mjs:12` archives to `midi/piano/log/jamcorder`.

Rename domain and application to `midi`. Adapters keep the vendor name — that is
what the adapter layer is for.

- `2_domains/jamcorder/JamCorderStone.mjs` → `2_domains/midi/MidiRecordingStone.mjs`
- `3_applications/jamcorder/HarvestJamCorderRecordings.mjs` → `3_applications/midi/HarvestMidiRecordings.mjs`
- ports `IJamCorderArchive` / `IJamCorderSource` → `IMidiRecordingArchive` / `IMidiRecordingSource`
- `1_adapters/jamcorder/{HttpJamCorderSource,FsJamCorderArchive}.mjs` — unchanged
- `bootstrap.mjs:3508` `registerHarvester('jamcorder', …)` → `'midi'`

The config is a single `host: 10.0.0.244` — a device address. It folds into
`hardware/devices.yml` as a device entry, and `bootstrap.mjs:3509` reads it from
the device registry instead of `getHouseholdAppConfig(null, 'jamcorder')`.

### 2. `chatbots.yml` is a dead duplicate — delete

Its `identity_mappings: telegram: "575596036": kckern` is never read.
`configLoader.mjs:36` builds `identityMappings` from
`buildIdentityMappings(config.users)`, which reads
`users/<name>/profile.yml` → `identities.telegram.user_id`.
`users/kckern/profile.yml:14` already carries the same id. The only thing
referencing the file is `AppsConfigService.mjs:35`, which exposes it in the admin
editor.

Move to `_deleteme/`; drop the `chatbots` entry from `AppsConfigService`.

### 3. Concierge belongs under agents

Not work-in-progress — it has `2_domains/concierge/`,
`3_applications/agents/concierge/` (ConciergePolicyEvaluator, MediaJudge,
YamlSatelliteRegistry) and an OpenAI-compatible `/v1` router wired at
`bootstrap.mjs:2760`. `household/agents/config.yml` already exists, so the config
lands beside it as `agents/concierge.yml`.

### 4. School surfaces are a LIVE production bug — fixed in scope

Not deferred. `school.surfaces.profile.unresolved` fires continuously in
production (`context.env: production`, most recent 2026-08-21T18:52Z, present
across every container restart back through 2026-08-20):

```
data.reason: "unknown surfaceId 'screen-browser'"
data.screen: "portal"
```

`screen-browser.yml` is one of the two files in `household/config/school/surfaces/`.
The Portal requests it every few minutes and `SurfaceRegistry` cannot resolve it,
because `schoolSurfaces.mjs:52` reads `<contentRoot>/surfaces` and
`schoolCatalog.mjs:31` resolves `contentRoot` to
`content/school/learning-catalog`, which does not exist. The real tree is at
`content/school/_inbox/learning-catalog`.

**The empty authored catalog is expected** — that tree is unfinished work, staged
in `_inbox` deliberately. So `contentRoot` is NOT changed here.

**The surfaces lookup is the actual bug.** Surface profiles
(`paper-letter-mono`, `screen-browser`) describe render capability — what a paper
sheet or a browser screen can do — which is household policy, not curriculum.
Coupling them to `contentRoot` was the design error.

Fix: read profiles from `household/school/surfaces/`, independent of
`contentRoot`. Move both files there, drop the `path.join(contentRoot, 'surfaces')`
in `schoolSurfaces.mjs:52`, and repoint `cli/school/certify.mjs:166`.

This makes the Portal surface resolve again and is verifiable: the warn stops.

### 5. `donow.approvalsToken` is a secret — moved, and the transport hardened

`routers/donow.mjs:42,50` — it is the only authentication on
`POST /approvals/:id/approve` and `/deny`. Anyone holding the string can approve a
parental-approval request.

Move to `household/auth/donow.yml`, read via
`configService.getHouseholdAuth('donow')` the way the other 18 services do.
`auth/` is a MASKED dir in the admin YAML editor, which is the correct posture.

`readToken()` at `donow.mjs:60` also accepts the token as `?token=`, so it lands
in access logs and in HA companion-app callback URLs. Also fixed here, but
**staged**, because approvals silently 401 if the deploy and the HA automation
edit are out of sync:

1. `readToken()` prefers `Authorization: Bearer` / body, still accepts `?token=`
   and logs `donow.approvals.token.query_deprecated` when it does.
2. Deploy. Update the HA automation to send the token in the body.
3. Confirm the deprecation warn has stopped in the log store.
4. Remove query-param support.

Staging is a sequencing requirement, not a deferral — all four steps are in this
work.

## Code changes

### The registry replaces two hand-maintained lists

Grouping breaks scan-based discovery: `hardware/scales.yml` is not
`<app>/config.yml`. So the colocated scan in `configLoader.mjs:170` and the
resolution in `ConfigService.mjs:236` are replaced by one explicit
`app → path` registry module.

That registry then **derives** two lists that are hand-maintained today and have
already drifted once:

- `YamlConfigFileService.mjs:52` `ALLOWED_FILES` — a 12-entry list whose own
  comment records that it shipped covering only 3 of the 11 files task-13 created,
  silently 403ing the other 8 in the admin YAML browser.
- `AppsConfigService.mjs:30` `APP_CONFIGS`.

Retiring `config/` should delete both lists, not extend them. This is the main
reason to do the grouped layout rather than one-folder-per-app.

### Hardcoded literal paths that must move with the data

| Config | Site |
|---|---|
| `artmode` | `1_adapters/content/art/artmodeConfig.mjs:26` (+ its unit test) |
| `playback-hub` | `5_composition/bootstrap.mjs:1482` |
| `omr-readers` | `cli/school/omr.mjs:44` |
| `media-app` | `cli/plex-sync.cli.mjs:117` |
| `keyboard` | `routers/device.mjs:150`, `routers/homeAutomation.mjs:275` (`loadFile('config/keyboard')`) |
| `finance` | `AppsConfigService.mjs:31`, `Admin/Apps/AppConfigEditor.jsx:18`, `Admin/Apps/FinanceConfig.jsx:101` |
| `art` | `Admin/Art/ArtLibrary.jsx:23` |
| `games` | `Admin/Games/GamesIndex.jsx:51,55` |
| `chatbots`, `entropy` | `AppsConfigService.mjs:35-37` |
| triggers | `1_adapters/trigger/YamlTriggerConfigRepository.mjs:28-35` (five constants; this repository also **writes**) |
| school surfaces | `cli/school/certify.mjs:166` |

### Dead references to remove while in here

- `household/config/local-media.yml` — `FileAdapter.mjs:369`, `MediaAdapter.mjs:281`. File does not exist.
- `config/home-dashboard` — `YamlHomeDashboardConfigRepository.mjs:13`. File does not exist.

Unrelated despite matching a grep: `authConfigDefaults.mjs:22` `config: ['config/*']`
is an HTTP route glob, and `YamlJobDatastore`'s `config/jobs` is system-scoped.
Neither touches `household/config/`.

## Deploy ordering

The data tree is shared Dropbox, so **a file move goes live on prod before any
code deploys** (see `reference_shared_dropbox_data_tree_deploy_hazard`). That
dictates the order:

1. **Code first.** Land the registry with dual-read (new path, fall back to
   `config/`) and teach every hardcoded site both paths. Deploy. Nothing has moved
   yet, so this is a no-op in behavior.
2. **Verify** the fallback is actually exercised — `POST /api/v1/system/reload`
   and confirm the app union still resolves every name.
3. **Move the data.** Both paths resolve, so prod stays up regardless of which
   tree a given host has synced.
4. **Restart** — config is cached at boot (`getHouseholdAppConfig` reads `#config`).
5. **Remove the fallbacks**, delete the `config/` scan from `configLoader`, and
   delete the directory.

Steps 1 and 5 are separate deploys. Collapsing them reintroduces exactly the
half-state that made task-13 hard to reason about.

## Verification

- `POST /api/v1/system/reload` returns every app with no `not_found`.
- Admin YAML browser lists and opens every moved file (this is the silent-failure
  surface — a missing registry entry 403s with no other signal).
- Admin per-app editor loads and saves finance, media, entropy, keyboard.
- `cli/school/omr.mjs`, `cli/plex-sync.cli.mjs`, `cli/school/certify.mjs` run.
- NFC trigger write round-trip (the trigger repository writes, not just reads).
- `docs/reference/core/configuration.md` updated.
