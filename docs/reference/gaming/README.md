# Gaming Architecture

Gaming is a thin deterministic protocol shared by contexts that define games. The kernel owns session identity, ruleset version, revision, seed, participants, seats, command/event envelopes, and coordinator contracts. It does not own phases, rounds, scoring policy, devices, rendering, AI, or printing.

Canonical packages:

- `shared/gaming/kernel`: protocol, runtime, authority strategies, and coordinator.
- `shared/gaming/experience`: portable result contracts.
- `shared/gaming/mechanics`: deterministic dice, selection, scoring, deadlines, turn order, and random streams.
- `shared/gaming/rulesets`: context-owned game behavior.
- `shared/interaction`: semantic input and experience manifests.
- `shared/presentation/scenes`: optional sprite/tile scene compilation and semantic actions.
- `frontend/src/modules/Gaming/platform`: environment-neutral session client, UI primitives, input normalization, authority, projections, and runtime.
- `frontend/src/modules/Gaming/environments/party-games`: co-located surface policy, setup, hardware bridges, companions, and effects.
- `frontend/src/modules/Gaming/experiences`: portable production presenters and their experience-specific UI.
- `frontend/src/lib/presentation`: reusable presentation runtime; it has no game authority.
- `frontend/src/dev/GamePresentationHarness`: developer-only renderer diagnostics and catalog exploration.
- `backend/src/3_applications/gaming`: use cases, ports, projections, and effects.

`party-games` is the canonical shared-display environment and `/api/v1/gaming` is the Gaming API.

The v2 cutover has no runtime compatibility aliases. `scripts/migrations/gaming-v2.mjs` migrates mounted manifests, durable snapshots, journals, and Party Games configuration with a recoverable backup; it is dry-run unless `--apply` is supplied. Source packages contain no branded experience definition data: themed definitions and assets enter only through mounted authored artifacts.

The dependency direction is `environment → experience → platform`. Experiences may consume environment capabilities (such as buzzers and audio cues) only through injected `gamingServices`; they never import an environment. `architecture.test.js` enforces these boundaries.

See [taxonomy](taxonomy.md), [kernel and runtime](kernel-and-runtime.md), [authored artifacts](authored-artifacts.md), and [Party Games](party-games.md).
