# Full-Stack Application Modules

> A roadmap for making Daylight Station extensible at the application level,
> without weakening its existing domain and adapter boundaries.

**Status:** Proposed architecture and migration roadmap — no implementation implied | **Last updated:** 2026-08-31

**Related:** [Backend Architecture](../reference/core/backend-architecture.md),
[Application Layer Guidelines](../reference/core/layers-of-abstraction/application-layer-guidelines.md),
[Domain Layer Guidelines](../reference/core/layers-of-abstraction/domain-layer-guidelines.md)

**Reading map:** Sections 1–3 state the decision and vocabulary. Sections 4–10
define the target model and exercise it against Music, Kitchen, adapters, and
satellites. Section 11 is the normative architecture and enforcement contract.
Sections 12–17 cover migration, acceptance, risks, and questions that the pilot
must resolve.

---

## 1. Problem statement

Daylight Station is already extensible at the integration boundary. A provider
such as Plex implements media capabilities behind an abstraction, and another
provider such as Jellyfin or Emby should be able to implement the same ports
without changing the application layer.

It is not yet similarly extensible at the application boundary.

A Daylight application is a vertical product slice. A hypothetical Lemonade
application could include:

- domain entities, policies, and value objects;
- application use cases and ports;
- persistence, payment, printer, or other adapters;
- API routers and handlers;
- jobs and event subscriptions;
- configuration, permissions, and health checks;
- frontend routes, screens, widgets, and navigation entries;
- migrations, fixtures, and tests.

An application is not necessarily one route, screen, kiosk, or device. It is a
cohesive product domain that may expose several independently addressable
**surfaces**. Music, for example, may be one application module with Piano,
Singer, Drummer, Conductor, Karaoke, and Sheet Music surfaces. Those surfaces
can share exercise assessment, repertoire, MIDI recording, sheet-music
rendering, and Karaoke services without turning each service into a global
platform abstraction.

The current source tree organizes these concerns first by architectural layer.
That preserves dependency direction, but spreads ownership of one application
across much of the repository:

```text
backend/src/1_adapters/.../school
backend/src/2_domains/school
backend/src/3_applications/school
backend/src/4_api/v1/routers/school.mjs
backend/src/5_composition/modules/school*.mjs
frontend/src/modules/School/...
```

Adding an application can therefore require coordinated edits to bootstrap,
router mounting, jobs, configuration allowlists, the frontend app registry,
navigation, permissions, and content discovery. This is cross-cutting
integration rather than an independently owned module.

The architectural goal is not to stop applications from spanning layers. They
necessarily do. The goal is to make the complete vertical slice independently
owned, removable, testable, and connected to the platform through one declared
contract.

---

## 2. Decision summary

Daylight Station should evolve toward a **modular monolith** with two kinds of
extension:

1. **Capability provider adapters** implement a public cross-application
   contract, such as a media provider, payment provider, printer, or presence
   source.
2. **Application modules** deliver a complete user-facing capability across the
   server and web client, such as School, Fitness, Gratitude, or Lemonade.

Application modules should be physically organized as vertical slices. Each
slice may retain domain, application, adapter, API, and composition layers
inside itself.

An application module may expose multiple surfaces for different devices,
audiences, and workflows. The server-side module is composed once; its surfaces
reuse the module's internal services and presentation code. A dedicated device
or substantially different interface does not, by itself, require another
application module.

Satellites do not introduce a third kind of product extension. They describe
where some application- or capability-owned code runs: in an independently
built and deployed firmware, device application, host agent, or companion
service outside the primary server/web artifact.

This is a change from:

```text
architectural layer -> application concern
```

to:

```text
application module -> architectural layer
```

The layers of abstraction remain. Their ownership boundary moves.

The first-class model stays deliberately small:

```text
Platform            loads and composes the system
Application module  owns a cohesive product domain
Surface             presents that application for a device or workflow
Capability          provides a narrow cross-application runtime contract
```

There is no separate first-class "feature module" category. Cohesive areas such
as Music exercises, Karaoke, sheet music, and MIDI recording are internal parts
of the Music application until independent lifecycle and ownership prove that a
different boundary is needed.

This should be an incremental extraction, not a repository-wide directory
rewrite. The module contract must be proven by extracting one small existing
application before it becomes the required shape for large applications.

The migration must also preserve architecture mechanically, not only in prose.
Before module-local layers become a normal source layout, the existing
AST-based import and infrastructure audits must classify those paths, enforce
the same dependency direction, and fail when production code falls outside the
known architecture. A module extraction is not complete merely because it
runs; it is complete when the architecture gates understand and protect it.

---

## 3. Terminology

The word "application" currently has two meanings and must be qualified in
architecture discussions.

| Term | Meaning |
|---|---|
| **Application layer** | Clean Architecture use cases, orchestration, and ports; currently `backend/src/3_applications/` |
| **Application module** | An installable full-stack Daylight product domain, such as Music, School, Fitness, or Gratitude |
| **Adapter** | A concrete provider implementing a port or capability |
| **Capability** | A provider-neutral runtime function that applications may declare, consume, or expose |
| **Integration** | A concrete reusable provider implementation of a public capability, potentially including both server and satellite code |
| **Library** | Reusable code with no runtime enablement, provider resolution, or lifecycle |
| **Satellite** | An independently built and deployed runtime target owned by an application, integration, or rarely the platform |
| **Satellite instance** | One privately provisioned installation of a satellite artifact in a household or system environment |
| **Surface** | A named route, kiosk, embedded view, widget, or other presentation exposed by an application module |
| **Platform** | Shared contracts, runtime, module loader, shell, configuration, security, observability, and composition machinery |

An application module contains an application layer; it is not synonymous with
that layer.

---

## 4. Target repository shape

The intended long-term shape is a platform, shared capabilities and libraries,
and self-contained application modules:

```text
DaylightStation/
├── backend/
│   └── src/
│       └── platform/
│           ├── api/
│           ├── application/
│           ├── composition/
│           ├── config/
│           ├── modules/
│           ├── observability/
│           └── runtime/
│
├── frontend/
│   └── src/
│       └── platform/
│           ├── module-loader/
│           ├── routing/
│           ├── screen-framework/
│           └── shell/
│
├── capabilities/
│   ├── playback/
│   ├── content-catalog/
│   ├── print-output/
│   ├── device-dispatch/
│   ├── satellite-management/
│   └── ...
│
├── integrations/
│   ├── print-output/
│   │   ├── ipp-laser/
│   │   └── escpos/
│   ├── device-dispatch/
│   │   ├── fully-kiosk/
│   │   └── home-assistant/
│   └── content-catalog/
│       ├── plex/
│       └── jellyfin/
│
├── libraries/
│   ├── ui/
│   ├── music-notation/
│   ├── embedded/
│   │   ├── esp32-core/
│   │   └── esp32-eink/
│   └── ...
│
├── tooling/
│   ├── architecture/
│   │   ├── policy.mjs
│   │   ├── classify-source.mjs
│   │   ├── fixtures/
│   │   └── waivers.yml
│   └── satellites/
│       ├── templates/
│       ├── manifest-validator/
│       └── build-cli/
│
├── shared/
│   ├── contracts/
│   ├── module-sdk/
│   └── kernel/
│
├── modules/
│   ├── gratitude/
│   ├── school/
│   ├── fitness/
│   ├── music/
│   ├── media/
│   └── ...
│
└── _satellites/                   # Independent or transitional products only
    ├── document-processor/
    └── ...
```

This tree is directional, not a requirement to rename the existing platform
folders immediately. During migration, the current numbered backend layers and
new vertical modules will coexist.

`integrations/` contains concrete, server-side implementations of public
capability contracts. A capability owns provider-neutral vocabulary and runtime
behavior; an integration owns vendor, protocol, SDK, and transport details.
Applications request `print-output` or `device-dispatch`, never `ipp-laser` or
`fully-kiosk` directly.

Satellite source is ownership-first rather than collected by runtime type.
Application-specific satellites live under `modules/<app>/satellites/`;
satellites that form one half of a reusable provider live with that provider in
`integrations/<capability>/<provider>/satellite/`. A top-level `_satellites/`
is reserved for genuinely independent or multi-capability products and for
transitional code whose owner has not yet been established.

`_satellites/` is the intended successor name for whatever remains in the
current `_extensions/` root after classification. "Satellite" does not mean
"can never run on a server-class host"; a standalone Docker service may be a
satellite. It means the artifact has an independent build and deployment
lifecycle and is not part of the primary Daylight server/web artifact. The
rename should be a separate mechanical migration of scripts, aliases, and
documentation rather than part of module extraction.

A satellite is a deployment target, not a DDD layer or adapter category. The
server-side adapter that communicates with it still belongs to the application,
capability integration, or platform contract it implements. Section 10 defines
the complete satellite model.

`shared/` is not a fourth kind of product ownership alongside platform,
capability, library, and application. It is a portability boundary for small,
dependency-light artifacts that genuinely have no server- or browser-specific
implementation. Prefer owner-local shared code such as
`capabilities/playback/shared/` or `modules/school/shared/`. The root `shared/`
should eventually shrink to universal platform contracts, the module SDK, and
kernel primitives rather than serve as a general reuse bucket.

### 4.1 Anatomy of an application module

```text
modules/lemonade/
├── daylight.module.mjs
├── package.json                    # Optional until modules become packages
│
├── shared/
│   ├── contracts.mjs
│   └── types.mjs
│
├── server/
│   ├── domain/
│   │   ├── entities/
│   │   ├── services/
│   │   └── value-objects/
│   ├── application/
│   │   ├── ports/
│   │   ├── services/
│   │   └── usecases/
│   ├── adapters/
│   │   ├── persistence/
│   │   └── hardware/
│   ├── api/
│   │   ├── handlers/
│   │   └── router.mjs
│   └── compose.mjs
│
├── web/
│   ├── components/
│   ├── surfaces/
│   ├── widgets/
│   ├── routes.mjs
│   └── entry.jsx
│
├── satellites/                    # Optional, independently deployed targets
│   └── <satellite-id>/
│       ├── daylight.satellite.yml
│       ├── README.md
│       └── <ecosystem-native project>/
│
├── config/
│   ├── schema.mjs
│   └── example.yml
│
├── migrations/
└── tests/
    ├── unit/
    ├── contract/
    └── live/
```

Not every module needs every directory. A simple module should remain simple.
The structure shows where a concern belongs when it exists; it must not become
boilerplate required for its own sake.

The application boundary should be drawn around a cohesive product domain, not
around each URL. A module may expose one surface or many.

### 4.2 Layers still apply inside a module

The dependency direction remains:

```text
server/compose ─┬─> server/api
                ├─> server/application ───────> server/domain
                └─> server/adapters ─────────> application ports
                                               and domain contracts

server/api ───────> injected public application operations/contracts
```

More precisely:

- `domain/` contains pure business rules and does not import API, adapters, or
  composition.
- `application/` coordinates domain behavior and defines the ports it needs.
- `adapters/` implement application ports and contain provider or persistence
  details.
- `api/` translates transport input and output; it does not become the business
  logic layer or deep-import concrete application workflows. Composition
  supplies the application operations it invokes.
- `compose.mjs` is the module's sanctioned cross-layer assembly point.
- `web/` communicates through public contracts and APIs, not imports from
  server implementation code.

Existing layer enforcement should be extended to understand these module-local
paths before vertical modules become the default. Section 11 defines the
executable architecture contract and migration gate.

### 4.3 Example: Music as one multi-surface application

Music illustrates why surface identity and application identity must remain
separate:

```text
modules/music/
├── daylight.module.mjs
├── shared/
│   └── contracts/
├── server/
│   ├── domain/
│   │   ├── notation/
│   │   ├── performance/
│   │   ├── recording/
│   │   └── repertoire/
│   ├── application/
│   │   ├── exercises/
│   │   ├── karaoke/
│   │   ├── midi-recording/
│   │   └── sheet-music/
│   ├── adapters/
│   ├── rendering/
│   ├── api/
│   └── compose.mjs
└── web/
    ├── components/
    ├── exercises/
    ├── karaoke/
    ├── midi-recording/
    ├── notation/
    ├── sheet-music/
    └── surfaces/
        ├── PianoKiosk/
        ├── SingerKiosk/
        ├── DrummerKiosk/
        ├── ConductorKiosk/
        ├── KaraokeKiosk/
        └── SheetMusicApp/
```

The internal `exercises`, `karaoke`, `midi-recording`, and `sheet-music` areas
do not receive platform manifests, enablement state, or independent lifecycle.
They are ordinary, well-owned internal modules composed once by Music.

This keeps the distinctions concrete:

| Concern | Owner |
|---|---|
| What a score, performance, take, or assessment means | Music domain layer |
| Run an exercise, record MIDI, or print sheet music | Music application layer |
| Receive MIDI events or submit a rendered artifact to a printer | Cross-application capability and its provider adapter |
| Arrange Music for piano, voice, drums, conducting, or Karaoke | Surface |

Reuse across several Music surfaces does not make code globally shared. Code
leaves the Music boundary only when another application has a real need for a
stable public library or capability contract.

### 4.4 Example: Kitchen as a provider-backed multi-surface application

Kitchen is a useful greenfield test of the same model from the opposite
direction. Music demonstrates deep reuse inside one application; Kitchen adds
provider variation, household-scoped configuration, responsive and dedicated
device surfaces, reusable playback, and physical output.

Kitchen remains one application module:

```text
modules/kitchen/
├── daylight.module.mjs
├── shared/
│   └── contracts/
├── server/
│   ├── domain/
│   │   ├── recipes/
│   │   ├── meal-planning/
│   │   └── shopping/
│   ├── application/
│   │   ├── ports/
│   │   ├── recipes/
│   │   ├── meal-planning/
│   │   ├── shopping/
│   │   └── cooking/
│   ├── adapters/
│   │   ├── providers/
│   │   │   ├── tandoor/
│   │   │   └── mealie/
│   │   └── presentation-overlays/
│   ├── rendering/
│   │   └── recipe-pdf/
│   ├── api/
│   └── compose.mjs
├── web/
│   ├── components/
│   ├── cooking/
│   ├── meal-planning/
│   ├── recipes/
│   ├── shopping/
│   └── surfaces/
│       ├── KitchenKiosk/
│       ├── MealPlanner/
│       └── ShoppingList/
├── config/
└── tests/
    ├── contract/
    ├── integration/
    └── live/
```

The three surfaces are different presentations of the same household food
workflow, not independent applications:

| Surface | Route | Primary environment | Responsibility |
|---|---|---|---|
| `kitchen:kitchen-kiosk` | `/kitchen` | Dedicated Fully Kiosk Browser tablet | Today's meals, recipe step mode, serving scale, timers, video, and print actions |
| `kitchen:meal-planner` | `/kitchen/plan` | Desktop or large browser | Search recipes and schedule meals on a week-oriented calendar |
| `kitchen:shopping-list` | `/kitchen/shop` | Mobile browser or installed PWA | Use the active provider-backed shopping list while in a store |

Recipe browse, ingredient display, serving controls, plan-entry editors, and
shopping-item controls are Kitchen-owned internal web code. They may be reused
by all three surfaces without becoming global features, capabilities, or
registry entries.

#### 4.4.1 Domain boundary

Kitchen owns the meaning and workflows of household meal preparation:

- a `Recipe` has an opaque identity, yield, ingredient groups, ordered steps,
  timing, tags, optional nutritional facts, and optional playback references;
- an `Ingredient` has a food description, optional quantity and unit, optional
  preparation note, and group membership;
- a `MealPlanEntry` assigns either a recipe or a free-text note such as
  leftovers or takeout to a household-local date and meal slot;
- a `ShoppingList` owns ordered `ShoppingItem` entries, completion state, and
  optional provider-supplied category, store, or aisle information;
- serving scaling and quantity calculations are domain behavior, independent
  of how a provider serializes fractions, units, or yields;
- a `PlaybackReference` names content through the public content/playback
  contract rather than embedding Player component props in the domain.

Provider-specific response objects, field names, pagination, category models,
and authentication never enter these types. Optional provider data that has no
provider-neutral Kitchen meaning remains private to the adapter rather than
appearing as a generic `metadata` escape hatch in every API response.

Kitchen and Nutrition are separate bounded contexts. Provider nutrition facts
may be displayed as part of a recipe, but planning, opening, or cooking a recipe
does not prove that a person consumed it and must not create a `NutriLog` entry.
A future integration may publish an explicit meal-served or meal-consumed event
with household and person attribution; it must not share repositories or treat
a plan entry as consumption evidence.

#### 4.4.2 Data authority and provider selection

Tandoor or Mealie is authoritative for recipes, meal plans, and shopping lists.
Daylight does not silently mirror those aggregates into a second writable store.
Every provider-backed write completes against the configured provider and then
returns a freshly normalized authoritative result.

One provider is active per household. A representative configuration is:

```yaml
applications:
  kitchen:
    enabled: true
    provider:
      type: mealie
      connection: household-mealie
    surfaces:
      kitchen-kiosk: true
      meal-planner: true
      shopping-list: true
```

`connection` is a reference resolved through platform configuration and secret
services. Provider endpoints, API tokens, and credentials are never returned to
the browser or module catalog. If Daylight hosts several households, provider
resolution is household-scoped; a process-wide singleton must not make every
household use the default household's provider.

Daylight may persist Kitchen-specific presentation overlays that the external
provider does not own, such as a mapping from a recipe to a Daylight content ID,
kiosk display preferences, or a preferred print theme. An overlay is keyed by
household, provider connection, and external recipe identity. It may decorate a
recipe but may not replace provider-owned ingredients, steps, plan entries, or
shopping state.

Provider changes are explicit boundaries. Switching a household from Tandoor
to Mealie does not merge identities, migrate data, or reattach overlays by title.
Old namespaced overlays may remain dormant for a later switch back, but automatic
cross-provider migration is a separate import/export project.

#### 4.4.3 Provider ports and honest capability differences

The external systems have overlapping product concepts, not guaranteed API
parity. Tandoor documents recipe-derived and meal-plan-derived shopping
workflows, while Mealie documents household meal plans, shopping lists, API
tokens, and installation-specific OpenAPI documentation. Those promises and
APIs evolve independently:

- [Tandoor shopping lists](https://docs.tandoor.dev/features/shopping/)
- [Tandoor connectors](https://docs.tandoor.dev/features/connectors/)
- [Mealie features](https://docs.mealie.io/documentation/getting-started/features/)
- [Mealie API usage](https://docs.mealie.io/documentation/getting-started/api-usage/)

Kitchen therefore must not define one enormous `IKitchenProvider` whose methods
are present but throw unpredictably. The application layer owns smaller ports,
such as:

- `IRecipeCatalog` for list, search, and get;
- `IRecipeCommands` for provider-supported create, edit, and import operations;
- `IMealPlanGateway` for range reads and supported entry mutations;
- `IShoppingListGateway` for list reads and supported item/list mutations;
- `IProviderEvents` for optional change subscriptions;
- `IRecipePresentationOverlayStore` for Daylight-owned decorations only.

Each configured adapter reports an operation-level support matrix. A broad
claim such as `shopping: true` is insufficient because a provider may allow
checking an item but not generating a list from an entire plan through its API.
The normalized shape is illustrative but the granularity is required:

```javascript
{
  recipes: {
    list: true,
    get: true,
    search: true,
    create: false,
    update: false,
    importUrl: false,
  },
  mealPlan: {
    list: true,
    createRecipeEntry: true,
    createNoteEntry: false,
    update: true,
    delete: true,
  },
  shopping: {
    list: true,
    create: true,
    addItem: true,
    updateItem: true,
    toggleItem: true,
    addRecipe: false,
    addMealPlan: false,
  },
  events: {
    subscribe: false,
  },
}
```

The operation matrix describes what the running adapter and configured provider
version can actually do. It is discovered or validated at composition/health
time, included in Kitchen's permission-filtered bootstrap response, and used by
all surfaces. It is not a new platform `CapabilityRegistry`: these operations
are private details of Kitchen's anti-corruption layer.

Both Tandoor and Mealie adapters are part of the first provider milestone and
must run the same contract suite. This validates the abstraction before it
hardens around one provider. It does not mean both are active in one household,
that Kitchen computes a lowest-common-denominator model, or that the adapters
claim unsupported operations merely to pass the suite. Contract tests assert
correct normalization and correct support reporting.

#### 4.4.4 Module and surface contract

Kitchen requires household identity and treats playback, device dispatch, and
physical printing as optional platform capabilities:

```javascript
export default defineApplicationModule({
  id: 'kitchen',
  version: 1,
  maturity: 'incubating',
  defaultEnabled: false,

  requires: {
    capabilities: ['household-identity'],
  },

  optional: {
    capabilities: [
      'content-catalog',
      'content-playback',
      'device-dispatch',
      'print-output',
    ],
  },

  config: {
    scope: 'household',
    key: 'kitchen',
    schema: './config/schema.mjs',
  },

  server: {
    entry: './server/compose.mjs',
  },

  surfaces: [
    {
      id: 'kitchen-kiosk',
      route: '/kitchen',
      entry: './web/surfaces/KitchenKiosk/index.jsx',
      optional: ['content-playback', 'print-output'],
    },
    {
      id: 'meal-planner',
      route: '/kitchen/plan',
      entry: './web/surfaces/MealPlanner/index.jsx',
    },
    {
      id: 'shopping-list',
      route: '/kitchen/shop',
      entry: './web/surfaces/ShoppingList/index.jsx',
    },
  ],
});
```

Platform capability availability and provider operation availability answer
different questions. Missing `content-playback` hides video actions but does not
disable cooking instructions. Missing `print-output` leaves PDF preview and
download available. By contrast, missing `mealPlan.list` makes the planner
surface unavailable, while missing only meal-plan write operations makes it
read-only. These application-specific states are projected by Kitchen; they do
not require Tandoor or Mealie to become platform capabilities.

Initial permissions should distinguish `kitchen.view`, `kitchen.plan`,
`kitchen.shop`, `kitchen.print`, and `kitchen.configure`. A household kiosk may
be permitted to view and cook without receiving provider configuration or
planning authority.

#### 4.4.5 Provider-neutral API

The browser talks only to Daylight. It never calls Tandoor or Mealie directly.
The initial API families are:

```text
GET    /api/v1/kitchen/bootstrap
GET    /api/v1/kitchen/recipes
GET    /api/v1/kitchen/recipes/:recipeId
PATCH  /api/v1/kitchen/recipes/:recipeId/presentation

GET    /api/v1/kitchen/meal-plan?from=YYYY-MM-DD&to=YYYY-MM-DD
POST   /api/v1/kitchen/meal-plan/entries
PATCH  /api/v1/kitchen/meal-plan/entries/:entryId
DELETE /api/v1/kitchen/meal-plan/entries/:entryId

GET    /api/v1/kitchen/shopping-lists
POST   /api/v1/kitchen/shopping-lists
GET    /api/v1/kitchen/shopping-lists/:listId
POST   /api/v1/kitchen/shopping-lists/:listId/items
PATCH  /api/v1/kitchen/shopping-lists/:listId/items/:itemId

GET    /api/v1/kitchen/recipes/:recipeId/print.pdf
POST   /api/v1/kitchen/recipes/:recipeId/print
```

`bootstrap` returns non-secret provider status, supported operations, available
surfaces and actions, today's plan, and any small summaries needed to render a
surface shell. The resource endpoints return normalized Kitchen contracts with
opaque IDs. Provider pagination cursors may be translated to an opaque Daylight
cursor but must not leak a vendor response body.

A mutation follows one path:

```text
HTTP request
  -> household and permission context
  -> operation-availability check
  -> Kitchen command/use case
  -> configured provider port
  -> provider mutation
  -> authoritative provider re-read
  -> normalized response
```

Failure semantics are explicit:

- a recognized operation unsupported by the configured adapter returns `501`
  with `KITCHEN_OPERATION_UNAVAILABLE`, its facet, and operation;
- missing or invalid household provider configuration makes Kitchen unavailable
  and returns an actionable `503` health/configuration error;
- provider authentication, transport, or malformed-response failures become
  normalized upstream errors and do not expose tokens or vendor payloads;
- a known concurrent revision conflict returns `409`; where a provider exposes
  no revision primitive, Kitchen does not promise conflict detection it cannot
  enforce;
- provider downtime produces a visible retryable state. A response cache may
  improve reads, but it must be labeled stale and can never accept offline
  writes as though they reached the authority.

#### 4.4.6 Playback and the cooking companion

Recipe media is expressed as a `PlaybackReference`, initially centered on a
Daylight `contentId`. An adapter or application mapper may recognize a provider
video link and normalize it to a supported ID such as `youtube:<videoId>`.
Household presentation overlays may associate Plex, local, YouTube, or other
content-catalog IDs when the recipe provider cannot store that relationship.
An arbitrary external URL remains an external link unless the content
capability can resolve it; Kitchen does not bypass content policy by handing
unknown URLs directly to a media element.

The Kitchen web code imports Player through the public playback-capability entry
point envisioned in section 6.2, not through a deep import of
`frontend/src/modules/Player/Player.jsx`. Kitchen owns the companion layout
around it: ingredients, current step, serving count, timers, and navigation are
application state, not playback metadata.

The existing surround subsystem remains optional and additive. If a selected
content ID already has an authored surround, normal playback resolution may
decorate it. Kitchen does not define a recipe-specific surround or translate
live recipe state into `docs/reference/player/surround` sidecars. A future
cooking-oriented surround would need a reusable playback use case of its own;
the Kitchen companion shell is the correct first boundary.

#### 4.4.7 PDF and physical printing

Recipe printing has two separate concerns:

1. Kitchen builds a provider-neutral recipe presentation model and owns the
   recipe layout, serving-scaled ingredient text, pagination, and print theme.
2. The optional `print-output` capability accepts the completed PDF artifact and
   reports dispatch and verification outcome.

The renderer belongs to Kitchen because it decides how a recipe is presented.
Printer transport remains outside Kitchen. The existing laser-printer adapter
receives ready-made PDF bytes and owns IPP/raster negotiation; Kitchen must not
know the printer model, network address, raster format, or transport.

`GET .../print.pdf` therefore works as preview/download even when no printer is
configured. `POST .../print` is present only for a caller with `kitchen.print`
and a resolved `print-output` provider. A failed physical print never invalidates
the generated document or mutates the recipe.

#### 4.4.8 Device, calendar, and mobile behavior

The dedicated tablet is a Kitchen surface hosted by Fully Kiosk Browser, not a
Kitchen-specific FKB adapter. Existing device dispatch may wake the configured
display and load `/kitchen`; Kitchen's domain and provider ports do not know the
device brand.

The provider-backed meal plan is Kitchen's authoritative calendar. The desktop
planner renders that model directly. The current household calendar API is
read-only and must not be repurposed as a second meal-plan store. A later
one-way projection may publish planned meals through a real calendar-write
capability. Bidirectional calendar synchronization, identity matching, and
conflict resolution are out of scope.

The shopping surface is an installable, responsive, online-first PWA. Its
application shell and last successful read may be cached, but checking, adding,
or editing an item requires a confirmed provider response. Offline mutation
queues and reconnect reconciliation are a later milestone because they create
conflict semantics that neither a service worker nor optimistic UI can erase.

#### 4.4.9 Delivery roadmap

Kitchen is not the first module-SDK pilot. A small existing application should
first prove discovery, composition, surface registration, and enablement. Once
those platform contracts exist, Kitchen is the representative greenfield module
that validates them under provider and device variation.

**K0 — Module prerequisites**

- Complete the architecture enforcement, minimal manifest, module composition,
  household enablement, and frontend surface-discovery work from phases 1
  through 5 of this roadmap.
- Establish public entry points for household identity and playback; allow
  printing and device dispatch to remain optional.

**Exit condition:** a synthetic Kitchen manifest can compose, report unavailable
configuration, and publish three discoverable surfaces without platform-specific
Kitchen branches.

**K1 — Domain, contracts, and provider probes**

- Define normalized recipe, ingredient, plan-entry, shopping-item, and playback
  reference contracts.
- Implement pure serving-scale and date/meal-slot rules.
- Define the split provider ports, operation matrix, normalized errors, fake
  provider, and household-scoped provider resolver.
- Probe supported Tandoor and Mealie versions and record fixture responses for
  every claimed operation.

**Exit condition:** the fake provider drives API contract tests, and each real
provider has a documented, test-backed operation matrix.

**K2 — Both provider adapters and recipe reads**

- Implement Tandoor and Mealie anti-corruption adapters together.
- Support authenticated recipe list/search/get and the meal-plan operations
  needed for the first slice.
- Add opt-in live tests against disposable or dedicated provider instances,
  while keeping ordinary tests synthetic and deterministic.
- Publish provider health and operation availability through bootstrap.

**Exit condition:** both adapters pass the shared contract suite without false
capability claims, and either can drive the same recipe browser.

**K3 — First vertical slice: plan to cook**

- Schedule a recipe and serving count from the desktop planner.
- Read today's authoritative plan from the kitchen kiosk.
- Open the normalized recipe in touch-oriented step mode.
- Resolve an attached Daylight content ID and play it inside the Kitchen
  companion shell.
- Make unsupported plan mutations or absent playback visibly degrade.

**Exit condition:** the complete desktop-plan-to-kiosk-cooking workflow passes
against both Tandoor and Mealie configurations.

**K4 — Recipe documents and printing**

- Build the serving-aware print presentation model and Kitchen PDF renderer.
- Add preview/download with safe filenames and deterministic fixtures.
- Add permission-checked physical dispatch through `print-output` with explicit
  dispatch/verification reporting.

**Exit condition:** the same normalized recipe produces a valid PDF for both
providers, preview works without hardware, and printer failure is isolated from
recipe state.

**K5 — Mobile shopping**

- Add active-list selection, provider ordering/category display, item checking,
  manual items, and supported recipe/plan expansion operations.
- Make each control depend on the exact shopping operation matrix rather than a
  broad provider flag.
- Ship the responsive installable shell, bounded read caching, retry states, and
  accessibility for one-handed use.

**Exit condition:** the surface is useful online for both providers and makes no
claim that an unconfirmed offline mutation was saved.

**K6 — Hardening and optional extensions**

- Add permissions, structured provider health, rate-limit handling, stale-read
  labeling, observability, and provider-version compatibility policy.
- Test provider switching without identity or overlay leakage.
- Consider provider event subscriptions, offline shopping reconciliation,
  one-way household-calendar projection, explicit Nutrition events, and richer
  playback presentation only as separate follow-on decisions.

**Exit condition:** Kitchen can be enabled for a household, operated with either
provider, and partially degraded without hidden state, credential exposure, or
failure of unrelated Daylight applications.

#### 4.4.10 Kitchen acceptance cases

The Kitchen case study proves the architecture only when:

- one manifest installs one server composition and three independently visible
  surfaces;
- one household selects one provider, while Tandoor and Mealie both satisfy the
  shared tests and remain interchangeable at the application boundary;
- unsupported provider operations are absent or read-only in the UI and fail
  explicitly through the API;
- no provider DTO, token, endpoint, or vendor SDK appears in Kitchen domain,
  public contracts, browser code, or application use cases;
- planner writes are visible from the authoritative provider on the kiosk;
- the cooking surface remains useful without video or a printer;
- Player is consumed through its public capability contract and Kitchen state
  remains in the Kitchen companion shell;
- PDF preview remains available without physical print output;
- the mobile surface distinguishes cached reads from confirmed writes;
- provider switching does not merge IDs or attach old overlays by title;
- Nutrition receives no implicit consumption record from planning or cooking;
- all tests run against synthetic fixtures by default, with live provider tests
  explicitly opted in and isolated from private household data.

---

## 5. The application module contract

Every installed module has one manifest. The manifest is declarative metadata;
it must not construct services or import frontend code as a side effect.

An illustrative contract:

```javascript
export default defineApplicationModule({
  id: 'lemonade',
  version: 1,
  maturity: 'community',
  defaultEnabled: false,

  requires: {
    capabilities: ['identity'],
  },

  optional: {
    capabilities: ['payments', 'thermal-printing'],
  },

  provides: {
    capabilities: ['lemonade-operations'],
  },

  config: {
    scope: 'household',
    key: 'lemonade',
    schema: './config/schema.mjs',
  },

  server: {
    entry: './server/compose.mjs',
  },

  web: {
    entry: './web/entry.jsx',
  },
});
```

The exact API should be derived from a real extraction. The important property
is that the platform learns about the module through this declaration rather
than through edits scattered across core registries.

### 5.1 Server composition contract

The server entry receives platform services and resolved capabilities. It
returns only the integration points it owns:

```javascript
export async function composeModule(context) {
  const events = createLemonadeEventPublisher({
    platformEvents: context.events,
  });

  const services = createLemonadeServices({
    settings: context.config,
    identity: context.requireCapability('identity'),
    payments: context.optionalCapability('payments'),
    logger: context.logger,
    events,
  });

  return {
    routers: [
      { mount: '/api/v1/lemonade', router: createLemonadeRouter(services) },
    ],
    jobs: [],
    subscriptions: [],
    healthChecks: [],
    permissions: [],
    dispose: async () => {},
  };
}
```

Here `context.config` is the module's already resolved and schema-validated
configuration, not the platform configuration service or a deployment-path
lookup. `events` is a narrow module-owned application port implemented during
composition; application workflows do not receive a generic event bus.

The registry owns startup order, mounting, failure reporting, and shutdown. A
module owns its internal object graph.

### 5.2 Surface contract

A module manifest may publish several surfaces while retaining one server-side
composition and application lifecycle:

```javascript
export default defineApplicationModule({
  id: 'music',
  version: 1,

  requires: {
    capabilities: ['household-identity', 'content-catalog'],
  },

  optional: {
    capabilities: [
      'midi-io',
      'content-playback',
      'print-output',
      'audio-capture',
    ],
  },

  server: {
    entry: './server/compose.mjs',
  },

  surfaces: [
    {
      id: 'piano-kiosk',
      route: '/music/piano',
      entry: './web/surfaces/PianoKiosk/index.jsx',
      requires: ['midi-io'],
    },
    {
      id: 'singer-kiosk',
      route: '/music/singer',
      entry: './web/surfaces/SingerKiosk/index.jsx',
      optional: ['audio-capture'],
    },
    {
      id: 'conductor-kiosk',
      route: '/music/conductor',
      entry: './web/surfaces/ConductorKiosk/index.jsx',
    },
    {
      id: 'karaoke-kiosk',
      route: '/music/karaoke',
      entry: './web/surfaces/KaraokeKiosk/index.jsx',
      requires: ['content-playback'],
    },
  ],
});
```

Application-level requirements determine whether the module can compose.
Surface-level requirements determine whether a particular presentation is
available. A missing MIDI provider can make Piano Kiosk unavailable without
disabling Sheet Music or Karaoke.

A surface descriptor may eventually include device roles, permission keys,
embedding support, navigation metadata, and configuration schema references.
Those fields should be added from real consumers rather than anticipated in the
initial contract.

### 5.3 Registry responsibilities

An `ApplicationModuleRegistry` should:

1. discover installed manifests;
2. validate manifest schema and unique IDs;
3. read household enablement;
4. resolve required and optional capabilities through existing registries;
5. reject missing required dependencies with an actionable status;
6. order module startup when dependencies require it;
7. compose enabled and available server modules;
8. mount routers and register jobs, subscriptions, permissions, and health
   checks;
9. dispose modules during shutdown or reload;
10. evaluate surface-level requirements and visibility;
11. publish the resulting module and surface catalog to the frontend and admin
    surfaces.

The registry is composition infrastructure. It should live in the platform's
composition layer, not in a domain or application module.

### 5.4 Separate registries, separate questions

One registry should not become a generic bag of every extension type.

| Registry | Question answered |
|---|---|
| `CapabilityRegistry` | Which capability contracts and resolved runtime implementations are available? |
| `AdapterRegistry` | Which providers can implement this capability? |
| `ApplicationModuleRegistry` | Which full-stack modules are installed, enabled, and available? |
| `SurfaceRegistry` | Which routes, screens, and launch targets can this client render? |
| Widget registry | Which widget types can a configured screen instantiate? |

The application module manifest may feed projections into the surface and
widget registries, but those registries still have distinct responsibilities.

---

## 6. Capabilities as a first-class concept

A capability is the provider-neutral seam through which application modules
reuse behavior or collaborate. It is not permission for shared code to reach
arbitrarily into every application.

The core relationship is:

```text
application module
       │ requires
       ▼
capability contract
       ▲ implemented by
       │
provider or adapter
```

For example:

```text
School ───┐
Media ────┼──> content-playback <── web player / cast target
Fitness ──┘              ▲
                         └────────── content-provider adapters
```

This adds a third architectural axis alongside layers and module ownership:

| Axis | Question |
|---|---|
| **Layer** | What kind of code is this? |
| **Module** | Who owns this code? |
| **Capability** | Through which supported public function may another module use it? |

A capability is first-class when it has:

- a stable identifier and provider-neutral public contract;
- a documented lifecycle and scope;
- declared required or optional consumption;
- one or more implementations, when provider choice is meaningful;
- availability and health reporting;
- contract tests shared by its implementations;
- an explicit owner and compatibility policy.

The current `AdapterRegistry` already uses capability/provider terminology. The
new model extends that idea beyond adapter discovery: application composition
can require resolved capabilities, and an application may deliberately expose
a capability of its own. A separate class is not mandatory on day one, but the
contract, provider, and consumer must remain conceptually distinct.

### 6.1 Declaring and resolving capabilities

An application declares its dependencies rather than reaching into platform or
another module's private files:

```javascript
export default defineApplicationModule({
  id: 'school',

  requires: {
    capabilities: {
      'household-identity': '^1',
      'content-playback': '^2',
    },
  },

  optional: {
    capabilities: {
      'thermal-printing': '^1',
      'device-dispatch': '^1',
    },
  },
});
```

The exact version syntax is deferred until the pilot establishes a real
compatibility need. Composition resolves only declared capabilities:

```javascript
export async function composeModule(context) {
  const identity = context.requireCapability('household-identity');
  const playback = context.requireCapability('content-playback');
  const printer = context.optionalCapability('thermal-printing');

  return createSchoolModule({ identity, playback, printer });
}
```

The context must not become an untyped service locator. Apart from a very small
universal platform context, a module can resolve only the capabilities declared
by its manifest.

### 6.2 Capabilities may be full-stack

A capability can contain server and frontend implementations without becoming
a launchable application:

```text
capabilities/playback/
├── daylight.capability.mjs
├── shared/
│   └── contracts.mjs
├── server/
│   ├── application/
│   ├── adapters/
│   ├── api/
│   └── compose.mjs
├── web/
│   ├── Player.jsx
│   ├── hooks/
│   └── index.js
└── tests/
    └── contract/
```

`Player.jsx` is not itself the capability contract. It is a reusable web
implementation associated with content playback. Media can own its queue and
now-playing experience, while School and Fitness use the same public player:

```javascript
import { Player } from '@daylight/capabilities/playback/web';
```

Applications import only a capability's public entry point. Deep imports into
its implementation are prohibited.

### 6.3 Applications may provide capabilities

An application module may expose a narrow, deliberately supported portion of
its behavior:

```javascript
export default defineApplicationModule({
  id: 'school',

  provides: {
    capabilities: {
      'learning-records': '^1',
      assessment: '^1',
    },
  },
});
```

Fitness could then submit anatomy-course evidence through `learning-records`
without importing School repositories, services, or persistence formats.

Application-provided capabilities introduce startup ordering. The registry
must validate the dependency graph, reject cycles with actionable errors, and
compose providers before required consumers. Events remain preferable when the
interaction does not require a synchronous response.

### 6.4 Initial Daylight capability catalog

The first catalog should formalize seams that already have multiple real or
near-term consumers.

| Capability | Contract boundary | Likely consumers or providers |
|---|---|---|
| `household-identity` | Members, profiles, roles, and household membership | All applications; current household configuration |
| `content-catalog` | Search, browse, and resolve content IDs | Media, School, Fitness, Piano; Plex, Jellyfin, Komga, Audiobookshelf, filesystem |
| `content-playback` | Playback, transport, format handling, and progress signals | Media, School, Fitness, Piano; web player and cast targets |
| `device-dispatch` | Wake a device and send it content or an action | Media, School, Fitness, DoNow; Fully Kiosk, WebSocket, Home Assistant, ADB, SSH |
| `document-rendering` | Convert structured documents into PDF, PNG, or receipt artifacts | School, Fitness, Gratitude, future commerce applications |
| `print-output` | Submit an artifact to a printer and report its outcome | School, Fitness, Gratitude; ESC/POS, CUPS, network printers |
| `scan-ingress` | Normalize physical scan events and their source metadata | School, Nutrition, inventory, commerce; barcode, QR, or NFC readers |
| `notifications` | Deliver messages and actionable notifications | School, Fitness, Health, Journalist; Telegram, email, browser notifications |
| `speech-synthesis` | Convert text into playable speech | School, Fitness, Journalist; hosted or local TTS providers |
| `speech-transcription` | Convert recorded audio into text | Journalist, Weekly Review, Fitness, School; hosted or local transcription |
| `ai-completion` | Provider-neutral text or structured generation | Journalist, School, Health, Nutrition; OpenAI, Anthropic, Ollama |
| `household-economy` | Query balances and issue or reverse idempotent rewards | School, Fitness, chores, commerce |
| `state-gates` | Determine whether an action is currently allowed | School, Fitness, media, and device access |
| `presence-location` | Household presence and location observations | Automation, safety, fitness, and journaling |

Physical inputs should use semantically meaningful contracts rather than one
universal `sensor` interface:

| Candidate capability | Contract boundary |
|---|---|
| `heart-rate-stream` | Normalized heart-rate observations |
| `fitness-machine-stream` | Cadence, power, speed, and resistance telemetry |
| `weight-measurement` | Normalized scale measurements |
| `midi-io` | Normalized MIDI input and output events |
| `camera-capture` | Capture an image or provide a camera stream |
| `audio-capture` | Record or stream microphone input |
| `display-control` | Wake, sleep, reload, or navigate a display |
| `lighting-control` | Apply scenes, colors, or effects |
| `environment-sensing` | Temperature, motion, occupancy, or air-quality observations |

These physical capabilities should be promoted only as applications need them.
MIDI, heart rate, and barcode input have sufficiently different semantics that
a generic event-shaped sensor contract would hide more than it abstracts.

### 6.5 Capabilities versus `shared/`, platform, and libraries

Not everything shared belongs in the capability catalog.

`shared/` describes where portable code can be imported; `capability` describes
how runtime behavior is offered and resolved. They answer different questions:

| Concept | Question answered |
|---|---|
| `shared/` code | Can this artifact be imported by more than one runtime or owner without environment-specific dependencies? |
| Capability | What supported runtime behavior may an application require or provide? |

A capability commonly publishes shared contracts, but those contracts are not
the capability's implementation:

```text
capabilities/playback/
├── shared/       # command and event shapes safe for server and web
├── server/       # resolution, orchestration, and provider composition
└── web/          # Player and playback hooks
```

The current root `shared/` contains several different architectural species.
They should be classified by ownership as migration reaches them:

- `shared/contracts/media/` resembles public contracts owned by content and
  playback capabilities;
- `shared/music/` resembles a pure music-domain library unless a portion gains
  runtime provider or lifecycle semantics;
- `shared/presentation/` resembles a reusable presentation library;
- `shared/gaming/` contains enough domain and runtime behavior that it needs an
  explicit library-versus-capability decision rather than being classified by
  its current directory name.

Moving code out of root `shared/` is not itself the goal. The goal is for every
shared artifact to have an explicit owner and public entry point.

Universal machinery remains platform infrastructure:

- structured logging and error handling;
- configuration and secrets resolution;
- module discovery and composition;
- HTTP routing and authentication enforcement;
- event transport and job scheduling machinery;
- health aggregation and observability.

The distinction is semantic. "Run this function every night" uses platform job
scheduling; "read household calendar events" may be a `calendar` capability.

Reusable code with no runtime availability, provider selection, permissions, or
lifecycle remains a library:

- music notation rendering;
- UI controls and layouts;
- date, time, and unit formatting;
- charting and visualization primitives;
- schema, math, and image utilities.

Music notation becomes a capability only if it acquires runtime behavior such
as provider-backed generation, MIDI evaluation, persistence, configuration, or
a server API. A React staff renderer alone belongs in
`libraries/music-notation/`.

Finally, reuse should be proven rather than predicted. Media queues, generic
progress, inventory, recommendations, and reporting may eventually become
capabilities, but their application semantics currently differ. Behavior stays
private until there is a real second consumer and a coherent provider-neutral
contract.

### 6.6 Capability guardrails

1. Capability names describe provider-neutral behavior, never a vendor.
2. Contracts contain domain language and normalized values, not provider
   response objects.
3. Required capabilities fail composition explicitly when unavailable.
4. Optional capabilities produce documented degraded behavior.
5. Applications do not select providers unless provider choice is itself part
   of the application's policy; household/platform composition normally does.
6. Capability implementations pass the same contract suite.
7. Cross-module capability calls respect identity, permissions, idempotency,
   and observability at the boundary.
8. A capability does not become a dumping ground for code merely because two
   folders import it.

---

## 7. Installed, enabled, available, and visible

An application does not have one Boolean state.

| State | Meaning |
|---|---|
| **Installed** | Its code and manifest are included in this build |
| **Enabled** | Household configuration selects it for use |
| **Available** | Its required capabilities and valid configuration are present |
| **Surface enabled** | Household configuration selects a particular presentation |
| **Surface available** | That surface's narrower capability requirements are present |
| **Visible** | The current user and device are permitted to see the surface |

This distinction allows the same build to support different households without
pretending a missing integration is an authorization problem.

Household selection could begin with:

```yaml
applications:
  gratitude:
    enabled: true

  fitness:
    enabled: false

  lemonade:
    enabled: true

  music:
    enabled: true
    surfaces:
      piano-kiosk:
        enabled: true
      singer-kiosk:
        enabled: false
      karaoke-kiosk:
        enabled: true
        device_roles:
          - living-room
```

Module-specific values remain in the module's normal household configuration.
The enablement catalog should not grow into a second copy of every module's
configuration.

An admin endpoint such as `GET /api/v1/modules` should return a filtered
catalog containing state, reason codes, permitted surfaces, and non-secret
metadata. It must never expose credentials or raw private configuration.

The catalog must report module and surface state separately. For example:

```json
{
  "id": "music",
  "enabled": true,
  "available": true,
  "surfaces": [
    {
      "id": "piano-kiosk",
      "available": false,
      "reason": "missing-capability",
      "missing": ["midi-io"]
    },
    {
      "id": "sheet-music",
      "available": true
    }
  ]
}
```

This allows one build and one Music server composition to serve different
households and devices without treating absent hardware as total application
failure.

---

## 8. Frontend loading model

The web client cannot safely import an arbitrary JSX path named in runtime YAML.
Vite must know the possible modules when it builds the bundle.

The first implementation should therefore separate:

- **installation at build time**; and
- **enablement and visibility at runtime**.

A build step or Vite-supported discovery mechanism should create an import map
for installed surface entries. At runtime, the client intersects that import
map with the catalog returned by the server:

```text
build-installed surface entries
        ∩
server-enabled modules and available surfaces
        ∩
current user/device permissions
        =
renderable surfaces
```

The resulting surface metadata can drive routes, navigation, app content IDs,
admin configuration links, and kiosk launch targets. Existing registries should
be adapted to consume this catalog rather than duplicated module lists.

Surface IDs are namespaced by their owning module, such as
`music:piano-kiosk` and `music:karaoke-kiosk`. Another application should reuse
Music through a supported boundary rather than import its private files:

1. launch a Music surface on a device;
2. embed a surface that explicitly supports embedding; or
3. consume a capability deliberately exposed by Music.

For example, School could dispatch `music:karaoke-kiosk`, embed a supported
`music:sheet-music` surface, or consume a `music-assessment` capability. It
must not import Music repositories, use cases, or private React components.

An eventual `SurfaceHost` can make supported embedding explicit:

```jsx
<SurfaceHost
  surfaceId="music:sheet-music"
  params={{ scoreId, mode: 'study' }}
/>
```

Embedding is part of a surface's public contract, not a loophole for arbitrary
cross-module component imports.

Downloading and executing third-party modules at runtime is explicitly out of
scope for the first implementation. Application modules are trusted server and
client code and should require a rebuild and normal deployment review.

---

## 9. Adapter ownership and placement

"Adapter" is the broad DDD role: an outer implementation translates between a
port and a concrete technology. Adapters are categorically different in
architectural ownership and lifecycle even though they use the same underlying
pattern. The deciding question is:

> Who owns the port this adapter implements?

| Category | Port owner | Visibility | Composition owner | Target location |
|---|---|---|---|---|
| Application-private adapter | One application module | Private | The module's `compose.mjs` | `modules/<app>/server/adapters/` |
| Capability provider adapter | A versioned cross-application capability | Public provider implementation | Capability/provider composition | `integrations/<capability>/<provider>/` |
| Platform adapter | Universal platform machinery | Platform-internal | Platform bootstrap | Beside the owning `platform/` subsystem |

Hardware, remote I/O, or a vendor SDK does not by itself determine the category.
A printer is not platform core merely because it is infrastructure, and a web
API adapter is not reusable merely because its provider is external.

### 9.1 Application-private adapters

If an adapter exists only to satisfy an internal application port, it stays
inside the module:

```text
modules/lemonade/server/adapters/persistence/YamlStandRepository.mjs

modules/kitchen/server/adapters/providers/tandoor/
modules/kitchen/server/adapters/providers/mealie/
```

It may use the application's ubiquitous language, is constructed by that
module's composition root, changes with the module, and does not need global
registration. Tandoor and Mealie initially belong here because they implement
Kitchen-owned recipe, planning, and shopping ports. A second real consumer and
a coherent public contract may later justify promotion; a recognizable vendor
name does not.

### 9.2 Capability provider adapters

If an adapter implements a stable capability used by several modules, the
provider implementation belongs to the shared integration ecosystem:

```text
capabilities/
├── print-output/
│   ├── shared/contracts.mjs
│   └── server/
│       ├── PrintOutputService.mjs
│       └── PrinterFleet.mjs
└── device-dispatch/
    ├── shared/contracts.mjs
    └── server/
        └── DeviceDispatchService.mjs

integrations/
├── print-output/
│   ├── ipp-laser/
│   │   └── LaserPrinterAdapter.mjs
│   └── escpos/
│       └── EscPosPrinterAdapter.mjs
└── device-dispatch/
    ├── fully-kiosk/
    │   └── FullyKioskContentAdapter.mjs
    ├── adb/
    └── home-assistant/
```

The capability owns the provider-neutral command, result, health, permission,
and lifecycle contract. The integration owns protocol negotiation, vendor API
translation, connection details, and vendor-specific errors. Each provider runs
the capability's shared contract suite and registers with provider resolution;
applications require the capability and never import the concrete adapter.

Accordingly, the directional homes of two current adapters are:

```text
backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs
  -> integrations/print-output/ipp-laser/LaserPrinterAdapter.mjs

backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
  -> integrations/device-dispatch/fully-kiosk/FullyKioskContentAdapter.mjs
```

`LaserPrinterAdapter` transports an already-rendered artifact; the application
still owns what to print and the rendering layer owns its layout.
`FullyKioskContentAdapter` currently combines wake, foreground, URL loading,
readiness checks, and optional ADB help. It may move intact under
`device-dispatch/fully-kiosk` first. Split it into narrower `display-control`,
`device-dispatch`, or capture-readiness providers only when real consumers prove
those contracts independently useful.

Jellyfin and Emby should normally implement existing content-catalog and
playback contracts. They justify a new capability only when their semantics
reveal a provider-neutral behavior the current contracts cannot express.

### 9.3 Platform adapters

Platform adapters implement ports required by universal runtime machinery:

```text
backend/src/platform/config/adapters/YamlConfigStore.mjs
backend/src/platform/secrets/adapters/EnvironmentSecretStore.mjs
backend/src/platform/events/adapters/InMemoryEventBus.mjs
```

They are composed during platform bootstrap and may be required before any
application module or capability can start. They must not contain household
product semantics such as recipes, printing policy, playback queues, or kiosk
workflow. Printer and Fully Kiosk providers are optional household integrations,
so they are capability adapters rather than platform adapters.

### 9.4 Satellites are orthogonal

A satellite may contain adapters internal to its own runtime, but independent
deployment does not determine ownership of the corresponding server adapter.
Application-specific satellites live with the application. A reusable
integration may contain both its server adapter and satellite implementation.
Section 10 defines placement, shared management behavior, manifests, lifecycle,
and migration in full.

These categories do not require a universal adapter superclass or one
indiscriminate registry. Application-private adapters need no global registry;
capability providers participate in their capability's provider resolution;
platform adapters are selected by platform bootstrap.

During migration, existing implementations remain in `backend/src/1_adapters/`
until their port owner is identified. Movement follows this classification;
there should be no bulk relocation merely to empty the numbered folder.

---

## 10. Satellite runtimes and management

A **satellite** is Daylight-owned code built and deployed independently from the
primary Daylight server and web artifact. Satellites include microcontroller
firmware, Android applications, calculator software, dedicated-host agents,
relays, playback hubs, and standalone containers. The physical machine does not
define the category: a Docker service on a server-class host is still a
satellite when it has its own artifact and deployment lifecycle.

Satellites extend an application or capability across a process, device, or
network boundary. They are optional full-stack runtime targets parallel to
`server/` and `web/`, not another layer inside the server's DDD dependency
direction.

### 10.1 Ownership and runtime are separate axes

Satellite placement follows logical ownership first:

| Ownership | Source location | Example |
|---|---|---|
| Application-private | `modules/<app>/satellites/<id>/` | A Kitchen-only scale relay or Music-only piano bridge |
| Reusable capability provider | `integrations/<capability>/<provider>/satellite/` | Firmware paired with a reusable scan-ingress server adapter |
| Platform-internal | Beside the owning platform subsystem | A bootstrap-critical agent, expected to be rare |
| Independent or multi-capability product | `_satellites/<id>/` | A separately governed companion service with no honest single owner |
| Transitional and unclassified | `_extensions/<id>/` until inventory | Current code awaiting an ownership decision |

A top-level runtime taxonomy such as `esp32/`, `android/`, `docker/`, or
`scripts/` must not become the primary source organization. That would recreate
the horizontal-layer problem: one product could contain several technologies,
and application ownership would again be scattered across the repository.

Examples should be classified from actual reuse rather than their current name:

- SchoolCalc belongs under School while it is a School-only client;
- a piano bridge or recorder belongs under Music while it serves only Music;
- an OMR relay belongs under School if its protocol is School-specific, but may
  move with a reusable scan-ingress integration after another consumer proves
  that boundary;
- a playback hub belongs with a content-playback integration if it implements
  the public playback capability for several applications;
- an e-ink panel belongs with one application when it renders only that
  application's semantics, or with a display integration when it is a generic
  display target;
- a document processor remains independent or becomes its own application based
  on who owns its workflow, not because it happens to use Docker.

A normal browser route displayed by Fully Kiosk Browser is a web surface, not a
satellite. Daylight-owned APK code installed beside the browser is a satellite.
Third-party products such as Fully Kiosk, Tandoor, or Mealie are external
providers, not Daylight satellite source.

### 10.2 Unit of organization

One satellite directory normally represents one independently deployable
artifact and lifecycle. If an APK and a host recorder can be upgraded,
provisioned, or rolled back separately, they are separate satellite IDs even
when they serve the same application. A multi-target directory is appropriate
only when the targets are released and operated as one product.

Every satellite requires only two uniform files:

```text
modules/kitchen/satellites/kitchen-relay/
├── daylight.satellite.yml
├── README.md
├── firmware/                     # PlatformIO project in this example
├── config/
│   └── example.yml
├── tests/
├── tools/                        # Flashing, simulation, and diagnostics
├── deploy/                       # Reproducible deployment helpers
└── docs/
```

The manifest and README are mandatory; the remaining layout follows the native
ecosystem. PlatformIO may use `firmware/`, Android may use `app/`, and a simple
Node or Python agent may keep `package.json`, requirements, and `src/` at the
satellite root. A forced universal source tree would make every toolchain harder
to use without adding architectural safety.

Scripts used only to build, flash, deploy, simulate, or diagnose a satellite
belong in that satellite's `tools/` or `deploy/` directory. A script is its own
satellite only when the script itself is the installed runtime, such as a
long-running MIDI recorder on a dedicated host.

### 10.3 Satellite manifest

`daylight.satellite.yml` describes an artifact; it does not contain household
instances, credentials, IP addresses, or arbitrary executable deployment logic.
A representative manifest is:

```yaml
id: kitchen-relay
version: 1
kind: firmware
runtime: esp32
profiles:
  - esp32-relay

artifacts:
  - id: m5-atom
    buildSystem: platformio
    project: firmware
    environment: m5-atom

management:
  protocol: satellite-management/v1
  operations:
    - identity
    - health
    - diagnostics
    - commands
    - ota

dataPlane:
  publishes:
    - kitchen-relay-events/v1
  accepts:
    - kitchen-relay-commands/v1

deployment:
  methods:
    - serial
    - ota

configuration:
  example: config/example.yml
```

The independent dimensions are:

| Dimension | Examples |
|---|---|
| `kind` | `firmware`, `device-app`, `host-agent`, `service` |
| `runtime` | `esp32`, `android`, `linux`, `node`, `python`, `ti86` |
| Build or packaging | PlatformIO, Gradle/APK, Docker, systemd, script, calculator binary |
| House-style profile | `esp32-relay`, `eink-deep-sleep`, `android-bridge` |
| Deployment method | serial, OTA, ADB, Docker, SSH, calculator link |

The manifest validator rejects duplicate IDs, unknown protocol versions,
missing build roots, unsafe committed secrets, and malformed operation claims.
Conformance tests verify that claimed management behavior exists. The validator
does not execute shell commands merely because a manifest named them.

Package identity and deployed instance identity remain separate. The manifest
might declare `kitchen-relay`; private household configuration may provision
instances such as `kitchen-scale-1` and `pantry-scanner-1`. Instance addresses,
credentials, update channels, and physical locations stay in platform-managed
configuration outside the public source tree.

### 10.4 Satellite management as a capability

Repeated remote health, diagnostics, control, and upgrade behavior is real
cross-application runtime behavior. It should become a first-class
`satellite-management` capability rather than copied house style:

```text
capabilities/satellite-management/
├── daylight.capability.mjs
├── shared/
│   ├── contracts.mjs
│   └── protocol/
│       ├── identity.schema.json
│       ├── health.schema.json
│       ├── diagnostics.schema.json
│       ├── command.schema.json
│       └── update.schema.json
├── server/
│   ├── SatelliteRegistry.mjs
│   ├── SatelliteHealthService.mjs
│   ├── SatelliteCommandService.mjs
│   ├── SatelliteUpdateService.mjs
│   └── compose.mjs
├── web/
│   └── admin/
├── sdk/
│   ├── esp32/
│   ├── android/
│   ├── node/
│   └── python/
└── tests/
    └── contract/
```

The common management contract covers:

- stable satellite and instance identity;
- firmware/application version, build identity, and protocol versions;
- health, readiness, uptime, and last-contact state;
- bounded diagnostic snapshots with secret redaction;
- authenticated, versioned command envelopes and outcomes;
- update availability, artifact identity, progress, result, and confirmation;
- capability/operation discovery rather than false cross-runtime parity;
- structured logs and correlation identifiers where the runtime can support
  them.

The server-side registry projects several states independently:

| State | Meaning |
|---|---|
| **Declared** | Satellite source and manifest are installed in this build |
| **Provisioned** | A household/system instance is configured |
| **Reachable** | The instance has responded within its health policy |
| **Compatible** | Its management and application protocols are supported |
| **Current** | Its installed artifact satisfies the configured update policy |

These states must not collapse into `enabled`. Enabling Kitchen does not flash
an ESP32, install an APK, start a remote container, or prove that any instance
is online.

### 10.5 Runtime SDKs and house-style libraries

The capability's runtime SDKs implement server-visible management semantics in
the native environment:

```text
capabilities/satellite-management/sdk/esp32/
├── identity/
├── diagnostic-web-server/
├── command-router/
├── health/
├── ota/
└── structured-logging/

capabilities/satellite-management/sdk/android/
├── diagnostics/
├── foreground-health/
├── command-client/
├── signed-apk-updater/
└── version-reporting/
```

Technology reuse with no server-side availability, permissions, or lifecycle
semantics remains a library:

```text
libraries/embedded/
├── esp32-core/                    # Wi-Fi, NVS, watchdog, clocks, retry
└── esp32-eink/                    # refresh mechanics and deep-sleep primitives
```

The distinction follows section 6.5. An ESP32 Wi-Fi retry helper is a library;
the versioned response returned by its diagnostic web server is part of the
satellite-management capability. E-ink deep-sleep calculations are a library;
a server command that changes wake cadence belongs to a management or display
contract.

Templates, manifest validation, scaffolding, release assembly, and developer
CLI behavior are tooling rather than runtime libraries:

```text
tooling/satellites/
├── templates/
│   ├── esp32-relay/
│   ├── eink-panel/
│   ├── android-app/
│   └── container-service/
├── manifest-validator/
└── build-cli/
```

Shared code and templates should be extracted from at least two working
satellites. The migration must not force every current firmware or APK through
an imagined universal framework before its real common behavior is measured.

### 10.6 Control plane versus application data plane

The management capability standardizes the control plane, not every message a
satellite can send:

| Common control plane | Owner-specific data plane |
|---|---|
| Identity and version | Barcode scan event |
| Health and diagnostic envelope | OMR answer payload |
| Authentication and correlation | Weight measurement |
| Generic command transport | Piano MIDI message |
| OTA lifecycle | Playback queue behavior |
| Logging shape | Scanner calibration semantics |

The common SDK may host the diagnostic web server, authentication, routing, and
command envelope. The owning application or integration defines what
`tare-scale`, `feed-omr-sheet`, or `reload-playback-slot` means. Application
payloads must not be smuggled into an untyped management `data` bag merely to
avoid defining their real contract.

Provider-specific wire protocols belong with the integration that owns both
ends:

```text
capabilities/scan-ingress/shared/contracts/       # Normalized public capability

integrations/scan-ingress/omr-relay/
├── shared/wire-protocol/                         # Relay-specific transport
├── server/OmrRelayAdapter.mjs
└── satellite/firmware/
```

An application-private satellite may use a versioned contract under its
module's `shared/` area. In all cases, the satellite communicates through a
published contract and never imports private server implementation code.

### 10.7 Updates and deployment lifecycle

Update mechanisms differ while reporting one normalized lifecycle:

```text
available -> downloading -> verified -> installing -> restarting -> confirmed
```

- ESP32 may write and select an OTA partition, with last-known-good rollback;
- Android may verify and install a signed APK, subject to device-owner and
  platform constraints;
- a Docker or systemd service may report its version but declare self-update
  unsupported because an external deployment process owns replacement;
- calculator software may require an explicit physical or link-cable transfer.

An operation matrix reports which transitions and remote commands a runtime
actually supports. The capability must not pretend an externally deployed
container can self-update merely because an APK can.

Production update policy requires authenticated control, artifact hashes,
signed release metadata where the runtime can verify it, bounded download size,
compatibility checks, redacted diagnostics, restart confirmation, and a
documented recovery path. Privileged diagnostic or remote-control endpoints must
not become unauthenticated merely because the device is expected to remain on a
home LAN.

Build and deployment remain separate from application enablement:

1. application/capability installation makes a satellite descriptor available;
2. provisioning creates a private instance and credentials;
3. build/package produces a versioned artifact;
4. deployment installs that artifact through a supported method;
5. health and compatibility checks confirm the running instance;
6. application surfaces use the relevant capability only after its required
   instance state is available.

Removing or disabling an application stops its server integrations and
surfaces, but it cannot assume remote code disappeared. Destructive
deprovisioning, factory reset, or credential revocation requires an explicit
operator action.

### 10.8 Testing and contributor contract

Satellite support must remain testable without recreating the reference
household's hardware:

- manifests and configuration examples pass schema and secret scans;
- shared management schemas have language-neutral golden request/response
  fixtures;
- every runtime SDK passes the same management conformance cases for the
  operations it claims;
- firmware, APK, and service projects have native unit tests where feasible;
- simulators or emulators exercise application protocols and failure states;
- server integration tests use fake satellite transports;
- update tests cover signature/hash rejection, interrupted installation,
  rollback or recovery, and confirmation timeout;
- live hardware tests are explicit, opt-in, and identify the required target;
- community modules include synthetic identities, endpoints, and fixtures rather
  than private device addresses or credentials.

CI may validate every manifest and run lightweight SDK/host tests, but it should
not require every contributor to install PlatformIO, Android tooling, calculator
toolchains, and Docker for an unrelated module change. Build matrices select
satellite jobs from changed manifests and declared toolchains.

### 10.9 Migration from `_extensions/`

The current `_extensions/` folder should be migrated by classification, not by
a blind rename:

1. inventory each directory's owner, artifact kind, build system, deployment
   target, protocols, runtime configuration, and current references;
2. add `daylight.satellite.yml` and a synthetic configuration example without
   moving source;
3. identify management behavior already repeated across at least two ESP32
   firmwares, APKs, or host services;
4. extract the smallest real `satellite-management` protocol, runtime SDKs, and
   conformance fixtures from those implementations;
5. migrate one ESP32 firmware, one Android application, and one host/container
   service to validate that the model is not toolchain-specific;
6. move application-private products under their module and reusable two-sided
   products under their integration;
7. move only genuinely independent or unresolved products into `_satellites/`;
8. update scripts, import aliases, runbooks, and links, then remove the empty
   `_extensions/` root.

No migration should combine independent artifacts merely because they support
the same room or application, and no common SDK should absorb application data
plane behavior. The exit condition is ownership clarity plus reproducible
independent deployment, not an empty old directory at any cost.

---

## 11. Architecture contract and enforcement

Vertical modules replace one physical organization with another; they do not
replace the dependency rules in
`docs/reference/core/layers-of-abstraction/`. Those rules must remain true for
legacy numbered folders, module-local layers, capabilities, integrations,
platform code, frontend code, and satellite runtimes.

The architecture should be a **fail-closed executable policy**. Documentation
explains why a boundary exists, manifests declare ownership and supported
dependencies, and tooling verifies every production file and import edge. No
new source root is considered supported until the architecture tooling can
classify and enforce it.

### 11.1 Normative boundary rules

The registry provides encapsulation only if module dependencies remain
disciplined.

1. A module may import the shared kernel, module SDK, public platform
   contracts, public capability entry points, and approved libraries.
2. A module must not import another module's private files.
3. Cross-module collaboration uses a declared capability, public contract, or
   versioned event.
4. A module owns its routes, jobs, subscriptions, configuration schema,
   migrations, and tests.
5. A module must not require a manual edit to platform bootstrap in order to be
   discovered.
6. A module's absence or disabled state must not break platform startup.
7. Optional dependencies must produce explicit degraded behavior and health
   status rather than hidden partial initialization.
8. Module configuration must use platform configuration services; it must not
   know deployment paths or read household files directly.
9. Module logs must use the structured logging framework with module context.
10. Community modules must use synthetic fixtures and must not contain one
    household's identities, devices, credentials, or private content.
11. A module may expose many surfaces, but those surfaces share one server-side
    composition and do not become implicit application modules of their own.
12. Reuse among a module's own surfaces stays private to that module unless a
    separate application proves the need for a stable public boundary.
13. Cross-application UI reuse occurs through an explicitly public embeddable
    surface or library entry point, never a deep import into another module.
14. Every production source file must have a recognized owner, runtime, and
    architectural layer; an unclassified file is a build failure.
15. Declaring a dependency does not grant access to private files. Cross-owner
    imports must be both declared and made through the target's public entry
    point.
16. Raw filesystem, network, process, clock, entropy, and timer APIs are allowed
    only in explicitly designated runtime implementations. Application and
    domain code receive narrow injected contracts.
17. A module is not eligible for extraction or third-party support until its
    source is covered by the same required architecture checks as legacy code.

School may, for example, require identity and content capabilities and
optionally consume printing and household-economy capabilities. It should not
reach directly into the private implementation folders of those modules.

Likewise, Piano, Singer, Drummer, Conductor, Karaoke, and Sheet Music surfaces
may freely reuse Music-owned exercise, notation, recording, and Karaoke code.
That internal reuse does not require a platform-level feature registry.

### 11.2 One architecture policy, many physical layouts

The current architecture audits are the foundation and should be refactored,
not replaced by an unrelated checker. Their path knowledge should move into one
declarative policy and classifier:

```text
tooling/architecture/
├── policy.mjs                    # owner types, layers, and allowed edges
├── classify-source.mjs           # path -> owner, runtime, layer
├── resolve-imports.mjs           # relative, alias, package, and export edges
├── fixtures/
│   ├── allowed/
│   └── forbidden/
└── waivers.yml                   # reviewed, owned, expiring exceptions only
```

For example:

```javascript
classifySource('modules/music/server/application/RecordPerformance.mjs');

// {
//   ownerType: 'application-module',
//   owner: 'music',
//   runtime: 'server',
//   layer: 'application',
// }
```

The classifier must understand both the migration source and target layouts:

- `backend/src/{0_system,1_adapters,1_rendering,2_domains,3_applications,4_api,5_composition}`;
- `modules/<id>/server/{domain,application,adapters,rendering,api}` and
  `compose.mjs`;
- capability, integration, platform, frontend, shared, library, CLI, and
  satellite source roots;
- production entry points outside those roots; and
- test, fixture, generated, and tooling code as separate classifications rather
  than silent exclusions.

`daylight.module.mjs` declares identity, public contributions, required and
optional capabilities, and supported entry points. It must not redefine the
layer matrix. If each module can customize what `domain` or `application` may
import, the architecture will fragment into local dialects.

The classifier fails on unknown production paths. This is the rule that keeps
a new directory convention from silently escaping all other rules.

### 11.3 Dependency graph and layer matrix

The audit resolves the complete import graph and evaluates two independent
questions for every edge:

1. **Layer direction:** may this kind of code depend on that kind of code?
2. **Ownership boundary:** may this owner consume that owner's public contract?

The initial module-local matrix is:

| Source | Allowed source dependencies |
|---|---|
| `domain` | Same-owner domain code, approved lower-level domain/kernel contracts, and pure libraries |
| `application` | Same-owner domain code and ports, public capability contracts, and approved libraries |
| `adapter` | The application port it implements, required domain contracts, designated runtime gateways, and its external provider SDK |
| `rendering` | Presentation models, domain values needed for rendering, and pure rendering libraries; never provider or workflow implementations |
| `api` | Transport contracts and injected public application operations; never repositories, concrete workflows, adapters, or domain internals |
| `compose` | Its owner's concrete API, application, adapter, rendering, and declared provider entries; no business rules or direct persistence/process work |
| `web` | Its owner's web/shared code plus public capability, surface, platform-UI, and library entry points; never server implementation or another module's private component |

The exact treatment of an API's application-facing contract must be validated
by the pilot. The default is dependency injection: composition imports the
concrete workflow and passes a narrow operation or facade to API construction.
If a shared application contract is imported, it must have an explicit public
entry point; `api -> application implementation` remains forbidden.

Cross-owner checks add these constraints:

- an application module cannot import another application's private source;
- a declared capability can be consumed only through its exported contract or
  runtime entry point;
- an integration can implement its owning capability but cannot become a
  shortcut into application internals;
- platform code cannot depend on an application module;
- package aliases, relative paths, dynamic imports, re-exports, CommonJS
  `require`, and static template imports receive the same verdict; and
- owner-level and capability-provider dependency cycles are rejected with the
  complete cycle in the diagnostic.

The audit should report the source classification, resolved target, violated
edge, and supported replacement. A message such as `application cannot import
node:fs; inject FileStore` is more self-correcting than `rule 17 failed`.

### 11.4 Public boundaries and package exports

Application modules, capabilities, integrations, and substantial libraries
should become workspace packages when the pilot proves the package shape. Each
owner exports only its supported surface:

```json
{
  "name": "@daylight/music",
  "exports": {
    ".": "./public.mjs",
    "./web": "./web/public.js"
  }
}
```

Package exports make deep cross-owner imports unavailable to normal module
resolution. The architecture audit still enforces internal layer direction,
relative-path escapes, and source environments that do not honor Node exports.

The package boundary belongs around an owner, not around every internal layer.
Making `domain`, `application`, `api`, and `adapters` separate packages would
add substantial release and tooling ceremony without eliminating the need for
an architecture audit inside the vertical slice.

Broad global aliases such as `#apps/*` and `#adapters/*` remain migration aids,
not the target public API. New owners receive narrow aliases or package exports
that lead developers toward public entry points rather than exposing the whole
tree.

### 11.5 Infrastructure choke points

The easiest compliant implementation should also be the safest implementation.
The platform and capability SDKs should expose narrow, injected services for
common runtime mechanics:

| Ambient or concrete mechanism | Application-facing contract |
|---|---|
| `node:fs` and deployment paths | `FileStore`, repository, artifact store, or other purpose-specific port |
| global `fetch` and vendor clients | `HttpClient` or provider adapter |
| `Date.now()` and `new Date()` as a clock | `Clock` |
| global timers | `Scheduler` or injected timer policy |
| randomness and UUID generation | `EntropySource` or ID factory |
| `child_process` | `ProcessRunner` owned by a designated adapter |
| printer, playback, MIDI, or device APIs | The corresponding capability contract |

Only narrow policy-designated runtime implementations may import the raw
mechanism. Composition selects and injects those implementations but does not
perform the I/O itself. The direct-filesystem audit should therefore consume
the same source classifier and policy as the layer audit instead of maintaining
an independent list of numbered folders.

This is not a demand to invent a universal abstraction for every library call.
It applies to ambient state and side effects whose direct use would make domain
or application code environment-dependent. Provider-specific SDKs remain
appropriate inside their owning adapters.

### 11.6 Scaffolding and reference implementations

Contributors and coding agents will copy the path with the least friction.
Daylight should provide generators backed by the same policy:

```text
npm run create:module
npm run create:capability
npm run create:integration
npm run create:satellite
```

A generated application module should include only the minimal manifest,
public entry points, layer folders actually requested, composition root,
synthetic fixture, architecture test, and contract-test shell. It must not
generate empty registries or speculative abstractions.

The repository should also retain one small, exemplary module as executable
documentation. Its purpose is to demonstrate constructor injection, public
exports, API translation, adapter implementation, composition, structured
logging, and deterministic tests in less code than a contributor would need to
reverse-engineer from School or Fitness.

Repeated correctness patterns should become APIs or templates rather than
review reminders. If every adapter must implement atomic writes, standardized
health reporting, or capability contract tests, the supported helper should
make that behavior the default.

### 11.7 Architecture fitness functions, feedback, and CI

Architecture enforcement has three feedback speeds:

1. editor or lint feedback for immediate local guidance;
2. staged and working-tree checks in the repository hook; and
3. a complete required CI check that cannot be bypassed with `--no-verify`.

The AST audit remains authoritative. An ESLint integration may call the same
classifier and policy for faster frontend/editor feedback, but it must not
reimplement a second dependency matrix.

Architecture fixtures test the checker itself. They must cover allowed and
forbidden examples for relative imports, aliases, package exports, re-exports,
dynamic imports, static template imports, CommonJS imports, globals, and new
source roots. At least one sentinel fixture must prove that an unclassified
production file fails. Otherwise a broken scanner can report a misleading
clean architecture.

The required CI job should run, at minimum:

- the complete layer, owner-boundary, and direct-infrastructure audit;
- manifest and package-export validation;
- dependency-cycle detection;
- architecture checker unit and fixture tests;
- parse and link checks; and
- affected capability/provider contract suites.

Native satellite builds remain selected by their changed manifests and
toolchains as described in section 10.8; the universal architecture job should
still validate all satellite manifests and ownership classifications.

### 11.8 Baselines, waivers, and policy changes

New module-local rules begin at zero violations. Ratcheted baselines are only
for measured legacy debt and may never make a new module violation acceptable.
Ordinary changes must not regenerate a baseline merely to make CI green.

An unavoidable temporary exception belongs in `waivers.yml` with:

- the exact rule, source, and target scope;
- a technical reason that cannot be satisfied by an existing public boundary;
- an owner;
- an expiration date; and
- a linked migration issue or architectural decision.

Expired, unused, broadened, or count-increasing waivers fail CI. Changes to the
central policy, classifier, manifests, public exports, baseline, or waivers
should receive architecture-owner review. Reports should show newly introduced
edges and expiring waivers so drift is visible before it becomes repository
structure.

The documentation and executable policy must not become independent sources of
truth. The policy is normative for machine-verifiable edges; this document and
the reference layer guides explain its semantics and rationale. Tests should
assert that every documented layer and owner type exists in the policy, while
generated dependency tables or reports should be preferred wherever prose
would otherwise duplicate the matrix.

---

## 12. What happens to `backend/src/3_applications`?

`backend/src/3_applications` does not disappear at the start of this work.
Today it is the application **layer**, and its dependency rules remain valid.

During migration:

- existing application-owned use cases remain there until their owning module is
  extracted;
- new full-stack modules place use cases in
  `modules/<id>/server/application/`;
- the `#apps/*` import alias remains available for unmigrated code;
- no bulk rename is performed merely to make the tree resemble the target.

As each application module is extracted:

```text
backend/src/2_domains/gratitude/*
backend/src/3_applications/gratitude/*
backend/src/1_adapters/.../gratitude*
backend/src/4_api/.../gratitude*
frontend/src/.../Gratitude*
```

moves under:

```text
modules/gratitude/
```

After application-owned use cases have moved, any truly platform-wide
orchestration can move to:

```text
backend/src/platform/application/
```

Only when `backend/src/3_applications` has no remaining ownership should the
directory and `#apps/*` alias be removed.

The same reasoning applies to `2_domains`, `1_adapters`, and `4_api`:
application-owned code can move as its module is extracted, while genuinely
shared platform code finds an explicit platform home. The roadmap does not
presume that every existing directory must eventually vanish.

---

## 13. Migration roadmap

### Phase 0 — Inventory and dependency map

- Inventory every current place where a new application must be registered.
- Trace one small and one large application across backend, frontend, config,
  jobs, events, permissions, and tests.
- Inventory the current distinction between application identity and surface
  identity, including routes that are really device- or workflow-specific
  surfaces of the same product domain.
- Classify dependencies as platform contracts, reusable capabilities,
  application-private code, or accidental cross-module coupling.
- Inventory every current `backend/src/1_adapters/` implementation by the owner
  of the port it implements: application module, reusable capability, or
  platform subsystem. Record separately whether it has a companion artifact in
  `_extensions/`; deployment location must not decide server-side ownership.
- Inventory `_extensions/` build targets, deployment targets, scripts, aliases,
  and documentation references before a later mechanical rename to
  `_satellites/`.
- Record current layer-enforcement assumptions that depend on numbered paths.

**Exit condition:** the project has a concrete integration checklist and a
dependency map for the pilot module, plus an ownership classification for each
adapter touched by the pilot.

### Phase 1 — Make architecture enforcement layout-independent

- Extract source classification and dependency policy from hardcoded numbered
  paths into the central architecture tooling described in section 11.
- Classify every current production source root and the proposed module,
  capability, integration, platform, library, frontend, and satellite layouts.
- Make unclassified production files a hard failure.
- Resolve and check relative, alias, package, dynamic, re-export, and CommonJS
  edges through one layer-and-owner graph.
- Make the direct-filesystem and ambient-infrastructure rules consume the same
  classifier and policy.
- Add allowed, forbidden, and scanner-sentinel fixtures for legacy and target
  layouts.
- Add a required CI architecture job while retaining the fast staged and
  working-tree checks.
- Separate zero-tolerance rules for new modules from any ratcheted legacy debt;
  require owned, expiring waivers for temporary exceptions.

**Exit condition:** a synthetic module-local file receives the same architecture
verdict as an equivalent numbered-layer file, every production file is
classified, and bypassing the local hook cannot merge a violation into `main`.

### Phase 2 — Define the minimal module SDK

- Define and validate `daylight.module.mjs` metadata.
- Define the minimal surface descriptor and namespaced surface ID contract.
- Implement a static `ApplicationModuleRegistry` in layer 5 composition.
- Define the server composition result and disposal contract.
- Add duplicate-ID, dependency, and invalid-manifest tests.
- Keep all existing manual registration paths working.

**Exit condition:** the registry can describe modules without changing runtime
behavior.

### Phase 3 — Extract a pilot module

Extract a small existing application, preferably Gratitude or Weekly Review.
Gratitude is a useful first candidate because it crosses domain, application,
persistence, rendering, API, and frontend concerns without the breadth of
School or Fitness.

- Move the pilot's owned server and web code into `modules/<id>/`.
- Preserve its internal layer boundaries.
- Compose it exclusively through its server entry.
- List every remaining core edit required to make it run.
- Add contract, unit, and live smoke tests at the module boundary.

Every remaining manual core edit is evidence of a missing extension point. The
contract should be revised from this evidence before extracting a second
module.

**Exit condition:** removing the pilot manifest removes the application without
leaving broken imports, routes, jobs, or navigation.

### Phase 4 — Enablement and server catalog

- Add household application enablement configuration.
- Model installed, enabled, available, surface-enabled, surface-available, and
  visible separately.
- Resolve module capability dependencies through the adapter/capability
  infrastructure.
- Publish a permission-filtered module and surface catalog API.
- Surface unavailable states and reason codes in administration and health.

**Exit condition:** one build can enable different module sets without source
edits.

### Phase 5 — Frontend surface discovery

- Generate or discover a build-time import map of installed surface entries.
- Register module routes and surfaces from manifests.
- Intersect installed entries with the server catalog and permissions.
- Derive navigation and app content entries from the surface catalog.
- Retire duplicated pilot entries from `frontend/src/lib/appRegistry.js` and
  backend app-content registration.

**Exit condition:** the pilot application requires no manually duplicated
frontend and backend catalog entry, and its surface identity is distinct from
its module identity.

### Phase 6 — Derive remaining integration points

Incrementally allow manifests to contribute:

- jobs and event subscriptions;
- configuration schemas and managed paths;
- permissions and administrative surfaces;
- health checks and readiness reasons;
- widgets and device-specific surfaces;
- satellite descriptors and management health projections, without coupling
  module enablement to remote deployment;
- migrations and lifecycle hooks.

Only add a contribution type when a real module needs it. Avoid creating a
general-purpose plugin framework in anticipation of hypothetical needs.

**Exit condition:** the pilot's manifest is its sole platform integration
point.

### Phase 7 — Extract representative modules

Extract modules of increasing complexity:

1. a small application such as Gratitude;
2. a medium application with shared capabilities and background work;
3. Music, after the smaller pilots, to validate one server composition with
   several device-specific surfaces and substantial internal reuse;
4. Media, to validate provider adapters and shared content capabilities;
5. Kitchen as a greenfield module, after module and surface discovery are
   proven, to validate household-scoped provider selection, honest operation-
   level provider differences, responsive and dedicated-device surfaces,
   playback composition, and optional physical output;
6. School or Fitness last, to validate hardware, multiple surfaces, jobs,
   policy, and cross-module contracts.

The order should be adjusted based on the Phase 0 dependency map. Large modules
must not be used as the first experiment.

**Exit condition:** the module model handles a conventional browser-first
application, a multi-surface domain such as Music, a provider-backed greenfield
application such as Kitchen, and a hardware-rich household application without
special platform branches.

### Phase 8 — Third-party authoring contract

- Publish a module template and contributor guide.
- Document how to add a surface to an existing application without creating a
  new application module or platform registry concept.
- Provide synthetic configuration and test fixtures.
- Define compatibility/version policy for the module SDK.
- Publish satellite manifest examples, runtime-specific build prerequisites,
  synthetic protocol fixtures, and opt-in hardware test conventions.
- Document official, incubating, community, and recipe maturity levels.
- Establish review rules for security-sensitive permissions, migrations, and
  server code.

**Exit condition:** a contributor can build and test a new application without
learning every internal bootstrap location or using private household data.

---

## 14. Acceptance criteria

The architecture is successful when a representative new module can be added
by creating its own directory and registering one manifest, with no module-
specific edits to platform source.

At minimum:

- every production source file is classified by owner, runtime, and layer, and
  an unknown source location fails the architecture check;
- legacy numbered layers and module-local layers receive equivalent dependency
  and ambient-infrastructure verdicts;
- every resolved cross-owner dependency is both declared and made through a
  public entry point;
- raw filesystem, network, process, clock, entropy, and timer mechanisms are
  confined to their policy-designated implementations;
- architecture checks and checker-fixture tests are required CI checks rather
  than local-hook conventions;
- new modules begin with zero architecture violations, while any temporary
  waiver is narrow, owned, justified, and expiring;
- a generated reference module passes architecture, contract, parse, and link
  checks without hand-edited allowlists;
- installation is a build concern and enablement is a household concern;
- the server validates dependencies before module composition;
- frontend routes and navigation come from the installed surface catalog;
- one module can expose multiple independently configurable surfaces while its
  server services are composed only once;
- a missing surface-specific capability can disable that surface without
  disabling unrelated surfaces in the same application;
- disabling a module prevents its routers, jobs, subscriptions, and surfaces
  from activating;
- missing required capabilities produce an explicit unavailable state;
- module-private adapters remain private;
- reusable provider adapters can be selected independently;
- every moved adapter is placed according to the owner of its port rather than
  whether it uses hardware, a network, a vendor SDK, or a separate device;
- applications consume capability contracts without importing concrete
  integrations such as IPP printers or Fully Kiosk;
- optional household integrations do not become platform-bootstrap
  dependencies;
- independently deployed satellites remain distinct from the server-side
  adapters and capabilities through which they communicate;
- application-private satellites live with their module, reusable two-sided
  satellites live with their integration, and the root satellite directory is
  reserved for genuinely independent or transitional products;
- satellite manifests distinguish artifact identity from private provisioned
  instances and contain no household endpoints or credentials;
- ESP32, Android, and host-service implementations can share one versioned
  management control plane while reporting unsupported operations honestly;
- common satellite management never becomes an untyped transport for
  application data-plane messages;
- application enablement neither flashes, installs, updates, nor destructively
  deprovisions a remote satellite;
- an application-private provider family can expose honest operation-level
  differences without leaking provider DTOs or inventing global capabilities;
- several surfaces can reuse application-owned services and components without
  promoting them into a global registry;
- removing a module does not leave imports from platform or other modules;
- dependency-layer checks and module-boundary checks both pass;
- the module can be tested using synthetic fixtures without a contributor
  reproducing the reference household's hardware.

---

## 15. Non-goals

This roadmap does not initially provide:

- runtime download or hot installation of arbitrary third-party code;
- process isolation or a security sandbox for untrusted modules;
- independent deployment of each module as a microservice;
- a public marketplace, package index, or remote registry;
- an immediate migration of all existing applications;
- a requirement that every household-specific workflow become a bundled app;
- a separate first-class feature-module registry;
- a separate application module for every route, kiosk, or device;
- an independently composed server runtime for each surface;
- a replacement for the adapter/port abstraction;
- an immediate mechanical rename of `_extensions/` before its deployment and
  documentation references are inventoried;
- one universal adapter superclass or indiscriminate registry for application,
  capability, and platform adapters;
- automatic satellite deployment as a side effect of enabling an application;
- one universal application-data protocol for every firmware, APK, agent, and
  container;
- a requirement that every satellite self-update when its deployment is owned
  by an external orchestrator;
- mandatory installation of every satellite toolchain for unrelated module
  development.

The first goal is a well-factored modular monolith. Distribution and marketplace
concerns can be considered after the local module boundary is proven.

---

## 16. Risks and guardrails

### A manifest becomes a service locator

If modules pull arbitrary global services out of `context`, boundaries will be
nominal rather than real. Context access should be narrow, typed, and oriented
around declared capabilities.

### The platform absorbs application policy

The platform should decide how modules load, not how a lemonade stand prices a
cup or how School grades a quiz. Application policy stays with its module.

### `integrations/` becomes a new adapter dumping ground

A concrete implementation belongs in `integrations/` only when it implements a
stable public capability contract. Application-private adapters stay with their
module, and platform adapters stay with their platform subsystem. Provider or
hardware code must not be promoted merely to make `backend/src/1_adapters/`
empty.

### One application becomes an undifferentiated monolith

A multi-surface application still needs explicit internal subdomains, public
entry points, and dependency rules. "One Music application" does not mean one
global model of notation, performance, recording, Karaoke, and repertoire.
Concepts that differ should remain distinct and translate at explicit internal
boundaries.

### Every surface becomes an application

A new route, dedicated tablet, or different audience is not sufficient reason
for another installable module. Split only when the candidate has independently
meaningful lifecycle, data ownership, permissions, compatibility, contributor
ownership, or product identity.

### Modules directly import each other

Convenient private imports create a distributed monolith. Cross-module needs
must become explicit capabilities, contracts, or events.

### Manifests become enormous

The manifest should declare contributions and entry points, not contain
business logic or instantiate an entire object graph. Module composition stays
in `server/compose.mjs`.

### The migration weakens layer discipline

Vertical ownership does not permit API code to become domain code or adapters
to leak vendor details into use cases. CI must enforce both module boundaries
and layer direction.

### The checker recognizes only yesterday's folders

A path-based audit can report a clean result while ignoring an entirely new
source root. Production classification must therefore fail closed, and scanner
fixtures must prove that module, capability, integration, frontend, and
satellite paths are visited before those layouts are adopted.

### Documentation and executable policy diverge

Duplicating dependency matrices across prose, audit scripts, lint rules, and
templates creates several competing architectures. One central policy should
drive machine-verifiable edges, fixtures, diagnostics, and generated reports;
the reference documents explain the rationale and semantics.

### Baselines and exceptions normalize new debt

A ratchet is appropriate for measured legacy violations, not for new module
code. Baseline regeneration must not be an ordinary escape hatch. Temporary
exceptions need exact scope, ownership, rationale, and expiration, and CI must
reject expired or broadened waivers.

### Satellite management becomes a generic message bus

Identity, health, diagnostics, command envelopes, and update lifecycle are a
coherent control plane. Barcode scans, OMR answers, weights, MIDI, and playback
queues remain application or capability data-plane contracts. A generic
management payload would erase ownership and versioning rather than create
reuse.

### A house-style SDK becomes a mandatory embedded framework

Shared SDKs should be extracted from working implementations and adopted one
runtime at a time. A satellite may implement only the management operations its
toolchain and deployment model support. PlatformIO, Android, Docker, scripts,
and calculator software must not be forced through one build system or one
self-update mechanism.

### Module enablement is confused with satellite deployment

Enabling a module activates server and web contributions; it does not authorize
flashing firmware, installing APKs, replacing remote containers, revoking
credentials, or factory-resetting devices. Provisioning and destructive
deprovisioning remain explicit operator workflows.

### A plugin marketplace is built too early

Build-time installation is sufficient for an open-source repository and is much
easier to secure, test, and support. Runtime installation should require a
separate threat model and compatibility design.

---

## 17. Questions to resolve through the pilot

The pilot extraction should answer these questions with code rather than
speculation:

1. Should modules be workspace packages immediately, or plain directories with
   import aliases first?
2. Should manifests be discovered from the filesystem or compiled into a
   generated catalog?
3. Which platform services may every module receive, and which must be declared
   as capabilities?
4. How should module-owned migrations be ordered, versioned, and rolled back?
5. Can configuration allowlists and schemas be derived safely from manifests?
6. Which frontend surface types are truly common across browser, kiosk, mounted
   tablet, and embedded displays?
7. Which requirements make the whole application unavailable, and which only
   make one surface unavailable?
8. What is the supported contract for launching or embedding a surface owned by
   another application?
9. What evidence justifies splitting a surface into a separate application
   module?
10. What is the smallest stable compatibility surface that can be promised to a
   third-party module author?
11. What is the smallest management contract already implemented consistently
    by one ESP32 firmware, one APK, and one host or container service?
12. How should installed satellite descriptors be discovered across modules and
    integrations without turning deployment into module startup behavior?
13. Which current `_extensions/` products are genuinely independent, and which
    have clear application or capability-integration owners?
14. Which application-facing operations or contract types may API code import,
    and which must always be supplied by composition?
15. Which existing aliases should be replaced first by owner-level package
    exports, and what compatibility period do legacy aliases require?
16. Which current architecture violations are genuine migration debt requiring
    a baseline, and which can be eliminated before module extraction begins?

Until those answers are proven, the module API should be considered internal
and version zero.
