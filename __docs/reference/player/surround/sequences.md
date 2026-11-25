# Station sequences — pinned heads, station IDs and breaks

A **sequence** is a queue-ordering rule a container (in practice a Plex
playlist) carries in a YAML sidecar. It answers two questions shuffle cannot:
*what must always play first*, and *what recurs between songs*. The motivating
case is the Salt Lake radio-station playlists: each opens with its station
jingle, and the jingle must survive shuffle; optionally a station ID drops in
every few songs so the playlist sounds like radio.

A station is still an ordinary playlist. Its menu tile is a plain
`action: Queue`, `shuffle: true` item; nothing in the menu, Player or list
schema knows sequences exist. The sidecar only changes the order of the queue
the backend returns.

## Where the files live

Sequence sidecars sit in the surround sidecar tree, because a station's frame
(logo, vintage-radio rendering) will live in the same file when it exists:

```
data/content/surround/radio/salt-lake/fm100.yml
```

They are read by their own store, `YamlSequenceStore`
(`__capabilities/content-catalog/server/adapters/persistence/`), not by the surround store:

- `YamlSequenceStore` indexes every YAML under the tree, **at any depth**, that
  carries a `sequence:` block, keyed by `match.contentId`. `_`-prefixed files
  and folders are reserved and skipped.
- `YamlSurroundStore` skips a file that has `sequence:` and no `surround:`
  quietly — not counted in `surround.index.built.skipped`, no
  `surround.sidecar.invalid`. Its tree walk is `<domain>/<group>/<file>.yml`, so
  keep station files at that depth too, ready for the frame.

Edits land without a restart: the store re-checks the tree at most every 2 s
on lookup and rebuilds on any change to a path or mtime (not only a newer one —
Dropbox keeps source-machine mtimes). One instance is built in
`createContentRegistry` and shared by both paths below.

## Schema

```yaml
match: { contentId: plex:10001, title: FM100 }   # title is for humans
sequence:
  head: 1                 # default 1
  breaks:                 # optional; omit for "pinned head, then shuffle"
    every: [3, 5]         # a break after every 3–5 items (or a fixed integer)
    minutes: 20           # …or after 20 minutes of items, whichever comes first
    count: [1, 2]         # items per break (default 1)
    order: shuffle        # shuffle (default) | sequential
    pool:
      - plex:10002        # one item, or a container: every item it holds
```

Any container with a content id can carry one: a Plex playlist, a saved query
(`query:tabernacle-songs`), a program queue. Breaks are any playable content:
station jingles, a Plex show of vintage commercials, an Immich album of
family photos (`immich:album:<id>`; each photo plays for the adapter's slide
duration).

| Field | Values | Meaning |
|-------|--------|---------|
| `head` | integer ≥ 0 | the playlist's first N items, in playlist order (`0` pins nothing) |
| `head` | list of content ids | exactly these, in this order; an id not in the playlist is resolved and prepended anyway (a container gives its first item) |
| `breaks.every` | integer ≥ 1, or `[min, max]` | items between breaks; a range is redrawn after each break |
| `breaks.minutes` | number > 0 | play time between breaks: a clip counts its window, other items their duration, an item with no duration counts 0 |
| `breaks.count` | integer ≥ 1, or `[min, max]` | items per break, redrawn per break |
| `breaks.order` | `shuffle` \| `sequential` | a shuffled bag, or the pool in its own order, wrapping |
| `breaks.pool` | list of content ids | sources; a container contributes every item it holds |

`every` or `minutes` is required; with both, whichever comes first. `idents:`
is the older name for `breaks:` and reads the same; a file with both uses
`breaks:` and reports `breaks-and-idents`.

An invalid field is reported (`station.sequence.invalid`) and falls back to the
default rather than dropping the station.

## Behaviour

1. **The head is split off before ordering.** Only the remaining songs go
   through the queue policy (`QueueService.resolveQueue` — watch-aware shuffle
   on the queue route; plain shuffle inside a program). The jingle is the
   most-replayed track in its playlist, and the watch-aware shuffle would
   otherwise push it to the end.
2. **A pool track plays only as an ID.** If the playlist also holds a pool
   track as an ordinary item (the Salt Lake playlists hold each of their
   station's jingles once), it is taken out of the songs — otherwise the
   shuffle can drop it right beside an inserted ID. A playlist track that is
   *not* in the pool stays a song.
3. **Breaks are inserted copies.** In `shuffle` order the pool rotates as a
   shuffled bag (a whole show of commercials before any repeats), never
   the same item twice in a row when the pool has more than one; in
   `sequential` order it is walked in pool order across breaks. Never right
   after the head and never after the last song.
4. **A source that owns its order keeps it.** A clip shuffle
   (`surround-segments`) has already kept two clips of one concert apart; a
   program's `shuffle: true` does not shuffle it again, with or without
   breaks.
5. **The clip band names the next clip, not the break.** A break has no
   surround, so the frame steps aside for it and the video fills the screen;
   "Next, from" skips past it to the next clip.
6. **`shuffle: false`** keeps the songs in playlist order; IDs still apply.
7. **Fails open.** An unresolvable pool id is dropped
   (`station.ident.unresolved`); an empty pool means head-only; any error
   (`station.sequence.failed`) returns the queue exactly as it would be without
   a sidecar.

## Where it applies

| Path | Code |
|------|------|
| Menu tile → `GET /api/v1/queue/plex/<id>` | `ContentAccessService.queue` (`#orderQueue`) |
| Program `action: Queue` item (e.g. `music-queue.yml`), watchlist Queue child | `ListAdapter._applySequence` |

The rule itself is pure: `__capabilities/content-catalog/server/domain/utils/stationSequence.mjs`
(`normalizeSequence`, `splitHead`, `interleaveIdents`, `sequenceQueue`).

## Observability

`context.app:surround`, events:

| Event | Level | Data |
|-------|-------|------|
| `station.sequence.indexed` | info | `count` |
| `station.sequence.applied` | info | `containerId, path (queue\|list), shuffle, head, songs, idents` |
| `station.ident.unresolved` | warn | `containerId, id` |
| `station.sequence.failed` | warn | `containerId, error` |
| `station.sequence.invalid` | warn | `file, problems` |
| `station.sequence.duplicate` | warn | `contentId, keptFile, droppedFile` |

```bash
curl -s {env.log_store_url}/select/logsql/query -d 'query="station.sequence.applied" AND _time:24h'
```

## Not yet

- A station frame (logo, vintage rendering) — same files, `surround:` key.
- Title rebind for a stale playlist id — neither queue path has the playlist
  title in hand; `match.title` is authored for it.

## Clip shuffles (`surround-segments` saved queries)

A saved query of `type: surround-segments` turns indexed recordings into a shuffle of
single pieces: one queue item per timed segment of the sidecars under `params.works`,
each playing only its own window (`segment: {start, end}`) with the recording's surround.

```yaml
type: surround-segments
params:
  works: christmas/tabernacle      # sidecar folder under content/surround/
  kinds: [song]                    # segment kinds to keep (all when absent)
  confidence: [verified, derived]  # confidence levels to keep (all when absent)
  noRepeatSong: true               # the next clip is never the same song
  noRepeatRecording: true          # the next clip is never from the same recording
```

Both `noRepeat*` rules constrain only the very next clip; the one after may repeat
freely, so a shuffle never has to cycle through every recording. When the rules cannot
be met (one recording is most of the list) the queue still plays, with the fewest
repeats the reorder could reach. Code: `__capabilities/content-catalog/server/domain/services/surroundSegments.mjs`.
