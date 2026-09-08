# Provider, widget and lifecycle review

This is the provider/widget portion of PRE-2.2.3. `provider-lifecycle-review.json`
records source anchors, dependency consumers and seven reviewed lifecycle seams;
[lifecycle accounting](lifecycle-closure.md) supplies the foundation, composition
and CLI follow-up. It also completes Fitness's explicit widget population alongside
the previously inventoried browser/catalog registrations. Nothing here starts
providers, schedules, hardware or the websocket singleton.

## Distinct populations and authorities

The original broad manifest scan mixed unlike declarations. There are **21
backend adapter manifest files**, not 31 backend providers. Separately, Fitness
has ten dedicated `manifest.js` files and four inline named metadata exports.
The expanded inventory records those 14 widget manifests separately.

Backend discovery, indexing and construction are different operations:

1. `FileModuleManifestDiscovery.find` recursively enumerates `manifest.mjs` under
   the adapter root, in filesystem enumeration order without an explicit sort.
   Directory symlinks are not recursed through via `isDirectory`; a file named
   `manifest.mjs` is collected without an explicit `isFile` check. Do not claim
   the loader implements an all-symlinks-denied policy.
2. `FileModuleManifestDiscovery.load` actually imports the discovered module.
   Although the file is in system, this is upward module execution, not merely
   returning file names. Future ownership/layer design must address that split;
   no LoA exception is granted by calling it discovery.
3. `AdapterRegistry.discover` indexes capability/provider pairs. Missing fields
   are skipped; import failures are logged and discovery continues. It does not
   call `manifest.adapter()` during indexing.
4. `IntegrationLoader.loadForHousehold` parses configuration, selects providers,
   calls their lazy adapter factory and constructs instances. Service selections
   precede deduplicated app-routing selections; first loaded provider becomes the
   default for its capability. A declared provider is not necessarily selected
   or configured. `HouseholdAdapters` applies app/default selection and NoOp
   fallback, separately from discovery.

The config merge is service fields → system scalar API key → household auth →
secret mappings → resolved service host, followed by conditional snake/camel
normalization. If a camel key already exists, its snake counterpart is retained.
The dedicated synthetic test checks that exact behavior; a future DTO cleanup
must not silently change precedence.

`initializeIntegrations` creates registry/loader/bot-loader singletons. System
bots use injected platform factories and system bot/auth configuration, not the
same manifest selection path. The source file is in composition despite comments
calling it system-layer. Explicit content-registry construction elsewhere in
bootstrap is also a separate mechanism and must retain its registration IDs.

## Existing collision and lifetime risks

Both `content/media/files/manifest.mjs` and `content/media/media/manifest.mjs`
claim capability `media`, provider `files`, but point to different adapters.
The registry uses `Map.set`: the last enumerated one replaces the earlier one.
The new isolated `CASE-PROVIDER-DUPLICATE` test proves order changes the winner
while constructing no adapters. It does not claim a particular deployed winner.
Moving directories or changing the discovery algorithm can therefore change
behavior. Resolve that collision in a separately scoped implementation decision,
not by arbitrarily choosing a manifest in the relocation plan.

Repeated `loadForHousehold` calls construct new selected adapter instances and
replace the stored household wrapper. The method does not dispose old instances.
`CASE-PROVIDER-LOAD` verifies distinct instances, zero disposal and config merge
behavior with synthetic adapters. Adding disposal/idempotency would be a lifecycle
behavior change, not a filesystem-only migration.

## Screen registry and Fitness ownership

`Fitness/index.js` registers 14 metadata-bearing widgets plus ten dashboard
components into `getWidgetRegistry()` at module evaluation. Its 14 legacy aliases
are lookup mappings, not additional registrations. The metadata is not a backend
capability declaration; merely storing it does not enforce `requires`.

This is the same default registry used by screen built-ins. FitnessApp imports
the registration module and invokes built-in registration. WeeklyReview's index
and screen built-ins both register the same `weekly-review` component. Registration
is replacement by key; it is not additive versioning or automatic conflict
detection. Surround reuses the registry class but owns a separate instance.

The classification implication is concrete: a generic registry implementation
can stay platform-owned while Fitness widgets remain Fitness-owned. Installed
composition chooses their registration. Sharing the registry does not promote
every contributed widget into platform ownership. Preserve the singleton and
import-time side effects until an explicit composition changeset replaces them.

## Reviewed Gratitude/shared seams

The JSON records seven seams with start/cleanup source anchors:

- Gratitude's payload effect sets and clears a **single callback slot** in its
  context; it does not own a new websocket connection or multi-listener registry.
- Keyboard effects remove the corresponding listener identities. Long-press
  handling owns keydown/keyup/blur listeners and its timer, separate from action
  animation timers.
- A delayed selection action can persist after unmount in current code; the
  existing browser case observes that write. Do not conflate subscription cleanup
  with cancellation of all pending actions.
- WebSocketProvider releases its returned status/message subscriptions. Its
  message-indicator timer is not cancelled there; unsubscribe does not disconnect
  the shared service.
- The singleton transport owns reconnect, stale checks and degraded-reload
  timers. Its current `disconnect()` is not evidence of comprehensive teardown:
  the close callback can schedule reconnection, and not every timer is cleared.

The expanded AST index includes named unsubscription calls, status subscriptions,
React effects, frame/idle callbacks and member timers as well as the previous
registration/schedule/event calls. These are **5,326 candidate calls**, including
96 in the current Gratitude/foundation file set, not 5,326 distinct registrations
or proofs of paired cleanup.

The follow-up accounts for all 96 affected calls through 15 lifetime policies,
eight controller service/entrypoint lifetimes, 14 termination bindings, 15
schedule declarations and 202 CLI source files. Together these complete source
registration inventory. Runtime activation and teardown certification remain
separate verification obligations, including known missing cleanup.
