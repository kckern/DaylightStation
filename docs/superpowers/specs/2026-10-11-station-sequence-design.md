# Station sequences — pinned heads and station IDs for shuffled playlists

**Status:** design approved in conversation 2026-10-11; awaiting spec review.

## Problem

Some playlists have a structured head that must survive shuffle. The eleven
Salt Lake radio playlists (FM100, B98.7, Kissin 97, Star 102.7, 94-9 ZHT,
107.5 The End, X96, KBER 101, 103.5 The Arrow, The Breeze 97.9, U92 — Plex
`757556`–`757566`) each open with a station jingle from the album *Salt Lake
Radio Jingles* (`plex:757862`, 20 tracks). A normal shuffle loses it — worse,
the watch-aware shuffle in `QueueService.resolveQueue` actively pushes
recently-played tracks to the end, and the jingle is the most-replayed track
in the list.

Plex playlists carry no labels, so the behaviour cannot be tagged in Plex. It
has to live in our own config, keyed by the playlist's content id, so it holds
wherever the playlist plays — a menu tile, a program, a kitchen button, a
barcode.

## Intent

- A station is an ordinary playlist. It is **not** a new list type, menu
  type or Player mode. The sidecar adds a queue-ordering rule and nothing else.
- **Default (A):** the head — track 1, the first N tracks, or named tracks —
  plays first, in order; everything after it shuffles as it does today.
- **Opt-in (B):** station IDs recur between songs, rotating through a pool, so
  the playlist sounds like radio.
- **Later, not now:** a station Surround (logo, vintage-radio rendering). The
  sidecar is the file it will live in, so it arrives without migration.

## The sidecar

Station sequences are Surround sidecars: one YAML per piece of content under
`data/content/surround/<area>/`, bound by `match: {contentId, title}`, indexed
by `YamlSurroundStore`, with its title rebind for stale Plex ids and its
edit-refresh window. The stations live under `surround/radio/`.

```yaml
# data/content/surround/radio/fm100.yml
match: { contentId: plex:757556, title: FM100 }
sequence:
  head: 1
  idents:
    every: [3, 5]
    pool:
      - plex:757863   # FM100 - Continuous Soft Hits
# surround: radio     # later
```

### `sequence.head`

| Value | Meaning |
|-------|---------|
| absent | same as `1` (a `sequence:` block exists to pin something) |
| `N` (integer ≥ 0) | the playlist's first N items, in playlist order; `0` pins nothing |
| list of content ids | exactly these items, in this order, wherever they sit in the playlist; ids not in the playlist are resolved and prepended anyway |

### `sequence.idents` (optional — omitted means behaviour A only)

| Field | Meaning |
|-------|---------|
| `every` | integer `N` — an ID after every N songs; or `[min, max]` — a random count in that range, redrawn after each ID |
| `pool` | content ids of the IDs to rotate through |

Rotation: the pool is shuffled and played through; reshuffled when exhausted,
never repeating the ID that just played (a one-ID pool repeats by necessity).
No ID is placed directly after the head, and none after the final song.

### Rules

1. **The head is split off before the shuffle.** Only the remainder goes
   through `QueueService.resolveQueue`, so watch-aware ordering still governs
   the songs and can never bury the head.
2. **Shuffle off:** the remainder keeps playlist order. Idents still apply —
   they are part of the station, not of the shuffle.
3. **IDs are inserted copies.** The playlist is not edited; a pool id that is
   also the head track simply plays again later, as on air.
4. **Fails open.** An unresolvable pool id is dropped (warn). An empty
   resolved pool means behaviour A. Any error in the sequence path returns the
   queue exactly as it would be without a sidecar. A station never fails to
   play because its sidecar is wrong.

## Architecture

```
menu Queue tile ─► GET /api/v1/queue/plex/757556?shuffle=1
                     ContentAccessService.queue
                       ├─ catalog.resolvePlayables(container)
                       ├─ surroundStore.lookupSequence(container)  ◄─ new
                       ├─ splitHead ─► head | rest                ◄─ new (domain)
                       ├─ queueService.resolveQueue(rest, {shuffle})
                       ├─ resolve ident pool → playables
                       └─ interleaveIdents(rest) → head + result  ◄─ new (domain)
                     QueuePresentationService.prepare   (unchanged)

program (music-queue.yml) Queue item
                     ListAdapter queue expansion (≈ ListAdapter.mjs:1141)
                       └─ same lookupSequence + domain functions  ◄─ new
```

### Units

- **`backend/src/2_domains/content/utils/stationSequence.mjs`** — pure, no I/O.
  - `normalizeSequence(raw) → {head, idents}|null` — validates shape; invalid
    fields are dropped with reasons returned for the store to log.
  - `splitHead(items, head) → {head: [], rest: []}`
  - `interleaveIdents(songs, {every, pool}, random) → []`
- **`ISurroundStore.lookupSequence(contentId, title)`** — new port method;
  `YamlSurroundStore` implements it off the existing index (same rebind, same
  refresh, returns a clone). The validator relaxes one rule: a sidecar must
  carry `surround:` **or** `sequence:` (today `missing-surround` blocks it at
  `YamlSurroundStore.mjs:1247`). Neither is still `surround.sidecar.invalid`.
  A sequence-only sidecar is not indexed for frames, so `lookup()` /
  `lookupByPart()` return exactly what they return today for that id, and
  `planSurroundQueue` stays a no-op for it.
- **`ContentAccessService.queue`** — gains the optional sequence step above,
  injected `surroundStore` (already composed in `contentApi.mjs`).
- **`ListAdapter`** — the program/menu Queue expansion consults the same store
  (injected) and domain functions before its inline shuffle. Without this, a
  station inside `music-queue.yml` would lose its jingle.

Untouched: `planSurroundQueue`, `QueuePresentationService`, the frontend, menu
schema, Player.

### Logging (backend structured logger, `app: surround`)

| Event | Level | Data |
|-------|-------|------|
| `station.sequence.applied` | info | `containerId, path (queue\|list), head, idents, songs, shuffle` |
| `station.ident.unresolved` | warn | `containerId, id` |
| `station.sequence.failed` | warn | `containerId, error` — fell back to the plain queue |
| `surround.sidecar.invalid` | warn | existing; now also `reason: sequence-*` |

## Data

- **11 sidecars** under `data/content/surround/radio/`, `head: 1`,
  `idents: {every: [3, 5], pool: <that station's jingles>}`, pools from the
  jingle album:

  | Station | Playlist | Pool |
  |---------|----------|------|
  | FM100 | 757556 | 757863 (757864 *Home for the Holidays* excluded — seasonal) |
  | B98.7 | 757557 | 757865, 757866, 757867 |
  | Kissin 97 | 757558 | 757868 |
  | Star 102.7 | 757559 | 757871, 757872 |
  | 94-9 ZHT | 757560 | 757869, 757870 |
  | 107.5 The End | 757561 | 757873 |
  | X96 | 757562 | 757874, 757875 |
  | KBER 101 | 757563 | 757876 |
  | 103.5 The Arrow | 757564 | 757877, 757878, 757879 |
  | The Breeze 97.9 | 757565 | 757880 |
  | U92 | 757566 | 757881, 757882 |

- **`data/content/lists/menus/music.yml`** — 11 ordinary tiles, flat:
  `input: plex:<id>`, `action: Queue`, `shuffle: true`. No new fields.

## Testing

- **Unit (vitest)** — `stationSequence`: head by count / by ids / 0 / longer
  than the playlist; `every` fixed and ranged with a seeded random; no
  back-to-back repeat; one-item pool; empty pool → A; no ID after the head or
  after the last song; `normalizeSequence` rejects bad shapes.
- **Store** — sequence-only sidecar is indexed for `lookupSequence`, invisible
  to `lookup`; sidecar with neither is still invalid; title rebind works for a
  stale id.
- **Integration** — queue route with a fake store: first item is the head;
  idents spaced within range; a store that throws yields the plain queue.
- **ListAdapter** — a program Queue item over a station keeps its head.
- **Live** — after deploy, `GET /api/v1/queue/plex/757556?shuffle=1`: item 0 is
  `757863`, an FM100 ID every 3–5 songs; repeat for one program path.

## Docs

- `docs/reference/player/surround/design.md` — a section on sequence
  sidecars (frame-less sidecars, `sequence` schema, fail-open rule).
- `CLAUDE.md` navigation table — a row pointing at it.

## Out of scope

- The station Surround frame (logo, vintage rendering) — later, same files.
- Time-based ID spacing ("every ~15 minutes"); `every` counts songs.
- The frontend's remote shuffle toggle (`shuffleExecutionOrder.js`) re-shuffling
  a live queue: it keeps the current item and the up-next band, so a station
  already playing keeps its head; IDs after it may move. Acceptable for v1.
