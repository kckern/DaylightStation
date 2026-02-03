# Fitness Module Architecture Audit

**Date:** 2026-02-03
**Status:** Complete
**Scope:** `frontend/src/modules/Fitness/`
**Triggered By:** Investigation of DRY violation in `FitnessUsers.jsx`

---

## Executive Summary

An investigation into a documented DRY violation (duplicate `device-wrapper` implementation) revealed systemic architectural issues in the Fitness module. A comprehensive shared component library exists but is largely unused by core production code. Five files exceed 1000 lines and contain the majority of complexity, predating the shared library and never refactored to use it.

**Key Finding:** The DRY violation is a symptom, not the disease. The module suffers from incomplete refactoring—abstractions were created but original code was never migrated.

---

## Findings

### 1. God Objects (CRITICAL)

Five JSX files exceed 1000 lines, with the largest at 1560:

| File | Lines | Role |
|------|-------|------|
| `FitnessPlayer.jsx` | 1,560 | Main video player |
| `FitnessShow.jsx` | 1,250 | Show/episode container |
| `FitnessPlayerOverlay.jsx` | 1,185 | Overlay system |
| `FitnessChartApp.jsx` | 1,138 | Chart plugin |
| `FitnessUsers.jsx` | 1,135 | User/device sidebar |

Additional large files (500-800 lines):
- `VoiceMemoOverlay.jsx` (786)
- `FitnessChart.helpers.js` (672)
- `FitnessMusicPlayer.jsx` (655)
- `ActivityMonitor.js` (623)
- `ChartDataBuilder.js` (578)

**Impact:** These files are difficult to test, modify, or understand. They accumulate responsibilities over time and resist decomposition.

---

### 2. Abandoned Shared Library (HIGH)

The `shared/` directory contains 30+ component directories:

```
shared/
├── primitives/       # 14 components (ProgressBar, Timer, CountdownRing, etc.)
├── composites/       # 7 components (AppModal, ConfirmDialog, ActionBar, etc.)
├── integrations/     # 11 components (DeviceAvatar, HeartRateDisplay, etc.)
├── containers/       # 4 components (FullScreenContainer, SplitViewContainer, etc.)
├── hooks/            # 3 hooks (useDeadlineCountdown, useAudioFeedback, etc.)
├── utils/            # Utility functions
└── constants/        # Shared constants
```

**Actual adoption in production code:**

| File | Components Used |
|------|-----------------|
| `VoiceMemoOverlay.jsx` | MicLevelIndicator, CountdownRing, formatTime |
| `FitnessTreasureBox.jsx` | ElapsedTimer, ZONE_COLORS |
| `FitnessGovernance.jsx` | StripedProgressBar, useDeadlineCountdown |
| `FitnessSessionApp.jsx` | FullscreenVitalsOverlay |
| `GovernanceStateOverlay.jsx` | useDeadlineCountdown |

**Only 5-6 production files import from shared/.** The majority of imports come from `ComponentShowcase/`—a demo/documentation app, not production code.

**The five god-object files do not use the shared library at all.**

---

### 3. Duplicate Implementations (MEDIUM)

Beyond the originally documented `device-wrapper` violation:

| Pattern | Location 1 | Location 2 | Location 3 |
|---------|------------|------------|------------|
| `device-wrapper` | `BaseRealtimeCard.jsx:78` | `FitnessUsers.jsx:977` | — |
| `device-timeout-bar` | `BaseRealtimeCard.jsx:98` | `FitnessUsers.jsx:1019` | `RpmDeviceCard.jsx:54` |
| `device-zone-info` | `BaseRealtimeCard.jsx:81` | `FitnessUsers.jsx:978` | — |
| `zone-progress-bar` | `PersonCard.jsx:89` | `FitnessUsers.jsx:1069` | — |
| DeviceAvatar | `shared/integrations/DeviceAvatar/` | `components/RpmDeviceAvatar.jsx` | — |

Each duplicate creates maintenance burden and divergence risk.

---

### 4. BaseRealtimeCard Adoption Failure (LOW)

`BaseRealtimeCard.jsx` was designed as a shared layout wrapper per its documentation:

```javascript
/**
 * BaseRealtimeCard - Shared layout wrapper for all realtime fitness cards
 *
 * Provides consistent structure for:
 * - Timeout/countdown bar
 * - Profile image container
 * - Info section (name, stats)
 * - Zone badge (optional)
 * - Progress bar (optional)
 */
```

**Adoption status:**

| Component | Uses BaseRealtimeCard |
|-----------|----------------------|
| `PersonCard.jsx` | Yes |
| `VibrationCard.jsx` | Yes |
| `FitnessUsers.jsx` | No (inline implementation) |
| `RpmDeviceCard.jsx` | No (own implementation) |

---

## Root Cause Analysis

Evidence from codebase comments suggests planned but incomplete refactoring:

1. **`shared/primitives/index.js`:**
   ```javascript
   // Phase 1 primitives (extracted from shell components)
   export { default as StripedProgressBar } from './StripedProgressBar';
   ```

2. **`shared/integrations/index.js`:**
   ```javascript
   // Phase 2: Migrated from components/
   export { default as DeviceAvatar } from './DeviceAvatar';
   ```

3. **`components/index.js`:**
   ```javascript
   * NEW: import { UserAvatar } from '../shared';
   * NEW: import { DeviceAvatar } from '../shared';
   ```
   These comments indicate planned migration that was never completed.

**Timeline (inferred):**
1. Core features built in monolithic files (FitnessPlayer, FitnessUsers, etc.)
2. Shared library designed and partially implemented
3. New features (PersonCard, VibrationCard) used the library
4. Original monolithic code never migrated
5. Refactoring effort stalled; shared library became aspirational

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Total JS/JSX files in module | 200+ |
| Files over 1000 lines | 5 |
| Files over 500 lines | 10 |
| Shared library components | 30+ |
| Production files using shared/ | 5-6 |
| Duplicate pattern instances | 5+ |

---

## Risk Assessment

| Issue | Severity | Likelihood of Problems | Notes |
|-------|----------|----------------------|-------|
| God objects | Critical | High | Any change risks regressions |
| Unused shared library | High | Medium | Confusion for new developers |
| Duplicate implementations | Medium | Medium | Styles may diverge over time |
| BaseRealtimeCard non-adoption | Low | Low | Isolated to sidebar cards |

---

## Recommendations

### Short Term (Low Effort)

1. **Document the architectural intent** — Add a README to `shared/` explaining what it is and that adoption is incomplete
2. **Delete truly dead code** — Audit shared/ for components that were never used and remove them
3. **Fix the documented DRY violation** — Migrate FitnessUsers.jsx to use BaseRealtimeCard (as outlined in the bug doc)

### Medium Term (Moderate Effort)

4. **Create a migration tracker** — Document which god-object files should adopt which shared/ components
5. **Establish review guidelines** — New sidebar cards must use BaseRealtimeCard; new UI must check shared/ first
6. **Consolidate DeviceAvatar** — Delete `components/RpmDeviceAvatar.jsx` and use `shared/integrations/DeviceAvatar`

### Long Term (High Effort)

7. **Decompose FitnessUsers.jsx** — Extract device rendering, sorting logic, and layout logic into separate modules
8. **Decompose FitnessPlayer.jsx** — The largest file (1560 lines) needs systematic breakdown
9. **Audit all god objects** — Each 1000+ line file needs its own decomposition plan

---

## Related Documents

- `docs/_wip/bugs/2026-02-03-fitness-device-wrapper-dry-violation.md` — Original bug report that triggered this audit
- `frontend/src/modules/Fitness/shared/DESIGN.md` — Shared library design document
- `frontend/src/modules/Fitness/ARCHITECTURE.md` — Module architecture documentation

---

## Appendix: File Size Distribution

Files over 300 lines in the Fitness module:

```
1560  FitnessPlayer.jsx
1250  FitnessShow.jsx
1185  FitnessPlayerOverlay.jsx
1138  FitnessChartApp.jsx
1135  FitnessUsers.jsx
 786  VoiceMemoOverlay.jsx
 672  FitnessChart.helpers.js
 655  FitnessMusicPlayer.jsx
 623  ActivityMonitor.js
 578  ChartDataBuilder.js
 574  useVoiceMemoRecorder.js
 559  ChallengeOverlay.jsx
 547  PoseDetectorService.js
 480  FitnessSidebarMenu.jsx
 423  FitnessPlayerFooterSeekThumbnails.jsx
 421  SidebarFooter.jsx
 418  useZoomState.js
 418  LayoutManager.js
 409  SkeletonCanvas.jsx
 394  poseGeometry.js
 393  GovernanceStateOverlay.jsx
 388  FitnessMenu.jsx
 374  useSeekState.js
 371  FitnessPlayerFooterSeekThumbnail.jsx
 319  PoseDemo.jsx
 316  fitness.js (constants)
 312  VibrationApp.jsx
 302  PoseContext.jsx
```

---

## Audit Methodology

1. Line count analysis of all JS/JSX files
2. Grep analysis for `BaseRealtimeCard` imports
3. Grep analysis for duplicate CSS class patterns
4. Directory structure review of `shared/`
5. Import analysis for shared library adoption
6. Review of inline comments indicating migration plans
