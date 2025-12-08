Fitness Session Data Review (session 20251207185402)

- Effectiveness of saved data
	- Captures detailed timebase (5s ticks, 2,717 ticks) plus treasureBox coin buckets, device/user heart_rate, zone_id, rpm, power, speed, and coins_total—sufficient for post-session analytics.
	- Media activity is present (multiple music starts, a video start for “Super Smash Bros Fitness”), so cross-modal timelines are preserved.
	- However roster is empty while user/device series exist, reducing interpretability of user-linked metrics and violating expected participant roster contract.
	- End time equals start time, suggesting session finalization was not recorded; undermines duration/recency analytics.
	- Series values are persisted as long JSON strings (quoted) instead of structured arrays, inflating size and requiring extra parsing to consume.
	- Repeated challenge_end events (dozens of duplicates at tick 86) inflate noise and may bias governance/challenge analytics.

- Architectural principle adherence (0–5, higher is better)
	- Snapshot completeness: 2/5 — core streams recorded but roster/playQueue/zoneConfig snapshots are missing or empty.
	- Type fidelity: 2/5 — endTime not updated; coins/zone/HR present but inconsistent shapes.
	- Domain modeling: 3/5 — timeline and treasureBox data align with FitnessSession timeline/coin model; device/user IDs carried through.
	- Observability/diagnostics: 3/5 — challenge events and media events logged, but excessive duplicates and lack of eventLog export limit clarity.
	- Data hygiene: 1/5 — duplicated challenge_end entries, null-filled long tails, and empty roster suggest missing guards/validation before persist.
    Notes: Arrays are stores as strings for improved YAML readability, this will NOT be fixed, and is by design.

- Possible applications
	- Heart-rate zone adherence analysis over time for each user/device; zone streaks, time-in-zone, and recovery curves.
	- Reward/coin accrual auditing and gamification insights (per-user coin pacing, bucket mix from treasureBox).
	- Media-to-effort correlation (e.g., HR response to specific songs/videos such as “Super Smash Bros Fitness”).
	- Device reliability checks (dropped RPM/power to zero; comparing device vs user heart_rate alignment).
	- Challenge outcome retrospectives (success/failure per zone and participant) once duplication is cleaned.

- Areas for improvement
	- Ensure roster and participant mappings are written alongside series to preserve identity and display labels; fail persistence if roster is empty while user data exists.
	- Fix session lifecycle bookkeeping: set endTime on completion and avoid startTime=endTime; record duration explicitly.
	- Debounce/deduplicate challenge_end emissions (tick 86 shows many duplicates); add validation before writing to timeline.
	- Validate timeline ticks against timebase (tickCount vs series length) and drop zero-only device metrics (rpm/power/speed) to shrink payloads.
    - Improve series compression by creating a dictionary encoding for repeated values instead of long quoted JSON strings.  For example, store [0,0,0,1,1,1,0,0] as [[0,3],[1,3],[0,2]] to indicate runs of repeated values.  Also use 1-letter keys instead of full words in the series objects (e.g., "W" for heart_rate zone "warm", "H" for heart_rate, "C" for coins_total, etc).
    - Use human readable datatime strings (ISO 8601) instead of epoch milliseconds for startTime and endTime to improve readability in logs and exports.


## Suggestions for Architcture Improvements
- Structural issues first
	- Persist roster and device→user assignments at each snapshot so downstream series can be resolved without inference.
	- Record session lifecycle transitions (start/end/duration) atomically; disallow startTime=endTime and require a non-null endTime before persist completes.
	- Enforce deduping on challenge events per tick/key to prevent explosion (e.g., multiple challenge_end at tick 86).
	- Validate timebase vs series lengths before write; drop or compress trailing nulls/zero-only stretches to avoid oversized payloads.
	- Maintain the design choice of quoted arrays for readability but add run-length or dictionary compression to keep structure compact and deterministic.

## Detailed Design Spec
- Scope and goals
	- Guarantee structurally sound fitness session exports that are self-describing, deduped, and size-efficient while retaining the existing “arrays-as-strings for readability” constraint.
	- Preserve identity mapping (roster and device→user assignments) and lifecycle integrity (start/end/duration) for downstream analytics.

- Data model adjustments
	- Snapshot payload must include: roster[], deviceAssignments (Map or object), timebase { startAbsMs, intervalMs, tickCount, lastTickTimestamp }, and series grouped by entity (device:ID:* and user:slug:*).
	- Lifecycle fields: sessionId, startTime, endTime (ISO 8601), durationMs (derived), lastActivityTime.
	- Media log: compact list of media events with timestamps and minimal fields (id, title, type, volume).
	- Challenge log: one entry per challenge id + tick; statuses deduped; include zone/participants/result.

- Series encoding (retaining quoted arrays)
	- Use run-length encoding for repeated numeric spans: e.g., [0,0,0,1,1,1,0,0] → [[0,3],[1,3],[0,2]].
	- Use small dictionaries for categorical values: zone_id uses map { c: "cool", a: "active", w: "warm", h: "hot" }; store encoded array as string of symbols with optional RLE.
	- Heart-rate and numeric series: RLE numeric tuples; allow sparse null runs; drop trailing null-only segments.
	- Maintain deterministic ordering: timebase-aligned arrays of length == tickCount (after compression validation).

- Validation rules (pre-persist)
	- roster must be non-empty if any user series exist; fail persist otherwise.
	- endTime must be set and > startTime; durationMs > 0.
	- tickCount must match decoded series lengths; reject on mismatch.
	- challenge events: at most one record per {challengeId, tickIndex, type}; dedupe before write.
	- Drop zero-only device metrics (rpm/power/speed) unless explicitly flagged as meaningful.
	- Enforce max size per series blob; truncate with reason if exceeded.

- Serialization flow
	- Collect snapshot → validate lifecycle → dedupe events → encode series (RLE/dict) → stringify arrays → write YAML.
	- Store ISO 8601 timestamps for startTime/endTime and epoch milliseconds for internal calculations.
	- Include compression metadata per series (encoding: rle, dict, plain; symbol map version).

- Backfill/migration
	- Add a migration step that rewrites existing sessions to include endTime, durationMs, and roster where derivable; re-encode series with RLE and symbol dictionaries.
	- Keep original raw data alongside migrated fields for audit until confidence is established.

- Ownership and testing
	- FitnessSession persist path owns validation/encoding; ZoneProfileStore/TreasureBox unaffected beyond data availability.
	- Tests: (1) lifecycle validation; (2) roster-required gate; (3) challenge dedupe; (4) series length vs tickCount; (5) RLE encode/decode round-trip; (6) size cap enforcement.

## Implementation Targets (files/functions)
- `frontend/src/hooks/fitness/FitnessSession.js`
	- `_persistSession(sessionData, opts)`: add lifecycle validation (start/end/duration), roster-required gate, size caps, and compression metadata; invoke series encoder before YAML write.
	- `_maybeAutosave` / `_startAutosaveTimer` paths: ensure they call the validated persist routine and fail fast on invalid snapshots.
	- `_collectTimelineTick` and `_maybeTickTimeline`: enforce tickCount alignment; reject or trim series that diverge from `timebase`.
	- Challenge logging site (where `challenge_end` is appended): dedupe per `{challengeId, tickIndex, type}` before writing to timeline/eventJournal.
	- Roster/device assignment capture: ensure `updateSnapshot` writes `roster` and `deviceAssignments` into snapshot before persist.

- `frontend/src/hooks/fitness/FitnessTimeline.js`
	- Add helpers to validate series length vs `timebase.tickCount` and to compute derived `durationMs` for lifecycle validation.

- `frontend/src/hooks/fitness/EventJournal.js` (or event emit site)
	- Centralize challenge event dedupe; guard against repeated `challenge_end` spam.

- `frontend/src/hooks/fitness/ZoneProfileStore.js` and `TreasureBox.js`
	- No structural changes; ensure data availability for roster/zone snapshots consumed during snapshot assembly.

- Migration script (new): `scripts/migrate-fitness-sessions.mjs`
	- Read historical YAML sessions, inject `endTime`/`durationMs`/`roster` when derivable, re-encode series with RLE/dictionary, and emit alongside originals for audit.

- Tests
	- `frontend/src/hooks/fitness/__tests__/FitnessSession.persistence.test.js`: lifecycle validation, roster gate, size cap, challenge dedupe, tickCount alignment, RLE round-trip.

## Phased Implementation Plan
- Phase 1: Validation and lifecycle hardening
	- Implement lifecycle checks in `_persistSession` (start/end/duration) and roster-required gate; add size caps and tickCount alignment guards.
	- Wire validation into autosave/persist paths; add unit tests for failure modes.

- Phase 2: Event hygiene
	- Add challenge event dedupe and enforce single record per `{challengeId, tickIndex, type}`.
	- Add media/challenge minimal logs and ensure they serialize compactly.

- Phase 3: Series compression
	- Implement RLE/dictionary encoder/decoder for numeric and categorical series; drop trailing null/zero runs.
	- Emit compression metadata; validate round-trip in tests.

- Phase 4: Snapshot completeness
	- Ensure roster and device→user assignments are captured in every snapshot; fail fast when missing.
	- Add timebase vs series length validation helpers in `FitnessTimeline`.

## Addendum: cumulative heartbeats and rotations
- Goals: emit cumulative keys `user:<slug>:heart_beats` (estimated total beats) and `device:<string_id>.rotations` (estimated rotations) using string equipment ids (e.g., `cycle_ace`, `ab_roller`) instead of numeric cadence codes.
- Data sources: reuse existing per-tick `heart_rate` and `rpm` series; equipment id lookup comes from `config.yaml` `equipment[].id` mapped by cadence number.
- Calculation strategy:
	- Heartbeats: for each tick, `beats += (heartRate / 60) * (intervalMs / 1000)`; accumulate per user to produce a monotonically increasing array aligned to `tickCount`.
	- Rotations: for each tick with RPM, `rotations += (rpm / 60) * (intervalMs / 1000)`; accumulate per device slug.
	- If a sample is missing/null, carry forward the prior cumulative value (no increment); start at 0.
- Timeline emission:
	- Add cumulative arrays during tick collection and store as series keys `user:<slug>:heart_beats` and `device:<equipmentId>.rotations` (equipmentId is string id from config, not cadence number).
	- For legacy cadence-based keys, optionally keep a compatibility map, but prefer only the string id in timeline output.
- Encoding/validation:
	- Pass cumulative arrays through the existing RLE encoder; tick-length validation applies unchanged.
	- Ensure roster/deviceAssignments are present when emitting user cumulative series; ensure equipment id is resolved before writing rotations.
- Testing:
	- Unit: verify cumulative math over a small timeline (e.g., HR 120 bpm over two 5s ticks → 20 beats); RPM 60 over two 5s ticks → 10 rotations.
	- Assert series keys use equipment string ids and align to `tickCount`; assert RLE metadata present.

### Implementation Plan
- Mapping
	- Build cadence→equipmentId map from `config.yaml equipment[]` during session init or on first use; fall back to deviceId string if no map hit.
	- Store resolved equipmentId on device objects when available to avoid repeated lookups.
- Timeline emission
	- In `_collectTimelineTick`, track per-user cumulative heartbeats and per-device cumulative rotations in memory (e.g., `this._cumulativeBeats`, `this._cumulativeRotations`) keyed by slug/equipmentId.
	- On each tick, compute increment using current `intervalMs`; append cumulative value to new series entries `user:<slug>:heart_beats` and `device:<equipmentId>.rotations` alongside existing HR/RPM samples.
	- Ensure missing samples carry forward the previous cumulative total rather than skipping indexes.
- Persist/validation
	- Existing `_validateSessionPayload` and `FitnessTimeline.validateSeriesLengths` cover tick alignment; no new rules needed.
	- Encoding flows unchanged (RLE applies to cumulative arrays).
- Tests
	- Add unit tests in `frontend/src/hooks/fitness/__tests__/FitnessSession.persistence.test.js` (or new file) covering: (1) heartbeats accumulation math; (2) rotations accumulation using equipmentId strings; (3) tickCount alignment and RLE metadata presence.
- Migration/backfill (optional)
	- For historical sessions, a migration script could decode RPM/HR, recompute cumulative series, and re-encode; defer unless requested.

