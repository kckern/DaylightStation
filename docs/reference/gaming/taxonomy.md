# Gaming Taxonomy

This taxonomy is mutually exclusive at the ownership level and collectively covers the in-scope gaming system. JavaScript emulation and RetroArch remain outside this architecture.

| Layer | Owns | Does not own |
|---|---|---|
| Experience package | Ruleset reference, portable manifest, projections, presenters, authored content schema | Device policy, household paths, session storage |
| Gaming platform | Session protocol and client, deterministic commands/events, authority, persistence, common mechanics, UI primitives, normalized input, normalized results | Game-specific phases, presentation, or scoring policy |
| Surface environment | Launch policy, input adapters, kiosk/screen layout, local recovery, surface-specific presenter selection | Canonical rules or cross-surface results |
| Party Games | Shared-display launch flow, team setup, buzzers, injected surface capabilities, host/verifier companions, party effects | Experience-specific presentation, Piano pedagogy, School course sequencing |
| Piano | MIDI interaction, kiosk lifecycle, piano-specific challenges and progression | Party host policy or generic score storage |
| School | Course sequencing, assignment/evidence policy, embedded mini-game lifecycle | Game authority internals or party equipment |
| Presentation | Sprite/tile catalogs, scene compilation, animation, rendering, semantic presentation actions | Game state mutation, scoring, authorization |
| Deployment data | Mounted definitions, manifests, media, environment configuration, durable sessions | Source-code behavior |

## Canonical concepts

- A **game** is deterministic rules plus authored definition data.
- An **experience** is the portable product unit: game, supported surfaces, presenters, projections, and result contract.
- A **surface** is where an experience is launched: `piano`, `school`, `party-games`, or `developer`.
- An **environment** is deployment and interaction policy surrounding a surface. Party Games is an environment; Jeopardy is an experience.
- An **authority mode** determines who commits state: `remote`, `checkpointed-local`, or `ephemeral`.
- A **presenter** is the required playable UI. A renderer embedding is optional decoration or spatial presentation and must have a presenter fallback.
- A **result** is the normalized terminal envelope consumed across surfaces.

## Current disposition

| Existing concept | Disposition |
|---|---|
| Group Play | Renamed, without aliases, to Party Games / `PartyGames` / `party-games` |
| Generic Gaming launcher | Developer harness at `/dev/gaming`; removed from the public app catalog |
| Scale Clash | Deprecated and migrated out of the playable definitions mount |
| GameDemo | Split into reusable presentation runtime plus `dev/GamePresentationHarness` |
| Jeopardy, Activity Party, Charades, Dice, Selector | Party Games experiences on the common platform |
| Card Battle | Portable Piano + developer reference experience; Presentation V2-compatible with fallback |
| Chess | Shared rules/mechanics with Piano and School surface presenters |
| Checkers and Connect Four | Piano experiences; portable manifest migration can add other surfaces later |
| School mini-games | School-owned orchestration consuming portable experiences and normalized results |
| Emulation / RetroArch | Explicitly out of scope |

## Refactor priorities

1. Protect deterministic session truth and migrate durable active records safely.
2. Make surface and authority compatibility explicit in manifests and launches.
3. Keep production experiences independent of Party Games, Piano, School, and developer harnesses.
4. Consolidate teams, scores, turns, rounds, deadlines, and results only where semantics are truly common.
5. Keep Presentation optional, projection-only, semantic-intent-driven, and fail-open.
6. Deprecate obsolete definitions and legacy history without presenting them as playable experiences.

## Dependency rule

The source dependency direction is `environment → experience → platform`:

- Environments select and mount compatible experiences and provide surface capabilities.
- Experiences own their game-specific presentation and depend only on the common platform and shared contracts.
- The platform depends on neither environments nor experiences.
- Cross-cutting capabilities such as buzzers and audio are injected through `gamingServices`; an experience does not import Party Games, Piano, School, or a developer harness.
