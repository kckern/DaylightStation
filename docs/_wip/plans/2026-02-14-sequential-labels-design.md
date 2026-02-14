# Sequential Labels Design

**Date:** 2026-02-14
**Status:** Approved

## Summary

Add `sequential_labels` config option to the fitness app. Shows tagged with a matching label enforce linear watch order — each episode must be completed (`isWatched`) before the next one unlocks. Locked episodes appear greyscaled with a lock icon replacing the episode number. Tapping a locked episode does nothing.

## Decisions

- **Completion definition:** Reuse existing `isWatched` flag (backend SSOT, 90%+ or natural end)
- **Locked UX:** Greyscale + reduced opacity, thumbnail intact, episode number replaced with lock icon, tap silently ignored via `pointer-events: none`
- **No auto-select:** Show opens with no episode pre-selected
- **Scope:** Fully linear across the entire show (must complete all of S1 before any S2 episode unlocks)

## Config & Data Flow

Identical pattern to `resumable_labels`:

- Stored at `plex.sequential_labels` in fitness config (array of strings)
- Admin UI: `TagsInput` in `FitnessConfig.jsx` next to existing "Resumable Labels"
- Flows through `plexConfig` into `FitnessShow.jsx`
- Case-insensitive matching against show labels

## Lock Logic

Flatten all episodes across all seasons into render order. Track a boolean gate:

```js
let sequentialGatePassed = true;

episodes.forEach(episode => {
  const isLocked = isSequential && !sequentialGatePassed;
  if (isSequential && !episode.isWatched) {
    sequentialGatePassed = false;
  }
});
```

First unwatched episode is unlocked (the one to watch next). Everything after it is locked.

## Rendering

- Add `locked` CSS class to episode-card div
- Replace episode number with lock icon (SVG) when locked
- CSS handles interaction blocking:

```scss
.episode-card.locked {
  filter: grayscale(1);
  opacity: 0.5;
  pointer-events: none;
}
```

## Route-Based Play Blocking

When `/fitness/play/:id` is hit, `handlePlayFromUrl` fetches episode info. If the episode's labels (which include show-level labels via PlexAdapter) match any `sequential_labels`, redirect to `/fitness/show/{showId}` instead of playing. The show UI then handles lock display normally.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/modules/Admin/Apps/FitnessConfig.jsx` | Add `TagsInput` for `plex.sequential_labels` |
| `frontend/src/modules/Fitness/FitnessShow.jsx` | Add sequential label matching, lock gate logic, locked class + lock icon |
| `frontend/src/modules/Fitness/FitnessShow.scss` | Add `.episode-card.locked` styles |
| `frontend/src/Apps/FitnessApp.jsx` | Add `sequentialLabelSet` memo + route play blocking in `handlePlayFromUrl` |

No backend changes. No new files. No new dependencies.
