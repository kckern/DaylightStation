# Registration provenance review

Source identities are frozen in `source-ledger.json`. `registration-review.json`
adds AST-derived declarations, source locations, incoming dependency IDs and
explicit unresolved mount/activation questions. It does not import the controller.
It supplements—not replaces—the original route candidates in `registrations.json`.

## Distinct installed namespaces

| Namespace | Current declaration population | Registration/consumer authority |
|---|---:|---|
| AppContainer apps | 12 | `frontend/src/lib/appRegistry.js`; `AppContainer` lazy-loads the selected entry |
| Backend native-app content IDs | 8 | `appDefs` in `backend/src/5_composition/bootstrap.mjs`; explicitly passed to `AppRegistryAdapter` |
| App parameter resolvers | 1 | `OPTION_RESOLVERS.household`; requests the existing Gratitude bootstrap projection |
| Specialized Admin editors | 4 | `AppConfigEditor.jsx`; other configurations use the existing fallback |
| Admin config-ID mappings | 7 in each of two maps | Backend `YamlAdminConfigStore.mjs` and frontend `adminConfigPaths.js` |
| Household app-config names | 33 | Closed naming declarations in `shared/contracts/householdConfig.mjs`; not app activation |
| Screen built-in widgets | 16 | `screen-framework/widgets/builtins.js`; registration invoked from `ScreenRenderer.jsx` |
| Fitness widgets / dashboard components | 14 / 10 | `Fitness/index.js`; import-time installation into the default screen registry |
| Fitness legacy lookup IDs | 14 | `LEGACY_ID_MAP`; compatibility aliases, not extra widget registrations |
| Player content renderers | 8 | `Player/lib/registry.js`; `SinglePlayer` selects by content format |
| Player media formats | 5 | Separate format set; not entries in the content-renderer map |
| Generic Gaming presenters | 1 | `Gaming/experiences/presenterRegistry.js`; experience-owned composition |
| Party Games experiences/host presenters | 5 / 5 | Separate environment registries; select by experience identity |
| Surround built-ins/aliases | 7 / 2 | `Surround/builtins.js`; side-effect registration, independent registry instance |

The four browser-only app IDs are `videocall`, `weekly-review`, `party-games` and
`school`. Do not add their backend native-content registrations as an incidental
migration improvement. Gratitude remains `gratitude` in AppContainer and
`app:gratitude` in native content, with its existing editor/config mappings.
Screen IDs, renderer formats, content prefixes and app IDs are not interchangeable.

There are 17 catalog declarations after including Fitness's registry/alias maps.
The [provider/lifecycle review](provider-lifecycle-review.md) distinguishes its
14 widget metadata exports from 21 backend adapter manifests and records shared
registry identity, import-time installation and repeated WeeklyReview registration.

Surround's `movement-map` and `libretto` aliases preserve authored definitions.
Its registry reuses the `WidgetRegistry` class but **not** the screen registry's
singleton. Sharing an implementation class does not imply sharing registrations.

## Browser route provenance

The source has 134 JSX `Route` declarations across 13 files. The inventory keeps
pathless layouts, index entries, parent IDs, wildcards, element expressions and
literal patterns separately. `main.jsx` has 38 declarations; its literal array
expands one declaration into `/screen/:screenId/*` and `/screens/:screenId/*`.
An expression-valued path is not silently dropped or counted as a literal URL.

Nested route patterns are local to the component that owns `<Routes>` until its
outer mount is resolved. For example Admin's `apps/:appId` is reached through
the main `/admin/*` mount; a syntactic `/apps/:appId` alone is not its public URL.
Main also mounts Admin at `/`, whose non-splat route must not be treated as a
second unrestricted prefix for every Admin child route. `assembled-browser.json`
now records the reviewed outer bindings: 134 declarations yield 178 conditional
pattern bindings, including both single/multi-piano roots and Karaoke reused by
Playalong/Singalong. These are not 178 simultaneously activated independent URLs.

The same artifact separately records School's section/material parser, the
Teacher console's path parser, Media's query/history view model and four legacy
redirects. Office intentionally drops the query; TV, School and Teacher aliases
preserve it. Media view keys must not erase playback query parameters. Literal
history writes are indexed; Teacher's computed push/replace operation is recorded
by its parser/shell authority. Browser registration inventory is not proof of
runtime access, configuration or navigation behavior.

## Gratitude's actual HTTP mount chain

The relevant chain, in source order, is:

1. `backend/src/app.mjs` configures proxy trust, COOP/COEP headers, default `cors()`,
   JSON/urlencoded parsing, and its WebSocket-path handling. The not-configured
   catchall can return before API handling.
2. Under `/api/v1`: request logger → device resolver → household resolver →
   network trust resolver → token resolver → permission gate. Reordering changes
   the access contract. The product currently selects its household from query
   or its directory default, not `req.householdId`.
3. `v1Routers.gratitude = createGratitudeApiRouter(...)` at app line 2597.
   That factory returns `createGratitudeRouter(...)`; no separate nested router
   mount exists inside this product factory.
4. `createApiRouter` looks up `routeMap['/gratitude'] === 'gratitude'` and mounts
   the supplied router only when that key is present. It is mounted under
   `/api/v1` at app line 6494. App-level error translation follows at line 6502.
5. The 18 product registrations retain their order and async-handler wrappers.
   `/card/print{/:location}` is one Express 5 pattern accepting both absent and
   present location, not a literal brace-containing URL or a renamed endpoint.

The dedicated pack exercises the real product router, API router, representative
permission gate and error handler. It does **not** exercise all controller-wide
middleware, body parsing, configuration failure or startup/shutdown wiring.
The unused bootstrap import still prevents safely importing the product's actual
composition module; IMP-BASE.01 remains a later protected-source change.

The in-memory HTTP wire cases use actual Express and Node response serialization:
HEAD `/bootstrap` has JSON headers/content length but no body; HEAD `/new?text=...`
still publishes exactly once; router-only OPTIONS `/new` advertises GET and HEAD
without publication; a projection with the current default CORS middleware
returns 204 before router handling; unsupported PUT falls through without effects.
This last CORS fixture verifies the current middleware behavior, not that a
future edited `app.mjs` still installs it. Full composition remains a separate gate.

## Wider API assembly and remaining lifecycle work

`assembled-api.json` statically follows imported/re-exported factories, returned
routers, argument projections, assignments, finite loops and nested mounts. It
resolves 76 of 79 route-map roots, plus direct agent-memory/meta and API-owned
routes and legacy `/admin/ws`. The current output has 1,049 reachable endpoint rows, with stable unique
IDs, source guards and registration-phase provenance. These are potential
registrations, not requests executed or proof of runtime activation. Three
unsupplied map keys and all 50 middleware-or-opaque arguments now have explicit
source-backed dispositions in [HTTP registration accounting](api-registration-audit.md).
Five agent helper patterns and two direct app GET registrations are separately
recorded, along with full global/local ordering and implicit method behavior.
Its eight self-checks cover representative resolution mechanisms, a rejected
re-export cycle, all 18 Gratitude patterns and unique endpoint identities.

All 79 API route-map mounts now link to their `v1Routers` assignments/spread
candidates and source conditions. There are ten post-factory School mounts,
including `/sentence-ladder` and its `/language` alias. Factory-only discovery
would lose them. Agent memory/meta HTTP mounts are installed directly on `app`,
outside the route map. Webhook proxy middleware also precedes the final API mount.

The packet separately captures provider manifest declarations, registration/
subscription/start/stop calls, and CLI switch dispatches with source consumers.
The expanded lifecycle index includes optional calls, publication/emission,
connect/disconnect, registerTask/schedule variants, named unsubscription, status
subscriptions, React effects and frame/idle/member timers: 5,326 candidate calls.
Their counts are in the generated JSON. A manifest or `.start()` call in source
is not proof of an activated provider or a matched `.stop()`. Remaining work:

- API source-registration accounting is complete; configuration-specific
  activation and full controller behavior still need later verification.
- Pair each affected registration/subscription/timer with its actual teardown.
- Review provider enumeration separately from instantiation and configuration.
- Preserve stable CLI entry paths; reading dispatch does not authorize execution.

The lifecycle items remain explicit PRE-2.2.3 exits, not reasons to mark the entire registration
inventory complete. Generic host wiring changes belong to installed composition;
product experiences keep their ownership and export deliberate entrypoints.
