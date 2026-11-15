# Lifelog knowledge

The knowledge subsystem records user-stated open loops with quoted journal evidence. It is separate from the read-only lifelog archive. The domain, recoverable persistence and read-only preview CLI are implemented in source. Runtime integration and production activation remain separate steps. No existing debrief uses the foundation until composition explicitly supplies the knowledge ports.

Only verified user messages can authorize committed proposals. Historical user rows can be inspected in a preview that cannot be committed. Quotes match their cited message after Unicode NFC and whitespace normalization; paraphrases are not evidence. The proposal vocabulary permits opening, touching and closing loops, candidate people and candidate aliases. It cannot delete, merge, confirm itself or loosen user pins. Sensitive proposals wait for review and default to never asking.

Question choice is deterministic, with at most two independent morning questions and five opt-in quiz candidates. Eligibility begins after the due date, uses local calendar days, normally observes a seven-day cooldown and never repeats within three days. Acknowledged deliveries alone count as asks; a 36-hour reply window prevents a new delivery being treated as immediately ignored. Two unanswered asks or two skips retire a loop. Three ignored morning dates trigger fourteen-day weekend-only backoff. Healthy empty selections remain empty.

Dates are interpreted against the original entry's local date. For example, an explicit Monday on a Monday means the next Monday, while today stays on the entry date. Unsupported date phrases remain uninferred for review. All domain operations receive explicit time and timezone; model output never supplies the clock or selection order.

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
appear only in preview mode. Canonical source IDs survive sorting and restarts;
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
