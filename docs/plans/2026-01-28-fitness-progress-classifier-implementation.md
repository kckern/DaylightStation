# Fitness Progress Classifier Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement FitnessProgressClassifier domain service, wire it into the fitness API, and simplify frontend to use backend-computed `isWatched`.

**Architecture:** FitnessProgressClassifier in Fitness domain implements IMediaProgressClassifier from Content domain. Fitness router instantiates classifier with config, computes `isWatched` for each episode. Frontend trusts backend's `isWatched` field.

**Tech Stack:** Node.js ES modules, YAML config

---

## Task 1: Create FitnessProgressClassifier

**Files:**
- Create: `backend/src/1_domains/fitness/services/FitnessProgressClassifier.mjs`

**Step 1: Create the classifier file**

```javascript
// backend/src/1_domains/fitness/services/FitnessProgressClassifier.mjs

import { IMediaProgressClassifier } from '#domains/content';

/**
 * Fitness-specific media progress classifier
 *
 * Implements different thresholds than standard media because workout
 * viewing patterns differ from entertainment content:
 *
 * **Short workouts (≤45 min):** 50% threshold
 * - Users often skip warmups/cooldowns but complete the main workout
 * - Example: 30-min HIIT, user stops at 85% skipping cooldown = "watched"
 *
 * **Long workouts (>45 min):** 95% threshold
 * - These are typically multi-session content (e.g., Mario Kart longplay
 *   where you do one cup per day)
 * - Need to preserve progress for resuming across days
 * - Example: 2-hour cycling video at 60% should stay "in_progress"
 *
 * **Anti-seeking protection:** 30 seconds minimum
 * - Prevents accidental "watched" status from seeking/previewing
 * - Lower than standard (60s) because workout selection is intentional
 * - Example: User seeks to preview a workout segment, closes after 5s
 *   of actual playback = stays "in_progress" even if playhead is at 90%
 */
export class FitnessProgressClassifier extends IMediaProgressClassifier {
  /**
   * @param {Object} config - Override default thresholds
   * @param {number} [config.shortThresholdPercent=50] - % to mark short content watched
   * @param {number} [config.longThresholdPercent=95] - % to mark long content watched
   * @param {number} [config.longDurationSeconds=2700] - Duration threshold (45 min)
   * @param {number} [config.minWatchTimeSeconds=30] - Anti-seeking minimum
   */
  constructor(config = {}) {
    super();
    this.config = {
      shortThresholdPercent: 50,
      longThresholdPercent: 95,
      longDurationSeconds: 45 * 60,  // 45 minutes
      minWatchTimeSeconds: 30,
      ...config
    };
  }

  /**
   * Classify workout viewing progress
   *
   * @param {import('#domains/content').MediaProgress} progress
   * @param {Object} [contentMeta]
   * @param {number} [contentMeta.duration] - Content duration in seconds
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   *
   * @example
   * // 30-min workout, user at 85% (skipped cooldown)
   * classifier.classify({ playhead: 1530, percent: 85, watchTime: 1500 }, { duration: 1800 })
   * // => 'watched' (85% >= 50% short threshold)
   *
   * @example
   * // 2-hour longplay, user at 60% across multiple sessions
   * classifier.classify({ playhead: 4320, percent: 60, watchTime: 4000 }, { duration: 7200 })
   * // => 'in_progress' (60% < 95% long threshold, preserves resume position)
   *
   * @example
   * // User previewed workout by seeking, only 10s actual playback
   * classifier.classify({ playhead: 1620, percent: 90, watchTime: 10 }, { duration: 1800 })
   * // => 'in_progress' (watchTime 10s < 30s anti-seeking threshold)
   */
  classify(progress, contentMeta = {}) {
    const { playhead, watchTime } = progress;
    const percent = progress.percent ?? 0;
    const duration = contentMeta.duration || progress.duration || 0;

    // No playhead = never started
    if (!playhead || playhead === 0) {
      return 'unwatched';
    }

    // Anti-seeking: must have actually watched content, not just seeked
    // Prevents false "watched" from preview/accidental seek
    if (watchTime !== undefined && watchTime < this.config.minWatchTimeSeconds) {
      return 'in_progress';
    }

    // Long content (>45 min) uses stricter threshold to preserve
    // resume position for multi-session viewing
    const isLongContent = duration > this.config.longDurationSeconds;
    const threshold = isLongContent
      ? this.config.longThresholdPercent
      : this.config.shortThresholdPercent;

    return percent >= threshold ? 'watched' : 'in_progress';
  }
}
```

**Step 2: Verify syntax**

Run: `cd backend && node --check src/1_domains/fitness/services/FitnessProgressClassifier.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/1_domains/fitness/services/FitnessProgressClassifier.mjs
git commit -m "feat(fitness): add FitnessProgressClassifier domain service"
```

---

## Task 2: Export classifier from Fitness domain

**Files:**
- Modify: `backend/src/1_domains/fitness/index.mjs`

**Step 1: Add export**

Add after existing service exports:

```javascript
export { FitnessProgressClassifier } from './services/FitnessProgressClassifier.mjs';
```

**Step 2: Verify syntax**

Run: `cd backend && node --check src/1_domains/fitness/index.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/1_domains/fitness/index.mjs
git commit -m "feat(fitness): export FitnessProgressClassifier from domain"
```

---

## Task 3: Wire classifier into fitness router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

**Step 1: Add import at top of file**

```javascript
import { FitnessProgressClassifier } from '#domains/fitness';
```

**Step 2: Create classifier in show route handler**

Inside the `/show/:id` route handler, after loading config and before mapping items, add:

```javascript
// Create fitness progress classifier with config thresholds
const classifier = new FitnessProgressClassifier(
  config?.progressClassification || {}
);
```

**Step 3: Update item mapping to include isWatched**

Find the items mapping section (around line 146-155) and update to:

```javascript
return {
  ...item,
  watchProgress: percent,
  watchSeconds: playhead,
  watchedDate: watchData.lastPlayed || null,
  lastPlayed: watchData.lastPlayed || null,
  // Backend-computed watch status (SSOT)
  isWatched: classifier.classify(
    { playhead, percent, watchTime: watchData.watchTime },
    { duration: mediaDuration }
  ) === 'watched'
};
```

**Step 4: Handle items without watch data**

After the mapping section, ensure items without watch data also get `isWatched: false`:

```javascript
// Ensure all items have isWatched field
items = items.map(item => ({
  ...item,
  isWatched: item.isWatched ?? false
}));
```

**Step 5: Verify syntax**

Run: `cd backend && node --check src/4_api/v1/routers/fitness.mjs`
Expected: No output (success)

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): wire FitnessProgressClassifier into show endpoint"
```

---

## Task 4: Simplify frontend isEpisodeWatched

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx`

**Step 1: Update isEpisodeWatched callback (around line 496-502)**

Replace:

```javascript
const isEpisodeWatched = useCallback((episode) => {
  const watchProgress = normalizeNumber(episode?.watchProgress) ?? 0;
  const durationSeconds = normalizeNumber(episode?.duration) ?? 0;
  // For long items (>45 min), require 95% progress; otherwise 50%
  const threshold = durationSeconds > 45 * 60 ? 95 : 50;
  return watchProgress >= threshold;
}, []);
```

With:

```javascript
const isEpisodeWatched = useCallback((episode) => {
  // Trust backend-computed isWatched (SSOT)
  // See: FitnessProgressClassifier for threshold logic
  return episode?.isWatched ?? false;
}, []);
```

**Step 2: Update episodes grid local calculation (around line 1084-1089)**

Replace:

```javascript
const watchProgress = normalizeNumber(episode.watchProgress) ?? 0;
const watchedDate = episode.watchedDate;
const durationSeconds = normalizeNumber(episode.duration) ?? 0;
// For long items (>45 min), require 95% progress; otherwise 50%
const watchedThreshold = durationSeconds > 45 * 60 ? 95 : 50;
const isWatched = watchProgress >= watchedThreshold;
```

With:

```javascript
const watchProgress = normalizeNumber(episode.watchProgress) ?? 0;
const watchedDate = episode.watchedDate;
// Trust backend-computed isWatched (SSOT)
const isWatched = episode.isWatched ?? false;
```

**Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx
git commit -m "refactor(fitness): simplify frontend to use backend isWatched"
```

---

## Task 5: Final verification

**Step 1: Check for remaining frontend threshold logic**

Run: `grep -n "45 \* 60\|watchedThreshold\|threshold.*95\|threshold.*50" frontend/src/modules/Fitness/`
Expected: No matches (all threshold logic removed)

**Step 2: Verify backend imports work**

Run: `cd backend && node -e "import('#domains/fitness').then(m => console.log('FitnessProgressClassifier:', typeof m.FitnessProgressClassifier))"`
Expected: `FitnessProgressClassifier: function`

**Step 3: Final commit**

```bash
git add -A && git commit -m "feat(fitness): complete FitnessProgressClassifier implementation" --allow-empty
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create FitnessProgressClassifier domain service |
| 2 | Export from Fitness domain index |
| 3 | Wire into fitness router, add isWatched to response |
| 4 | Simplify frontend to trust backend isWatched |
| 5 | Final verification |
