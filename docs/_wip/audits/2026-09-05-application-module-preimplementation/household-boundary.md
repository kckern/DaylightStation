# Household identity: presentation query and roster client

Status: exact selected source/interface/manifest proposal with baseline evidence.
No implementation, install, controller, rehearsal or candidate build was run.
Machine specification: [household-boundary.json](household-boundary.json).
Global owner-metadata/test/dev targets, package/lock/build adoption and native
candidate proof remain separate, open preparation gates.

## Responsibility split

`household-identity` is a **capability**, not platform core and not the Gratitude
product. This changeset gives it the existing reusable household presentation
policy and the browser roster transport seam. It does not move every identity
adapter, authentication flow, profile writer, or household surface at once.

| Responsibility | Owner/layer |
|---|---|
| Config representation (`display_name`, profile `group_label`) | Identity config adapter implementing a shared application source port |
| Ordered user projection and confirmation-name precedence | Identity application query |
| Category coercion/validation and timestamp generation/fallback | Gratitude application helper |
| Existing HTTP household parameter, bootstrap ordering and response envelope | Gratitude API |
| Actual configured instances and cross-owner bindings | Installed backend composition |
| Fixed roster response request through the existing transport | Identity browser client |
| Wheel selection/errors/avatars and parameter-option labels | Existing FamilySelector and app registry consumers |

Neither Homebot's `ConfigHouseholdAdapter` nor the general `ConfigUserDirectory`
is substituted for this query. They differ in roster DTOs, missing-profile
filtering, object/falsy IDs and fallback names. Those remain distinct policies
over the same configured household membership—not new duplicate membership
stores or an invitation to make each application restate the roster.

## Exact source and public entries

Seven new source files under `capabilities/household-identity/`:

| Path relative to owner | Layer / purpose |
|---|---|
| `server/application/ports/IHouseholdPresentationSource.mjs` | Four-method source port: default household, raw timezone, user IDs, profile presentation values |
| `server/adapters/config/ConfigHouseholdPresentationSource.mjs` | Real `extends` of that port; receives the installed ConfigService, imports no config singleton or filesystem |
| `server/application/queries/HouseholdPresentationQuery.mjs` | Reusable presentation policy over the injected source |
| `server/composition/createHouseholdIdentityServices.mjs` | Inert construction and bound returned operations |
| `web/rosterClient.mjs` | Direct forwarding request through `@daylight/platform/web/http` |
| `public/server/compose.mjs` | Composition facade to private server facet |
| `public/web/roster-client.mjs` | Browser facade to private web facet |

Public consumers import only:

- `@daylight/household-identity/server/compose` → `createHouseholdIdentityServices`
  (installed backend composition only).
- `@daylight/household-identity/web/roster-client` → `fetchHouseholdRosterResponse`
  (FamilySelector and app-parameter resolver).

The server factory returns `householdPresentation` with bound synchronous
`getDefaultHouseholdId()`, `getTimezone(householdId)`,
`getHouseholdUsers(householdId)` and `resolveDisplayName(userId)` operations.
No public application-module/port/adapter entry is necessary: composition passes
the operations to Gratitude, and only the identity adapter imports its port.
There is no unused aspirational facade, application-to-adapter import, new domain
context/rank, or shared-code exception to the binding layers.

The source port's profile values are `displayName`, `name`, and `groupLabel`.
The config adapter translates their representation with request-local getters
so choosing a roster name does not eagerly read an unused fallback or group
label. It never exposes a raw profile. The outward plain user DTO remains
`{id, name, group_label}`: that last spelling is an existing public presentation
field, not an application dependency on stored YAML fields. Truthy non-string
values remain observable; this extraction is not a validation/security overhaul.

`getTimezone` on the shared query returns the configured value **without** adding
a UTC default. Gratitude retains its current `|| 'UTC'` policy and timestamp
method. This avoids turning a product's timestamp quirk into generic identity
behavior or changing Homebot's distinct timezone result.

## Packages and unresolved adoption work

Three full proposed manifests are in the machine specification. Sibling roots
are `public`, `server`, and `web`; the owner ancestor is not a workspace package.
All are private ES-module packages with an initial proposed version `0.0.0`.

The public facade depends on the two same-owner private facets and exports only
the two public entries above. The server facet exports only its composition
entry and has no direct external dependency. The web facet exports only its
roster client and declares `@daylight/platform`; it does not import React itself
or require a new React peer. This is not proof that the transitive browser graph
has correct singleton identity.

`backend/package.json` and `frontend/package.json` must declare the public
capability. IMP-PKG.02 must add the exact three workspace roots to the reviewed
root install/lock graph, with its nested-install policy and the matching adopted
platform-facade version. A version mismatch requires an explicit revised
manifest—not an incidental npm upgrade. No install is performed here.

`capabilities/household-identity/owner.json` must classify these actual files and
exports, with no domain contexts; its supported test/dev targets and owner
README commands still depend on the global target/schema design. Do not invent
passing target names, register an empty dev harness or mark the metadata complete
merely because the source/manifest paths are specified. Build context, watcher,
runner, architecture resolver and lock changes remain their named package cards.

## Exact existing edits

Eighteen edit groups across six original files are recorded with source hashes,
original anchors, sequential replacement text, and the planned Gratitude
relocation destinations:

1. `GratitudeHouseholdService.mjs`: rename the required dependency to
   `householdPresentation`; delegate names/users/default ID; retain category
   validation, timestamp generation, and the truthy timezone fallback.
2. `gratitudeApi.mjs`: receive/inject the shared query object instead of creating
   the inline ConfigService projection. Keep the router/helper, print and event
   construction order otherwise unchanged.
3. `bootstrap.mjs`: remove its confirmed unused private
   `GratitudeHouseholdService` import, coordinated with existing extraction work.
   The helper gets no public package export to support an unused import.
4. `app.mjs`: import the public identity factory and create it immediately before
   the existing Gratitude API binding with the same installed ConfigService;
   pass the returned query object. Construction reads no config, starts nothing
   and adds no subscriptions/cache/disposer.
5. `FamilySelector.jsx`: replace the request call with the shared browser entry,
   remove the unused DaylightAPI import, and update the endpoint-specific comment.
6. `appRegistry.js`: use the same shared client in its household option resolver.

Both browser files keep DaylightMediaPath. Their foundation relocation still
changes that helper's import path to its separately specified public platform
entry; this card's symbol-list edits work independently of that path change.
The router itself is retained unchanged. Preparation drivers need distinct
baseline/candidate dependency bindings; no existing assertion is weakened and no
candidate silently falls back to original code.

The generator also applies the selected Feed → Homebot → household edit sequence
**in memory**: all 39 edit groups apply to ten original files without an anchor
collision, and the combined result parses. Thirteen proposed new source paths
are unique, and both users of the planned Gratitude factory agree on its hash.
This checks compatibility between these three cards, not full foundation/import/
relocation/package changes or execution of a candidate. No resulting source
file is written to the worktree.

## Baseline evidence and compatibility details

Nine original server cases cover initial Homebot/Gratitude contrasts plus:

- General ConfigUserDirectory is not interchangeable: it filters missing
  profiles, may replace IDs from `profile.username`, and has different name,
  blank-label and birthyear fields.
- Roster projection preserves declared order, duplicates, missing-profile
  fallback, raw ID/value types, own-property order, and short-circuit field/error
  order. No array normalization, sorting, filtering or eager profile copy.
- A fixed `2026-09-05T12:00:00Z` clock with Gratitude `UTC`/empty fallback yields
  `2026-09-05 05:00:00` through the existing household-default helper. A configured
  Tokyo timezone uses locale formatting. Invalid timezones still throw.
- Writing a profile on disk does not refresh the query's configured view.
  Explicit ConfigService reload becomes visible on the next query; prior returned
  DTOs remain unchanged. There is no new result cache or implicit fresh-disk read.
- HTTP bootstrap waits for the Gratitude bootstrap operation before querying
  users. The spread `users, ...data, _household` order is preserved, including
  service data's ability to override users and the final household field winning.
  Empty request household falls back; repeated household query values still
  reach the service as the existing array. The users route stays synchronous.
- Bootstrap failure prevents user projection. Original synchronous projection
  errors reach Express unchanged. This tests handler ordering/error identity,
  not the whole installed authentication/error-middleware stack.

Five original browser-consumer cases include normal FamilySelector/parameter
behavior, the exclusion minimum, duplicate/raw-ID/fallback option behavior,
missing/malformed responses and the existing failed-load surface.

`fetchHouseholdRosterResponse` is deliberately an ordinary function returning
`DaylightAPI('/api/v1/gratitude/bootstrap')` directly. It adds no `async`, `.then`,
selector, query parameter, retry, cache or response normalization. The old
bootstrap envelope is preserved; identity consumers consume its `users` field
only and do not adopt Gratitude's other fields as identity API. The URL is an
intentional external compatibility contract, not a private-code import.

Six proposed negative controls target wrong directory substitution, eager
profile fields, UTC formatting repair, stale query caching, early projection,
and browser fallback on failure. They are **specified, not executed**, and do
not increase the product red/restored-green pair count. Actual new source,
factory and browser promise identity, public/native resolution, classification,
package/build effects and whole candidate parity remain execution proof gates.

## Recovery unit

Reverse installed/server/browser bindings together with the new capability
source/facades and dedicated manifest/workspace dependency additions. Restore
the old inline config projection/helper and browser calls; do not restore the
unused bootstrap import unless reversing its owning extraction changeset too.
Keep unrelated platform/Feed/Homebot changes if their cards remain installed.
The query/client has no owned state to restore and changes no stored format.
Never restore older profile/selection data to reverse source changes. Re-run
baseline cases and loaded-client artifact recovery under the separate rehearsal
runbook before claiming rollback success.
