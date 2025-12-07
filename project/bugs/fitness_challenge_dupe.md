## Fitness Challenge Duplicate Issue
### Summary
- Governance overlay lists multiple rows for the same participant when several unmet conditions apply, instead of consolidating to the strictest requirement.
- Example: baseline requires green, challenge requires yellow, user is blue. Overlay shows two rows (`blue -> green` and `blue -> yellow`) rather than a single `blue -> yellow` row.

### Impact
- UI noise: duplicate chips/rows for one user.
- Operator confusion: appears as two distinct blockers even though satisfying the higher requirement resolves all.

### Repro
1) Configure governance locks with both baseline (green) and challenge (yellow) thresholds active.
2) Present a participant whose current zone is blue.
3) Trigger governance overlay (`overlay.category === 'governance'`) with `lockRows` containing multiple unmet entries for the same user.
4) Observe two rows for the same user: one targeting green, one targeting yellow.

### Expected
- Single row per user showing the highest/unmet requirement span (e.g., `blue -> yellow`), implying lower requirements are satisfied by meeting the stricter one.

### Actual
- Multiple rows render for the same user whenever multiple unmet requirements exist, because `lockRows` is rendered verbatim without consolidation in `GovernanceStateOverlay.jsx`.

### Suspected Cause
- `GovernanceStateOverlay` maps `lockRows` directly to rows (`rows.map(...)`) without deduping by participant or collapsing overlapping requirements to the strictest pending target.

### Fix Sketch
- Before render, group `lockRows` by participant key and keep only the highest/strictest unmet requirement (e.g., prioritize target zone severity) so one row per participant remains.

## Rearchiture Suggestions
- Consolidate unmet requirements in the data/service layer before reaching the overlay: emit one record per participant keyed by slug/device and collapse multiple unmet targets into the strictest requirement (highest zone/threshold).
- Introduce a requirement normalizer in the governance domain model that orders requirements by severity and returns the max unmet target per participant; expose this via a selector (`getGovernanceLockRows()`) that UI consumes read-only.
- Define a deterministic requirement severity comparator (e.g., zone order enum or numeric intensity) shared across back end and selectors so “stricter” is consistent; use it when merging baseline + challenge conditions.
- Include a deduped ledger of participant-to-requirement state inside session/governance store, updated atomically when telemetry or challenge state changes; downstream consumers only observe the deduped map.
- Add unit tests at the selector/service layer that feed overlapping requirements for a single participant and assert a single consolidated entry with the highest required zone/target.

## Detailed Design Spec (non-UI)

### Goals
- One row per participant even when multiple unmet requirements exist; row reflects the strictest unmet requirement.
- Consolidation happens in the governance/session/service layer—UI becomes a pure presenter of already-deduped data.
- Deterministic severity ordering shared across producers/consumers; testable selectors with clear contracts.

### Data Model
- `RequirementSeverity`: enum or ordered map (e.g., zone intensities) with comparator `compareSeverity(a, b) -> -1|0|1`.
- `GovernanceRequirement`: `{ key, participantKey, targetZoneId, severity, source, targetLabel, progressPercent, heartRate, targetHeartRate, currentZone, currentLabel }`.
- `GovernanceRequirementLedger`: `Map<participantKey, GovernanceRequirement>` storing only the strictest unmet requirement per participant.

### Flow
1) Sources (baseline rules, challenge rules, telemetry) emit raw requirements into a normalizer function `normalizeRequirements(rawReqs, severityComparator)`.
2) Normalizer groups by `participantKey` and keeps the max-severity unmet requirement using the comparator. If two requirements have equal severity, keep the latest by `updatedAt` (if present) or first non-null targetLabel.
3) The result replaces `lockRows` in session/governance store: `state.governance.lockRows = normalizedRows`.
4) Selectors (`getGovernanceLockRows()`) expose the deduped array to overlay consumers; UI no longer maps raw data.

### API / Interfaces
- `normalizeRequirements(rawReqs, comparator) -> GovernanceRequirement[]`
- `getGovernanceLockRows(state) -> GovernanceRequirement[]` (memoized selector; returns already normalized array)
- Optional: `updateGovernanceRequirements(rawReqs)` inside session/governance store to recompute ledger atomically.

### Edge Cases
- If a participant has unmet and met requirements, only unmet are considered; if all met, omit the participant.
- If severity ties, prefer the one with a non-empty `targetZoneId`; fallback to first arrival.
- Null/undefined `targetZoneId` are treated as lowest severity to avoid overshadowing stricter ones.

### Testing
- Unit tests for comparator: ordering of zone severities matches expectation.
- Unit tests for normalizer: given multiple entries for same participant with differing severities, output is single entry with highest severity and expected targetLabel/zone.
- Regression test mirroring the repro case: baseline=green, challenge=yellow, user=blue → selector yields one row (blue -> yellow).

### Migration Plan
- Introduce comparator + normalizer alongside existing flow; add selector tests.
- Wire session/governance store to run normalizer before exposing `lockRows`.
- Remove UI-level dedupe (none currently) and rely on normalized selector.

## Phased Implementation Plan

1) Comparator & Normalizer
- Add `RequirementSeverity` ordering and `compareSeverity` helper in governance domain shared by producers/selectors.
- Implement `normalizeRequirements(rawReqs, comparator)` with unit tests covering multi-entry consolidation and the blue/green/yellow repro.

2) Session/Store Integration
- Introduce `GovernanceRequirementLedger` in session/governance store; update ingestion paths (baseline + challenge rules) to route through the normalizer.
- Expose `getGovernanceLockRows` selector returning deduped rows; add selector tests.

3) Data Producers Alignment
- Ensure baseline/challenge requirement generators emit `participantKey`, `targetZoneId`, `severity`, and labels; remove any per-UI shaping at this layer.
- Add regression test fixture for overlapping requirements to guard against future duplicates.

4) Cleanup & Hardening
- Remove any downstream code that assumes multiple rows per participant; enforce one-row invariant with assertions in the selector.
- Add telemetry/event log entry when consolidation drops duplicate requirements (optional).
