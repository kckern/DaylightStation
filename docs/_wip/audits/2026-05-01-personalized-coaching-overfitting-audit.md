---
date: 2026-05-01
scope: 39 commits aa0309cb3..4b515d6b5 implementing the personalized pattern-aware coaching plan (`docs/plans/2026-05-01-personalized-pattern-aware-coaching-plan.md`)
trigger: user flagged `same-jog-rut` as suspiciously specific to hardcode; clarified principle — "any pattern like that should be defined in config ymls, not in code"
sibling: docs/roadmap/2026-05-01-personalized-pattern-aware-coaching-design.md
---

# Personalized Coaching — Overfitting & Hardcoded-Pattern Audit

The PRD itself was explicit about this: pattern names, thresholds, and dimensions
were called **"illustrative"** examples of one user's playbook, not canonical
vocabulary. The implementation instead baked many of those examples into JS as
class methods, switch cases, default-value tables, and validation enums. This
audit names every place that happened, with file:line references, and proposes
the corrected boundary: code holds **primitives** (atomic checks, computation,
schema), YAML holds **patterns** (named compositions of primitives, threshold
values, dimension labels, and prose).

A second class of myopia is also catalogued here — magic numbers, scoring
constants, and one-user assumptions that aren't pattern-shaped but are equally
brittle if the user persona ever changes (different sex, weight range, training
modality, food culture).

**Severity ladder used below:**
- **CRITICAL** — pattern-shaped content hardcoded in production code; the trigger for this audit
- **IMPORTANT** — magic numbers / one-user assumptions that will need re-tuning per user
- **MINOR** — cosmetic or non-load-bearing concerns

---

## Section 1 — Pattern names hardcoded as code (CRITICAL)

### F1-A. PatternDetector dispatch table

`backend/src/2_domains/health/services/PatternDetector.mjs:65-82`

```js
#evaluate(playbookEntry, windows, userGoals) {
  const dispatch = {
    'cut-mode': this.#detectCutMode,
    'if-trap-risk': this.#detectIfTrap,
    'same-jog-rut': this.#detectJogRut,            // ← KC's running profile
    'bike-commute-trap': this.#detectBikeTrap,     // ← KC's commute pattern
    'maintenance-drift': this.#detectMaintenanceDrift,
    'on-protocol-tracked-cut': this.#detectTrackedCut,
    'tracked-cut-formula': this.#detectTrackedCut, // ← fixture-name alias
    'on-protocol-coached-bulk': this.#detectCoachedBulk,
  };
  const fn = dispatch[playbookEntry.name];
  if (!fn) {
    this.logger.warn?.('pattern_detector.unknown_pattern', { name: playbookEntry.name });
    return null;  // ← any pattern not in the dispatch silently ignored
  }
  return fn.call(this, playbookEntry, windows, userGoals);
}
```

**The bug:** A future playbook pattern like `weekend-binge` or `winter-tracking-collapse`
returns `null` and gets logged as `unknown_pattern`. Patterns become a code
change, not a YAML edit. The PRD explicitly stated otherwise.

**Recommended refactor — the inversion:**

```js
// backend/src/2_domains/health/services/PatternDetector.mjs

const PRIMITIVES = {
  // Each primitive: (windows, threshold, entry) → { match: boolean, signal: number, evidenceKey: string, evidenceValue: any }
  pace_stdev_seconds_lt: (windows, threshold, entry) => {
    const runs = recentRuns(windows.workouts, entry.detection?.window_runs ?? 5);
    const paces = runs.map(paceSeconds).filter(Number.isFinite);
    if (paces.length < (entry.detection?.window_runs ?? 5)) return null; // not enough data
    const value = stdev(paces);
    return { match: value < threshold, signal: value, evidenceKey: 'pace_stdev_seconds', evidenceValue: value };
  },
  hr_stdev_bpm_lt: (windows, threshold, entry) => { /* ... */ },
  protein_avg_lt_g: (windows, threshold) => { /* ... */ },
  protein_avg_gt_g: (windows, threshold) => { /* ... */ },
  calorie_avg_lt: (windows, threshold) => { /* ... */ },
  calorie_avg_gt: (windows, threshold) => { /* ... */ },
  tracking_rate_14d_lt: (windows, threshold) => { /* ... */ },
  tracking_rate_14d_gt: (windows, threshold) => { /* ... */ },
  weight_trend_3w_gt_lbs: (windows, threshold) => { /* ... */ },
  weight_trend_3w_lt_lbs: (windows, threshold) => { /* ... */ },
  weight_delta_lt_lbs: (windows, threshold) => { /* ... */ },
  weight_delta_gt_lbs: (windows, threshold) => { /* ... */ },
  protein_avg_drop_pct_gt: (windows, threshold) => { /* ... */ },
  breakfast_skipped_days_7d_gt: (windows, threshold) => { /* ... */ },
  meal_repetition_index_gt: (windows, threshold) => { /* ... */ },
  bike_workouts_30d_gt: (windows, threshold) => { /* ... */ },
  programmed_workout_present: (windows, threshold) => { /* ... */ },
  // window_runs is metadata for run-shaped primitives; not a check
};

#evaluate(entry, windows /* , _goals */) {
  const detection = entry.detection || {};
  const checks = [];
  for (const [key, threshold] of Object.entries(detection)) {
    if (key === 'window_runs') continue;          // metadata, not a check
    const fn = PRIMITIVES[key];
    if (!fn) {
      this.logger.warn?.('pattern_detector.unknown_primitive', { name: entry.name, primitive: key });
      return null;                                // strict — bad config = no match
    }
    const result = fn(windows, threshold, entry);
    if (result === null) return null;             // not enough data
    if (!result.match) return null;               // logical AND
    checks.push(result);
  }
  if (!checks.length) return null;

  return {
    name: entry.name,
    type: entry.type,
    confidence: this.#scoreConfidence(checks, entry.detection),
    evidence: Object.fromEntries(checks.map(c => [c.evidenceKey, c.evidenceValue])),
    recommendation: entry.recommended_response || '',
    memoryKey: `pattern_${entry.name}_last_flagged`,
    severity: entry.severity || 'medium',
  };
}
```

**Outcome:** patterns become pure YAML. New patterns ship without code review.
The dispatch goes from "list of named bespoke methods" to "list of named atomic
primitives, composable freely."

**Cost:** rewrite of `PatternDetector.mjs` (~430 lines → ~250 lines), rewrite
of `PatternDetector.test.mjs` (16 tests). The primitive set is recoverable
from the existing `#detect*` methods — about a 90-minute refactor.

### F1-B. Detection-method internals smuggle their own thresholds

`backend/src/2_domains/health/services/PatternDetector.mjs:90-92`

```js
const windowRuns = detection.window_runs ?? 5;
const paceThresh = detection.pace_stdev_seconds_lt ?? 60;
const hrThresh = detection.hr_stdev_bpm_lt ?? 3;
```

The fallback values (5 / 60 / 3) are KC's running-profile thresholds. A
different runner has different cadence, different aerobic-zone HR variability,
different stride-length stdev. Even if F1-A is fixed, these fallbacks pull KC's
shape back in via the back door.

**Fix:** when F1-A lands, **drop the fallbacks entirely.** A primitive without a
threshold from playbook YAML should be a hard error or skip — not a "default to
KC's number." Same for `cut-mode`'s default `weight_delta_lbs <= -1`,
`bike-commute-trap`'s `weight_delta_lbs > 1`, etc. — all of these embed one
user's body in the code path.

### F1-C. Pattern-name alias smuggled in to bridge spec/fixture mismatch

`PatternDetector.mjs:73`

```js
'tracked-cut-formula': this.#detectTrackedCut, // alias for fixture playbook name
```

The plan called the pattern `on-protocol-tracked-cut`; the fixture YAML I
shipped (Task 4) called it `tracked-cut-formula`. Rather than reconciling, I
aliased. Once F1-A lands, this disappears entirely — the dispatch becomes
data-driven. **Note for the refactor**: pick one naming convention in the
fixture and delete the alias.

---

## Section 2 — Compliance dimensions hardcoded as code (CRITICAL)

### F2-A. `DailyCoachingEntry` enumerates KC's three dimensions

`backend/src/2_domains/health/entities/DailyCoachingEntry.mjs:29-33`

```js
const VALID_TOP_LEVEL_KEYS = new Set([
  'post_workout_protein',     // ← KC's "highest-leverage daily action"
  'daily_strength_micro',     // ← KC's pull-up plateau drill
  'daily_note',
]);
```

Plus dedicated parser methods `#parseProtein`, `#parseStrength`, each with
hardcoded sub-key validation (`taken: boolean`, `movement: string`, `reps: int`).

**The bug:** A user whose lever is meditation, cold exposure, water intake, or
morning walk can't add a dimension. The entity rejects unknown top-level keys
with `Error: unknown top-level key`.

**Recommended refactor — playbook-driven dimension schemas:**

```yaml
# playbook.yml
coaching_dimensions:
  - key: post_workout_protein
    type: boolean              # logged when taken=true
    fields:
      taken: { type: boolean, required: true }
      timestamp: { type: string, required: false, format: 'HH:MM' }
      source: { type: string, required: false }
  - key: daily_strength_micro
    type: numeric              # logged when reps>=0; engagement-only (no miss channel)
    fields:
      movement: { type: string, required: true }
      reps: { type: integer, required: true, min: 0 }
  - key: morning_walk         # a hypothetical second user's lever
    type: numeric
    fields:
      duration_min: { type: integer, required: true, min: 0 }
```

`DailyCoachingEntry` becomes a generic validator that takes a dimension
schema + raw input and validates. The compliance summary tool (F2-B) follows
the same shape.

### F2-B. `ComplianceToolFactory` enumerates the same three dimensions

`backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs`
contains `summarizeBoolean(post_workout_protein)`, `summarizeStrength(daily_strength_micro)`,
`summarizeNote(daily_note)` — three bespoke summarizers, each named for KC's dimension.

**Fix:** generic summarizers keyed by dimension `type`:
- `boolean` → counts logged/missed/untracked + streak/gap math
- `numeric` → counts logged/untracked + avg + streak/gap math
- `text` → counts logged/empty (no streak math)

The dimension list comes from playbook config; the summarizer is selected by
declared `type`. New dimensions don't need new tool methods.

### F2-C. `MorningBrief` compliance CTA logic hardcodes the two dimensions

`backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs:11-21`

```js
const DEFAULT_COMPLIANCE_THRESHOLDS = Object.freeze({
  post_workout_protein: {
    consecutive_misses_trigger: 3,
    cta_text: '...protein-shake-specific copy...',
  },
  daily_strength_micro: {
    untracked_run_trigger: 5,
    cta_text: '...pull-up-specific copy...',
  },
});
```

**Fix:** thresholds + CTA text live entirely in playbook YAML (the
`coaching_thresholds` section already exists for the override path; the
defaults shouldn't exist in code at all). When F2-A's dimension schema lands,
each dimension declares its own `consecutive_misses_trigger` /
`untracked_run_trigger` / `cta_text`. The brief iterates whatever dimensions
the playbook declares; no hardcoded names.

### F2-D. UI component hardcodes `pull_up`

`frontend/src/modules/Health/widgets/CoachingComplianceCard.jsx:24`

```js
const STRENGTH_MOVEMENT_V1 = 'pull_up';
```

Comment notes "v1 — make it a constant easy to change." That's exactly the
shape of overfitting that needs to die: the constant should be the user's
declared movement from playbook config, not a const at the top of a JSX file.
The card today literally cannot serve a user whose drill is ring-rows or
pistol squats.

**Fix:** card reads the dimension declaration from playbook config (delivered
by an existing API or a new `GET /api/v1/health/coaching/schema` endpoint).
Movement label, sub-fields, and even the layout (toggle vs numeric vs text)
flow from declared `type`. No `STRENGTH_MOVEMENT_V1` constant.

---

## Section 3 — One-user assumptions in scoring constants (IMPORTANT)

### F3-A. SimilarPeriodFinder scales assume KC's body + KC's deficits

`backend/src/2_domains/health/services/SimilarPeriodFinder.mjs:24-30`

```js
const SCALES = {
  weight_avg_lbs: 30,        // 30-lb difference → 0
  weight_delta_lbs: 10,      // 10-lb cycle delta → 0
  protein_avg_g: 100,        // 100g protein gap → 0
  calorie_avg: 1500,         // 1500-cal gap → 0
  tracking_rate: 1,
};
```

These scales are tuned for an adult male in the 165–185 lb range running
~1500-cal cuts and 145g protein targets. A 110-lb female athlete cutting at
1100 cal and 90g protein has a body where 30 lb is a third of her weight —
the scale gives ~zero discrimination on the dimension that matters most.

**Fix:** scales should derive from the user's own historical range, OR live
in playbook config:

```yaml
# playbook.yml
similar_period:
  scales:
    weight_avg_lbs: 30        # absolute fallback
    weight_avg_pct_of_body: 0.15  # better: 15% of user's avg weight
    weight_delta_lbs: 10
    protein_avg_g: 100
    calorie_avg: 1500
    tracking_rate: 1
```

OR, more elegantly, compute scales lazily from `user.weight.median ± stdev` so
the comparison stays meaningful at any body size. This is a real algorithmic
gap, not just config plumbing — defer until the user persona actually expands.

### F3-B. Linear-distance scoring weights all dimensions equally

`SimilarPeriodFinder.mjs:#scorePeriod` — each present dimension contributes
equally to the composite. In coaching practice, weight delta over a period is
far more diagnostic than calorie average. The current model treats them as
equal-vote.

**Fix:** dimension weights in playbook config:
```yaml
similar_period:
  weights:
    weight_delta_lbs: 3        # heavily weighted
    weight_avg_lbs: 1
    protein_avg_g: 1.5
    calorie_avg: 1
    tracking_rate: 1.5
```

### F3-C. CalibrationConstants adjacency window is fixed

`backend/src/2_domains/health/services/CalibrationConstants.mjs:31`

```js
const ADJACENCY_WINDOW_DAYS = 7;
```

Fine for KC's daily-weigh-in cadence. A user who weighs weekly may have NO BIA
reading within ±7 days of any DEXA, silently producing zero offsets. Should be
playbook-configurable.

### F3-D. CalibrationConstants uses unweighted mean

Mean is sensitive to a single anomalous BIA reading in the window. Median or
trimmed mean is more robust. Already flagged by the implementer's self-review.
Defer until a real outlier is observed.

### F3-E. PersonalContextLoader chars-per-token estimate

`backend/src/3_applications/health/PersonalContextLoader.mjs:25`

```js
const CHARS_PER_TOKEN = 4;
```

GPT/Claude tokenizers run ~3.5 for English prose, more like 2.5 for code. The
4 estimate over-budgets by ~14% — the bundle will be smaller than the budget
suggests. Not a correctness bug; just be aware when the budget feels
under-utilized. Fix: depend on the actual tokenizer (`openai-gpt-token-counter`
is already a dep) when budget precision matters. Defer.

### F3-F. PersonalContextLoader truncation strategy is hardcoded

`PersonalContextLoader.mjs:#render` step 2 — "trim periods to most recent 3"
when over budget. The "3" is arbitrary, and the strategy itself (high-pattern
priority over period priority) embeds an editorial choice. Both should be
playbook-configurable for users who care more about their period analogs than
their pattern catalog.

---

## Section 4 — Path / vocabulary hardcoded as code (IMPORTANT)

### F4-A. F-106 whitelist names specific fitness platforms

`backend/src/2_domains/health/services/HealthArchiveScope.mjs` — the whitelist
includes `strava/**` and `garmin/**` as literal path segments. A user who uses
Suunto, Apple Health, Whoop, Oura, or a future-platform-of-the-week is silently
locked out of their own archive even though the data is identical in shape.

**Fix:** the whitelist should be category-shaped, not platform-shaped. Existing
F-100 categories (`workouts`, `weight`, etc.) already provide the right
abstraction. Specific platform paths should be ALLOWED IF declared in
playbook config:

```yaml
# playbook.yml
archive:
  workout_sources:
    - strava
    - garmin
    - apple_health    # adds /apple_health/** to the whitelist for this user
```

The HealthArchiveScope constructor pulls the source list from playbook config
and composes the regex. Code holds the schema and the path-traversal defense;
data declares which sources count.

### F4-B. F-100 ingestion categories are a code-level enum

`backend/src/2_domains/health/entities/HealthArchiveManifest.mjs:14-21`

```js
export const VALID_CATEGORIES = new Set([
  'nutrition-history', 'scans', 'notes', 'playbook', 'weight', 'workouts',
]);
```

Reasonable for v1, but a user who wants to ingest `mood-journal/`,
`hr-recovery/`, `vo2-tests/`, or `mobility-screens/` needs a code change.
Same as F4-A — the categories should be playbook-declared with paired
destination policies.

### F4-C. Privacy exclusions are a code-level regex set

`HealthArchiveScope.mjs:PRIVACY_EXCLUSIONS` and parallel set in
`HealthArchiveIngestion.mjs:EXCLUSION_PATTERNS` — `[email, chat, finance,
journal, search-history, calendar, social, banking]`. These are fine defaults,
BUT:
- Substring match means a user named `social-user` is locked out of all paths
- `journal\b` only word-boundaries on the right; `journals.md` PASSES the filter
- A user can't ADD their own exclusions (e.g., `client-confidential/`)

**Fix:** the default set stays in code (sensible, keep as floor), but
playbook config can ADD exclusions:
```yaml
archive:
  additional_privacy_exclusions:
    - client-confidential
    - therapy-notes
```

The userId-collision case (`social-user-42`) deserves its own fix — apply
exclusions only to the path tail AFTER the per-user prefix.

### F4-D. HealthScan `source` enum is hardcoded to two specific products

`backend/src/2_domains/health/entities/HealthScan.mjs:40`

```js
const VALID_SOURCES = new Set(['inbody', 'bodyspec_dexa', 'other']);
```

KC has used InBody and BodySpec specifically. A different user with a Hologic
Horizon, GE iDXA, or Tanita will hit `'other'` (acceptable) but the source
field loses its diagnostic value. The `bodyspec_dexa` token also conflates
*service* (BodySpec, the company) with *device type* (DEXA), which is the
abstraction `device_type` was supposed to handle.

**Fix:** drop `source` to a free-form string (no enum), or split into
`service: string` + `device_type: enum`. Update backfill scripts accordingly.
Defer until a third source is encountered.

### F4-E. `source` token names use snake_case identifiers in YAML

Minor: `bodyspec_dexa` reads awkwardly. If it survives F4-D, normalize to
either `BodySpec` (display name) or `bodyspec` (lowercase identifier without
the device suffix).

---

## Section 5 — Coupling: assignment knows about specific personalization signals (IMPORTANT)

### F5-A. MorningBrief.buildPrompt has 4 fixed personalization sections

`MorningBrief.mjs:buildPrompt` — sections rendered in order:
1. `## Similar Period` (F-105)
2. `## Compliance` (F-003)
3. `## Detected Patterns` (F-004)
4. `## DEXA Calibration` (F-007)

These are hardcoded. A future signal (e.g., `## Sleep Anomalies`,
`## Habit Stacking`, `## Travel Window`) requires editing `buildPrompt`. The
assignment is a god-object that knows about every personalization layer's
prompt format.

**Fix (architectural, deferred):** signal contributors register themselves with
a `PromptComposer` that the assignment iterates. Each contributor declares its
section header and rendering function. The assignment becomes:
```js
buildPrompt(gathered, memory) {
  const sections = ['## Date: ...', this.#renderCoreData(gathered)];
  for (const contributor of this.#promptContributors) {
    const section = contributor.render(gathered, memory);
    if (section) sections.push(section);
  }
  sections.push('## Instructions ...');
  return sections.join('\n');
}
```

Big lift; defer until a 5th signal lands and the pattern crystallizes.

### F5-B. `## Instructions` block in MorningBrief.buildPrompt has section-specific writing rules baked in

The instructions section reads "When a Similar Period section is provided, lean
on it; when Detected Patterns are listed, name them; ..." This logic is
duplicated between `system.mjs` (Task 25's rules) and the per-assignment prompt
instructions. Two sources of truth for the same rule.

**Fix:** the per-assignment instructions should describe WHAT the brief is for
(format, length, tone), not WHEN to reference each signal section — that's a
system-prompt concern. Move the "name detected patterns" / "name similar
period" instructions into `prompts/system.mjs` only.

---

## Section 6 — Memory key namespace is flat (MINOR)

`MorningBrief.mjs` and the agent code stamp keys like:
- `pattern_<name>_last_flagged` (TTL 7d)
- `compliance_<dimension>_last_flagged` (TTL 7d)
- `dexa_stale_warned` (TTL 14d)
- `last_morning_brief` (TTL 24h)

These all live in a single working-memory map. Collision risk with future keys
or with a pattern named `last`. Should namespace under prefixes:
- `personalization.pattern.<name>.last_flagged`
- `personalization.compliance.<dim>.last_flagged`
- `personalization.calibration.staleness_warned`

Trivial refactor; defer until a collision actually happens (or until the
memory map is documented).

---

## Section 7 — Schema rigidities (MINOR / DEFER)

### F7-A. Pattern signature has 5 fixed dimensions

`MorningBrief.#detectAndQuerySimilarPeriod` builds a signature with exactly:
`{ weight_avg_lbs, weight_delta_lbs, protein_avg_g, calorie_avg, tracking_rate }`.

Same hardcoded dimension set is mirrored in `WeeklyDigest.mjs`. Same set is
mirrored in `SimilarPeriodFinder` SCALES. Three places to update if a new
dimension is added.

**Fix:** single dimension list lives in playbook config. All three call sites
read it.

### F7-B. ComplianceToolFactory's `currentMissStreak` only exists on `post_workout_protein`

The intentional design choice is "only boolean-typed dimensions have a miss
channel; engagement-typed dimensions only have logged/untracked." That's
correct. But it's hardcoded by dimension name (`if (dim === 'post_workout_protein')`)
rather than by declared `type`. Same fix as F2-B: drive the channel logic from
declared type.

### F7-C. ScoringPersonality of `flagIfStale`: returns false when no calibration

`CalibrationConstants.flagIfStale(180)` — false when no calibration. Defensible
("not stale if it never existed"), but means a user who has NEVER had a DEXA
gets no nag at all. They probably want a separate "schedule your first DEXA"
nag, not a "your DEXA is stale" nag. Different problem; not a current-code
defect.

---

## Section 8 — Process / observability gaps (MINOR)

### F8-A. Pattern detection observability is line-in-line-out

`PatternDetector.mjs` logs `pattern_detector.match` per detection. That's it.
No log of "evaluated 7 patterns, 0 matched, here's why." For debugging why a
pattern isn't firing, you need to instrument by hand.

**Fix:** when a pattern doesn't match, log at `debug` with the failing primitive
+ value + threshold. Aggregated dashboard can show "if-trap-risk: would have
fired but `protein_avg_g=104` exceeded threshold `100` by 4g."

### F8-B. No version field on the playbook YAML

The playbook YAML has `playbook_version: 1` (Task 4 fixture) but no code reads
it. Future schema migrations will silently break older playbooks rather than
warn.

**Fix:** `PersonalContextLoader.loadPlaybook` reads `playbook_version` and
warns when it's behind the current code version. (Code declares
`SUPPORTED_PLAYBOOK_VERSIONS = new Set([1])`.)

---

## Section 9 — User-persona assumptions baked in (IMPORTANT, DEFER)

These aren't pattern-shaped — they're fundamental modeling choices that assume
KC's profile. Worth naming so they don't accumulate silently:

- **Imperial units everywhere** (`lbs`, `lbs_lean`, `bodyFatPercent`). A
  metric-system user has every value in their archive in kg / cm. The system
  assumes lbs at every layer (entity, datastore, tool, prompt).
  *Fix:* unit declaration in playbook config; conversion at the data-ingestion
  boundary; storage in canonical units (recommend SI internally).
- **Weekly cadence assumptions** in `WeeklyDigest`'s 14-day weight window and
  84-day reconciliation window. A user with sparse weight readings (weighs
  monthly) gets degraded signal.
- **Three-meals-a-day implicit model** in `breakfast_skipped_days` (timestamp
  > 11:00). A shift worker, a OMAD practitioner, a habitual late-riser all
  have legitimate eating patterns the heuristic mislabels.
- **Strava-as-canonical-workout-truth** — the longitudinal workout query
  archive falls back to `media/archives/strava/**`. No equivalent for
  Garmin / Suunto / Apple Health / Whoop, even though F-100 declares them as
  ingest-capable categories.

Defer all of these until a second user persona is in scope. But document them
so when that persona lands, the work is scoped honestly.

---

## Section 10 — Counter-pressures (don't over-rotate)

Not everything that looks hardcoded should be config. Some current-code
choices are correct:

- **Path-traversal regex** (`/^[a-zA-Z0-9_-]+$/` on userId) — a security
  primitive, MUST be in code, MUST not be configurable.
- **Privacy exclusion FLOOR** (the 8-keyword set) — sensible base policy.
  Allow ADDITIONS via config, but don't allow REMOVALS — a user can't opt
  themselves out of "don't ingest my email."
- **DailyCoachingEntry sub-field types** (boolean, integer, string) — the
  schema VOCABULARY is data, but the validation primitives stay in code.
- **The pattern-detection algorithm** (logical AND, min-confidence, evidence
  collection) — primitives go in code; thresholds and compositions go in
  YAML.

The line is: **schema and primitive-shape stays in code; instances and
thresholds go to YAML.**

---

## Recommended implementation order

If we do all of this, ordered by leverage:

1. **F1-A (PatternDetector dispatch → primitives)** — biggest win, fixes the
   trigger of this audit. ~90 min refactor + test rewrite.
2. **F2-A + F2-B + F2-C + F2-D (compliance dimensions to YAML)** — eliminates
   the second-largest hardcoded surface. Touches entity, tool, assignment, UI.
   ~3 hours.
3. **F4-A + F4-B (workout-source vocabulary to YAML)** — unblocks any user
   whose tracker isn't Strava/Garmin. ~1 hour.
4. **F4-C extension (additional privacy exclusions in YAML)** — small, but
   valuable for users with profession-specific data. ~30 min.
5. **F1-B (drop hardcoded fallbacks)** — done as part of F1-A.
6. **F3-A (similarity scales config)** — only matters when a non-KC body
   joins. Defer.
7. **F8-A (pattern detection observability)** — useful but not blocking. ~30
   min when convenient.
8. **F5-A (PromptComposer)** — defer until 5th signal.
9. **Section 9 (unit/cadence/meal-pattern assumptions)** — defer until second
   persona.

Items 1–4 represent ~5 hours of work and unwind the bulk of the
overfitting. Everything below 4 is genuine product surface that doesn't
need to be paid for until the constraint actually binds.

---

## Disposition

**Do now (~5 hours):** F1-A, F1-B, F1-C, F2-A through F2-D, F4-A, F4-B, F4-C
extension. These collectively turn "personalized coaching" from "KC's coaching
hardcoded plus a thin config layer" into "generic coaching primitives driven
by per-user playbook YAML."

**Track but defer:** F3 series, F4-D/E, F5-A, F7 series, F8 series, Section 9.
Worth knowing about, not worth paying for until the constraint actually binds.

**Keep in code:** every item in Section 10. The audit isn't about removing
all constants — it's about moving the right ones.

---

## Footnote — how this happened

The plan I wrote for these 32 tasks did instruct subagents to implement each
detector method per pattern name. That is the original sin. A better plan
would have asked for: "implement a generic primitive-driven detector; write
the seven illustrative patterns as YAML fixtures." The subagents executed
faithfully against a flawed spec.

Lesson for future plans of this shape: when the PRD says "illustrative," the
plan should preserve the illustration as DATA, not translate it into named
methods. The translation step is the moment overfitting hardens.
