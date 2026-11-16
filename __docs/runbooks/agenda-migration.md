# Agenda migration and data backout

Migration moves one explicitly dated current-week list into an Agenda series and plan. It preserves sections, order, existing UIDs, artwork, active flags, and actions. Missing UIDs receive deterministic IDs. Existing game roster order and Charades clue modes become plan-local settings. It creates no future plans or extra attendees.

This runbook does **not** authorize deployment or household data changes. Live operation requires independent review of the private dry-run manifest and backout preview, then an explicitly authorized deployment/data-change window. Keep manifests, identities, source bytes, and backups private. Synthetic tests do not establish Admin/TV/gameplay acceptance.

## Installed authority and activation order

Only the existing installed backend writes. The CLI is an authenticated HTTP client; it never constructs a writable repository, starts a backend, or falls back to an offline writer. Stop other writers and direct filesystem/Dropbox/SMB edits during the authorized window. Atomic rename is not multi-process compare-and-swap.

The registered household app path is `agendas/config.yml`. Canonical Agenda can be enabled without transferring a legacy list. Migration inputs are separately configured:

```yaml
enabled: true
migration:
  series_id: family
  legacy_list_id: family
  game_definition_id: charades:family
```

The server derives paths from `ConfigService`, including the `fitness/config` registry entry. Request manifests cannot choose destinations. Exact `menu` and `menus` aliases point to `agenda:<series_id>`. Their live authority is the validated durable `agendas/migrations/<series_id>.json`; one alias object serves reads, ownership lookup, and mutation guards.

**Installing migration configuration belongs inside the maintenance window.** With no migration configuration, legacy ownership is unclaimed. Once configured, a missing, unreadable, or corrupt authority file fails closed for the selected legacy resource. It does not reopen editing. Deploying this configuration therefore requires an intentional availability window: install the shared identity reader and migration runtime, configure the migration, obtain/review the fresh installed dry run, and apply the reviewed digest. The first apply creates the recoverable authority record. Do not remove configuration or disable the feature as a substitute for backout.

A pre-install read-only review can describe current inputs and the proposed configuration. Installing that configuration changes source bytes; a fresh installed dry run is required before apply. This tooling does not authorize that activation step.

Fitness's shared `PeopleDirectory` guest resolver must be installed before references are written. Exact canonical household-user IDs remain unchanged inline in Fitness; this deterministic policy appears in the digest-bound manifest. Existing visitor names/portraits move into the named directory while preserving Fitness category, device, birth-year, and zone overlays. Duplicate IDs and conflicting definitions block apply; similar names are not merged.

## Review and commands

Supply the installed server URL and a household host bearer token through the environment. Avoid tokens in shell history. The CLI requires a private output path and refuses to overwrite an existing review.

```sh
node cli/agenda.cli.mjs migration dry-run \
  --server "$DAYLIGHT_AGENDA_SERVER" --output "$PRIVATE_REVIEW_FILE"
```

`agenda-migration-review/v1` contains documents, aliases, identity policy/changes/conflicts, source paths, SHA-256 hashes, exact bytes in base64, warnings, and a digest binding the entire review. Sources include the list, game defaults/content/manifest and referenced clue assets, named directory, Fitness configuration, household membership/timezone configuration, and profiles. Pre-install absence of Agenda configuration is represented explicitly.

Inspect roster/date, identity changes, preserved overlays, public-codec round-trip, installed canonical target capabilities, and selected-plan legacy export. The current week comes from the server clock and configured IANA timezone. Initial admission refuses a review from an earlier week; an already admitted retry retains its operation identity across a week boundary.

After independent review and explicit live-window authorization:

```sh
node cli/agenda.cli.mjs migration apply \
  --server "$DAYLIGHT_AGENDA_SERVER" --manifest "$PRIVATE_REVIEW_FILE" \
  --review-digest "$REVIEW_DIGEST"
```

`DAYLIGHT_AGENDA_TOKEN` must identify an authenticated household host. Both CLI and server require the explicit reviewed digest. The server validates aggregates through the public embedded-list codec/repository and installed activity/target validation. Source hashes are checked under the transition gate immediately before writes and again immediately before ownership changes. A stale initial source returns `source_changed` before any backup, journal, or output write.

## Phases and recovery

The shared gate protects actual synchronous legacy-list commits, named-directory commits, and relevant Admin configuration commits. Migration acquires the same repository series lane used by Agenda edits and launch reservation. There is no asynchronous gap between a legacy store's final ownership guard and persistence. Staged Agenda documents cannot be edited or launched before ownership changes.

| Durable phase | Authority | Recovery |
| --- | --- | --- |
| `prepared` | Legacy | Exact private backups and review persisted; resume identity writes. |
| `identities` | Legacy | Named identities precede Fitness references; install validated aggregates through the repository codec. |
| `installed` | Legacy | Recheck source hashes, then switch the one authority file. |
| `owned` | Agenda | Stale legacy commits are rejected; retire legacy file. |
| `retired` / `complete` | Agenda | Complete or return the same operation; never reinstall over later edits. |
| `aborting` / `aborted` | Legacy | Restore exact Fitness bytes before named-directory bytes; preserve later legacy list edits. |
| `backout-prepared` | Agenda | Durable export binds selected plan ID/revision and bytes; recover the same export. |
| `backout-exported` | Agenda | Legacy export exists but is not editable until ownership changes. |
| `backed-out` | Legacy | Agenda documents/runtime records remain retained and protected. |

After a lost response or crash, repeat the same command, review digest, and selected plan. A different admitted payload conflicts. Retry accepts original sources or its own exact identity outputs, validates persisted review authority, and does not reinstall over later Agenda edits. Investigate external source conflicts rather than editing hashes or phases. Before ownership switches, backout aborts staged identity changes while leaving current legacy list edits intact. Terminal aborted/backed-out receipts remain retained; a later migration needs a separately reviewed operation rather than receipt reuse.

Private backups live under `<authority>.transactions/<digest>/backups/`; absence is retained in the review. These directories restrict access. Do not copy them into source fixtures or public docs. A corrupt configured authority stays unavailable after restart.

## Backout after Agenda edits

Choose the plan explicitly. Backout exports its current saved list, roster, and clue modes, preserving other current game-rule fields. It does not restore the stale original list over newer edits.

```sh
node cli/agenda.cli.mjs migration backout \
  --server "$DAYLIGHT_AGENDA_SERVER" --manifest "$PRIVATE_REVIEW_FILE" \
  --review-digest "$REVIEW_DIGEST" --plan-id "$SELECTED_PLAN_ID"
```

Anonymous participants, newly introduced named guests unsupported by the original direct roster, differing per-activity setups, and unsupported consumers/subsets return `unsupported_downgrade`; Agenda remains authoritative. Recoverable export phases freeze edits. Completed-cutover backout retains shared identity support and Fitness references: retain that reader when rolling back code. Downgrading to a backend without guest-reference support requires a separately reviewed identity export and is not performed here.

Commands never reset, rewrite, or delete direct-session journals, Agenda launch records, or existing sessions. Retained game resume authorization remains independent of authoring ownership. Browser journeys and whole-change regression remain release acceptance work.
