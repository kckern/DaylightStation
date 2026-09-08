# Public-entry matrix

Status: every currently proposed public entry is source-backed, but none is an
installed package export yet. The [machine matrix](public-entry-review.json)
contains all 57 entries: 49 reviewed foundation entries and eight Gratitude
entries. For each it records source/proposed source, names, current consumers,
owner/layer/runtime/context/rank, direct static closure, state expectation, and
contract IDs.

The Gratitude composition, surface, settings, icon, print adapter, narrow
events, renderer, and print-presentation entries now have explicit contract IDs
in the matrix rather than relying on a generic package label. The latter three
are composition-scoped entries, not a general cross-application service.
Foundation entry symbols inherit their individually reviewed consumers,
identity/state constraints, and contract IDs. The mixed
`RealtimePublications` body is not an entry; only its reviewed Gratitude symbol
has a future owner-specific seam.

An entry forwards the same canonical implementation binding. It does not create
a second React context, logger, browser service, native canvas instance, or
product workflow. Package manifests, resolver configuration, actual facade
bytes, and candidate behavior remain later Phase 4/6/7 work.
