# Item identity vs launch context

An episode in the Fitness app can be reached from its own show page, from a
season opened as a show, from a Plex playlist, or from a suggestion card. Where
it was launched from must not change what it is.

## The rule

A play-queue item carries two separate things.

**Item identity** is what the episode is. It comes from the episode's own
metadata and the API's real `parents` map.

| Field | Meaning |
|---|---|
| `parentId`, `parentTitle` / `season` | the episode's own season |
| `seasonImage` (alias `parentImage`) | that season's art |
| `grandparentId` (alias `showId`), `grandparentTitle` / `show` | the episode's own show |
| `showImage` | that show's poster |
| `title` | the episode's own title, without any grid caption prefix |

**Launch context** is where it was launched from, in `launchContext`:

| Field | Meaning |
|---|---|
| `type` | `show`, `season`, `playlist`, ... (the container's `info.type`) |
| `id`, `title`, `image` | the container the grid was showing |
| `groupId`, `groupTitle` | the playlist page, when the container is paged |

Identity feeds art, titles, labels, watch history, saved-session `parent_id` /
`grandparent_id`, per-show volume memory and unlock scope. Launch context feeds
"return to where I was browsing" after an episode and launch telemetry
(`fitness.show.launch_episode` logs `show`, `season` and `launchedFrom`).
Nothing reads art or titles from `launchContext`.

A playlist or collection is never an item's show. When an item in one has no
`grandparentId`, the field stays empty; outside those containers the container
is the item's show and may stand in for a missing grandparent.

## Playlist pages are grid groups

`buildVirtualSeasons` (`browser/lib/playlistVirtualSeasons.js`) pages a flat
playlist into tabs. It tags each item with `groupId` / `groupIndex` and returns
the page map as `groups`. It does not touch `parentId`, `parentTitle` or
`parentIndex`, and FitnessShow keeps the API's `parents` map next to `groups`.

The grid groups by `gridGroupIdOf(item)` (`groupId`, else `parentId`). A page's
thumbnail is the poster of one show on that page, chosen so adjacent tabs do
not repeat. It decorates the tab and describes no other item on the page.

`label` on a paged item is the grid caption (`Show—Episode`); `itemLabel`
keeps the original.

## Where it is implemented

- `browser/player/episodeQueueItem.js`
  - `buildEpisodeQueueItem` builds the queue item for a FitnessShow launch.
  - `originTileImage(item)` is the art for the first tile of the seek timeline
    and the poster fallback for the other tiles: own season, then own show,
    then own frame.
  - `browseContainerIdOf(item)` is the post-episode "back" target.
- `browser/player/FitnessShow.jsx` calls the builder from `handlePlayEpisode`.
- `browser/player/footer/FitnessPlayerFooterSeekThumbnails.jsx` and
  `FitnessPlayer.jsx` read the tile art through `originTileImage`.

Other builders (`widgets/FitnessSuggestionsWidget/buildSuggestionPlayItem.js`,
the `/fitness/play/:id` route in `FitnessApp.jsx`) already build from the
episode's own metadata. A new launch surface follows the same rule: fill the
identity fields from the item, and put the surface in `launchContext`.

## The failure this replaced

Virtual pages used to be written into `parentId` and returned as `parents`,
replacing the real seasons map. The queue item then took `seasonImage` from the
page thumbnail. Launching one show's warm-up from a rating-sorted playlist page
headed by another programme put that programme's poster on the first timeline
tile, and saved `parentId: virtual-season-N` as the episode's season.
