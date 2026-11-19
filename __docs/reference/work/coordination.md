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

The context/backfill increment supplies per-user configuration, read-only provider context, durable links/relevance, and explicit quiet historical import jobs. The two-way increment adds guarded provider commands, journal interpretation and bound Telegram decisions. Budgeted attention and Telegram housekeeping are implemented behind the separate proactive flag. Source installation does not activate them. Starting the runtime does not extract journal history. The server has no operator import endpoint; the CLI constructs the separate job capability.


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

## Web and system principals

Besides the Telegram sender, the principal authority produces two more trusted
principal kinds. Both are tracked in the same private trust set, so a copied or
hand-built object grants nothing, and both are re-checked on every `verify`.

- **Web** (`principal.web({ session: { username, sid }, requestId })`): the
  owner's own login session. The authority itself asks the host's
  `isActiveSession(sid, username)` (the app passes a check that the session row
  exists in the auth session store *and* belongs to that username) and that the
  user is enrolled in Work. Without an `isActiveSession` dependency no web
  principal is ever produced. Revoking the session in Admin → Household →
  Sessions stops a principal mid-flow, including at dispatch.
- **System** (`principal.system({ username, job })`): an unattended job acting
  for an enrolled user. `job` must be in `SYSTEM_JOBS` (`triage-overnight`). It
  is not authored, and `WorkCommands` allows it only `complete`: anything else
  is `denied` with `system_operation_not_allowed` before any provider read or
  write, on both `propose` and `execute`.

Neither kind has a Telegram source record. Their source is the request itself:
at proposal the intent's `sourceReceipt` must be the principal's own receipt
(it defaults to it), `auto` mode is refused, and the queued command is stamped
with `sourcePlatform`. At execution only a principal of the same user and the
same kind may execute it, so a web or system principal can never run a command
queued from Telegram and a Telegram confirmation can never run one queued from
the web or a job.

Every web or system command still requires a confirmation. `decisions.confirmWeb`
(web) and `decisions.confirmSystem` (system, `complete` only) take
`{ principal, commandId, expectedVersion }` and return `{ confirmationId }`. The
grant is single-use, expires after 5 minutes, and is bound to the username, the
command (its full hash) and `expectedVersion`; a grant is refused at issue if the
queued command's version already differs. Grants are held in memory: a restart
only means the owner taps again. Telegram grants are unchanged.

Callers outside Work that need to act on items (the triage pass) read them with
`context.actionableItems({ username, asOf })`. It returns
`{ items: [{ item, domainId, source, operations }], coverage }`: the same items
`context.execute` returns, each with the first configured domain that holds it
(the conversation path's rule), a display name for where it lives (`source`: its
container's title, else the domain id) and the write operations a command could use on
it now (provider capability, the domain's route, and this host being the
writer; empty otherwise). Items in no domain are left out. It is read-only.

Logs: `work.principal.web.captured|rejected`,
`work.principal.system.captured|rejected` (with `reason`),
`work.confirmation.granted`, and `work.command.denied` with `reason`.

## Attributed activity and linked KB outcomes

Canonical provider occurrences project idempotently to `lifelog/work.yml`,
grouped by the user's local occurrence date. Projection acknowledgement follows
the durable write. A crash between them safely replays the same event ID. The KB
consumer has a separate acknowledgement; a KB failure leaves the recorded lifelog
activity intact and retryable without another provider command.

The optional lifelog reader merges this source with legacy provider history in
both day and range reads. Scoped provider identity and exact occurrence/time
match suppress duplicates. Unknown accounts and ambiguous minute-only matches
remain distinct. Summaries are rebuilt after deduplication and retain provider
attribution. Native task titles are display metadata; they never authorize
matching or writes.

The public KB runtime supplies a guarded Work closure port. It defaults to deny
without an injected verifier of actual Work authority and closure policy.
Only `same_commitment` can close a matching loop after owner-side checks of its
current authored evidence, pins, sensitivity and status. `action_for` and
`context_for` leave the broader outcome open. Provider events never become user
journal prose or user evidence, and closure does not relax asking policies.

## Journal and Telegram task coordination

Work can verify authored journal evidence independently when the KB is disabled.
A saved entry normally waits 15 minutes before interpretation; explicit task or
project requests take an immediate path. The original journal entry remains the
user's record. Provider activity is a separate attributed lifelog observation.

Automatic completion requires a current verified affirmative statement, an exact
single task match, a confirmed `same_commitment` link and an enabled
`linked_explicit` task domain. Negative, tentative, quoted and third-party
statements do not propose completion. Project check-in is progress: a configured
`code_checked_in` transition asks for confirmation and does not accept a project.

Telegram Work choices use opaque expiring callback tokens, bound to the user,
conversation, delivered bot message, configuration and current source. Matching
pages show at most three items. Selection is followed by a named action and
destination confirmation. Typed keyboard labels open flows; they grant no write
authority. Creation, deletion and container changes always require confirmation.
Delivery failures disable the corresponding controls. An uncertain provider
result requires readback or manual reconciliation rather than another write.

A journal edit invalidates queued actions. After an external completion, an edit
records a reconciliation need and can offer a separately confirmed correction;
it does not automatically reopen the task. Pending interpretation after a
restart requires fresh authenticated interaction rather than restoring a
serialized Telegram capability.

Live KB extraction, Work intent extraction and optional workflow ranking share a
durable maximum of four attempts per user-local day, including failed attempts.
Repeated receipts do not spend again. Ordinary unrelated journal entries skip
Work extraction. KB-only installations retain the existing KB cap; historical
import jobs retain their separate operator usage ledger.

Task/project CRUD is limited to supported operations intersected with configured
permissions. Project creation needs an explicit `creationParentId`. ClickUp
creation uses a Folder parent; it must differ from the configured List ID because
untyped equal IDs cannot safely distinguish those native objects. Todoist uses
Project parents. ClickUp List archive is unsupported; archive never means delete.
Flags in the example remain off. Source installation alone enables no provider
writes or proactive messages. Commission destinations and transition mappings
with reversible samples before enabling `providerWrites`.

Automatic authority also binds the exact saved statement, its original verified
principal receipt and the task version/occurrence observed at journal save time.
A subsequent harvest cannot silently retarget the next recurring occurrence.
Direct replies and immediate retractions suspend pending automatic action.

Creation keyboard controls first request a titled “Create task/project <title>”
message. Destination selection and named confirmation follow that authored
request. Assignee-filtered task creation shows the configured assignment before
confirmation; multiple allowed assignments are separately bound choices.

Known-target uncertain commands receive at most five rotating read-only
reconciliations per successful refresh or explicit Work opening. This never
repeats the provider mutation. Unknown creation/deletion results remain manual:
the response names the destination to inspect before another request.
Reopen lookup can use scoped completion history or a durable applied command
when a completed task no longer appears in the open-task snapshot.
A newer native open observation prevents a delayed completion from closing the
KB loop, while its original completion remains attributed lifelog history.

## Shared attention reservations

An optional shared attention budget combines acknowledged KB morning questions
and review invitations with Work opportunities. Each user-local day has at most
two unsolicited question units. Housekeeping also has a rolling seven-day limit
of one acknowledged item and a thirty-day item cooldown. Prepared and uncertain
sends hold capacity; only provider-acknowledged messages count as exposure.

The Work canonical log uses `attention.reserved`, `attention.dispatching`, `attention.sent`,
`attention.failed` and `attention.responded`, separate from callback decisions.
The KB receipt and Work reservation carry a common reservation ID. Public KB
history supplies accounting metadata only, including questions sent before Work
was enabled. It exposes no journal excerpts or KB object content.

The budget uses the current configured local date, including repeated DST hours.
Crossing midnight requires a new day-bound reservation before send; a late ACK
cannot revive the old preparation. Unknown delivery remains quarantined, and
repeating the same decision does not grant a repeat send. Explicit user requests,
echo acknowledgements and quiz processing do not spend proactive capacity.

KB-only operation retains its existing behavior when no attention budget is
injected. These receipt primitives add no autonomous delivery job; workflow
selection and the morning integration consume them separately.

## Quiet opportunity selection

Opportunity selection runs deterministic relevance, scope, pause, snooze, KB
policy and source-coverage gates before optional ranking. Fetching an old native
in-progress task does not make it active. Unknown modification dates remain
unknown. Legacy housekeeping requires both a configured local review window and
an explicitly opted-in domain. Two acknowledged ignored housekeeping invitations
maturing after36 hours quiet further unsolicited housekeeping for30 days; recent
grounded work can still qualify for a useful follow-up.

The static workflow registry permits only named local review actions. Optional
Jev ranking receives at most five already eligible IDs and bounded reason codes,
spends the shared live model budget, and cannot add candidates or operations.
Failure uses the deterministic relevance/oldest-offer/ID order. After ranking,
source, policy, relevance and owner history are checked again. Selection returns
one opportunity; it never writes to a provider.

Generating morning metadata does not reserve a question or count exposure. The
selected offer is recorded with native version and local relevance fingerprint;
preparation revalidates that exact offer before reserving capacity. Owner-approved
KB review proposals form one invitation, with at most five IDs and no proposal
content in the unsolicited message. Provider mutation still uses the separate
command confirmation path.

## Telegram maintenance and linking

`Review work` or `/work_review` opens an explicitly requested cleanup session,
three items per page. A bound selection opens `Keep active`, `Revisit in30 days`
and `Stop tracking`. These change only local relevance. Snooze uses thirty local
calendar days, preserving local time across DST. Refreshes, imports and new links
cannot silently erase a pause or retirement. Old controls reject after a native
version, configuration, relevance or expiry change.

Unsolicited processing starts with one invitation (`Review`, `Later`, `Dismiss`),
not a backlog list. First-fourteen-day KB control dates and unavailable KB paths
add no Work question. The existing morning exchange reserves KB units first;
only one remaining unit can hold a Work invitation. Existing weekly KB delivery
can delegate to one `Review N suggestions?` invitation rather than an unsolicited
batch. Its opted-in private controls need the actual independently attested KB
principal; a Work identity cannot substitute for it. Work keeps Later/Dismiss
preferences locally and does not delete or accept KB proposals.

`Link work` or `/link_work` first selects a task, then a grounded normal KB
commitment, then `Same commitment`, `A step toward it` or `Context only`.
The KB owner supplies at most three current choices per page and excludes
sensitive/never, retracted and unsupported evidence. Both owners must map to the
same configured private destination. Relationship confirmation creates only the
local typed link. A later real completion may resolve a same-commitment loop only
through the KB owner's existing source/pin/current-state checks; a step or context
relationship never closes the broader outcome.

The callback executor keeps a temporary claim capability for the exact delivered
decision and choice. Caller-supplied flow state, a copied principal or a plain
keyboard label grants no mutation authority. Server invitation preparation uses
only configured destination and recorded eligible offer/reservation; it cannot
prepare provider commands or create authored user evidence.

Stale-source repair checks available observations without asserting that an item
is open or done. User intent fingerprints exclude exposure bookkeeping, so
recording an ACK does not invalidate its own controls or make an item active.
Acknowledged item cooldown and shared capacity are checked before optional paid
ranking. In-flight capacity carries over midnight until ACK/failure/expiry; an
unreleased ACK records its actual local delivery day, while a released old
preparation cannot revive.

All production flags remain opt-in. Synthetic tests are not live commissioning:
select domains/windows and verify a bounded acknowledged invitation plus local
snooze/retirement before enabling broader proactive delivery.

Dispatch rechecks the current local date, expiry, configured destination, owner
quiet allowance and policy revision, then claims the reservation once in the
canonical log. A dispatch that may have reached transport is never replaced at
midnight or replayed after restart. Switching Work off or read-only retains
accounting for today's existing exposures and unsettled sends; it does not grant
standalone KB extra capacity. Unknown in-flight dispatches require settlement
before their capacity can be reused.

Later and Dismiss on a native-item invitation suppress that item's unsolicited
invitations for thirty local calendar days without changing provider state or
its active relevance. An explicit private review remains available. A weekly
KB invitation cannot immediately advance to another batch after Later/Dismiss.
The read-only Review handoff can resume with the same bound control after a
temporary owner/identity failure; owner preparation and sends remain idempotent.

Private KB link choices require the independently attested KB principal from the
same Telegram input. A matching serialized username/chat is insufficient. The
unsolicited-budget exemption is issued privately by the authenticated KB review
route; public preparation cannot request it with a boolean. Linked owner policy
and review evidence are checked again before presenting content.
