# Personalized Pattern-Aware Health Coaching

> Layer documented user-specific behavioral patterns over the existing HealthCoachAgent so coaching is informed by personal history, not just recent trends.

**Last Updated:** 2026-05-01
**Status:** Draft — Ready for Engineering Review
**Parent Design:** [Fitness Dashboard & Health Coach Agent Design](./2026-02-14-fitness-dashboard-health-agent-design.md)

---

## Overview

The HealthCoachAgent is technically sophisticated — reconciliation-aware nutrition coaching, working memory to avoid repeat nagging, scheduled assignments across the day. But it coaches **generically based on current data** without knowledge of the user's documented historical patterns.

For users who have built up rich personal datasets (multi-year weight history, training logs, nutrition tracking, body composition scans) and have written analyses of their own patterns, the agent re-derives advice from first principles each time and frequently misses high-confidence calls that the user's own history would make obvious.

This design adds personalization layers:

- **Pattern detection** tied to documented historical states
- **Longitudinal data access** so coaching is grounded in actual personal evidence rather than 7-day windows
- **Daily compliance tracking** for the highest-leverage behaviors that the system currently cannot see
- **DEXA calibration** so body composition math doesn't run on inflated consumer-BIA readings
- **Goal-aware coaching modes** for users with event-driven targets (race day, weight milestone, etc.)
- **Maintenance-phase mode** to address post-cut rebounds — historically the harder problem than cutting

**Core Question Answered:** "How do I get a coach that knows my actual history — what's worked, what's failed, what specific gaps have persisted across years — and grounds every observation in real personal precedent rather than platitudes or recent-window heuristics?"

### Why Longitudinal Context Is a First-Class Concern

The current agent operates on 7- to 84-day windows. Even with reconciliation and trend awareness, this is short-term memory. It cannot say "this looks like the August-2018 pattern" because it has never seen August 2018. It cannot say "your last sub-target weight was three years ago, here's what you were doing then" because that data isn't reachable.

The agent's primary value proposition (over generic nutrition apps) is that **it has read the user's entire health history** and can reference specific past moments to inform present decisions. Without longitudinal access, the coach is functionally a generic app with better prompts.

---

## Background: Use Case Profile

The implementation targets a specific user persona. Multi-user generalization is out of scope for v1, but the design uses per-user namespacing throughout so future expansion is not blocked.

### Use Case Persona

A long-term self-quantifier who:

- Maintains multi-year health datasets across multiple modalities (weight, training, nutrition, body composition scans)
- Has identifiable behavioral patterns visible across time windows of 6+ months
- Trains consistently with documented chronic gaps in specific narrow areas (e.g., a strength movement that has not improved across multiple programs and years)
- Has a defined fitness goal tied to an event date
- Has had at least one professional body composition scan (DEXA or similar) to calibrate consumer-BIA readings
- Maintains qualitative analyses of their patterns (markdown notes alongside quantitative data)
- Has experienced cyclic weight patterns — active cuts followed by passive-maintenance rebounds

### Documented Behavioral Profile

Patterns common to this persona:

- **Responds to structure, not willpower.** Slot ownership, named programs, habit substitution. "Try harder" approaches are not in the user's success history.
- **Frequency > intensity.** Best outcomes from consistent moderate effort, not heroic single sessions.
- **Documented chronic gaps** that persist across multiple training programs and years (the user has been faithfully executing programs that don't happen to address these specific gaps).
- **Cyclic weight patterns.** Successful active cuts followed by passive-maintenance rebounds. Maintenance has historically been the harder problem than cutting.
- **Exceptional execution baseline.** Multi-year sustained training discipline. The unsolved problems are narrow specific gaps, not generalized execution failure.

### Named Pattern Library

The user maintains a personal playbook of named patterns. The system needs to recognize and reference these patterns. The exact signatures, thresholds, and date ranges are user-specific and live in the user's playbook config (not in this PRD).

**Illustrative failure mode names:**

- *Same-jog rut*: pace and HR variance collapse to near-zero across recent runs (no stimulus variation = no adaptation)
- *IF-with-low-protein trap*: intermittent fasting + chronically low protein + skipped breakfast
- *High-activity-without-defense*: heavy training + casual tracking + weight rising (deficit generated but not defended)
- *Maintenance drift*: tracking dropping + weight rising + protein dropping (the post-cut rebound pattern)

**Illustrative success mode names:**

- *Tracked-cut formula*: high-protein anchor + structured meal repetition + 100% tracking discipline
- *Slot substitution*: replacing one activity with another in the same time slot when conditions force change
- *Coached structured bulk*: defined program + creatine + adequate protein + calorie surplus

### Calibration Truth

The user has had a professional DEXA scan. Using DEXA as ground truth:

- Consumer BIA tends to **overstate lean mass** by several pounds and **understate body fat percentage** by 3–5 percentage points
- The HealthCoachAgent currently treats consumer BIA as truth, producing systematic errors in protein-target math and body composition assessment
- All lean-mass-derived calculations should be calibrated against the latest DEXA reference

Specific magnitudes are user-specific and stored in calibration config.

---

## Goals

1. **Make documented playbook patterns visible to the agent.**
2. **Expose the full longitudinal record to the agent**, with external archives mirrored into DaylightStation for self-contained operation.
3. **Track high-leverage daily behaviors** currently invisible to the system (e.g., post-workout protein compliance, daily strength micro-protocol counts).
4. **Calibrate body composition math against DEXA truth.**
5. **Provide goal-aware coaching mode** for users with event-driven targets.
6. **Enable maintenance-phase mode** post-event to break historical rebound cycles.
7. **Surface chronic-stagnation patterns** (multi-year plateaus on specific metrics).

## Non-Goals

- **Multi-user generalization.** The current scope targets one user persona; design should not block future expansion but should not optimize for it either.
- **New tracking modalities.** Existing data sources (consumer BIA, third-party fitness apps, food logging) are sufficient.
- **Sleep optimization features.** Out of scope.
- **Sugar tracking expansion.** Wrong variable per user playbook (already low; not a lever).
- **Social / community features.** Not aligned with persona.
- **Gamification.** Sustained training history predicts gamification will feel insulting.
- **Conversational chatbot.** Current scheduled-assignment (push) model fits the persona; engagement loops (pull) do not.
- **Replacing existing reconciliation/nutrition coaching.** This work layers on top.

## Success Metrics

### User-specific outcomes

Targets are stored in the user's private goal config (not in this PRD). The system should accept and track arbitrary user-defined goals against these dimensions:

- Race-day weight target
- DEXA lean-mass preservation target
- Strength milestones (e.g., reps in a specific movement)
- Running economy targets (HR per pace ratio)
- Event completion

### System-specific outcomes

- Coach correctly classifies current state into named patterns ≥90% of the time when manually validated against playbook definitions
- Pattern detection latency <14 days from onset (vs months of manual review historically)
- Post-event rebound prevented based on user-defined weight ceiling

### User experience constraints

- No increase in daily tracking burden beyond 3 new optional fields (~10 sec/day)
- Coach references named patterns rather than generic advice
- Maintenance-mode coaching activates within 24 hours of event date

---

## Functional Requirements

### Phase 1A (P0) — Data Ingestion / Import
**Target: May 2026 — foundational; required for Phase 1B and beyond**

The user's longitudinal data is currently stored in external archives outside the DaylightStation project (a personal health directory and a daily-record life archive maintained by the user). To enable longitudinal context access (Phase 1B) inside a self-contained DaylightStation deployment, the relevant subset of external data must be imported into the existing DaylightStation data stores.

DaylightStation already has two data stores with established conventions:

- **`data/`** — per-user structured data, namespaced by `users/{userId}/`. Holds queryable YAML/JSON files of modest size. Examples: `data/users/{userId}/health.yml`, `data/users/{userId}/lifelog/`, `data/users/{userId}/agents/health-coach/`.
- **`media/archives/`** — shared raw bulk archives. Holds large binaries and full historical exports. Single archive shared across users (per-user filtering happens at read time). Examples: `media/archives/strava/`, `media/archives/tomtom/`.

Health-archive ingestion follows these conventions rather than creating a parallel directory.

#### F-100: HealthArchive ingestion job

New ingestion job extends existing per-user lifelog archive structure under `data/users/{userId}/lifelog/archives/` and shared bulk archives under `media/archives/`.

**Destination structure (per-user, structured):**

```
data/users/{userId}/lifelog/archives/
├── strava/              # existing — Strava archive (already populated)
├── garmin/              # existing
├── weight.yaml          # existing — consolidated weight readings
├── nutrition-history/   # NEW — date-keyed nutrition logs from prior trackers
│   ├── primary/         # e.g., LoseIt entries
│   ├── secondary/       # e.g., MyFitnessPal entries
│   └── manifest.yml
├── scans/               # NEW — transcribed body composition YAMLs
│   ├── *.yml            # one per scan with structured fields
│   └── manifest.yml
├── notes/               # NEW — markdown analyses (read-only mirror)
│   └── *.md
└── playbook/            # NEW — YAML personal playbook (canonical source)
    ├── playbook.yml
    └── playbook.md      # auto-generated from YAML for human reading
```

**Destination structure (shared, raw binaries):**

```
media/archives/
├── strava/              # existing — 3,000+ activity files
├── tomtom/              # existing
├── abs/                 # existing
├── scans/               # NEW — body composition scan PDFs and images (originals)
│   └── {userId}/
│       ├── *.pdf
│       └── *.jpg
└── nutrition-raw/       # NEW — original raw exports (whole-archive dumps from trackers)
    └── {userId}/
```

**Ingestion mode**: read-only mirror. The user-managed external archive remains source of truth; DaylightStation maintains a clone for query/coaching purposes.

**Sync cadence**:
- Manual on-demand via CLI (`yarn ingest:health-archive --user <userId>`)
- Optional scheduled daily sync
- Incremental: only new/modified files copied based on mtime + content hash

**File-type whitelist** (strict — no scope creep):
- Weight readings (one date-keyed format per source tracker)
- Nutrition logs (one date-keyed format per source tracker)
- Activity files (one date-keyed format per source tracker)
- Body composition scan files (YAML + image/PDF originals)
- User-authored analysis markdown
- Personal playbook YAML

**Explicitly excluded**: email, chat, financial, journal, search history, calendar, social media. The ingestion job hard-fails on any source path matching exclusion patterns.

**Privacy & security**:
- Per-user namespacing follows existing `data/users/{userId}/` convention
- Bulk archives in `media/archives/` namespace by `{userId}` for user-bound files (scans), share top-level for cross-user data (Strava already does this)
- Both data stores are excluded from repo via `.gitignore` (already configured)
- Archive contents never appear in logs or telemetry
- Multi-user installs use the existing user-namespaced read patterns

#### F-100A: Manifest tracking

Each ingested category includes a `manifest.yml` with:

```yaml
manifest_version: 1
user_id: <userId>
category: nutrition-history | scans | notes | playbook
last_sync: <ISO8601>
source_locations:
  - path: <user-supplied source path>
    file_count: N
    last_modified: <ISO8601>
schema_versions:
  primary: v1
  secondary: v1
record_counts:
  total_files: N
  date_range:
    earliest: <ISO8601>
    latest: <ISO8601>
```

Used by longitudinal query tools to detect staleness and prompt re-sync.

#### F-100B: Sync CLI command

CLI subcommand: `yarn ingest:health-archive --user <userId> [--source <path>] [--dry-run] [--category <category>]`.

- Reads source paths from user config (`data/users/{userId}/config/health-archive.yml`)
- Validates against whitelist
- Performs incremental sync
- Updates per-category manifest files
- Reports counts and warnings

---

### Phase 1B (P0) — Longitudinal Context Access
**Target: May 2026 — foundational; required for Phases 2–5 to deliver full value**

This phase makes the user's full historical archive queryable by the HealthCoachAgent. Without it, the coach has read the playbook (a summary) but cannot reach the underlying evidence.

#### F-101: PersonalContext bootstrap

On agent boot, load a structured personal-context bundle into the system prompt. Bundle should be approximately 1,500–3,000 tokens and include:

- The user profile (age range, goal context — but NOT specific weights/measurements; the agent looks those up via tools when needed)
- Persistent personal truths (from user playbook)
- The named patterns (success and failure modes) with detection signature shapes and date-range pointers
- The chronic gaps with year-over-year evidence summaries
- DEXA calibration constants (offset values, last-DEXA date)
- Named historical period index (machine-readable list of meaningful date ranges with one-line descriptions)

**Source format**: YAML config under `data/users/{userId}/lifelog/archives/playbook/playbook.yml`. Canonical playbook is YAML; markdown (`playbook.md` in the same directory) is auto-generated for human reading. Long semantic strings (descriptions, lessons, contextual notes) are stored as multi-line YAML values — preserves structure for querying while keeping the prose human-readable.

Example shape:

```yaml
patterns:
  - name: same-jog-rut
    type: failure_mode
    detection:
      pace_stdev_seconds_lt: 60
      hr_stdev_bpm_lt: 3
      window_runs: 5
    description: |
      Pace and HR variance collapse to near-zero across recent runs.
      No stimulus variation produces no adaptation. Documented in
      [date range], when [observed outcome].
    recommended_response: |
      Add one interval/tempo session this week.
      Reference period for contrast: [named period].
    severity: medium
    last_observed: 2024-Q3
```

#### F-102: NotesReader tool

New tool: `read_notes_file({ filename, section? })`.

- Whitelist of readable files: `data/users/{userId}/lifelog/archives/notes/*.md` and `data/users/{userId}/lifelog/archives/scans/*.yml`
- Optional `section` parameter for markdown anchor-based extraction
- Cache per-conversation
- Used when the agent wants depth on a topic the personal-context bundle only summarizes

The agent should call this tool when:

- Discussing a specific topic in detail (e.g., user asks about a strength movement; agent reads relevant strength notes)
- Producing a multi-paragraph response that benefits from full qualitative analysis
- A pattern triggers and the agent wants to reference the documented case

Tool output is markdown; the LLM consumes it directly.

#### F-103: Longitudinal data query tools

A small family of tools that expose the underlying data archives:

`query_historical_weight({ from, to, aggregation })`:
- Aggregations: `daily`, `weekly_avg`, `monthly_avg`, `quarterly_avg`
- Returns time series with weight, fat%, lean (consumer-BIA — calibration-aware), source attribution
- Source: `data/users/{userId}/lifelog/archives/weight.yaml` (existing)

`query_historical_nutrition({ from, to, fields, filter? })`:
- Returns per-day calories, protein, carbs, fat, sugar, fiber, foods array
- Filter examples: `protein_min`, `tagged_with`, `contains_food`
- Source: `data/users/{userId}/lifelog/archives/nutrition-history/{primary,secondary}/`

`query_historical_workouts({ from, to, type?, name_contains? })`:
- Returns activities with date, type, duration, HR, suffer score, name, program metadata
- Source: `data/users/{userId}/lifelog/archives/strava/` (existing) and/or `media/archives/strava/` for full historical depth, with per-user filtering

`query_named_period({ name })`:
- Returns aggregated stats and characteristic foods/activities/weight changes for a named period
- Convenience wrapper that calls underlying queries with pre-defined date bounds from the personal-context config

All query tools must respect the same redaction rules as existing reconciliation (no implied-intake or tracking-accuracy fields for days <14 days old).

#### F-104: SimilarPeriod finder

Tool: `find_similar_period({ pattern_signature, max_results })`.

Inputs: a pattern signature object (e.g., current 30-day metrics, or a specified set of conditions like "weight 165–172 lbs, protein avg <100g, tracking 60–80%").

Returns: list of historical periods that match the signature, with similarity scores and brief descriptions.

Use case: agent wants to ground a pattern observation with specifics — calls this tool to surface the closest historical analog.

This is the single feature that gives the agent the ability to say *"the last time you did this, here's what happened"* — the qualitative leap from "smart nutrition app" to "coach that has read your entire history."

#### F-105: Updated MorningBrief and WeeklyDigest gather

Existing assignments must be updated to consume the new tools:

- `MorningBrief`: when a pattern triggers, call `find_similar_period` and include the matched analog in the prompt, so coaching messages can ground observations in actual personal precedent
- `WeeklyDigest`: include long-arc context — e.g., comparing this week's protein average to historical periods that preceded specific outcomes — by surfacing relevant periods via `find_similar_period`
- Both should reference named periods by name when relevant

#### F-106: Privacy / scope boundary

Longitudinal access is intentionally scoped to **health and lifestyle data only**. Hard-coded whitelist of accessible paths:

- `data/users/{userId}/lifelog/archives/weight.yaml`
- `data/users/{userId}/lifelog/archives/strava/**`
- `data/users/{userId}/lifelog/archives/garmin/**`
- `data/users/{userId}/lifelog/archives/nutrition-history/**`
- `data/users/{userId}/lifelog/archives/scans/**`
- `data/users/{userId}/lifelog/archives/notes/**`
- `data/users/{userId}/lifelog/archives/playbook/**`
- `data/users/{userId}/health.yml`
- `media/archives/strava/**` (for historical depth pre-2026)

Whitelist enforced at tool implementation (path traversal blocked). No tool can read outside this set.

Future expansion (with explicit user opt-in via config) could include calendar (for travel/event correlation) and selected journal entries (for emotional context). Initially out of scope.

---

### Phase 1 (P0) — Compliance Tracking & Playbook Loading
**Target: May 2026 — supports active user goals**

#### F-001: Daily compliance fields in health daily entry

Extend the existing `coaching` field (currently `null`) in the daily health entry:

```yaml
coaching:
  post_workout_protein:
    taken: true
    timestamp: "07:15"        # optional
    source: "shake_brand"     # optional, from configurable list
  daily_strength_micro:        # for the user's chronic-gap drill
    movement: "pull_up"
    reps: 5
  daily_note: "felt heavy"     # optional, one line
```

UI: One-tap entry from HealthHub. No new tracking app.

#### F-002: ComplianceSummary tool

New tool registered in `health-coach/tools/`:

`get_compliance_summary({ userId, days })` returns counts, percentages, streaks, and longest gaps for each tracked compliance dimension over rolling windows (7/14/30 days).

#### F-003: Compliance gap detection in MorningBrief

Update `MorningBrief.gather()` to call `get_compliance_summary` and add to the prompt logic:

- N consecutive days of missed post-workout shake → CTA referencing the user's documented "highest-leverage daily action"
- Multiple-day gap on the chronic-weakness drill (e.g., daily pull-ups) → CTA referencing the documented multi-year stagnation pattern

Thresholds and CTA text live in user-specific playbook config, not in coach prompt.

#### F-004: PatternDetector domain service

New service: `2_domains/health/services/PatternDetector.mjs`. Pure function, no I/O.

**Inputs**: 30-day windows of nutrition, weight, workouts, compliance from the longitudinal archive (via Phase 1B tools).

**Outputs**: array of detected patterns with confidence, evidence, recommendation, memory key, severity.

Pattern definitions (initial set from user playbook):
- `cut-mode`
- `if-trap-risk`
- `same-jog-rut`
- `bike-commute-trap`
- `maintenance-drift`
- `on-protocol-tracked-cut`
- `on-protocol-coached-bulk`

Each pattern's specific threshold values come from user config.

#### F-005: Playbook context in system prompt

Update `prompts/system.mjs` to include a `personalContext` block from F-101.

Coach output should reference patterns by name when applicable: "this matches the IF-trap pattern from late 2020" rather than "consider increasing protein."

---

### Phase 2 (P0) — DEXA Calibration & Body Composition Truth
**Target: June 2026**

#### F-006: HealthScan entity

New entity: `2_domains/health/entities/HealthScan.mjs`.

```javascript
{
  date: ISO8601,
  source: 'inbody' | 'bodyspec_dexa' | 'other',
  device_type: 'clinical_BIA' | 'DEXA' | 'consumer_BIA',
  weight_lbs: number,
  body_fat_percent: number,
  lean_tissue_lbs: number,
  fat_tissue_lbs: number,
  bone_mineral_content_lbs: number?,
  bmr_kcal: number?,
  bmr_method: 'measured' | 'katch_mcardle' | 'estimated',
  visceral_fat_lbs: number?,
  bone_density_z_score: number?,
  asymmetry: object?,
  regional: object?,
  raw_image_path: string?,
  raw_pdf_path: string?,
  notes: string?,
}
```

Backfill from scan files in `data/users/{userId}/lifelog/archives/scans/*.yml` (transcribed YAML) with original PDFs/images in `media/archives/scans/{userId}/` referenced via the `raw_pdf_path` and `raw_image_path` fields.

#### F-007: CalibrationConstants service

Service: `2_domains/health/services/CalibrationConstants.mjs`.

- Reads latest DEXA scan and adjacent consumer-BIA readings (±7 days)
- Computes consumer-BIA → DEXA offsets
- Exposes:
  - `getCorrectedLean(rawBIA: number): number`
  - `getCorrectedBodyFat(rawBIA: number): number`
  - `getCalibrationDate(): ISO8601`
  - `getStaleness(): number` (days since last DEXA)
  - `flagIfStale(thresholdDays: number): boolean`

All lean-mass-derived calculations consume calibrated values.

#### F-008: Multi-formula RMR estimator

Service: `2_domains/health/services/RMREstimator.mjs`.

- Computes RMR via Katch-McArdle (uses calibrated lean), Mifflin-St Jeor, Harris-Benedict
- Returns range: `{ lower, expected, upper, primary_method }`
- Defaults to Katch-McArdle when calibrated lean is available
- Flags when measured RMR (from indirect calorimetry) is available vs estimated

The HealthCoachAgent's tools consume the RMR range, not a single value.

---

### Phase 3 (P1) — Periodic Self-Tests & Strength Tracking
**Target: June–July 2026**

#### F-009: StrengthTest entity & assignment

New entity: `2_domains/health/entities/StrengthTest.mjs`. Captures periodic self-test results (max-rep tests, holds, jumps, balance times).

New assignment: `StrengthSelfTest`.
- 8-week cadence
- Prompts user to perform 5-minute test battery
- Records results, compares to historical baselines and goal targets
- Surfaces in dashboard

---

### Phase 4 (P1) — Goal-Aware Coaching
**Target: July–August 2026**

#### F-010: Event countdown widget

Frontend widget showing days until user's defined event date with phase markers (build / peak / taper / event).

#### F-011: Running variance widget

Frontend widget computing pace stdev across last N runs. Red flag at user-configured threshold (the same-jog-rut detection threshold).

#### F-012: Pre-event scan reminder

MorningBrief CTA in the weeks leading up to a scan-relevant event: "Schedule pre-event DEXA before [date]. Last opportunity to measure cut quality before event."

#### F-013: EventWeekProtocol assignment

New assignment activated in the final week before a defined event:
- Tapering reminders
- Pre-event nutrition timing prompts
- Sleep priority CTA
- Hydration tracking
- Day-of breakfast plan

---

### Phase 5 (P0 for post-event) — Maintenance Phase
**Target: post-event onward**

This phase addresses the historical pattern that has cost the user every previous cut: passive maintenance after success.

#### F-014: MaintenanceMode coaching state

New coaching state activated post-event:
- Different system prompt tone (less prescriptive, more pattern-watch)
- Reduced tracking targets (50% of days minimum, vs cut-phase 80%+)
- Daily weigh-in continues; weekly avg drives decisions
- Trigger to escalate: 7-day rolling weight up >user-configured-threshold from event-day weight

#### F-015: ReboundEarlyWarning detection

PatternDetector specialization for the rebound pattern:
- Tracking dropping (logged days <50% over 14 days)
- Weight creeping (sustained over 3+ weeks)
- Protein dropping below threshold

When triggered: single CTA referencing user's documented rebound history with explicit choice prompt.

#### F-016: AnnualPlaybookReview assignment

End-of-year assignment:
- Pulls year's data
- Identifies new patterns (using same statistical methods as the detector)
- Writes proposed playbook config updates to YAML (additions only — does not silently overwrite existing entries)
- Triggers markdown regeneration via CLI step
- Surfaces a review summary with diffs the user can accept or reject before changes apply
- Schedule: late December

---

## Technical Considerations

### Architecture compatibility

All additions follow existing hexagonal architecture:
- Domain entities in `backend/src/2_domains/health/entities/`
- Domain services in `backend/src/2_domains/health/services/`
- Use cases / orchestration in `backend/src/3_applications/health/`
- Tools registered with HealthCoachAgent via `backend/src/3_applications/agents/health-coach/tools/`
- Frontend widgets in `frontend/src/modules/Fitness/widgets/`

No restructuring of existing code required. All work is additive.

### Data ingestion

DaylightStation data stores (`data/` and `media/archives/`) are already excluded from version control. Health-archive ingestion lands data inside the existing `data/users/{userId}/lifelog/archives/` and `media/archives/` directories — no new top-level paths. The ingestion job is the one boundary between external user data and DaylightStation; downstream code only reads from the imported clone, never directly from external paths.

### Memory & deduplication

Reuse existing `WorkingMemory` system with TTLs. Pattern detections write to memory with appropriate TTLs:
- Pattern triggered → write `pattern_<name>_last_flagged` with 7-day TTL
- Compliance gaps deduplicated similarly

### Format conventions: YAML for agent-writable artifacts

**Design principle:** any file the agent reads, writes, or continually updates uses **YAML as canonical format**. Markdown is reserved for read-only human-authored prose.

Rationale: YAML preserves structure (filterable, queryable, programmatically aggregable) while still allowing long unstructured semantic strings as multi-line values. Markdown is fine for humans but loses structure the moment an agent tries to update a section.

This applies to:

| Artifact | Format | Notes |
|----------|--------|-------|
| Personal playbook config | YAML | Canonical. Auto-generates markdown for human reading. |
| Pattern definitions | YAML | Already structured; never markdown. |
| Compliance fields in daily entry | YAML | Already YAML; preserve. |
| Manifest files | YAML | Already YAML; preserve. |
| Annual playbook review output (F-016) | YAML | Agent writes structured update; markdown auto-regenerates. |
| Pattern detection logs | YAML | One entry per detection event with structured fields. |
| Cached `find_similar_period` results | YAML | Structured for querying. |
| Coaching message history | YAML | Per-message records with timestamp, pattern triggered, message body. |
| Body composition scans | YAML in `lifelog/archives/scans/` + originals in `media/archives/scans/{userId}/` | Structured transcription separate from source image/PDF. |
| User-authored analyses (markdown notes) | Markdown in `lifelog/archives/notes/` | Read-only mirror; humans edit upstream, agent reads via NotesReader tool. |

The boundary: **if the agent ever writes or updates the file**, it's YAML. If only humans edit it and the agent only reads it, markdown is acceptable but YAML is still preferred where structure exists.

### Playbook source-of-truth

YAML canonical. Markdown auto-generated for human reading via a small CLI command (`yarn playbook:render <userId>`). When the agent updates the playbook (e.g., AnnualPlaybookReview), it writes YAML; the markdown is regenerated as a derivative artifact.

### Performance

- PatternDetector runs in MorningBrief gather phase; expected runtime <100ms with 30 days of data
- Cache results with 6-hour TTL
- Compliance summary tool runtime negligible
- HealthScan loads cheap (handful of records expected lifetime)

### Testing

- Unit tests for each pattern detector with synthetic data fixtures generated from documented historical periods
- Integration tests using fixture date ranges that should classify into specific patterns
- Path traversal / scope boundary tests for F-103 query tools
- Ingestion job tests with mock external archives

### Observability

- Each pattern detection emits a structured log with pattern name, confidence, evidence
- Aggregate dashboard for weekly review of which patterns triggered and how often
- Pattern memory persistence allows month-over-month comparison

---

## Open Questions for Engineering Review

1. **Compliance entry UX**: HealthHub card extension vs dedicated quick-entry screen vs voice memo via existing nutribot adapter?
2. **Tracking granularity for chronic-gap drills**: daily totals only, or per-set logging? (Recommendation: daily totals; the lever is frequency, not volume.)
3. **Event-week assignment activation**: hardcoded against goal date or user-confirmed kickoff?
4. **Maintenance mode duration**: indefinite or until next defined goal? (Recommendation: indefinite until next cut goal is defined.)
5. **Pattern detector confidence thresholds**: should low-confidence detections still surface in dashboard? (Recommendation: high-confidence only for CTAs; all detections logged for analysis.)
6. **Cross-agent playbook sharing**: how should other agents (e.g., lifeplan-guide) reference patterns? (Possibly extract to `agents/_shared/playbook/` if pattern emerges.)
7. **DEXA staleness threshold**: warn at 180 days? Treat as expired at 365?
8. **Ingestion failure modes**: partial sync handling, schema mismatch detection, source path unavailability.

---

## Timeline

| Phase | Period | Deliverables | Dependencies |
|-------|--------|--------------|--------------|
| 1A | May 2026 | F-100 through F-100B (data ingestion) | None |
| 1B | May 2026 | F-101 through F-106 (longitudinal tools) | Phase 1A |
| 1 | May 2026 | F-001 through F-005 (compliance + patterns) | Phase 1B |
| 2 | June 2026 | F-006 through F-008 (DEXA calibration) | Phase 1B |
| 3 | June–July 2026 | F-009 (strength self-tests) | Phase 2 |
| 4 | July–August 2026 | F-010 through F-013 (goal-aware) | Phase 1 |
| 5 | post-event | F-014 through F-016 (maintenance) | Phase 1 + 2 |

Critical path: **Phases 1A and 1B must ship before May 15** to provide ingestion + longitudinal access foundation. Phase 1 (compliance + patterns) depends on 1B. The rest can ship sequentially.

---

## If Time Is Constrained: Priority Order

1. **F-100 + F-101 + F-103 + F-104** (data ingestion + longitudinal access). Without this, the agent cannot ground its observations in personal precedent and the rest of the work delivers diminished returns. **Single largest qualitative improvement to coaching outputs.**

2. **F-001 + F-002 + F-003** (compliance tracking + MorningBrief integration). Daily compliance for the user's highest-leverage behaviors.

3. **F-004 + F-005** (PatternDetector + playbook in system prompt). Makes named patterns live for the agent.

4. (If a fourth slot is available) **F-006 + F-007** (DEXA calibration). Stops coaching math from running on inflated BIA numbers.

These deliverables capture roughly 80% of the value of the full roadmap.

---

## Out-of-Scope / Future Work

- Voice-based daily compliance entry (potential nutribot extension)
- Multi-user pattern detection beyond per-user namespacing
- Integration with external coaching platforms
- Wearable device integrations beyond current stack
- Predictive modeling beyond pattern classification
- Computer vision for form analysis
- Automated meal planning based on protein targets

---

## Appendix: External Data Source Format Expectations

The ingestion job (F-100) expects external sources in approximately these shapes. Specifics vary by user; the format detection logic should accept reasonable variations.

**Weight readings** — date-keyed YAML with weight, optional body composition fields (fat%, lean lbs, fat lbs).

**Nutrition logs** — date-keyed YAML/JSON with calories, macros, foods array. Optional fields for fiber, sugar, sodium.

**Activity files** — date-keyed YAML with type, duration, HR data, suffer score, name, program metadata.

**Body composition scans** — YAML transcribed from professional scan reports (DEXA, InBody) with weight, fat%, lean mass, regional breakdown, optional bone density and asymmetry data.

**User analyses** — markdown files with playbook patterns, personal truths, calibration constants, named historical periods.

Format adapters should live in `1_adapters/health-archive/` so additional source formats can be added without changing the domain layer.

---

## Author's Note

This PRD was drafted from an extended conversational interview with the primary user covering their multi-year health history, behavioral patterns, chronic gaps, calibration data, and current goal context. The level of user-specific detail in the Use Case Profile section is intentional — the implementation targets one identified user persona, and engineering decisions should optimize for that persona's documented behavior. The architecture supports per-user namespacing throughout so future expansion to additional users is not blocked.

Specific user data (weights, body composition, dates, food brands, life events) is intentionally omitted from this open-source design document and lives in user-controlled private config and the imported `data/health-archive/{userId}/`.
