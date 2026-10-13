# Fitness Suggestions Grid

The home screen's "what to do next" grid (`GET /api/v1/fitness/suggestions`,
`fitness:suggestions` widget). Cards come from five strategies run in order —
Resume, Next Up, Favorite, Memorable, Discovery — deduplicated by show, with up
to four overflow cards for client-side replacement.

## Built once, served many times

Building the grid walks recent shows and the fitness library through Plex,
which answers one request at a time: about a hundred metadata calls, 2–5 s on a
quiet Plex and 20 s+ on a busy one. Nothing the grid depends on changes on the
home screen's 5-minute refresh, so the route serves a **snapshot**
(`SuggestionsSnapshot`, wrapping `FitnessSuggestionService` behind the same
`getSuggestions` interface):

| Rebuilt when | How |
|---|---|
| Backend boots | `preload()` builds the default grid in the background |
| Local midnight | a timer just after 00:00; also any request on a new day |
| A workout settles | every session save/end/delete marks it stale and pushes one rebuild back by 2 min of quiet — a workout's many saves cause one rebuild |
| A request finds it stale | the request waits for the rebuild — old Resume / Next Up cards after a workout are wrong, not merely old |

After a workout the player refetches `sessions` **and** `suggestions` once the
final save settles, so home lands on the rebuilt grid.

A failed rebuild keeps serving the previous grid (`build-failed` is logged);
the next request retries.

Discovery picks are seeded per local day + household, so a rebuild after a
workout does not reshuffle the discovery cards — they change when the day
turns or a picked show leaves the pool.

## Below the snapshot

`FitnessPlayableService` keeps its 5-minute Plex **structure** cache (episode
lists, container info, item metadata, the library show list); watch state is
always read live. `PlexAdapter.getStoragePath` remembers each item's library
section (it never changes), which watch-state enrichment used to ask Plex for
once per show.

## Logs

- `fitness.suggestions.snapshot.built` — `{reason, key, ms, cards}`; reason is
  `preload`, `first-request`, `stale`, `day-rollover`, `session-saved`, …
- `fitness.suggestions.snapshot.build-failed`
- `suggestions.breakdown` — per build: `sessionsMs`, `excludedMs`, per-strategy
  ms, playable calls/misses
- `fitness.suggestions.timing` — per request `totalMs` (≈0 when served from the
  snapshot)
