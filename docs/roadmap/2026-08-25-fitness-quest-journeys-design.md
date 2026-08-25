# Fitness Quest Journeys — Detailed Design

**Status:** Proposed  
**Created:** 2026-08-25  
**Owners:** Fitness  
**Decision:** Use verified heartbeats recorded during Fitness sessions as the default Quest currency. Convert them into clearly fictional **Journey Miles**; do not use GPS or inferred real-world distance in the first release.

---

## 1. Summary

A Fitness **Quest** gives a household or an individual a long-running, game-like destination. During a monitored Fitness session, each valid heart-rate sample contributes the actual number of heartbeats represented by its elapsed time. The Quest converts those heartbeats to **Journey Miles**, which advance a narrative path made of stages, checkpoints, gates, level-clear ceremonies, and an optional finale/boss ceremony.

The product promise is deliberately narrow and honest:

> Move your body with a heart-rate monitor; your real, measured heartbeats advance an imagined journey.

“Journey Miles” are a narrative unit, not a claim that the participant walked, ran, or cycled that distance. This avoids the false equivalence of treating a bicycle mile as a walking mile and makes the system work without GPS, cadence, Strava, or a declared workout type.

The system supports two complementary shapes:

1. **Personal Quest:** a participant’s cumulative Journey Miles carry them through a full path at their own pace.
2. **Collective Quest:** the household shares a sequence of short stages. Each person races only within the current stage. The first participant to open the next gate becomes its **Gatebreaker**; all participants are immediately advanced to the new stage so nobody remains permanently behind.

The heart-beat ledger is the source of truth. Quest position, winners, ceremony eligibility, and displays are deterministic projections of that ledger plus the Quest definition.

---

## 2. Problem and Product Intent

The Fitness app already has rich, session-by-session feedback: live HR charts, zone visualization, coins, session recaps, workout history, a consistency calendar, a longitudinal dashboard, and household momentum. It does not yet provide a durable, concrete answer to the question following a workout:

> “What did this move me toward?”

The Conqueror-style insight worth adopting is not literal virtual travel or a distance conversion table. It is the motivational loop:

```text
measured effort → visible progress → near milestone → ceremony/reward → next meaningful target
```

DaylightStation should make that loop fit the hardware and data it already owns. Fitness sessions are explicitly bounded, participants are identified, and the app already records a timed heart-rate series. Heartbeats are therefore the most universal first signal across dancing, cycling, walking, strength work, and video-based workouts.

### Goals

- Make each monitored Fitness session visibly advance a chosen personal or household Quest.
- Reward actual measured work without privileging an activity that happens to produce high GPS distance.
- Give children and adults a familiar game structure: worlds, levels, gates, checkpoints, a finale, and short celebrations.
- Make group participation motivating even when household members have very different fitness levels.
- Preserve exact, auditable reasons for every increment of Quest progress.
- Reuse existing Fitness session data; Quest v1 must not require a third-party service or wearable API beyond the current live heart-rate monitor flow.

### Non-goals for v1

- Measuring real-world travel, route maps, GPS, cadence, power, calories, or steps.
- Declaring a physiological fitness score, caloric burn, medical exercise prescription, or a comparison of fitness between people.
- Replacing the current in-session Treasure Box / coin mechanic.
- A general-purpose game engine or an exact recreation of a commercial game world.
- Automatic credit for activities performed outside a recorded Fitness session.

---

## 3. Existing Foundation

The proposed design uses existing data rather than inventing a second workout history.

| Existing capability | Current location | Role in Quests |
| --- | --- | --- |
| Five-second HR sampling | `frontend/src/hooks/fitness/MetricsRecorder.js` | Source samples for actual heartbeats. |
| Cumulative heartbeat timeline | `user:{id}:heart_beats` / compact `{id}:beats` timeline series | Source for a session’s per-person total. |
| Persisted sessions and participant summaries | Fitness session log + session API | Historical replay/backfill and session attribution. |
| Per-user HR zones | Fitness user config / `Zone.mjs` | Live feedback; not the Quest scoring rule. |
| Session calendar, Momentum, Longitudinal widgets | `frontend/src/modules/Fitness/widgets/` | Existing home-screen context which the Quest card complements. |
| Treasure Box coins | existing live Fitness gameplay | A separate, zone-multiplied, short-session reward system. |

The recorder already calculates the needed integral per sample:

```js
deltaBeats = (heartRate / 60) * intervalSeconds
```

The Quest system must calculate from preserved timed samples or a canonical persisted heartbeat total—not from the live UI’s rounded chart values. A completed session is credited once, server-side.

### Why Quest Miles must not reuse coins

Coins are intentionally a zone game: active, warm, hot, and fire zones earn different rates. That is a good in-session feedback loop, but it is not “actual heartbeats.” If coins also became distance, a participant could not explain why 10,000 recorded beats resulted in one distance on one day and another elsewhere. Quests therefore retain two currencies:

| Currency | Meaning | Scope |
| --- | --- | --- |
| **Coins** | Zone-weighted play/reward signal | One live Fitness session |
| **Quest beats / Journey Miles** | Measured heartbeat accumulation converted by a stable Quest rule | A personal or collective long-running Quest |

---

## 4. Measurement Contract

### 4.1 Canonical heartbeat calculation

For every valid sample `i` belonging to participant `p` in a completed Fitness session:

```text
beats_i = bpm_i × elapsed_seconds_i / 60
session_beats_p = Σ beats_i
```

Where:

- `bpm_i` is finite, positive, and within the Quest’s configured sanity range.
- `elapsed_seconds_i` comes from the session timebase, not a hard-coded assumed interval.
- samples during a sensor dropout produce zero beats.
- samples are attributed only to the participant resolved by the Fitness session at that time.

Internally retain fractional beats for accurate accumulation. Present only rounded whole beats and Journey Miles rounded to two decimals.

### 4.2 Validity and integrity rules

1. A Quest can credit only a **completed, persisted Fitness session**. Live display is provisional.
2. Reject or quarantine impossible data (`bpm < 35`, `bpm > 240`, negative elapsed time, malformed timebase). These bounds are a data-quality guard, not a health judgement.
3. A missing reading earns no credit. Do not fill a dropout using the prior HR value.
4. Do not credit samples captured while the monitor is unmapped, unless the session has explicitly resolved the sample to a participant.
5. The same `session_id` and participant may contribute to a Quest at most once. Replays and retries are idempotent.
6. Corrections or deletion of a session create a compensating ledger entry; they never silently mutate historical credits.
7. A Quest uses the configuration snapshot that was active when the contribution was committed. Later tuning never rewrites history.

### 4.3 Baseline policy

The default is **actual session heartbeats**, not “beats above resting heart rate.” A participant with a higher measured HR advances more quickly for the same session duration, as intended by the initial product direction.

This needs one guardrail: Quest credit exists only inside a purposeful Fitness session. The system must not count an entire day of background heartbeats.

An optional future `active_only` policy may count only samples at or above a participant’s `active` zone threshold. It is explicitly deferred because it changes the intuitive rule from “my heartbeats count” to “some of my heartbeats count,” and would discourage gentle starts and recovery work.

### 4.4 Journey-Mile conversion

Each Quest stores an immutable conversion ratio:

```text
journey_miles = credited_beats / beats_per_journey_mile
```

**Initial default:** `1,000 beats = 1 Journey Mile`.

At that calibration, a 30-minute session produces approximately:

| Average HR | Heartbeats | Journey Miles |
| ---: | ---: | ---: |
| 100 bpm | 3,000 | 3.00 |
| 120 bpm | 3,600 | 3.60 |
| 150 bpm | 4,500 | 4.50 |

This produces a five-mile stage about once per substantial session, which is frequent enough for level-clear feedback without making a Quest feel instantly completed. The conversion ratio is a Quest-authoring choice, not a user-specific fairness setting. In v1 it should be chosen from a small set of tested presets rather than exposed as arbitrary free-form tuning.

---

## 5. Quest Model

### 5.1 Vocabulary

| Term | Definition |
| --- | --- |
| **Quest** | A configured narrative journey, personal or collective. |
| **Journey Mile** | A fictional distance unit earned from a stable number of real heartbeats. |
| **World** | A thematic grouping of stages, used for art and narrative. |
| **Stage** | A bounded segment of a Quest, normally five Journey Miles. |
| **Gate** | The threshold at the end of a stage. |
| **Gatebreaker** | In a collective Quest, the participant whose accepted contribution first crosses the current gate. |
| **Checkpoint** | A durable stage boundary and optional ceremony trigger. |
| **Ceremony** | A short, intentional presentation shown after a stage, world, or Quest completion. |
| **Finale / Boss** | A special terminal stage and ceremony; an original thematic construct, not a licensed character or game asset. |

### 5.2 Quest definition

Quest content is declarative. The scoring engine must not know about individual themes, artwork, videos, or ceremony mechanics.

```yaml
id: kingdom-run
title: Kingdom Run
mode: collective-stage-race # personal | collective-stage-race
beats_per_journey_mile: 1000
credit_policy:
  source: fitness-session-heartbeats
  min_bpm: 35
  max_bpm: 240
stages:
  - id: meadow-1
    world: meadow
    title: Meadow Path
    distance_miles: 5
    checkpoint_ceremony: quest-level-clear
  - id: meadow-2
    world: meadow
    title: Cloud Bridge
    distance_miles: 5
    checkpoint_ceremony: quest-level-clear
  - id: meadow-castle
    world: meadow
    title: Meadow Gate
    distance_miles: 8
    checkpoint_ceremony: quest-world-clear
    finale: true
```

An original “platform adventure” visual language is acceptable. Exact Nintendo characters, levels, maps, music, sounds, or imagery are not Quest content unless DaylightStation has the relevant license.

### 5.3 Quest state

Store definitions separately from household/person-specific runs. The definition says what the journey is; a run says where particular people are in it.

```text
QuestDefinition
  id, title, mode, conversion ratio, stage definitions, presentation references

QuestRun
  id, definition_id, scope (household | personal), owner/participants,
  state (active | ceremony_pending | complete | archived), current_stage_id,
  started_at, completed_at, definition_snapshot

QuestContribution (append-only ledger)
  id, run_id, session_id, participant_id,
  credited_beats, credited_miles, committed_at,
  source/timebase metadata, reversal_of?

QuestStageResult
  run_id, stage_id, stage_number, opened_at, cleared_at,
  gatebreaker_id?, gatebreaker_contribution_id?, ceremony_status
```

### 5.4 Scope and membership

- A **personal run** has one owner. Its stage position is cumulative; nobody can move it or reset it.
- A **collective run** belongs to one household and has an explicit participant list. Adding someone midway makes them eligible from the next stage by default; it must not reassign a past Gatebreaker.
- A participant can be enrolled in one active personal Quest and one active collective Quest in v1. One accepted contribution may advance both, each using its own independent ledger entry and conversion ratio.

---

## 6. Collective Stage-Race Semantics

The collective design is intentionally not “every person must reach the gate.” That would leave less frequent participants visibly stranded. Instead it makes each stage a fresh, contained chance to lead.

### 6.1 Stage positions

For the current stage only, each enrolled participant has:

```text
stage_miles(participant) = sum(accepted contributions since current stage opened)
```

At a new stage, every participant’s visible stage position begins at `0.00 / stage_distance`. Their all-time and Quest-total contributions remain unchanged.

### 6.2 Gate opening transaction

When a contribution takes a participant to or beyond the current stage distance:

1. Commit that contribution to the append-only ledger.
2. Acquire the Quest-run concurrency guard and re-read its current stage/version.
3. If another contribution already opened the stage, apply this contribution to the newly current stage only if it was recorded after the transition; otherwise retain it as an audited but non-racing contribution according to the policy below.
4. Record the crossing participant as Gatebreaker.
5. Close the stage atomically, record a `QuestStageResult`, and advance the run to `ceremony_pending` for the next stage.
6. Set every participant’s next-stage visible position to zero.
7. Publish a `fitness.quest.stage-cleared` event containing the Quest, stage, Gatebreaker, and ceremony reference.

The atomic stage transition is mandatory. The server, not a browser, decides the winner. This prevents two devices that submit at nearly the same time from both claiming the gate.

### 6.3 Boundary and overflow policy

The final accepted sample can take a participant a few beats past the gate. In v1:

- The display caps their race position at the gate for the completed stage.
- The whole credited amount remains in their all-time ledger and personal contribution history.
- The overage does **not** grant a head start in the following stage.

This creates a real reset. It is the correct tradeoff for a household race: an enthusiastic participant cannot clear a series of gates in one uninterrupted session while the others never see a new beginning.

### 6.4 Ceremony-pending state

While a gate ceremony is pending, a collective Quest does not open a second gate. New completed-session contributions are retained in the ledger but are marked `awaiting_stage_resume`. Once the ceremony is acknowledged or a configured expiry occurs, the next stage becomes active and pending contributions are applied in chronological order.

This prevents a long workout from bypassing the family’s level-clear moment. It also makes the user experience legible: **clear gate → celebrate → begin new level**.

V1 may choose a short automatic expiry (for example, after the post-workout screen is dismissed) so an absent household member does not block the Quest indefinitely.

### 6.5 Collective display

The active collective card must show:

- current world and level;
- gate distance and each participant’s current-stage progress;
- the leader only as “closest to the gate,” never a global fitness ranking;
- previous stage’s Gatebreaker and contributions;
- a prominent next event: “0.82 Journey Miles until the Meadow Gate opens.”

Avoid red “losing” states. A participant behind the stage leader has not failed; they will start beside everyone else at the next gate.

---

## 7. Personal Quest Semantics

Personal Quests use the same ledger and conversion math, but no collective reset.

- Progress carries continuously across all stages.
- A person sees their own current-stage distance, total Journey Miles, and next ceremony.
- A personal stage may be cleared during a session; the same ceremony-pending policy can defer the next narrative scene, but it must not erase legitimate personal excess credit.
- Unlike a collective run, personal Quest overflow carries into the next stage. The participant earned it and is not competing for a fresh shared start.

Personal and collective Quests intentionally offer different motivational contracts:

| Dimension | Personal Quest | Collective Quest |
| --- | --- | --- |
| Progress model | Continuous cumulative path | Short resettable stage races |
| Milestone owner | The participant | The household; Gatebreaker opens it |
| Overflow | Carries forward | Preserved in history, no next-stage head start |
| Social pressure | None | Temporary and bounded to current stage |

---

## 8. User Experience

### 8.1 Fitness home

Add a Quest widget to the Fitness home screen alongside Momentum, calendar, sessions, and coaching.

**Idle state**

```text
Choose a Quest
Turn monitored heartbeats into Journey Miles.
Start a personal adventure or a household stage race.
```

**Active personal Quest**

```text
KINGDOM RUN · Meadow Path
3.42 / 5.00 Journey Miles
1,580 beats to the Cloud Bridge
Next ceremony: Level Clear
```

**Active collective Quest**

```text
KINGDOM RUN · Level 2 — Cloud Bridge
Gate opens at 5.00 Journey Miles
Alex 3.42 · Sam 2.08 · Riley 0.94
Alex is closest to the gate
Everyone begins the next level together.
```

The widget should make “why” inspectable. Tapping a person or a stage opens the contribution ledger, not an opaque score.

### 8.2 Post-session receipt and recap

After a session is persisted, show a lightweight Quest increment before or alongside the normal session recap:

```text
Quest progress
+3,412 heartbeats
+3.41 Journey Miles
Cloud Bridge: 3.42 / 5.00
```

If a gate was crossed, replace that line with an explicit event:

```text
GATE OPENED
Alex cleared Cloud Bridge for the household.
Everyone enters Meadow Gate together.
```

### 8.3 Ceremonies

A ceremony is presentation, never scoring. It receives a structured event payload and cannot decide a winner or alter the ledger.

```js
{
  type: 'fitness.quest.stage-cleared',
  runId,
  questId,
  stage: { id, title, world, distanceMiles },
  nextStage: { id, title, world } | null,
  gatebreaker: { id, displayName },
  results: [{ participantId, stageMiles }],
  ceremony: 'quest-level-clear',
}
```

Initial ceremony forms, in increasing richness:

1. **Receipt ceremony:** full-screen level-clear card, Gatebreaker name, next-world preview, sound-free by default.
2. **Screen scene:** original visual scene/animation presented on the Fitness screen after the workout.
3. **Configured experience:** an approved content/module launch that consumes the event payload and reports completion/skip. This is the integration seam for future household-specific ceremony sets.

No local system named “Chris Carnival” was identified during design research. Treat any such ceremony collection as a future presentation adapter until its location, asset contract, and licensing status are known.

### 8.4 Accessibility and household tone

- Never require a ceremony to be watched to preserve progress.
- Offer reduced-motion and mute defaults.
- Use words such as “contributed,” “opened,” and “next chance,” not “beat,” “lost,” or “failed.”
- Show both Journey Miles and raw heartbeats; raw data builds trust.
- A guardian/admin can pause, archive, or restart a Quest without deleting session history.

---

## 9. Architecture

### 9.1 Domain layer

Add a pure `quest` domain under `backend/src/2_domains/fitness/` (or `2_domains/quest/` if the concept later expands beyond Fitness). For v1, keeping it within fitness expresses the bounded context clearly.

```text
2_domains/fitness/quests/
  entities/
    QuestDefinition.mjs
    QuestRun.mjs
    QuestContribution.mjs
    QuestStageResult.mjs
  services/
    HeartbeatCreditCalculator.mjs
    QuestProgressProjector.mjs
    CollectiveStageTransition.mjs
  value-objects/
    JourneyMiles.mjs
    QuestMode.mjs
    QuestRunState.mjs
```

Responsibilities:

- validate definitions and immutable snapshots;
- integrate valid timed HR samples into heartbeat totals;
- project personal and collective state;
- decide whether a contribution clears a stage;
- produce state-transition facts, but perform no I/O and launch no ceremony.

### 9.2 Application layer

```text
3_applications/fitness/quests/
  ports/
    IQuestRunRepository.mjs
    IQuestContributionRepository.mjs
    IQuestDefinitionRepository.mjs
  usecases/
    CreateQuestRun.mjs
    ListQuestRuns.mjs
    GetQuestProgress.mjs
    CreditCompletedFitnessSession.mjs
    AcknowledgeQuestCeremony.mjs
    ReverseQuestSessionCredit.mjs
```

`CreditCompletedFitnessSession` receives a completed session, extracts canonical participant heartbeat totals, calls the domain calculator, appends idempotent contribution entries, advances a collective stage under a repository transaction/lock, and publishes the resulting events.

This use case must be called from the existing finished-session path after a session is durable. It must not be invoked from a React live tick.

### 9.3 Adapters and persistence

V1 can use YAML persistence consistent with Fitness session storage. Repository implementation details belong in `1_adapters/persistence/yaml/`; session logs remain untouched.

Suggested layout:

```text
data/household/fitness/quests/
  definitions/<quest-id>.yml
  runs/<run-id>.yml
  contributions/<run-id>/<contribution-id>.yml
  stage-results/<run-id>/<stage-number>.yml
```

The exact physical layout may evolve, but contributions must remain append-only and must be keyed by `(run_id, session_id, participant_id)` for idempotency. The repository must provide an atomic compare-and-swap or filesystem lock around collective stage transition.

### 9.4 API and events

Add v1 endpoints under `/api/v1/fitness/quests`:

| Method | Path | Responsibility |
| --- | --- | --- |
| `GET` | `/quests` | List available definitions and active runs visible to the household/user. |
| `POST` | `/quests/runs` | Start a personal or collective run from a definition. |
| `GET` | `/quests/runs/:id` | Return progress projection plus recent contributions/stage results. |
| `POST` | `/quests/runs/:id/ceremony/acknowledge` | Close/skip a pending ceremony and activate the next stage. |
| `POST` | `/quests/runs/:id/pause` | Pause a run; requires existing Fitness management authorization. |
| `POST` | `/quests/runs/:id/archive` | Archive a run without deleting its ledger. |

Events:

```text
fitness.quest.contribution-credited
fitness.quest.stage-cleared
fitness.quest.ceremony-pending
fitness.quest.ceremony-acknowledged
fitness.quest.completed
fitness.quest.credit-reversed
```

Event payloads carry IDs and projections, not raw HR timelines.

### 9.5 Frontend

```text
frontend/src/modules/Fitness/widgets/FitnessQuest/
  FitnessQuestWidget.jsx
  QuestProgressCard.jsx
  QuestStageRace.jsx
  QuestLedgerDrawer.jsx
  QuestCeremonyOverlay.jsx
  questApi.js
```

The screen framework widget fetches a server projection. It must not recalculate past heartbeat totals in the browser. A focused pure view-model helper can format miles, pace, and contributor state for test coverage.

---

## 10. Data Projection and Reconciliation

### 10.1 Completed-session credit flow

```text
Fitness session completes and persists
          ↓
Canonical heartbeat totals are derived from its timeline/timebase
          ↓
CreditCompletedFitnessSession finds eligible active Quest runs
          ↓
Append idempotent contribution(s)
          ↓
Project personal/collective state; atomically resolve any gate
          ↓
Persist stage result and publish event
          ↓
Home widget / post-session recap / ceremony consume projection
```

### 10.2 Historical backfill

Do not silently credit every historical session when a Quest starts. A Quest begins at its chosen start timestamp. An explicit administrator-only “seed Quest from past N days” action may be considered later, but it must create clearly labelled seed entries and cannot fabricate per-stage Gatebreaker results.

### 10.3 Session edits and deletion

Session correction is exceptional but must be coherent:

- If a credited session is deleted or its canonical heartbeat attribution changes, append a reversal or correction contribution.
- Reproject the current Quest from the ledger.
- If the affected contribution had cleared a historical collective gate, preserve the historical ceremony record but mark the run as `needs_reconciliation` for guardian review rather than silently rewriting who won.

This is preferable to a surprising retroactive teleportation of household members.

---

## 11. Testing and Acceptance Criteria

### Domain tests

- Integrates varying HR samples and non-uniform time intervals accurately.
- Rejects invalid BPM/timebase values and never produces negative credit.
- Does not count dropout intervals.
- Uses the Quest’s immutable conversion snapshot.
- Projects one and many personal stages, including overflow.
- Projects collective stages and caps stage display at the gate.
- Guarantees one Gatebreaker when two valid crossing contributions race.
- Does not carry collective overflow into the next stage.
- Retains total participant contribution despite a collective stage reset.

### Application/repository tests

- Replaying the same completed session does not double-credit a run.
- One session may advance one personal and one collective run independently.
- Ceremony-pending blocks a second collective gate.
- Acknowledgement activates the next stage and applies queued contributions in order.
- A session deletion produces a visible compensating ledger record.
- Household authorization prevents an unrelated user from reading or changing a run.

### UI tests

- Shows raw beats, Journey Miles, stage target, and contribution explanation.
- Shows an accessible zero/empty/loading state.
- Does not render a participant as a permanent loser after a stage advances.
- Ceremony skip/reduced-motion path preserves progress.
- Post-session recap receives exactly one Quest progress event.

### Product acceptance examples

1. A participant records 30 minutes at 120 BPM in a valid Fitness session. The Quest credits approximately 3,600 beats and 3.60 Journey Miles under the default ratio.
2. A 10-minute sensor dropout adds no Quest beats, even if the session continued playing video.
3. In a five-mile collective stage, the first participant to reach 5.00 miles opens the gate. Every enrolled participant immediately sees the next stage at `0.00 / target`; each can still inspect their contribution to the prior stage.
4. A participant reaches a gate with 5.03 stage miles. Their all-time total includes the full 5.03-mile equivalent, while their next collective stage begins at zero.
5. A personal Quest participant crossing a stage with 5.03 miles begins the next personal stage with 0.03 miles carried forward.

---

## 12. Rollout Plan

### Phase 0 — Measurement audit

- Confirm one canonical persisted representation of participant heartbeat totals and timebase across normal, split, merged, and strength sessions.
- Add fixtures covering mixed participants, handoffs, and HR dropout.
- Do not expose a Quest UI yet.

### Phase 1 — Domain ledger and personal Quest

- Implement definitions, runs, contribution ledger, heartbeat credit calculation, and read API.
- Start one original, unlicensed Quest definition.
- Surface a personal Quest card and post-session increment only.
- Verify all ledger events against existing session timelines.

### Phase 2 — Collective stages

- Add collective run mode, locking/CAS, Gatebreaker, stage results, and reset semantics.
- Display short current-stage races on the household Fitness home.
- Add a simple level-clear receipt ceremony with acknowledgement/expiry.

### Phase 3 — Narrative content and ceremony adapter

- Author original worlds, stages, finale language, artwork, and accessible scenes.
- Add the event-to-ceremony presentation contract.
- Integrate any household-specific ceremony collection only after its technical and licensing contract is documented.

### Phase 4 — Tuning and optional extensions

- Review actual completion cadence before changing the default conversion ratio.
- Consider an `active_only` credit policy, seasonal Quest templates, team-vs-team variants, and optional external activity ingestion.
- Do not add GPS/distance until it serves a separate, explicitly named product promise.

---

## 13. Open Decisions

1. **Ceremony acknowledgement:** should the level clear occur immediately after the gate opens, at the end of the triggering session, or on the next household Fitness-home visit? Phase 2 should begin with end-of-session plus automatic expiry.
2. **Quest authoring audience:** v1 should ship with curated YAML definitions. A household Quest editor should wait until the scoring and ceremony contract has proven stable.
3. **Membership changes:** should a new participant join current collective stage at zero or only at the next stage? Default: next stage, to keep the race understandable.
4. **Multi-session delayed sync:** v1 credits only sessions recorded in the native Fitness flow. Any later harvester integration needs timestamps plus deterministic ordering and cannot assume “now” is the time the activity happened.
5. **Existing ceremony collection:** identify the “Chris Carnival” reference before committing to a renderer or content dependency.

---

## 14. Design Decisions Record

| Decision | Rationale |
| --- | --- |
| Heartbeats, not GPS or distance conversions | Universal to the monitored Fitness experience; fairly represents harder work without claiming real travel. |
| `1,000 beats = 1 Journey Mile` initial default | Easy to explain and yields roughly one five-mile stage per substantial session. |
| Only credit completed native Fitness sessions | Avoids background/resting HR and keeps attribution and auditability strong. |
| Coins and Quest Miles remain separate | Coins are deliberately zone-multiplied; Quest mileage must remain raw and explainable. |
| Collective stages reset all visible positions | Prevents permanent lag and creates repeated chances to lead. |
| Historical contribution never resets | The stage reset is social presentation, not erasure of work. |
| Server resolves gates atomically | Ensures one winner and correct behavior across simultaneous devices. |
| Original platform-adventure themes only | Retains the familiar motivation without using unlicensed game IP. |

