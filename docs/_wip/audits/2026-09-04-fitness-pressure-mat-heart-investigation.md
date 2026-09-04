# Fitness pressure-mat visibility and heart rendering investigation

Date: 2026-09-04

Status: implementation and regression verification in progress. The equipment
entry is selectively recovered on disk, preserving all other settings. Code is
implemented in an isolated worktree; deployment and physical garage acceptance
are still pending. The investigation evidence below describes the original state.

## Implementation progress

- Backed up the active household `fitness/config.yml` to
  `fitness/config.yml.bak-20260904-mat-recovery`, then added only the missing
  equipment entry through the admin config API. A parsed comparison after
  removing that entry matches the backup exactly. The conflicted copy is intact;
  no requirements/challenges were activated. Runtime config caching still needs
  the supported deployment/reload path before the public catalog reflects it.
- Reconciled mat trackers by physical identity; preserved assignment and renamed
  timeline series on discovery promotion without dropping a longer canonical
  series. Config refresh/removal no longer hides a used mat or resets counts.
- Added durable mat checkpoint metadata, legacy sampled-total restoration,
  recorder rebinding, and per-user aggregation across multiple mats. Tests verify
  40 saved steps plus a new step records 41 in the actual resumed timeline.
- Ignored same-boot counter regressions, stale timestamps, and prior-boot frames;
  kept unknown optional boot identity null rather than converting it to zero.
- Wrapped the mat in a native element at the FlipMove boundary. Added keyboard
  activation, focus management, and a visible temporary “Release mat” action.
- Replaced live HR emoji and the reusable PersonCard heart with a fixed SVG and
  shared frontend/backend strap palette. Added actual client-entry asset and
  effective catalog identities to startup diagnostics.
- Current regression run: **519 Vitest tests passed**, zero failed/skipped,
  plus **three backend strap-color node:test cases passed**. Targeted ESLint and
  `git diff --check` pass. The unrelated realtime-bpm-analyzer package still emits
  a missing source-map warning.
- Isolated Chromium and Firefox real-component checks: **225 layout/color/state
  cases pass in each browser (450 total)**,
  covering 1/2/3/4/6 participants, three widths, all strap colors, long names,
  inactive states, zoom, and reduced motion. Dynamic mat insertion and keyboard
  interaction pass without browser errors or animation ref warnings. The fixture
  uses viewport-coordinate painted-path bounds for zoom equivalence between
  engines. Deployment and the physical garage check remain pending.

Implementation reference: [step-mat lifecycle and heart rendering](../../reference/fitness/governance-engine.md#step-mat-lifecycle).

## Summary

The pressure mat's hardware-to-browser transport worked during the reported
session. Its Fitness equipment definition and governance settings are stranded
in a Dropbox conflicted copy, while the active configuration omits them. Runtime
timing strongly suggests the kiosk is also using code from before the fallback
discovery fix was deployed. The exact loaded JavaScript hash remains unverified.

The investigation additionally reproduced mat state loss on equipment-config
reapplication and session resume, and an unsupported animation-wrapper child.
These require code repairs; refreshing the kiosk is not a complete remedy.

Heart clipping remains a reported defect without an exact reproduction. The
current live-screen capture and isolated current-stylesheet checks do not prove
glyph clipping. A shared SVG heart and scoped sizing are the recommended design,
but visual acceptance must include the actual Firefox kiosk and affected layout.

## Evidence and confidence

| Finding | Evidence | Status |
| --- | --- | --- |
| Mat transport reached the Fitness browser | During 21:40–22:20 UTC, frontend `fitness.pressure-mat` logged 32 `pressed`, 20 `stomped`, and 31 `released` events; backend completed-press logs corroborate delivery | Confirmed; these are event counts, not additive step totals |
| Active Fitness catalog omits the mat | `GET /api/v1/fitness` returns nine equipment entries, none bound to the pressure mat | Confirmed |
| Intended configuration exists in a conflict file | The household's `fitness/config (<conflicted copy>).yml` contains `step_mat`, its hardware binding, an activity-rate requirement, and three step/stomp challenges; active `fitness/config.yml` does not | Confirmed |
| Old browser code likely drops otherwise healthy events | Old `ingestPressureMat` returns early for unconfigured hardware. Current fallback emits a discovery warning, but no discovery/creation/card-lifecycle logs were found in the two-day query | Strong inference, not a loaded-bundle hash check |
| Mat card violates the animation library's child contract | `FitnessUsers` passes a function component without a forwarded DOM ref directly to `FlipMove`; the composition test reproduces both library and React warnings | Confirmed; not established as today's invisibility cause |
| Reapplying unchanged config loses activity | Local probe: one step/visible card becomes zero steps/`seenThisSession:false` after calling `setEquipmentCatalog` again with identical configuration | Confirmed |
| Resume does not restore mat runtime totals | Local probe: saved series ends at 40 steps; `_hydrateFromSession` leaves the tracker at zero/hidden; the next physical step reports one, not 41 | Confirmed |
| Same-boot counter regression can overcount | Local probe: counter sequence 100 → 101 → 100 → 101 records three steps for two distinct physical increments, with unchanged boot identity | Confirmed robustness gap; no evidence this sequence occurred during the incident |
| Heart clipping has a specific established cause | Current screenshot did not show it; 24 isolated glyph/layout cases did not show glyph boxes crossing their card bounds | Not established |

### Deployment timing

- Fallback discovery was committed as `a1922e75f` on September 3 at 18:40 PDT.
- The last observed production startup before the kiosk's current app lifetime
  was September 3 at 16:02 PDT, before that commit.
- The kiosk profiler's current lifetime began September 3 at 19:10 PDT and
  continued through the reported workout. The next observed production startup
  was at 22:28 PDT.
- Production now serves application commit `292251b1b`, which includes the
  fallback. Server deployment does not replace JavaScript already in a kiosk tab.
- This chronology, plus missing tracker logs, supports stale client code. A
  running-process start time or a fresh `/build.txt` response alone cannot prove
  which code an existing tab has loaded.

### Configuration ownership and safe recovery

Use the current `HOUSEHOLD_APP_CONFIGS` contract in
`shared/contracts/householdConfig.mjs`: Fitness configuration resolves to
`fitness/config`, and pressure-mat hardware configuration to
`hardware/pressure-mats/config`, within the selected household. Older generic
project guidance about `config/fitness.yml` does not describe these current paths.
Resolve the environment's data root through `.claude/settings.local.json`.

The conflict is not limited to adding an equipment row. Differences include
equipment, ring celebration volume, the default base requirement, typed
requirements, and challenge selections. Do not overwrite the live file with the
conflicted copy or infer that every older setting should win.

The conflicting copy contains a **currently inactive, but marked enabled**
30-SPM continuous requirement and challenges for 40 steps, 70 steps, and eight
stomps. Restoring those rules changes workout enforcement, not merely visibility.
Restore the equipment binding first; activating enforcement is a separate,
explicit product decision. Keep both original files recoverable.

## Implementation sequence

### 1. Restore reliable visibility and deployment verification

- Back up and selectively reconcile the missing equipment definition into the
  active household Fitness configuration. Preserve unrelated current values.
- Verify the effective public catalog, not just the edited YAML. Use the
  supported config-reload/deployment path; account for server-side caching.
- Retain automatic discovery as a safety net. Missing optional friendly metadata
  must not silently discard validated mat events or require a setup dialog.
- Keep visibility independent of user assignment: the first in-session step
  should show SPM, steps, and stomps with **zero taps**.
- Put a stable native element at the mat's `FlipMove` boundary, or consistently
  forward its actual DOM ref. Test insertion after HR cards already exist,
  sorting, removal, and remounting—not just initial rendering.
- Add client-loaded build identity and effective equipment-config identity to
  low-volume startup diagnostics. Do not label the result of a fresh server
  build-info fetch as the version already executing in the browser.
- Log the first in-session mat activation through ingest, tracker, context
  publication, and card mount with the same mat/session identity. Keep periodic
  diagnostics aggregated; do not add per-reading log floods.

Acceptance: after an idle, verified kiosk refresh, a physical step creates one
card without assignment/setup; a stomp adds one stomp without adding a second
step. The card remains visible when the person stops, with totals intact.

### 2. Make mat state survive normal lifecycle changes

- Reconcile trackers by stable hardware identity rather than clearing/recreating
  every tracker when the config object changes. Preserve totals, counter
  baselines, visibility, and assignments for unchanged hardware.
- Explicitly handle discovered-to-configured ID promotion so it does not split
  one physical mat's session into two identities or reset its counters.
- Restore device and attributable per-user totals on session resume. Rebase
  firmware counters separately from saved workout totals; do not count an entire
  device-boot history as new activity or assume movement during a browser gap.
- Rebind the timeline recorder to the resumed timeline and verify subsequent
  samples append to that same timeline. Audit `_hydrateFromSession` and recorder
  ownership together instead of restoring only the displayed number.
- Distinguish a firmware restart from stale/duplicate/regressing packets using
  available boot identity and device timestamps. Preserve monotonic workout
  totals; document the fallback when firmware identity is unavailable.
- Keep offline/dormant status separate from session visibility and stored totals.

Acceptance: an identical config reapply changes nothing; promoting a discovered
mat retains its total; 40 saved steps followed by one new step yields 41; duplicate
or stale readings add nothing; firmware reboot neither subtracts nor invents reps.

### 3. Standardize hearts without a broad Fitness rewrite

- Introduce one code-native SVG `HeartIcon`, with explicit viewBox/dimensions,
  `flex-shrink: 0`, centered alignment, and adequate internal space if animated.
  Reuse the installed icon system where appropriate; no raster/image generation.
- Preserve the distinction between physical strap color and exertion-zone color.
  Keep an accessible text label where color is meaningful; hide a decorative
  heart from screen readers when adjacent BPM text already supplies its meaning.
- Use a shared pure strap palette/resolver for frontend and backend. The current
  frontend palette and `backend/src/2_domains/fitness/strapColors.mjs` are manually
  synchronized copies. Preserve existing public imports through re-exports if
  moving the implementation to a shared contract.
- Update the actual inline HR card in `FitnessUsers`, not just `PersonCard`.
  The latter appears in a registry but has no current direct call site found in
  the application; replacing it alone would miss the live screen.
- Scope heart sizing and any animation to the component. Several legacy Fitness
  stylesheets declare the global `heartbeat` name with different amplitudes.
  However, the current sidebar fixture computed `animation:none`: the earlier
  animation-clipping theory is not proven for the reported screen.
- Consolidate only the duplicated HR stats/icon layout needed for this fix.
  Do not combine it with an unrelated rewrite of the entire Fitness app.

Acceptance: uncropped hearts and readable BPM at one/two-user vertical, three/
four-user horizontal, five-plus-user compact, and resized sidebar widths; test
long names, all strap colors, inactive states, zoom/display scaling, Firefox,
Chromium, and reduced motion. Obtain/reproduce the reported clipped state on the
actual kiosk before calling the visual defect resolved.

### 4. Close adjacent workflow and test gaps

- The mat currently exposes pointer down/up handlers on a non-focusable wrapper;
  the base card is not marked clickable. Supply keyboard activation and visible
  focus as well as touch/pointer access.
- Keep assignment optional. If attribution is needed, show likely active people
  immediately and preserve an explicit existing assignment; do not silently
  attribute historical unassigned steps to a guessed person.
- Clarify stop/disengage semantics. Current `disengage()` clears engagement, but
  the next step engages again; its confirmation text implies stopping for the
  whole session. Decide whether this is a temporary release or a latched opt-out,
  name it honestly, and test the chosen behavior. Avoid making a hidden long
  press the only available control.
- Add an integration test that feeds normalized WebSocket events through the
  real provider/session into the real card and verifies actual visibility after
  dynamic insertion. Existing tests separately validate these stages but allow
  the ref warnings to pass.
- Validate hardware/equipment configuration bindings and unresolved policy
  targets at load time, with actionable operator diagnostics. Preserve basic
  tracking when policy metadata is incomplete.
- Keep continuous enforcement and additional challenges out of the visibility
  repair until their intended behavior is confirmed and tested.

## Verification performed

- Read-only production API, log-store, source/history, household config, and
  garage-display inspection. No artificial sensor events were sent to production.
- Original focused frontend suite: 19 tests passed across seven files, with the
  `FlipMove`/React ref warnings described above.
- Expanded checks: **46 Vitest tests passed across 12 files**, plus **three
  backend strap-color tests passed under `node --test`**, with no skipped tests.
  These cover adapter, HTTP operations, completed-press logging,
  normalization, provider, tracker, session routing, sampled timeline, step
  governance, card composition/interactions, and strap palettes.
- Backend strap-color tests use `node:test`, not Vitest. An initial combined run
  reported “No test suite found” for that file; it was rerun with its correct
  runner rather than treating the warning as a pass.
- Additional local, in-memory probes reproduced unchanged-config reset,
  missing resume hydration, and same-boot regressing-counter overcount. These
  are not yet committed regression tests and do not prove those sequences
  occurred during the reported workout.
- An isolated Chromium fixture using the currently served production CSS checked
  24 heart/color-layout combinations without loading the application JavaScript
  or connecting to its WebSocket. No glyph-to-card clipping was reproduced.
  This is not a full application, kiosk-Firefox, font-equivalence, or auto-scaling
  test; full-list overflow and the original reported state remain to be checked.

## Rollout and completion criteria

Implement code changes and targeted regression tests before production rollout.
Run the standalone deploy gate before a build and again before container
replacement; respect Fitness, Player, and Portal activity checks. Refresh the
garage kiosk only when safe, then verify its loaded build/config identities.

A green unit suite and a new server build are insufficient. Completion requires
one observed physical-step/stomp-to-visible-card check, verified preserved totals
across supported lifecycle changes, no animation ref warnings, and a visual
check on the affected garage display. Record unresolved checks explicitly.

Related reference: [governance engine and step-mat lifecycle](../../reference/fitness/governance-engine.md).
