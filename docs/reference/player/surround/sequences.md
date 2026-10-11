# Station sequences — pinned heads and station IDs

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
(`backend/src/1_adapters/content/sequence/`), not by the surround store:

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
match: { contentId: plex:757556, title: FM100 }   # title is for humans
sequence:
  head: 1                 # default 1
  idents:                 # optional; omit for "pinned head, then shuffle"
    every: [3, 5]         # an ID after every 3–5 songs (or a fixed integer)
    pool:
      - plex:757863
```

| Field | Values | Meaning |
|-------|--------|---------|
| `head` | integer ≥ 0 | the playlist's first N items, in playlist order (`0` pins nothing) |
| `head` | list of content ids | exactly these, in this order; an id not in the playlist is resolved and prepended anyway |
| `idents.every` | integer ≥ 1, or `[min, max]` | songs between IDs; a range is redrawn after each ID |
| `idents.pool` | list of content ids | IDs to rotate through |

An invalid field is reported (`station.sequence.invalid`) and falls back to the
default rather than dropping the station.

## Behaviour

1. **The head is split off before ordering.** Only the remaining songs go
   through the queue policy (`QueueService.resolveQueue` — watch-aware shuffle
   on the queue route; plain shuffle inside a program). The jingle is the
   most-replayed track in its playlist, and the watch-aware shuffle would
   otherwise push it to the end.
2. **IDs are inserted copies.** The pool rotates as a shuffled bag, never the
   same ID twice in a row when the pool has more than one, never right after
   the head and never after the last song.
3. **`shuffle: false`** keeps the songs in playlist order; IDs still apply.
4. **Fails open.** An unresolvable pool id is dropped
   (`station.ident.unresolved`); an empty pool means head-only; any error
   (`station.sequence.failed`) returns the queue exactly as it would be without
   a sidecar.

## Where it applies

| Path | Code |
|------|------|
| Menu tile → `GET /api/v1/queue/plex/<id>` | `ContentAccessService.queue` (`#orderQueue`) |
| Program `action: Queue` item (e.g. `music-queue.yml`), watchlist Queue child | `ListAdapter._applySequence` |

The rule itself is pure: `backend/src/2_domains/content/utils/stationSequence.mjs`
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
- Time-based spacing ("every ~15 minutes"); `every` counts songs.
- Title rebind for a stale playlist id — neither queue path has the playlist
  title in hand; `match.title` is authored for it.
