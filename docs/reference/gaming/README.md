# Gaming Architecture

Gaming is a thin deterministic protocol shared by contexts that define games. The kernel owns session identity, ruleset version, revision, seed, participants, seats, command/event envelopes, and coordinator contracts. It does not own phases, rounds, scoring policy, devices, rendering, AI, or printing.

Canonical packages:

- `shared/gaming/kernel`: protocol, runtime, authority strategies, and coordinator.
- `shared/gaming/mechanics`: deterministic dice, selection, scoring, deadlines, turn order, and random streams.
- `shared/gaming/rulesets`: context-owned game behavior.
- `shared/interaction`: semantic input and experience manifests.
- `shared/presentation/scenes`: optional RPG-style scene compilation.
- `frontend/src/modules/Gaming/environments/group-play`: co-located native surface.
- `backend/src/3_applications/gaming`: use cases, ports, projections, and effects.

`group-play` is the canonical shared-display environment and `/api/v1/gaming` is the Gaming API.

The cutover deliberately has no stored-session migration or compatibility layer. Source packages also contain no branded experience implementation: themed definitions and assets enter only through mounted authored artifacts.

See [Kernel and runtime](kernel-and-runtime.md), [authored artifacts](authored-artifacts.md), and [group-play](group-play.md).
