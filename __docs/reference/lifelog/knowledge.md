# Lifelog knowledge

The knowledge subsystem records user-stated open loops with quoted journal evidence. It is separate from the read-only lifelog archive. Journalist consumes its optional runtime ports for bounded questions, private reviews and entry echoes. Production participation defaults off and requires explicit commissioning after read-only precision review.

Only verified user messages can authorize committed proposals. Historical user rows can be inspected in a preview that cannot be committed. Quotes match their cited message after Unicode NFC and whitespace normalization; paraphrases are not evidence. The proposal vocabulary permits opening, touching and closing loops, candidate people and candidate aliases. It cannot delete, merge, confirm itself or loosen user pins. Sensitive proposals wait for review and default to never asking.

Question choice is deterministic, with at most two independent morning questions and five opt-in quiz candidates. Eligibility begins after the due date, uses local calendar days, normally observes a seven-day cooldown and never repeats within three days. Acknowledged deliveries alone count as asks; a 36-hour reply window prevents a new delivery being treated as immediately ignored. Two unanswered asks or two skips retire a loop. Three ignored morning dates trigger fourteen-day weekend-only backoff. Healthy empty selections remain empty.

The extractor is instructed to preserve a verbatim contiguous due-date phrase from its cited quote; it must not combine fragments or guess an ISO date. Deterministic validation still rejects ungrounded dates. Dates are interpreted against the original entry's local date. For example, an explicit Monday on a Monday means the next Monday, while today stays on the entry date. Unsupported date phrases remain uninferred for review. All domain operations receive explicit time and timezone; model output never supplies the clock or selection order.

Direct user decisions are distinct from model proposals: a verified application-level reply may change a pinned status while recording the edit and preserving the pin. Model proposals and sweeps cannot do that. Storage and delivery authority must enforce identity and acknowledged-message binding before invoking these transitions.

## Storage and recovery

The YAML store writes one file per loop/person, a confirmed-alias projection, dated ask files, and state. A production writer must match the configured environment and host, have both enable/write flags, and hold a real kernel lease. Disabled/read-only reads do not acquire a lease or create files. Losing an acquired lease makes the writer's view unhealthy immediately.

Transactions durably append before/after images, write atomic object files and state last, then append a completion marker. Recovery accepts only known before/after images; an intervening hand edit blocks replay instead of being overwritten. An incomplete final ledger line is reported by readers and repaired only by the authorized writer. Conflicted copies, corrupt state, removed evidence and altered derived projections prevent participation.

A revision is an opaque sequence-plus-content-hash token. Callers pass the observed token back unchanged; a new direct edit invalidates it even without a state-file revision change. Valid object edits are compared with their prior ledger image and recorded with dotted field pins. Direct edit timestamps use filesystem modification metadata, so repeated reads remain stable while model work is in flight. Closed loops retain identity and are filed by the user-local closure year.


## Verified evidence and read-only previews

Verified journal receipts bind the configured sender and private conversation to
an immutable message identity and a checksum of the original persisted content
and timestamp. Edited receipts and ambiguous duplicate identities cannot
silently become new evidence. Historical rows without trusted provenance can
appear only in preview mode. Older rows without a role field require an exact
configured-sender match; known bot markers are excluded. They never authorize
a committed proposal. Canonical source IDs survive sorting and restarts;
the opaque cursor tracks consumed identities so equal-time arrivals during model
work remain pending.

The extraction gateway receives selected user journal text, at most thirty open
loop titles, recent ask references and confirmed aliases. Its finite JSON schema
allows at most twenty proposals from at most one hundred messages. Extra fields,
unknown evidence references, oversized output and model-selected question order
are rejected. Proposal IDs are assigned deterministically by the adapter. The
reducer independently checks exact quotes, targets, dates and pins; model output
never writes an object directly.

```sh
node cli/knowledge.cli.mjs show --username sample
node cli/knowledge.cli.mjs questions --username sample --ask-date 2026-11-03 --as-of 2026-11-03T15:00:00Z
node cli/knowledge.cli.mjs extract --dry-run --username sample --since 2026-11-01 --until 2026-11-03 --as-of 2026-11-03T15:00:00Z --usage-dir {usage_dir}
```

`since` and `until` are inclusive user-local dates; `as-of` bounds the evidence
at an explicit instant. Preview receipts and the AI usage ledger go to an
existing directory outside the data tree; symlinks into the data tree are
refused. Keep the same receipt directory across previews. Four exclusive attempt
receipts per user and actual local day bound preview calls there, including
failed calls; the historical as-of date does not reset that budget. Empty
selections make no model call. Show/questions acquire no writer lease and create
no directories, timers or state. There are no apply, send or rebuild modes.

Real extraction previews require the separately approved historical range and
precision review. All later runtime integration remains disabled until explicit
production commissioning; source implementation does not activate it.


## Maintenance and observations

Maintenance reserves a durable per-user daily attempt before making a model
call. Failures consume that attempt; a stale reservation is checked again, and
configured lower caps remain effective. AI work runs outside serialized storage
mutation. The final reduction re-reads original evidence and current pins, then
commits only the captured cursor. New equal-time or out-of-order receipts arriving
during AI work remain pending. Activation initializes a live cursor instead of
implicitly backfilling historical journals.

A verified entry of at least two hundred characters, or an attributed short
answer, moves that user's durable deadline fifteen minutes forward. Restart
restores that deadline. Entries over six hundred characters receive a plain
acknowledgement and suppress the old conversational follow-up. A successful
validated batch may echo at most three normal loop titles and a generic pending
review count. Sensitive/person/alias candidates are never silently confirmed.
Delivery claims precede network sends; uncertain prepared echoes are not resent
on restart. Ready echoes older than the thirty-six-hour reply window expire.
Callback token preparation and acknowledged-message binding belong to the
separate delivery service. No maintenance task is scheduled until runtime
composition explicitly enables an authorized writer.

Metrics use acknowledged morning messages as the twelve-hour reply-rate
denominator, deduplicating two questions in one message. Only attributed replies
count. Reply-rate and fourteen-day resolution cohorts mature before entering
denominators; absent observations produce null rates. Tap share includes
attributed tap replies, while median reply length uses text/voice lengths.
Drop-it and human review/back-off events are counted separately. Historical
reports use completed ledger images when present, and identify the current-view
fallback when no committed image exists. These are measurements, not claims that
an improvement target has been achieved.

## Durable questions and reviews

Question selection reserves no delivered asks. Delivery preparation writes opaque,
short callback tokens before transport; only an acknowledged Telegram message ID
binds tokens and counts the ask. Repeated preparation never authorizes a second
send. Known failures allow one bounded retry; uncertain sends remain quarantined
until expiry. Stale sweep health prevents preparing new questions.

Replies require a request-local verified private sender capability, the configured
conversation, an acknowledged bot message and its matching token. Forwarded input
cannot make decisions. A consumed token or receipt cannot change a loop twice.
Free text and voice prefer explicit reply linkage; an unambiguous recent ask may
supply window attribution. Ambiguous windows stay unattributed.

Monday reviews begin after 05:00 in the user's timezone, in one deterministic batch
of at most five proposals. Remaining proposals wait for a later weekly batch.
Confirmation applies to the individual person or alias; ambiguous identity changes
never merge records. Supporting evidence is revalidated, including retractions.
Accepting sensitive storage retains `ask_policy: never`. Rejection removes the
pending proposal without deleting an existing person or loop.

Echoes contain at most three validated normal loop titles and a generic private
review notice. Their Looks right token confirms the echo only; it cannot approve
pending people, aliases or sensitive proposals. Runtime and Journalist wiring
remain separate from these delivery services; production participation stays off.


## Runtime configuration and lifecycle

Copy the [configuration example](../../configuration/lifelog.example.yml) to the
household's `lifelog/config.yml` only when commissioning is approved. The registry
resolves `lifelog` to `lifelog/config`; no flat config fallback exists. Defaults
perform no journal scan, model call, timer registration, directory creation or
writer lease acquisition. Invalid enabled configuration disables participation
with a structured reason, leaving the ordinary debrief available.

Both `enabled` and `write` must be true. `writer_env` must match the runtime's
actual environment and `writer_host` its actual OS hostname; container deployments
need a stable explicit hostname before commissioning. A production flag or synced
configuration alone grants no authority. Linux's kernel lease prevents concurrent
writers. Losing authority, a conflicting hand edit, failed recovery or sweep age
above thirty-six hours makes question selection fall back to the ordinary path.

Timezone resolves from the user profile, then household configuration. `timezone`
is an optional fallback for injected runtimes. Schedules use local calendar
arithmetic through the application scheduler: the next 03:30 sweep and Monday
05:00 private review remain local across daylight-saving transitions. Startup
recovers before exposing healthy ports, catches up one missed sweep and restores
unfinished verified entry jobs. It initializes a live cursor, never a historical
backfill. Repeated startup does not duplicate timers or acknowledged asks.

The extraction daily cap may be lowered from four; post-entry delay and entry
thresholds are validated. Quiz size five, seven-day queue expiry and fourteen-day
A/B policy are fixed Phase 1 constraints: incompatible overrides disable the KB
rather than being silently ignored. An optional `model` selects the extraction
model and is attributed through `app: lifelog, feature: knowledge-extract`.
Shutdown cancels timers, stops accepting principal capabilities, waits up to five
seconds for work and closes the lease. Late model or recovery results cannot
commit after shutdown.

## Rollback, previews and observations

Set `knowledge.enabled: false` and restart the app to return to ordinary debriefs.
Do not delete the knowledge tree or ledger. Before repairing a conflict, stop the
writer and preserve both the canonical files and immutable ledger; resolve the
conflicting hand edit, then let startup recover. Never erase or overwrite a third
file image merely to make replay succeed. A second writer must remain stopped.

The CLI is read-only and cannot apply a review, enable writing or send a message.
Extraction previews require an existing usage directory outside the data tree;
use the same directory across retries. Every attempt, including failed model
calls, consumes one of four per user-local day. Keep real preview output private.
Human precision review and an explicit production config approval precede
activation. The ten-date generation fixture checks report/ask-date separation,
question caps and empty selections without real model calls or data mutation.

```sh
node cli/knowledge.cli.mjs metrics --username sample --since 2026-11-01 --until 2026-11-03 --as-of 2026-11-21T15:00:00Z
```

The first fourteen activated days alternate odd local ask dates (KB) and even
local dates (ordinary questions). Control-day messages retain their ordinary text
and keyboard while recording acknowledged exposure for metrics. Unknown rates
stay null; skips do not count as answers. No deployment, activation, human
precision acceptance or reply-rate improvement is implied by passing source tests.
Digests, sensor feeders, lookup resolution and historical writing backfills remain
deferred.


## Corrections and delivery safeguards

Authenticated Telegram edits version the evidence receipt under its original
message identity. Corrections retain the original journal timestamp and use a separate observation instant for the live cursor and historical preview cutoff. Old references stop resolving, and later original-message
redelivery cannot restore superseded text. Private corrections received while KB
provenance is unavailable invalidate the previous trusted receipt without granting
trust to the replacement. Revocation metadata is retained; selection and delivery
refresh it before asking, so a withdrawn sole evidence source cannot keep driving
questions. An extraction already in flight re-reads the versioned evidence before
accepting any proposal. Date bases must occur in the quoted source text.

A reply to a message containing two independent questions records message-level
engagement and qualifies a short response for extraction. It does not mark both
loops answered. Metrics deduplicate that engagement; loop unanswered history
remains intact. A skipped question uses its explicit three-day deferral, with the
absolute three-day repeat floor, rather than the ordinary seven-day cooldown.
Expired quiz sessions are cleared before another is selected. Ask controls bind
to their delivered morning selection and local ask date; old controls explain
expiry rather than consuming today's queue.

Normal writes recheck canonical file images after durable preparation, preserving
an intervening third image and stopping the transaction. Missing acknowledged ask
shards make storage unhealthy. Restore them from preserved ledger evidence while
the writer is stopped; never commit an empty replacement as though history vanished.
Extraction input is bounded to twenty thousand characters per receipt and one
hundred thousand per batch. Unsupported oversized receipts remain in the journal,
while their skip is durably resolved so later entries and nightly freshness can
progress. Long-entry suppression is independent of attribution bookkeeping; when
maintenance cannot start, the entry receives a plain acknowledgement rather than
an invented follow-up or a promise of future work.

The fourteen-day resolution metric uses opened-loop cohorts and their opening
instant, including loops resolved without an ask. It does not restart the clock at
first delivery. Cached debrief reads, writes, interview and Details paths use the
request's username; one household user's roundup cannot be reused for another.

## Read-only cached-facts review

After the separately approved extraction preview, the KB-specific renderer uses
its private artifact and explicit per-date requests through the actual
`GenerateMorningDebrief` path. It reads cached facts, makes zero model calls and
has no delivery or writer capability. The legacy headline-preview CLI is not proof
of KB rendering behavior.

```sh
node cli/journalist-knowledge-preview.cli.mjs --username sample --input {private_dir}/extraction.json --requests {private_dir}/requests.json > {private_dir}/rendered.json
```

A requests file is an array of up to ten items:

```json
[{"reportDate":"2026-11-02","askDate":"2026-11-03","asOf":"2026-11-03T15:00:00Z"}]
```

Each ask date is the user-local day after its report date. Rendering excludes
future evidence and rejects an artifact whose referenced source has changed or is
unavailable. Missing cached facts are labeled as fallback; this is not a fresh
roundup-model quality measurement. CLI stdout is JSON; routine progress logging is
suppressed while framework warnings/errors remain diagnostic output. Extraction
usage remains in its durable outside-data receipt/usage ledger.

## Quiet historical imports

An explicit operator job can import authored journal evidence from a frozen range
of at most 90 elapsed days. It excludes older text before extraction, processes
at most ten messages and 20,000 characters per chunk, and reports oversized
entries as skipped. A result at the twenty-proposal limit is split or left
incomplete. Incomplete jobs cannot apply. Private result caches and checksummed
checkpoints support resuming; conflicting or torn artifacts fail closed.

Extraction and preview share the existing four-attempt user-local daily budget,
including failed calls. Keep the same outside-data usage directory across runs.
Preview creates no KB files, task updates, deliveries, activation or sweep state.

Apply uses a separate process-local operator receipt bound to the manifest,
source hashes and exact artifact. It requires the configured actual Linux UID,
hostname and deployment environment (`DAYLIGHT_ENV`, default `docker`), explicit
import-write configuration, and the existing KB writer lease. Serialized approval
flags grant no authority. Source changes invalidate the job; a revision change
requires reading and reducing against current KB state again.

New imported loops retain historical creation, evidence, touch and completion
dates. Their ask policy is pinned to `user_initiated`; sensitive candidates retain
the existing never-ask confirmation rules. Import time is recorded separately in
the audit ledger. Existing edits, pins, retractions, asks and the live extraction
cursor survive. Reapplying a completed job and overlapping unchanged evidence do
not create another loop.

Imported evidence retains `historical_import` provenance. Legacy journal rows
never gain fabricated Telegram verification. A read adapter can resolve an
import only through its durable authorization and a matching current source
hash; changed or missing evidence is revoked. Imported evidence does not enter
the live-message extraction stream. Optional purpose, resource references and
work-domain context must appear verbatim in quoted evidence; referenced files
are not fetched or ingested by this mechanism.
