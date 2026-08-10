# Gamified Learning — First-Wave Structural Implementation

**Date:** 2026-08-09
**Status:** Tactical rescue slice implemented after the initial player-experience gate failed.
Generalization remains frozen until the revised encounter earns replay willingness.
**Design context:** `2026-08-09-gamified-learning-framework-design.md`

## Purpose

This wave builds the load-bearing seams once, while keeping game mechanics deliberately
narrow. It is a playable single-player card/piano slice, not evidence that a universal
game DSL is warranted.

Launch the original chord fixture at `/gaming` or `/app/gaming`. The YAML-authored Pokémon
scale pilot is registered as **Scale Stadium** at `/piano/games` and deep-links at
`/piano/games/card-game`; it uses the kiosk's selected piano user, falling back to `guest`.

## Implemented structural seams

| Seam | Current implementation | Why it is load-bearing |
|---|---|---|
| Shared engine contract | `shared/gaming/` | Browser and server execute the same command/reducer contract |
| Read model | `deriveInteraction()` + `projectState()` | Views consume legal commands instead of reimplementing rules |
| Deterministic state | Seeded RNG and pinned definition hash | Replays and server verification have stable inputs |
| Challenge recovery | `requested → prepared → started → resolved/aborted` | Prepared work is durable before physical execution begins |
| Server authority | `GamingSessionService` independently applies every command | Client checkpoints are never trusted as authoritative state |
| Write safety | Optimistic revision, command idempotency, atomic file replacement | Retries and stale clients do not double-apply an action |
| Domain ownership | Piano attempt ledger under each user | Gaming references practice evidence without owning it |
| Provider boundary | Registered provider runtime with `ready/prepare/restore/start/cancel/dispose` | Later domains can plug in without importing into Gaming |
| App composition | `GamingApp` and `PianoCardGame` register the piano provider | Gaming runtime remains free of Piano imports |
| YAML game content | `shared/gaming/definitions/card-game.yml` | Combatants, cards, balance, media references, semantic challenge requests, and outcomes remain editable without changing the engine |
| Resume | Active session id persisted per game/user in local storage | Browser reload resumes rather than silently starting another game |
| Experience telemetry | Structured client journey events plus authoritative server outcomes | Field monitoring can separate UI abandonment, blocked hands, practice difficulty, persistence failure, and completed play |

## Tactical rescue slice

The revised `card-game` is now an authored Pikachu-versus-Squirtle tactical encounter
rather than a one-card quiz loop. Its presentation takes cues from collectible card games,
while the battle remains deliberately smaller than the Pokémon TCG:

- Players see the enemy's next attack, defense, or charge intent before committing cards.
- A three-energy turn can contain multiple attack, guard, and focus cards before an explicit
  end-turn action.
- Guard answers announced attacks; focus persists until and strengthens the next attack.
- The concrete scale is selected from a rotating challenge pool after the tactical card is
  chosen, so card selection no longer doubles as scale selection.
- Fluent, recovered, and fizzled performances produce distinct effects. Electric move
  outcomes also express Squirtle's weakness. Three authored mistakes fizzle the card
  instead of allowing an infinite retry loop.
- Pikachu and Squirtle identity, types, base stats, moves, and SVG references are curated
  from the PokeAPI corpus under `media/games/pokemon`; assets stream through the existing
  media proxy rather than being duplicated in the bundle.
- Enemy turns resolve as explicit events, hands redraw to four cards, and both victory and
  defeat are reachable.
- Damage has an immediate combat reaction, terminal results score and summarize the run,
  and winners choose either extra health or starting focus for a clean rematch.

This implementation reopens the field test; it does not declare the experience gate passed.

## Deliberate first-wave constraints

- Only `card-battle-v1` definitions validate.
- Untimed root-position chords and ordered one-octave scales execute; timing and fingering
  are deliberately not graded.
- `scale-clash` is bundled as a bootable definition; household YAML with the same id
  overrides it.
- `card-game` is bundled from YAML, and household
  `apps/gaming/games/card-game/game.yml` transparently overrides the bundled definition.
- A challenge found in `started` state after reload is conservatively refunded. The
  browser cannot prove whether the physical performance completed while it was absent.
- The first view has no hidden information, so projection currently copies every field.
- Session history is one YAML file per session. Definition snapshots are content-addressed.

These are constraints, not accidental omissions. Extension points exist at the boundary
where the next implementation must supply evidence.

## TODO map

### Field pilot — next

- [x] Author a minimal YAML card set and a short win/loss loop using scale interstitials.
- [x] Field-test balance, tutorial clarity, and whether the loop actually sustains interest.
  Initial result: **revise**. See
  `../audits/2026-08-09-card-game-player-experience-audit.md`.
- [ ] Choose numeric gates for challenge duration, retry rate, abandonment, and replay
  willingness before supervised sessions begin.
- [x] Add structured duration telemetry for prepare, start, first input, result, and
  persistence, including aggregate wrong-note/restart counts without per-note log spam.
- [ ] Compare against an equivalent non-game chord-practice baseline.
- [ ] Decide go/revise/stop before adding another ruleset.

### Challenge providers

- [ ] Add device-disconnect and explicit timeout results to the piano runtime.
- [ ] Add latency/clock-domain calibration before any timed grading.
- [ ] Build the occurrence aligner only when a timed passage use case is approved.
- [ ] Add reconciliation for an attempt saved immediately before a session write fails.
- [ ] Add a durable provider-version compatibility policy.

### Engine growth — evidence gated

- [ ] Add typed effect/path semantics only after a second game repeats a mechanic.
- [ ] Add visibility policies to state, events, yields, and legal commands together.
- [ ] Add behavior manifests only when a real mechanic cannot fit the shared primitive set.
- [ ] Run track, hidden-grid, and initiative traces before claiming a generalized schema.
- [ ] Keep purpose-built reducers if those traces do not converge cleanly.

### Persistence and operations

- [ ] Partition sessions by date once listing/retention requirements are known.
- [ ] Add a session index and explicit abandon/complete endpoints.
- [ ] Bound or compact command/idempotency history for long sessions.
- [ ] Add cross-process locking if more than one backend process can write the same data tree.
- [ ] Define engine/definition migration and supported-resume windows before changing the
  serialized state schema.
- [ ] Add reconciliation/repair tooling and checkpoint-vs-replay verification.

### Product and presentation

- [ ] Replace the temporary `?user=` assignment with the household profile picker.
- [ ] Add keyboard/focus testing, screen-reader announcements, and reduced-motion variants.
- [ ] Add authored sound/art manifests after the mechanic survives the field gate.
- [x] Register the scale pilot in Piano Games while retaining the standalone framework fixture.

## Verification

Focused tests cover:

- Legal-action derivation.
- Requested/prepared/started challenge boundaries.
- Successful result commit and interrupted-result refund.
- Definition pinning and authoritative server replay.
- Stale-revision rejection and duplicate-command idempotency.
- Frontend controller/provider orchestration.
- Reload recovery of an already-started challenge.
- HTTP definition/session/command routes.
- Ordered-scale restart/completion semantics and Piano Games registration.
- Tappable hand rendering, explicit no-card states, and deduplicated blocked/empty-hand logs.

## Player-experience telemetry

Client journey events use the `gaming.*` namespace and always include `gameId`,
`sessionId`, `userId`, `revision`, and `turn` when a session exists:

| Event | Monitoring question |
|---|---|
| `gaming.session.ready` / `gaming.session.closed` | Did the player start, resume, finish, or abandon? How long were they present? |
| `gaming.card.selected` | Which scale did they choose, at what cost and turn? |
| `gaming.challenge.prepared` / `started` | Did setup stall before input became possible? |
| `gaming.challenge.completed` | How long to first input and completion; how many wrong notes/restarts; first try or recovered; persistence healthy? |
| `gaming.challenge.aborted` / `abandoned` | Did the player cancel, reload during play, or leave the surface? |
| `gaming.turn.ended` | Which announced intent resolved, how much damage was blocked, and did the player survive? |
| `gaming.hand.empty` | Did an authoritative player-choice state contain no cards? |
| `gaming.hand.blocked` | Were cards present but unplayable, and was energy the reason? |
| `gaming.session.completed` | Winner, turns, health, elapsed observation time, and aggregate challenge counts |

The backend separately emits `gaming.authority.challenge.resolved`,
`gaming.authority.challenge.aborted`, `gaming.authority.enemy.intent.resolved`, and
`gaming.authority.session.completed`. This keeps
authoritative outcomes distinct from browser experience events so dashboards do not
double-count them. Hand warnings are keyed by session revision and hand contents, preventing
React rerenders from producing duplicate alerts.

The production frontend build passes after restoring the already-declared, lockfile-pinned
`signalsmith-stretch` dependency to `frontend/node_modules`. The install changed no tracked
manifest or lockfile content. Existing Sass deprecation and bundle-size warnings remain.
