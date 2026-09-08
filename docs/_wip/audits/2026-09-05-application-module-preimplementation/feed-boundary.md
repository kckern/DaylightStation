# Feed / Gratitude boundary — selected preparation specification

Status: exact interface and source changes selected; **not implemented or
candidate-certified**. `feed-boundary.json` contains source hashes/anchors, ten
exact existing-source edits, three proposed private files, an expansion of the
already-planned Gratitude factory, import targets and twelve baseline case links.
Its source snippets are parsed, never executed by the inventory tool.

## Ownership and public operation

Gratitude owns reading and interpreting its stored selections. Feed owns the
bundle: sample limit, random comparator/slice, group-label lookup, timestamp
selection, title/body/meta, tier/priority defaults and logged-error fallback.
The existing Feed adapter and browser card stay with Feed. DataService remains
the shared persistence mechanism; stored files and user/household scopes do not
move with source.

The existing public composition entry supplies the operation:

```text
@daylight/gratitude/server/compose
  createGratitudeServices({dataService, logger})
    → existing gratitudeStore and gratitudeService, unchanged identities
    → gratitudeQueries.readSelectionQuotes()

installed composition
  → Feed adapter receives readGratitudeQuotes: that bound operation
```

The selected signature is synchronous:
`readSelectionQuotes(): null | Iterable<GratitudeQuoteView>`.
The view has lazy `text`, `userId`, and `datetime` properties. It is a local
read-only operation result, **not a wire DTO or a new HTTP API**. Do not serialize,
normalize or materialize fields before Feed selects its rows. `null` denotes
the old absent/non-array source outcome. An empty iterable remains a present
empty collection and therefore still produces the existing empty Feed bundle.

There is no argument: the current source reads the default household and ignores
Feed's username. Adding a household filter or authorization policy here would
be a separate functional change, not part of this extraction.

Retire the earlier placeholder `@daylight/gratitude/server/queries` module entry.
No external source needs to import the private query class. The public operation
is a returned member of the existing composition factory, not a reason to expose
another package subpath. Feed gains no private Gratitude source import.

## Why fields remain lazy

The preserved sequence is:

```text
read once → inspect query limit → spread/shuffle/slice
  → selected text + user ID + display name, row by row
  → selected timestamps → fallback clock → bundle ID/tier/priority
```

The source and new baseline cases establish these distinctions:

- An unselected null row is ignored. A selected null/sparse row fails the whole
  bundle at the original `item` access. It is not filtered into a smaller bundle.
- A display-name failure in an earlier selected row wins over a later invalid
  row or timestamp failure. Eager projection would change the warning and which
  collaborators execute before failure.
- Legacy text uses nested `item.text`, then string `item`, then top-level `text`,
  with the existing truthiness rules. Truthy non-string values are not coerced.
  Missing/undefined group labels are not replaced by new display-name fallbacks.
- Timestamp comparison is the existing `>` reduction over picked values, not
  ISO validation, date parsing or a maximum over every stored entry. The empty
  bundle's `new Date()` fallback is separate from `Date.now()` used for its ID.
- Source read, selection and field access finish synchronously inside the
  current `async fetchItems` body. Adding an `await` before selection changes
  scheduling. The new operation must remain synchronous.

The read adapter returns an iterable over that one read result. Iteration creates
views without accessing row fields. Getters perform the exact old expressions
only at the corresponding selected-row access. Neither iteration nor getters
perform another disk read. There is no open file, stream, timer, subscription,
global cache or disposal obligation. Synthetic getter/sparse-array tests expose
ordering; they are not a claim that YAML files contain JavaScript getters.

## Exact private implementation boundaries

| Proposed file beneath `modules/gratitude/server/` | Role and permitted dependencies |
|---|---|
| `application/ports/IGratitudeQuoteSource.mjs` | Application-owned synchronous read port; no dependencies |
| `adapters/yaml/YamlGratitudeQuoteSource.mjs` | Really extends that port; receives DataService, owns exact dotted `.yml` key and lazy legacy interpretation; no peer adapter import or direct fs |
| `application/queries/GratitudeSelectionQuery.mjs` | Delegates the query to its injected port; no DataService/FileIO, renderer or concrete adapter import |
| `composition/createGratitudeServices.mjs` | The single factory already planned by IMP-SHARED.01; constructs the new reader/query using the same supplied DataService and returns a bound operation alongside existing objects |

No domain context/rank changes, shared-code exemption or new public port is
introduced. D1/D3/D5/D7/D10 remain binding. Feed continues to extend its actual
`IFeedSourceAdapter`; no unused second Feed port is added merely for naming.

`GratitudeFeedAdapter` intentionally changes its internal constructor dependency
from `dataService` to `readGratitudeQuotes`, including the missing-dependency
message. There is no old/new fallback. Its one installed constructor call changes
in the same changeset. The other tracked importer is
`tests/isolated/adapter/feed/AdapterProvides.test.mjs`; it uses the prototype and
does not call the constructor, so it needs no edit. The preparation fixtures do
construct the baseline adapter and need target-specific wiring when a candidate
driver is later approved; their behavior assertions must remain the same.

## Verification and reversal

Twelve original-Feed baseline cases now cover existing legacy/empty/error/limit
behavior plus selection/field/error/query order and inherited page/read-state
contracts. The five new cases are in `registrations.case.mjs`; the other seven
remain in `gratitude.case.mjs`. `feed-boundary.json` links exact case IDs and RUNs.

The candidate must run those same oracles through native approved packages,
prove one DataService read and no extra side effects, and preserve source
type/provides, `fetchPage`'s null cursor, null detail and no-op markRead. Required
negative controls remove legacy string support, eagerly inspect invalid rows,
insert an async boundary or duplicate a read; they must fail the specific case,
then pass after restoration. These new controls are specified, **not claimed
as executed red tests**. Existing seven red/restored pairs remain separate.

Rollback restores the Feed constructor and installed binding with the factory/
query/port/reader changes as one unit. Remove only the introduced source artifacts
for this change; never restore old records over current household data. No
compatibility adapter, duplicate writer or extra public query facade remains.

Remaining gates: safe native candidate drivers, real extracted factory/package
resolution, full shared-foundation acceptance and the broader implementation
approval. A syntax-valid source plan is not runtime parity evidence.
