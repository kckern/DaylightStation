# Work coordination

Work coordination separates contextual commitments in the Lifelog KB from authoritative tasks and project workflows in external providers. The lifelog records attributed history; Journalist is the conversational client. A refreshed snapshot or an old native in-progress label is not evidence of renewed user relevance.

## Configuration and routing

Household configuration lives only at `work/config.yml`; it does not inherit a legacy flat config file. The document contains a `work` block. See [the example](../../configuration/work.example.yml).

All features start disabled and read-only. Each participating username needs an explicit `work.users` entry. Provider aliases route domains to a provider type, logical account and explicit container ID. The same provider can serve personal actions and projects; a missing role is valid and an unknown domain never selects the first available list. Account references and state are scoped per user. Credentials stay in existing user/household auth stores.

Per-user scalar settings override household defaults. If a user supplies providers or domains, that map replaces the entire base map; hidden inherited destinations must not survive. Invalid routing/configuration disables Work participation. Invalid attention settings disable only proactive attention and retain valid manual read access. Empty review windows and opted-in domain lists schedule no housekeeping.

Configured provider operations are necessary permission, not proof a live adapter supports them. Command execution will separately check actual capability, current destination/account/version and authorized writer role. Todoist command support is implemented behind a trusted dispatch-authority callback; source capability does not activate writes.

## Source identity and dates

Work references include provider, account, object kind and opaque string ID. Never coerce IDs to numbers or match objects solely by title. Source creation, modification and completion timestamps are nullable and distinct from observedAt. A missing source date remains unknown. Recurring tasks retain occurrence identity separately from their enduring task ID.

## Implementation status

The context/backfill increment supplies per-user configuration, read-only provider context, durable links/relevance, and explicit quiet historical import jobs. Provider command execution and conversational attention workflows are separate increments. Starting the runtime does not extract journal history. The server has no operator import endpoint; the CLI constructs the separate job capability.


## Provider collection and completeness

Todoist open tasks/projects are cursor-paginated; completed history uses the current completion-date endpoint with bounded 28-day query windows. ClickUp task pages are bounded and retain native status, typed hierarchy IDs and source timestamp metadata. Collection has a hard page budget; hitting it, a later-page failure or malformed provider data returns incomplete coverage and preserves the last complete current snapshot.

Optional composition-supplied scope binds an observation to its configured logical account. Older snapshots without that binding remain unavailable for automatic decisions. Only one harvested account of each provider type is supported per user by the current upstream storage/auth connection; conflicting same-type account configuration is rejected. One account can still fill multiple domain roles.

Account aliases must agree on credential scope as well as account identity. A known Work binding selects exactly the configured user or household credentials; missing credentials never fall back to another connection. ClickUp's configured credential record must include its workspace ID. Canonical task history is under `lifelog/{provider}.yml`; current source facts are under `current/{provider}.yml`.

Collectors retain latest per-user/account attempt health separately at `current/{provider}-health.yml`. A failed refresh preserves the last complete task file but makes Work coverage unavailable, including after reader restart. A current snapshot is not proof that a later refresh succeeded.

Read adapters filter account, container and any configured assignee scope. Unknown source timestamps stay null. Events include actual occurrence identity; two completions of a recurring task are distinct. Older history without account provenance is not silently attributed to a newly configured account and is reported as unknown coverage. Source events outside the last 90 days are not included in the Work read context. Todoist exposes only implemented operations intersected with current configuration; ClickUp commands use live List status definitions and configured semantic transitions.

## Runtime and private operator jobs

Disabled Work performs no source reads, locks, timers or model work. An explicitly
enrolled user can read context independently of KB maintenance. Local mutations
require the configured Linux writer environment/host and a separate Work lease.
Successful complete harvests can refresh backup context; unchanged semantic
facts do not append another full snapshot. The optional `catchUp: true` setting
enables missed-hook polling at `pollMinutes` only on an authorized local writer.
Neither refresh path activates task relevance. Shutdown cancels timers and
prevents late reads from writing after its five-second grace period.

```sh
node cli/work.cli.mjs inspect --username sample
node cli/work.cli.mjs backfill prepare --username sample --days 90 --as-of 2026-11-17T18:00:00Z --output-dir /private/work-job
node cli/work.cli.mjs backfill preview --manifest /private/work-job/JOB.manifest.json --usage-dir /private/shared-kb-usage
node cli/work.cli.mjs backfill apply --manifest /private/work-job/JOB.manifest.json --artifact /private/work-job/JOB.artifact.json
```

Prepare returns the actual manifest path. Private directories must be outside
the data tree. Preview uses the same persistent daily attempt receipts as KB
Phase 0; keep the same usage directory across runs. Source hashes, username,
configuration revision and exact range bind the job. Apply requires configured
`importWrites`, local write authority and the actual permitted operator UID;
there are no force, send, host-spoofing or environment-spoofing options.

Reports separate supported historical outcomes, unresolved candidates,
ambiguities, unsupported dates, skipped evidence and incomplete Work coverage.
A candidate is historical context, not an assertion that a provider task is
fresh or still due. Incomplete extraction cannot apply. Repeated jobs reuse
cached chunks and unchanged imported evidence does not create duplicate loops.
New imports retain their historical dates and a pinned user-initiated ask policy.
Rollback uses existing KB object edits/retractions; retain the import ledger and
original journal. See [quiet historical imports](../lifelog/knowledge.md#quiet-historical-imports).


## Durable relevance and links

Work keeps canonical transactions in `work/events.jsonl` under each user, with a checksum chain and optimistic revisions. `work/state.yml` is a generated projection, not an editable replacement for provider state or the KB. Reads create no directory or lock. Writes require the exact configured Linux host/environment and a pipe-held kernel lease; a second writer or a lost lease cannot continue mutations.

A durable envelope is replayed exactly once after a projection failure. Authorized recovery preserves incomplete tail bytes before repairing; a complete valid envelope missing only its newline is retained. Complete corrupt records and missing canonical history block writes. Edited generated projections are backed up and rebuilt from the canonical log; user-editable KB files are not touched by this recovery.

Read context joins explicitly scoped provider facts, stable links and the local relevance overlay. Refresh does not reactivate paused/retired work. Missing or old sources can supply clearly unavailable prior context, but cannot authorize an automatic action. Observations newer than an explicit as-of are excluded. Links require a verified authored principal and bind the canonical provider reference; a repeated confirmation is idempotent and cannot silently replace its relation to a broader outcome.

## Todoist command adapter

The v1 adapter supports complete/reopen, create/update/delete task and
create/rename/archive project. It does not treat archiving a task as completing
it and does not expose a generic status transition. IDs remain opaque strings.
Task creation is restricted to the domain container. Project creation additionally
requires an explicit `creationParentId`; this grants creation below that parent,
not permission to rename or archive the parent itself.

Each command refetches its target and checks the captured version, current
account, destination, operation permission, assignee restrictions and trusted
dispatch authority before sending. Reopen, create, update, delete and project
changes require a bound confirmation supplied by the command owner. The adapter
alone cannot validate a Telegram confirmation or acquire a writer lease; its
injected authority callback defaults to deny.

Mutation success requires independent readback. A timeout is uncertain and is
never retried inside the adapter. Rate limiting returns a retry time without an
automatic retry. A recurring close requires the native completion counter to
advance; advancing the due date alone proves nothing. Exact provider history
supplies completion occurrences separately, so a next occurrence is never
fabricated as an accomplishment. Unknown creates/deletes require explicit
resolution rather than title matching or another blind write.

## ClickUp workflow adapter

ClickUp supports confirmed task create/update, native workflow transitions,
archive and delete, plus List creation under `creationParentId` and List rename.
List archiving is not advertised: the current documented List update API does
not expose an archive operation. Space and Folder creation are outside this
adapter. The configured credential record must identify the workspace; task
workspace and List/Folder space membership are checked on live reads.

`transitions` maps semantic actions such as `code_checked_in`, `complete` and
`reopen` to exact native List statuses. The adapter refetches List definitions
and rejects unavailable or invalid mappings. `complete` requires a done/closed
native status; `reopen` requires another status. Check-in never implies acceptance
without an explicit configured mapping and confirmation. Custom-field updates
are unsupported; task creation enforces native required custom fields.

Readback checks requested fields and detects changes in other represented task
fields. This is best effort concurrency detection, not an atomic conditional
write. An updated timestamp without a native completion timestamp remains
unknown completion time and creates no attributed completion event.

## Durable command boundary

A command intent and its dispatch reservation are separate canonical Work
transactions. Only the transaction that actually created the reservation may
send the provider request; a replayed transaction is not another dispatch grant.
Concurrent duplicate requests therefore share one command and one attempt.

Results and exact canonical observations are committed together. A lost result
leaves the attempted command uncertain. Recovery reconciles provider state
without another mutation; an unknown create is never resolved by equal titles.
Source validity, configured routing and a trusted bound confirmation are checked
again at dispatch. The command service defaults to deny when those verifiers are
not wired, and an arbitrary confirmation string grants no authority.

Inbound reconciliation seeds a complete baseline without accomplishments, then
records distinct actual occurrences after that baseline. Disappearance, partial
coverage, imported history and estimated timestamps cannot fabricate completion.
A provider actor stays explicitly attributed; shared project changes do not
silently become the journal owner's actions. Incoming events never dispatch
commands or reactivate the relevance overlay.
