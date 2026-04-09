# Suggestion Card Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user completes a workout and returns to the home screen, surgically replace the completed card with a fresh one using locally cached overflow data, with a dimmed→fade-out→fade-in transition.

**Architecture:** The backend suggestions API returns visible cards plus overflow candidates. The frontend tracks which card was played, dims it on return, fades it out, and swaps in a replacement from overflow — no network request needed.

**Tech Stack:** Express (backend), React (frontend), SCSS transitions

---

### Task 1: Backend — Collect Overflow Candidates

**Files:**
- Modify: `backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs`
- Test: `tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs`

- [ ] **Step 1: Write failing test for overflow in response**

Add this test to the existing `describe('FitnessSuggestionService')` block in `tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs`:

```javascript
test('returns overflow candidates beyond grid size', async () => {
  const strategies = [
    stubStrategy('next_up', ['100', '200', '300', '400', '500', '600']),
    stubStrategy('discovery', ['700', '800', '900', '1000']),
  ];
  const service = makeService(strategies);
  const result = await service.getSuggestions({ gridSize: 4 });

  expect(result.suggestions).toHaveLength(4);
  expect(result.overflow).toBeDefined();
  expect(result.overflow.length).toBeGreaterThan(0);
  // Overflow should contain next_up cards that didn't fit
  expect(result.overflow.some(c => c.type === 'next_up')).toBe(true);
  // Overflow should not duplicate visible suggestions by showId
  const visibleShowIds = new Set(result.suggestions.map(s => s.showId));
  for (const card of result.overflow) {
    expect(visibleShowIds.has(card.showId)).toBe(false);
  }
});

test('overflow is capped at 4 cards', async () => {
  // 20 shows — way more than grid + overflow cap
  const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i));
  const strategies = [stubStrategy('next_up', ids)];
  const service = makeService(strategies);
  const result = await service.getSuggestions({ gridSize: 4 });

  expect(result.suggestions).toHaveLength(4);
  expect(result.overflow.length).toBeLessThanOrEqual(4);
});

test('overflow is empty when no excess candidates', async () => {
  const strategies = [stubStrategy('next_up', ['100', '200'])];
  const service = makeService(strategies);
  const result = await service.getSuggestions({ gridSize: 4 });

  expect(result.suggestions).toHaveLength(2);
  expect(result.overflow).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs`
Expected: 3 new tests FAIL — `result.overflow` is `undefined`

- [ ] **Step 3: Implement overflow collection**

In `backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs`, replace the strategy collection loop and return statement in `getSuggestions()` (lines 67–103) with:

```javascript
    // Run strategies in order, dedup by showId
    // Collect beyond gridSize into overflow for client-side card replacement
    const OVERFLOW_CAP = 4;
    const allCards = [];
    const usedShowIds = new Set();
    const maxCollect = slots + OVERFLOW_CAP;

    for (const strategy of this.#strategies) {
      const remaining = maxCollect - allCards.length;
      if (remaining <= 0) break;

      let cards;
      try {
        cards = await strategy.suggest(context, remaining);
      } catch (err) {
        this.#logger.error?.('suggestions.strategy-failed', {
          strategy: strategy.constructor?.name,
          error: err?.message,
        });
        continue;
      }

      for (const card of cards) {
        if (allCards.length >= maxCollect) break;
        if (card.showId && usedShowIds.has(card.showId)) continue;
        allCards.push(card);
        if (card.showId) usedShowIds.add(card.showId);
      }
    }

    const results = allCards.slice(0, slots);
    const overflow = allCards.slice(slots, slots + OVERFLOW_CAP);

    // Reorder top row: next_up cards left, resume cards right
    const topRow = results.slice(0, 4);
    const bottomRow = results.slice(4);
    topRow.sort((a, b) => {
      const aResume = a.type === 'resume' ? 1 : 0;
      const bResume = b.type === 'resume' ? 1 : 0;
      return aResume - bResume;
    });

    return { suggestions: [...topRow, ...bottomRow], overflow };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs`
Expected: All tests PASS (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs
git commit -m "feat(fitness): return overflow candidates in suggestions response"
```

---

### Task 2: Backend — Remove Internal Cap from NextUpStrategy

**Files:**
- Modify: `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs`
- Test: `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs`

The `NextUpStrategy` currently caps at `next_up_max` (default 4) internally. Since the `FitnessSuggestionService` now handles the visible/overflow split, the strategy should return its full candidate pool so extras can flow into overflow.

- [ ] **Step 1: Write failing test for uncapped output**

Add this test to `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs`:

```javascript
test('returns all candidates when remainingSlots exceeds next_up_max', async () => {
  const sessions = [
    makeSession('100', 'Show A', '1001', 'Ep 1', '2026-04-08'),
    makeSession('200', 'Show B', '2001', 'Ep 1', '2026-04-07'),
    makeSession('300', 'Show C', '3001', 'Ep 1', '2026-04-06'),
    makeSession('400', 'Show D', '4001', 'Ep 1', '2026-04-05'),
    makeSession('500', 'Show E', '5001', 'Ep 1', '2026-04-04'),
    makeSession('600', 'Show F', '6001', 'Ep 1', '2026-04-03'),
  ];
  const playables = {
    '100': [makeEpisode(1002, 2)],
    '200': [makeEpisode(2002, 2)],
    '300': [makeEpisode(3002, 2)],
    '400': [makeEpisode(4002, 2)],
    '500': [makeEpisode(5002, 2)],
    '600': [makeEpisode(6002, 2)],
  };
  const ctx = makeContext(sessions, playables, { next_up_max: 4 });
  // Ask for more than next_up_max
  const result = await strategy.suggest(ctx, 8);

  expect(result.length).toBe(6);
});
```

Check the existing test helpers `makeSession`, `makeEpisode`, and `makeContext` in the file first. Adjust the helper call signatures if they differ from above — the test should use the same patterns as existing tests in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs`
Expected: FAIL — returns only 4 cards due to internal `next_up_max` cap

- [ ] **Step 3: Remove internal cap**

In `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs`, change line 11:

```javascript
// Before:
const max = Math.min(fitnessConfig?.suggestions?.next_up_max ?? 4, remainingSlots);

// After:
const max = remainingSlots;
```

- [ ] **Step 4: Run all NextUpStrategy tests**

Run: `npx vitest run tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs
git commit -m "feat(fitness): remove internal cap from NextUpStrategy for overflow"
```

---

### Task 3: Frontend — Add lastPlayedContentId to FitnessScreenProvider

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

- [ ] **Step 1: Add state and expose in context**

In `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`, add `lastPlayedContentId` state and include it in the context value:

```jsx
import React, { createContext, useContext, useMemo, useState } from 'react';

const FitnessScreenContext = createContext(null);

export function FitnessScreenProvider({ onPlay, onNavigate, onCtaAction, children }) {
  const [scrollToDate, setScrollToDate] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [longitudinalSelection, setLongitudinalSelection] = useState(null);
  const [lastPlayedContentId, setLastPlayedContentId] = useState(null);

  const value = useMemo(() => ({
    onPlay, onNavigate, onCtaAction,
    scrollToDate, setScrollToDate,
    selectedSessionId, setSelectedSessionId,
    longitudinalSelection, setLongitudinalSelection,
    lastPlayedContentId, setLastPlayedContentId,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate, selectedSessionId, longitudinalSelection, lastPlayedContentId]);

  return (
    <FitnessScreenContext.Provider value={value}>
      {children}
    </FitnessScreenContext.Provider>
  );
}

export function useFitnessScreen() {
  const ctx = useContext(FitnessScreenContext);
  if (!ctx) {
    return {
      onPlay: null, onNavigate: null, onCtaAction: null,
      scrollToDate: null, setScrollToDate: () => {},
      selectedSessionId: null, setSelectedSessionId: () => {},
      longitudinalSelection: null, setLongitudinalSelection: () => {},
      lastPlayedContentId: null, setLastPlayedContentId: () => {},
    };
  }
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git commit -m "feat(fitness): add lastPlayedContentId to FitnessScreenProvider"
```

---

### Task 4: Frontend — Track Played Card and Swap Logic in SuggestionsWidget

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.jsx`

- [ ] **Step 1: Add overflow state, play tracking, and swap logic**

Replace the full contents of `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.jsx` with:

```jsx
import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import SuggestionCard from './SuggestionCard.jsx';
import './FitnessSuggestionsWidget.scss';

function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx), localId: contentId.slice(colonIdx + 1) };
}

function SuggestionsGridSkeleton() {
  return (
    <div className="suggestions-grid">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="suggestion-card suggestion-card--skeleton">
          <div className="suggestion-card__image skeleton shimmer" />
          <div className="suggestion-card__body">
            <div className="skeleton shimmer" style={{ height: 10, width: '50%', borderRadius: 3 }} />
            <div className="skeleton shimmer" style={{ height: 12, width: '80%', borderRadius: 3 }} />
            <div className="skeleton shimmer" style={{ height: 10, width: '40%', borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FitnessSuggestionsWidget() {
  const rawData = useScreenData('suggestions');
  const { onPlay, onNavigate, lastPlayedContentId, setLastPlayedContentId } = useFitnessScreen();

  // Local mutable state for visible cards and overflow
  const [visibleCards, setVisibleCards] = useState([]);
  const [overflow, setOverflow] = useState([]);
  const [spentContentId, setSpentContentId] = useState(null);
  const [fadingOut, setFadingOut] = useState(null);
  const [fadingIn, setFadingIn] = useState(null);
  const swapTimerRef = useRef(null);

  // Sync from server data when it arrives or refreshes
  useEffect(() => {
    if (!rawData) return;
    setVisibleCards(rawData.suggestions || []);
    setOverflow(rawData.overflow || []);
    // Clear any in-progress swap state on full refresh
    setSpentContentId(null);
    setFadingOut(null);
    setFadingIn(null);
  }, [rawData]);

  // Detect when we return from playing (lastPlayedContentId was set, player closed)
  useEffect(() => {
    if (!lastPlayedContentId) return;
    const isVisible = visibleCards.some(c => c.contentId === lastPlayedContentId);
    if (!isVisible) {
      // Card not in grid (maybe already swapped by a refresh) — just clear
      setLastPlayedContentId(null);
      return;
    }

    // Mark the card as spent (renders at 50% opacity immediately)
    setSpentContentId(lastPlayedContentId);
    setLastPlayedContentId(null);

    // After 1s beat, start fade-out
    swapTimerRef.current = setTimeout(() => {
      setFadingOut(lastPlayedContentId);

      // After 500ms fade-out, swap the card
      swapTimerRef.current = setTimeout(() => {
        setVisibleCards(prev => {
          const idx = prev.findIndex(c => c.contentId === lastPlayedContentId);
          if (idx === -1) return prev;

          // Pick replacement from overflow
          const visibleShowIds = new Set(prev.map(c => c.showId));
          const replacement = overflow.find(c => !visibleShowIds.has(c.showId));

          if (replacement) {
            // Remove used card from overflow
            setOverflow(ov => ov.filter(c => c.contentId !== replacement.contentId));
            setFadingIn(replacement.contentId);
            const next = [...prev];
            next[idx] = replacement;
            return next;
          }
          // No replacement — remove the card
          return prev.filter((_, i) => i !== idx);
        });

        setSpentContentId(null);
        setFadingOut(null);

        // After 500ms fade-in, clear fading-in state
        swapTimerRef.current = setTimeout(() => {
          setFadingIn(null);
        }, 500);
      }, 500);
    }, 1000);

    return () => clearTimeout(swapTimerRef.current);
  }, [lastPlayedContentId]);

  const handlePlay = useCallback((suggestion) => {
    if (!onPlay) return;
    // Track which card was played for swap-on-return
    setLastPlayedContentId?.(suggestion.contentId);

    const { source, localId } = parseContentId(suggestion.contentId);
    onPlay({
      id: localId,
      contentSource: source,
      type: 'episode',
      title: suggestion.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(suggestion.thumbnail?.replace(/^\//, '') || `api/v1/display/${source}/${localId}`),
      duration: suggestion.durationMinutes,
      ...(suggestion.progress ? { resumePosition: suggestion.progress.playhead } : {}),
    });
  }, [onPlay, setLastPlayedContentId]);

  const handleBrowse = useCallback((suggestion) => {
    if (!onNavigate) return;
    const { localId } = parseContentId(suggestion.showId);
    onNavigate('show', { id: localId, episodeId: suggestion.contentId });
  }, [onNavigate]);

  if (rawData === null) return <SuggestionsGridSkeleton />;
  if (visibleCards.length === 0) return null;

  return (
    <div className="suggestions-grid">
      {visibleCards.map((s, i) => {
        let cardClass = '';
        if (s.contentId === spentContentId && s.contentId !== fadingOut) {
          cardClass = 'suggestion-card--spent';
        } else if (s.contentId === fadingOut) {
          cardClass = 'suggestion-card--fading-out';
        } else if (s.contentId === fadingIn) {
          cardClass = 'suggestion-card--fading-in';
        }

        return (
          <SuggestionCard
            key={s.contentId || i}
            suggestion={s}
            onPlay={handlePlay}
            onBrowse={handleBrowse}
            transitionClass={cardClass}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Update SuggestionCard to accept transitionClass**

In `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx`, change the component signature and root div to apply the transition class:

Change the function signature from:
```jsx
export default function SuggestionCard({ suggestion, onPlay, onBrowse }) {
```
to:
```jsx
export default function SuggestionCard({ suggestion, onPlay, onBrowse, transitionClass = '' }) {
```

Change the root div from:
```jsx
    <div className={`suggestion-card suggestion-card--${type}${isMuted ? ' suggestion-card--muted' : ''}`}>
```
to:
```jsx
    <div className={`suggestion-card suggestion-card--${type}${isMuted ? ' suggestion-card--muted' : ''}${transitionClass ? ` ${transitionClass}` : ''}`}>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.jsx frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx
git commit -m "feat(fitness): surgical card swap with overflow on workout completion"
```

---

### Task 5: Frontend — Add Transition CSS

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss`

- [ ] **Step 1: Add transition classes**

Append to the end of `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss`:

```scss
// ─── Card Swap Transitions ───────────────────────────

.suggestion-card--spent {
  opacity: 0.5;
  pointer-events: none;
}

.suggestion-card--fading-out {
  opacity: 0;
  transition: opacity 500ms ease-out;
  pointer-events: none;
}

.suggestion-card--fading-in {
  animation: suggestion-fade-in 500ms ease-in forwards;
}

@keyframes suggestion-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

Using a `@keyframes` animation for fade-in ensures it triggers on mount (when the new card replaces the old one in the DOM). A CSS `transition` wouldn't fire because the element is new.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss
git commit -m "feat(fitness): add spent/fade-out/fade-in transition styles for card swap"
```

---

### Task 6: Integration Test — Build, Deploy, Verify

- [ ] **Step 1: Run all suggestion tests**

Run: `npx vitest run tests/unit/suite/fitness/suggestions/`
Expected: All tests PASS

- [ ] **Step 2: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .

sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 3: Verify suggestions API returns overflow**

Wait ~60s for container startup, then:
```bash
sudo docker exec daylight-station sh -c 'node -e "
const http = require(\"http\");
http.get(\"http://localhost:3111/api/v1/fitness/suggestions?gridSize=8\", res => {
  let d = \"\";
  res.on(\"data\", c => d += c);
  res.on(\"end\", () => {
    const j = JSON.parse(d);
    console.log(\"suggestions:\", j.suggestions?.length);
    console.log(\"overflow:\", j.overflow?.length);
    j.overflow?.forEach(c => console.log(\"  overflow:\", c.type, c.showTitle));
  });
});"'
```

Expected: `suggestions: 8`, `overflow: 1-4` (extra next_up and/or discovery cards)

- [ ] **Step 4: Visual verification**

On the fitness home screen:
1. Note which "NEXT UP" card is in position
2. Click it to play
3. Exit the workout
4. Verify: the completed card appears dimmed (50% opacity)
5. Verify: after ~1s it fades out
6. Verify: a replacement card fades in
