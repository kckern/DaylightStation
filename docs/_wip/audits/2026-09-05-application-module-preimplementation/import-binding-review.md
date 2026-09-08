# Import binding review

Status: complete source-level binding specification; no candidate import or
package has been created.

The machine record, [import-binding-review.json](import-binding-review.json),
reconciles all 66 static Gratitude edges with the foundation symbol map. Each
edge now has a binding owner and one exact disposition: a selected or reviewed
public entry, a same-owner relative import, a deliberately removed import as
part of a named extraction, or a removed root-barrel re-export. It does not use
a compatibility alias, deep private cross-owner path, or broad facade barrel.

The same-owner paths are checked against the retained D1–D10 direction: adapters
may depend on their application/domain abstractions; applications on domains;
composition on API/application; and rendering/domain local bodies remain local.
Test-owned imports are recorded separately and do not grant production access.

Three narrowly scoped entries close the previously mixed/installed seams:

- `@daylight/gratitude/server/events` exposes only `GratitudeEvents`; the other
  `RealtimePublications` classes remain in their current owner.
- `@daylight/gratitude/server/rendering/card-renderer` is for installed
  composition to create the renderer; application/API/domain code receives only
  the callback it produces.
- `@daylight/gratitude/server/application/print-presentation` is limited to
  installed composition and its explicit composition contract test.

The foundation ledger has 2,663 individual symbol bindings. 2,655 resolve to a
reviewed entry; eight explicitly retain their present publication or await the
private household-helper split. Those eight are not silently rewritten. Actual
facade bytes, manifests, resolver behavior, package identity, and candidate
runtime behavior remain later preparation/implementation gates.
