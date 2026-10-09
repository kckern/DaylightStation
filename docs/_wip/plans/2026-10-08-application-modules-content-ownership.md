# Content, catalog, Media and playback ownership

Source review at759be3aaf7; implementation batch must preserve actual signatures and source bodies. Folder names alone are not the partition.

| Destination | Source responsibility and evidence |
|---|---|
| modules/media | Existing MediaApp and frontend Media product, backend domains/media + applications/media and corresponding private adapters/persistence/routes/composition. MediaSuggestionsService explicitly implements start-page household/screen history rules; HouseholdMediaMemoryService, MediaQueueService, routines, source-healing and fleet UI are Media product policy. Multiple consumers do not make them platform. Product queue versus playback transport remain distinct. |
| capabilities/content-catalog | Content identifiers/items/source vocabulary, source registry/catalog lookup/query/list/search/access/alias resolution, reusable Content browser combobox and Admin ContentLists surfaces. Real consumers include Media, Fitness config and PlaybackHub admin. Expose deliberately named browser picker/model exports and server catalog/query interfaces; keep source implementations/provider clients private. |
| capabilities/playback | Reusable execution/session/stream/progress operations and player runtime. In existing applications/content this includes runtime/PlaybackSessionRegistry, playback-session/progress use cases, PlaybackReadService/PlayResponseService, queue presentation and surround planning, plus their exact ports/adapters. Shared playback may consume content-catalog contracts; it must not acquire Media household recommendation or Piano/School/Fitness product rules. |
| capabilities/content-catalog server rendering | Existing applications/catalog/GenerateCatalog is reusable content-list-to-QR-PDF projection with injected listSource, expression, QR and PDF functions. Keep that optional export and catalog rendering together, rather than inventing a new Catalog product. |
| capabilities/content-catalog server adapters | Existing provider families under adapters/content (Plex/ABS/Komga/Immich/files/list/query/etc) implement catalog contracts; preserve native module identities, provider namespace, registration order and one writable authority. Concrete providers remain private adapter implementations behind installed composition. Generic source registry must not import product providers. |
| capabilities/playback server adapters | adapters/content/playback and surround execution/progress storage, with exact consumed ports, follow reusable playback runtime. Content item/progress vocabulary can remain content-catalog-owned and be published explicitly; avoid duplicate models. |
| product provider exceptions | School, Piano, Fitness, art and other product-specific content providers/configuration belong to their product, even if a shared catalog invokes them. Composition registers the exported provider contract. Do not promote product curricula/selection policy simply because it currently sits under adapters/content or shared content. |

Concrete public seams required: catalog resolve/getItem/getList/query/siblings and content ID/model helpers; playback stream/progress/session operations; Media household queue/suggestions/dispatch operations; composition-only provider installation. Preserve existing factories where they already inject interfaces (LaunchService requires contentCatalog and deviceLauncher; GenerateCatalog injects its render/list functions). No runtime registry/discovery redesign.

Browser Content has28 tracked files and cross-owner consumers, so it is a real shared facility. Media controller/cast code must be checked per consumer: Media-only shell/household policy stays Media; reusable Player/session controls are playback. Existing ScreenPlaybackService is a Media household playback projection, not proof that every screen abstraction belongs to playback. Installed screen widget selection belongs to composition, neutral host mechanics to screen-host.

Implementation ledger must enumerate mixed content files actually assigned to each capability before moving them. This note settles the ownership rule and concrete groups; it is not a substitute for the per-file move manifest/resource-path audit. Tests and collocated assets follow their implementation. Vendor transport/source implementations are not exported wholesale merely to make old deep imports compile.

The neutral catalog installation now has three composition phases in
`capabilities/content-catalog/server/composition/installation.mjs`: initial
registry/list/query sources, remote catalog sources, and textual sources.
Their source blocks preserve the original constructor options and registration
order. Installed composition retains intervening FreshVideo, streaming and Art
registrations. Later phases receive the originally captured HTTP client and
progress memory, avoiding additional dependency getter reads. Installed composition now calls the three phases at their original positions;
25 unused private provider imports were removed from the host. The extracted
source blocks remain byte-identical. Confined candidate verification is pending.

The installed `createContentRegistry` wrapper now lives in
`backend/src/5_composition/contentRegistry.mjs`; bootstrap reexports that same
function. Its function body is unchanged, and the host gained no unbound names.
The two existing Libby assembly suites import this narrow factory so their
confined baseline does not evaluate the full bootstrap module. They retain all
11 original cases, with memory-backed HTTP transport and private temporary paths.
This does not finish the separate mixed `createApiRouters` ownership split.

### Content API assembly ownership correction

The installed `createApiRouters` orchestration now lives in
`backend/src/5_composition/modules/contentApi.mjs`. Eight contiguous construction
phases have moved into actual catalog, playback, and Media composition factories,
retaining the original phase bodies, call order, callbacks, and returned service
identities. Media owns `BrowseCatalogService`, which reads household Media
configuration. The old neutral-capability orchestration file is removed, and all
six identified consumers of the two relocated implementations now use their
actual owners. Static checks found no introduced unbound identifiers or missing
relative imports; runtime candidate verification remains pending.

Installed content-source assembly now explicitly injects Piano curriculum
functions into catalog source construction. The separate third argument avoids
spreading or eagerly reading the existing dependency object. Plex receives this
provider through its dependency argument; its Piano cache and merge semantics
remain owned by Piano.

This does not close the whole content seam: router publication, the mixed
Piano/School progress store, and remaining installed private constructor imports
still require ownership/public-interface closure before milestone 3 completion.


### Remaining content router ownership applied

Eight files now follow their actual owners: catalog owns display/info/query/sibling
APIs, playback owns queue API and its surround tests, and Media owns local/stream
APIs. The [exact manifest](2026-10-09-content-router-owner-manifest.json) records
these moves. Nineteen files received 40 import rewrites, preserving router/test
bodies and the installed app's dynamic import timing.

Three coherent factories now construct content-query, playback-queue, and local
Media routers within their owners. Their original router-call expressions remain
exact, including nested constructor order and bound callback evaluation. The
catalog factory receives Media search validation explicitly. Static checks found
no introduced unbound names or missing relative imports. Candidate runtime
verification remains pending for this latest change.

The preceding content assembly checkpoint passed all 11 original selected Libby
composition/playback cases (`content-api-0sZ7Ur`), with baseline parity and
confinement controls. That evidence predates these eight router moves and does
not certify them by itself.

### Legacy forwarding removal and final policy owners

The three legacy content domain/application/port forwarding modules are removed.
A resolved scan of 11,507 source files identified all nine incoming references:
seven production imports and two test mock targets. Those consumers now import
the actual owner contracts; existing item contracts are reused. The former domain
barrel's transitive initialization consisted of declarations and constants, so
removing its unrelated Art and playback exports removes no I/O initialization.

The unchanged games schedule and RetroArch configuration-alias policy now belongs
to Arcade. Installed content composition still supplies the same object to the
neutral query router. Media owns its Plex content-filter router and household
profile/override repository, alongside the filter use case and port scheduled in
the remaining ownership batch. RetroArch's catalog provider adapters remain with
the catalog capability: their configuration, catalog reads/writes, HTTP transport
and thumbnail operations are supplied by installed composition.

The [correction manifest](2026-10-09-content-public-owner-corrections.json) records
three ownership corrections and three retired forwarding modules. Static checks
preserve 19 source/test bodies apart from import and mock-target literals and
resolve 166 relative imports. Runtime verification of this final correction is
pending; earlier content API results do not certify these later edits.
