# Full-Stack Application Modules

> A roadmap for making Daylight Station extensible at the application level,
> without weakening its existing domain and adapter boundaries.

**Status:** Proposed architecture and migration roadmap — no implementation implied | **Last updated:** 2026-08-31

**Related:** [Backend Architecture](../reference/core/backend-architecture.md),
[Application Layer Guidelines](../reference/core/layers-of-abstraction/application-layer-guidelines.md),
[Domain Layer Guidelines](../reference/core/layers-of-abstraction/domain-layer-guidelines.md)

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

1. **Capability adapters** implement a platform port, such as a media provider,
   payment provider, printer, or presence source.
2. **Application modules** deliver a complete user-facing capability across the
   server and web client, such as School, Fitness, Gratitude, or Lemonade.

Application modules should be physically organized as vertical slices. Each
slice may retain domain, application, adapter, API, and composition layers
inside itself.

This is a change from:

```text
architectural layer -> feature
```

to:

```text
application module -> architectural layer
```

The layers of abstraction remain. Their ownership boundary moves.

This should be an incremental extraction, not a repository-wide directory
rewrite. The module contract must be proven by extracting one small existing
application before it becomes the required shape for large applications.

---

## 3. Terminology

The word "application" currently has two meanings and must be qualified in
architecture discussions.

| Term | Meaning |
|---|---|
| **Application layer** | Clean Architecture use cases, orchestration, and ports; currently `backend/src/3_applications/` |
| **Application module** | An installable full-stack Daylight product capability, such as Gratitude or School |
| **Adapter** | A concrete provider implementing a port or capability |
| **Surface** | A frontend route, screen, kiosk view, widget, or other presentation exposed by a module |
| **Platform** | Shared contracts, runtime, module loader, shell, configuration, security, observability, and composition machinery |

An application module contains an application layer; it is not synonymous with
that layer.

---

## 4. Target repository shape

The intended long-term shape is a platform plus self-contained modules:

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
├── shared/
│   ├── contracts/
│   ├── module-sdk/
│   └── kernel/
│
└── modules/
    ├── gratitude/
    ├── school/
    ├── fitness/
    ├── media/
    └── ...
```

This tree is directional, not a requirement to rename the existing platform
folders immediately. During migration, the current numbered backend layers and
new vertical modules will coexist.

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
│   ├── screens/
│   ├── widgets/
│   ├── routes.mjs
│   └── entry.jsx
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

### 4.2 Layers still apply inside a module

The dependency direction remains:

```text
server/compose
  ├── server/api ──────> server/application ──> server/domain
  └── server/adapters ─> application ports and domain contracts
```

More precisely:

- `domain/` contains pure business rules and does not import API, adapters, or
  composition.
- `application/` coordinates domain behavior and defines the ports it needs.
- `adapters/` implement application ports and contain provider or persistence
  details.
- `api/` translates transport input and output; it does not become the business
  logic layer.
- `compose.mjs` is the module's sanctioned cross-layer assembly point.
- `web/` communicates through public contracts and APIs, not imports from
  server implementation code.

Existing layer enforcement should be extended to understand these module-local
paths before vertical modules become the default.

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
  const services = createLemonadeServices({
    config: context.config,
    identity: context.requireCapability('identity'),
    payments: context.optionalCapability('payments'),
    logger: context.logger,
    eventBus: context.eventBus,
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

The registry owns startup order, mounting, failure reporting, and shutdown. A
module owns its internal object graph.

### 5.2 Registry responsibilities

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
10. publish the resulting module catalog to the frontend and admin surfaces.

The registry is composition infrastructure. It should live in the platform's
composition layer, not in a domain or application module.

### 5.3 Separate registries, separate questions

One registry should not become a generic bag of every extension type.

| Registry | Question answered |
|---|---|
| `AdapterRegistry` | Which providers can implement this capability? |
| `ApplicationModuleRegistry` | Which full-stack modules are installed, enabled, and available? |
| `SurfaceRegistry` | Which routes, screens, and launch targets can this client render? |
| Widget registry | Which widget types can a configured screen instantiate? |

The application module manifest may feed projections into the surface and
widget registries, but those registries still have distinct responsibilities.

---

## 6. Installed, enabled, available, and visible

An application does not have one Boolean state.

| State | Meaning |
|---|---|
| **Installed** | Its code and manifest are included in this build |
| **Enabled** | Household configuration selects it for use |
| **Available** | Its required capabilities and valid configuration are present |
| **Visible** | The current user and device are permitted to see a particular surface |

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
```

Module-specific values remain in the module's normal household configuration.
The enablement catalog should not grow into a second copy of every module's
configuration.

An admin endpoint such as `GET /api/v1/modules` should return a filtered
catalog containing state, reason codes, permitted surfaces, and non-secret
metadata. It must never expose credentials or raw private configuration.

---

## 7. Frontend loading model

The web client cannot safely import an arbitrary JSX path named in runtime YAML.
Vite must know the possible modules when it builds the bundle.

The first implementation should therefore separate:

- **installation at build time**; and
- **enablement and visibility at runtime**.

A build step or Vite-supported discovery mechanism should create an import map
for installed web entries. At runtime, the client intersects that import map
with the catalog returned by the server:

```text
build-installed web entries
        ∩
server-enabled and available modules
        ∩
current user/device permissions
        =
renderable surfaces
```

The resulting surface metadata can drive routes, navigation, app content IDs,
admin configuration links, and kiosk launch targets. Existing registries should
be adapted to consume this catalog rather than duplicated module lists.

Downloading and executing third-party modules at runtime is explicitly out of
scope for the first implementation. Application modules are trusted server and
client code and should require a rebuild and normal deployment review.

---

## 8. Adapters owned by an application

An application may own adapters. Their placement depends on whether their
contract is private or reusable.

### Application-private adapter

If an adapter exists only to satisfy an internal Lemonade port, it stays inside
the module:

```text
modules/lemonade/server/adapters/persistence/YamlStandRepository.mjs
```

It is constructed by `modules/lemonade/server/compose.mjs` and does not need to
be registered globally.

### Reusable capability adapter

If an adapter implements a capability useful to multiple modules, it belongs to
the shared integration ecosystem:

```text
integrations/payments/stripe/
integrations/thermal-printing/escpos/
integrations/media/jellyfin/
```

The provider registers with `AdapterRegistry`; modules request the capability,
not the provider by name.

Jellyfin and Emby should normally implement the existing media/content ports.
They justify a new abstraction only when their semantics reveal a capability
that the current port genuinely cannot express.

---

## 9. Module boundary rules

The registry provides encapsulation only if module dependencies remain
disciplined.

1. A module may import the shared kernel, module SDK, and public platform
   contracts.
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

School may, for example, require identity and content capabilities and
optionally consume printing and household-economy capabilities. It should not
reach directly into the private implementation folders of those modules.

---

## 10. What happens to `backend/src/3_applications`?

`backend/src/3_applications` does not disappear at the start of this work.
Today it is the application **layer**, and its dependency rules remain valid.

During migration:

- existing feature use cases remain there until their owning feature is
  extracted;
- new full-stack modules place use cases in
  `modules/<id>/server/application/`;
- the `#apps/*` import alias remains available for unmigrated code;
- no bulk rename is performed merely to make the tree resemble the target.

As each feature is extracted:

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

The same reasoning applies to `2_domains`, `1_adapters`, and `4_api`: feature
code can move as its module is extracted, while genuinely shared platform code
finds an explicit platform home. The roadmap does not presume that every
existing directory must eventually vanish.

---

## 11. Migration roadmap

### Phase 0 — Inventory and dependency map

- Inventory every current place where a new application must be registered.
- Trace one small and one large application across backend, frontend, config,
  jobs, events, permissions, and tests.
- Classify dependencies as platform contracts, reusable capabilities,
  application-private code, or accidental cross-module coupling.
- Record current layer-enforcement assumptions that depend on numbered paths.

**Exit condition:** the project has a concrete integration checklist and a
dependency map for the pilot module.

### Phase 1 — Define the minimal module SDK

- Define and validate `daylight.module.mjs` metadata.
- Implement a static `ApplicationModuleRegistry` in layer 5 composition.
- Define the server composition result and disposal contract.
- Add duplicate-ID, dependency, and invalid-manifest tests.
- Keep all existing manual registration paths working.

**Exit condition:** the registry can describe modules without changing runtime
behavior.

### Phase 2 — Extract a pilot module

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

### Phase 3 — Enablement and server catalog

- Add household application enablement configuration.
- Model installed, enabled, available, and visible separately.
- Resolve module capability dependencies through the adapter/capability
  infrastructure.
- Publish a permission-filtered module catalog API.
- Surface unavailable states and reason codes in administration and health.

**Exit condition:** one build can enable different module sets without source
edits.

### Phase 4 — Frontend surface discovery

- Generate or discover a build-time import map of installed web entries.
- Register module routes and surfaces from manifests.
- Intersect installed entries with the server catalog and permissions.
- Derive navigation and app content entries from the surface catalog.
- Retire duplicated pilot entries from `frontend/src/lib/appRegistry.js` and
  backend app-content registration.

**Exit condition:** the pilot application requires no manually duplicated
frontend and backend catalog entry.

### Phase 5 — Derive remaining integration points

Incrementally allow manifests to contribute:

- jobs and event subscriptions;
- configuration schemas and managed paths;
- permissions and administrative surfaces;
- health checks and readiness reasons;
- widgets and device-specific surfaces;
- migrations and lifecycle hooks.

Only add a contribution type when a real module needs it. Avoid creating a
general-purpose plugin framework in anticipation of hypothetical needs.

**Exit condition:** the pilot's manifest is its sole platform integration
point.

### Phase 6 — Extract representative modules

Extract modules of increasing complexity:

1. a small application such as Gratitude;
2. a medium application with shared capabilities and background work;
3. Media, to validate provider adapters and shared content capabilities;
4. School or Fitness last, to validate hardware, multiple surfaces, jobs,
   policy, and cross-module contracts.

The order should be adjusted based on the Phase 0 dependency map. Large modules
must not be used as the first experiment.

**Exit condition:** the module model handles both a conventional browser-first
application and a hardware-rich household application without special platform
branches.

### Phase 7 — Third-party authoring contract

- Publish a module template and contributor guide.
- Provide synthetic configuration and test fixtures.
- Define compatibility/version policy for the module SDK.
- Document official, incubating, community, and recipe maturity levels.
- Establish review rules for security-sensitive permissions, migrations, and
  server code.

**Exit condition:** a contributor can build and test a new application without
learning every internal bootstrap location or using private household data.

---

## 12. Acceptance criteria

The architecture is successful when a representative new module can be added
by creating its own directory and registering one manifest, with no feature-
specific edits to platform source.

At minimum:

- installation is a build concern and enablement is a household concern;
- the server validates dependencies before module composition;
- frontend routes and navigation come from the installed surface catalog;
- disabling a module prevents its routers, jobs, subscriptions, and surfaces
  from activating;
- missing required capabilities produce an explicit unavailable state;
- module-private adapters remain private;
- reusable provider adapters can be selected independently;
- removing a module does not leave imports from platform or other modules;
- dependency-layer checks and module-boundary checks both pass;
- the module can be tested using synthetic fixtures without a contributor
  reproducing the reference household's hardware.

---

## 13. Non-goals

This roadmap does not initially provide:

- runtime download or hot installation of arbitrary third-party code;
- process isolation or a security sandbox for untrusted modules;
- independent deployment of each module as a microservice;
- a public marketplace, package index, or remote registry;
- an immediate migration of all existing applications;
- a requirement that every household-specific workflow become a bundled app;
- a replacement for the adapter/port abstraction.

The first goal is a well-factored modular monolith. Distribution and marketplace
concerns can be considered after the local module boundary is proven.

---

## 14. Risks and guardrails

### A manifest becomes a service locator

If modules pull arbitrary global services out of `context`, boundaries will be
nominal rather than real. Context access should be narrow, typed, and oriented
around declared capabilities.

### The platform absorbs feature policy

The platform should decide how modules load, not how a lemonade stand prices a
cup or how School grades a quiz. Feature policy stays with its module.

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

### A plugin marketplace is built too early

Build-time installation is sufficient for an open-source repository and is much
easier to secure, test, and support. Runtime installation should require a
separate threat model and compatibility design.

---

## 15. Questions to resolve through the pilot

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
7. What is the smallest stable compatibility surface that can be promised to a
   third-party module author?

Until those answers are proven, the module API should be considered internal
and version zero.
