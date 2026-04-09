# Suggestion Card Replacement After Workout Completion

## Problem

When a user plays a workout from the suggestions grid and returns to the home screen, the card they just completed still shows as available. The 5-minute polling interval means stale cards linger. The user sees a "next up" card for something they literally just did.

## Design

### Overview

When the player closes, the completed card appears visually spent (dimmed), fades out, and a replacement card fades in — all using locally cached overflow data with no network request.

### Backend: Overflow Candidates

The suggestions API response gains an `overflow` array alongside the existing `suggestions` array:

```json
{
  "suggestions": [ ...8 visible cards ],
  "overflow": [ ...up to 4 extra cards ]
}
```

**How overflow is populated:** `FitnessSuggestionService` already runs strategies that produce more candidates than the grid needs. Instead of discarding extras beyond `gridSize`, continue collecting into an overflow pool. Overflow candidates are deduplicated against the visible 8 by showId (same logic as today).

**Overflow priority order:**
1. Extra `next_up` cards (shows not already in the visible 8)
2. Extra `discovery` cards

**Cap:** 4 overflow cards max. Keeps the response lean while providing enough replacements for a session where multiple cards get played.

**Strategy changes:** `NextUpStrategy` currently caps at `next_up_max` (default 4). It should return its full candidate pool to the service. The service applies the visible cap and routes extras to overflow. Same for `DiscoveryStrategy`.

### Frontend: Surgical Card Swap

#### State

`FitnessScreenProvider` gains a new context value:
- `lastPlayedContentId` / `setLastPlayedContentId` — set when a suggestion card is played, cleared after the swap completes

#### Play Flow

When a suggestion card's play zone is clicked:
1. `setLastPlayedContentId(suggestion.contentId)` — record which card was played
2. Existing `onPlay` flow continues unchanged

#### Return Flow (Player Closes)

When `executeClose()` fires and the home screen re-renders:

1. **Instant dimming:** The suggestions widget checks each card against `lastPlayedContentId`. The matching card renders at 50% opacity immediately — no transition, it's already ghosted when the screen appears.

2. **Fade out (~1s delay, then 500ms):** After a 1-second beat (so the user registers the dimmed state), the card fades from 50% to 0% opacity over 500ms.

3. **Replacement selection:** While fading out, pick the replacement from `overflow`:
   - First available `next_up` card whose `showId` isn't in the current visible grid
   - If no `next_up` available: first `discovery` card from overflow
   - If overflow is empty: remove the card (grid shrinks by 1)

4. **Fade in (500ms):** The replacement card fades in from 0% to 100% opacity.

5. **Cleanup:** Clear `lastPlayedContentId`. Remove the used card from the local overflow cache.

#### CSS

```
.suggestion-card--spent      { opacity: 0.5; }
.suggestion-card--fading-out { opacity: 0; transition: opacity 500ms ease-out; }
.suggestion-card--fading-in  { opacity: 0; }
.suggestion-card--fading-in.active { opacity: 1; transition: opacity 500ms ease-in; }
```

No changes to the card's internal layout or structure — only opacity manipulation on the card wrapper.

### What Doesn't Change

- The 5-minute polling cycle continues as-is and will do a full grid refresh on its normal schedule
- The suggestion strategies themselves don't change their logic — only the service-level cap/overflow split changes
- The skeleton loading state, card click zones, browse navigation all remain the same

### Files Changed

| Layer | File | Change |
|-------|------|--------|
| Backend | `FitnessSuggestionService.mjs` | Collect beyond gridSize into overflow array; return `{ suggestions, overflow }` |
| Backend | `NextUpStrategy.mjs` | Remove internal max cap; return full candidate pool |
| Frontend | `FitnessScreenProvider.jsx` | Add `lastPlayedContentId` / `setLastPlayedContentId` |
| Frontend | `FitnessSuggestionsWidget.jsx` | Store overflow locally, detect lastPlayed match, manage fade state machine, pick replacement |
| Frontend | `FitnessSuggestionsWidget.scss` | Add spent/fading-out/fading-in transition classes |

### Edge Cases

- **User plays multiple cards in sequence:** Each play sets `lastPlayedContentId`. If the first replacement hasn't completed its fade before the user plays again, the widget should handle both — queue the swaps or let the full refresh catch up.
- **Overflow exhausted:** If the user plays more cards than overflow has replacements, the grid shrinks. The next 5-minute poll restores it to 8.
- **Same show in overflow as completed:** The replacement picker skips any overflow card whose showId matches an already-visible card, preventing duplicates.
