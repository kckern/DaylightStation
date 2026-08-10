# Gamified Learning — Scale Stadium Practice Journey

**Started:** 2026-08-09

**Journey implementation:** 2026-08-10

**Status:** Implemented; supervised replay-willingness pilot remains open.

**Design context:** `2026-08-09-gamified-learning-framework-design.md`

## Purpose

Scale Stadium is a Pokémon-themed replay loop whose primary job is better piano
practice. Combat, collection, and household competition make practice inviting;
they do not replace, skip, or weaken the required piano performance.

The game is registered at `/piano/games` and deep-links at
`/piano/games/card-game`. It uses the PianoKiosk player identity, falling back to
an explicitly unranked `guest` run.

## Implemented player loop

1. The player sees their weekly best, household record, skill mastery, and three
   mechanically equivalent partners: Bulbasaur, Charmander, or Squirtle.
2. The chosen partner travels through three encounters: Pidgey, Meowth, and
   Snorlax. Health resets at each cleared checkpoint.
3. Every move launches a real Piano-owned challenge. The four move slots always
   map to scales, root-position chords, arpeggios, and short rhythm patterns.
4. The first encounter teaches the three foundation moves. Clearing it unlocks
   the rhythm signature move.
5. A successful performance resolves the announced enemy intent, saves practice
   evidence, and updates the live run score. Checkpoints show the next household
   rival without interrupting active practice.
6. Defeat retries the same opponent with fresh health while retaining every
   completed practice attempt. Completing all three encounters produces a
   versioned score and offers replay or partner change.

Partner type is presentation only. Each partner has the same damage, shield,
focus, challenge-kind, threshold, and scoring structure.

## Piano success contract

The piano result maps directly to hit quality. Pokémon type effectiveness is not
part of practice success.

| Normalized piano score | Battle result | Authored power |
|---:|---|---:|
| `0.90–1.00` | Direct hit — bullseye | 125% |
| `0.75–0.89` | Direct hit | 100% |
| `0.50–0.74` | Partial hit | 65% |
| `0.00–0.49` | Miss; practice still counts | 25% |

The low miss damage keeps the journey moving without calling an inaccurate
performance successful. Timeout and player-aborted attempts resolve as zero-score
misses and allow the announced enemy action. Provider or infrastructure errors
refund the move, do not create practice evidence, and make the run unranked.

Ordered journey exercises no longer restart on a wrong note. The player corrects
the highlighted target and continues, preserving continuity evidence. The legacy
standalone scale challenge retains its authored mistake-limit behavior.

### Grading

- Untimed scale/arpeggio: 70% pitch accuracy, 30% continuity.
- Paced scale/arpeggio/rhythm: 55% pitch accuracy, 30% timing, 15% continuity.
- Chord: 70% target pitch set, 30% onset simultaneity.

Piano selects unattempted exercises before revisiting the weakest exercise in a
skill family. After two performances at or above 85%, it introduces a 60 BPM
pulse. Two recent paced results above 90% raise tempo by 5 BPM; below 70% lowers
it by 5 BPM, clamped to 40–120 BPM.

The foundation curriculum currently contains:

- C, G, F, and D major scales.
- C, F, and G major/minor root chords.
- C, G, and F major arpeggios.
- Three short four-to-six-note patterns.

## Cross-session progression and competition

Completed attempts feed persistent skill stars, encounter badges, partner
evolution, mastery aura, and personal best. A completed journey plus two-star
mastery across all four skills evolves that partner; three-star mastery adds the
aura.

The server derives a run score from immutable terminal state:

| Component | Maximum |
|---|---:|
| Mean piano challenge score | 8,500 |
| First-pass rate | 1,000 |
| Opponents completed | 300 |
| Skill-family breadth | 200 |
| **Total** | **10,000** |

A ranked run must clear all three opponents, contain at least six completed
performances, and have no provider/infrastructure invalidation. Rankings are
partitioned by journey and score version.

- Weekly standings use the kiosk's local Monday-to-Monday week.
- Each user contributes only their best run; the attempt count remains visible.
- Ties go to the earlier completion.
- The lobby shows personal weekly best, all-time household record, and leader.
- Checkpoints show the next rival to catch.
- Guest sessions can play but never appear in saved progress or standings.

## Structural seams

| Seam | Implementation |
|---|---|
| Shared authority | `shared/gaming/pokemonJourney.mjs` reducer and read model |
| Authored content | `shared/gaming/definitions/card-game.yml` |
| Definition validation | `shared/gaming/definition.mjs` |
| Session authority | `backend/src/3_applications/gaming/GamingSessionService.mjs` |
| Progress and rankings | `GET /api/v1/gaming/games/:gameId/progress` and `/leaderboard` |
| Piano adaptation | `backend/src/3_applications/piano/PianoScaleChallengePolicy.mjs` |
| MIDI grading | `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js` |
| Kiosk runtime | `frontend/src/modules/Gaming/runtime/GamingRuntime.jsx` |
| Lobby and battle | `PokemonJourneyLobby.jsx` and `PokemonJourneyView.jsx` |
| Live readiness | `node cli/piano-card-game.cli.mjs` |

The legacy `card-battle-v1` reducer and generic `/gaming` fixture remain supported,
but `card-game` now pins the purpose-built `pokemon-practice-journey-v1` contract.
An active session whose definition hash no longer matches is explicitly abandoned
before a new journey begins.

## Verification

Focused tests cover:

- All three partners and their isomorphic four-skill move sets.
- Signature locking and checkpoint unlock.
- Direct, partial, miss, timeout, provider-error, retry, and retained-evidence behavior.
- Versioned 10,000-point scoring and ranked-run qualification.
- Adaptive exercise selection and tempo changes.
- Pitch/continuity, pitch/timing/continuity, and chord/simultaneity grading.
- Household best-run deduplication, weekly standings, tie order, rivals, mastery,
  evolution, and guest exclusion.
- Lobby, battle, challenge-overlay, and hit-feedback rendering.
- The 1280×800 lobby and battle layout in Chromium.

The live CLI validates the deployed definition and all six SVGs, opens the real
PianoKiosk route, selects Bulbasaur, sends MIDI through the kiosk WebSocket
contract, exercises every skill family, clears all three opponents, and checks
the final summary for viewport overflow and API/page failures.

## Remaining field gate

The code is ready for supervised play, but the experience claim is not proven
until children choose to replay it. Measure:

- Journey completion and voluntary replay rate.
- Challenge duration and abort/timeout rate per skill family.
- Direct/partial/miss distribution and tempo movement.
- Whether players can explain why a hit was direct, partial, or missed.
- Whether sibling standings motivate another run without encouraging identity
  swapping or score farming.
- Piano improvement against an equivalent non-game practice baseline.

Keep the purpose-built reducer until a second approved learning game provides
evidence for a repeated mechanic. Do not generalize this journey into a broader
DSL based on one successful presentation.
