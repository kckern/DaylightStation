# Player Surround Framework

> Status: design agreed 2026-08-18. Not implemented. First slice is a two-piece
> proof of concept in the Slow TV classical library.

## Outcome

Give certain classes of media a custom presentation built *around* the existing
player: the video shrinks to a fixed 16:9 box and the reclaimed screen space is
filled by modules that are synchronized to the playhead — a movement map, a
composer card, a cue ticker, and later VH1-style pop-ups over the video itself.

The first concrete use case is the classical music in the Slow TV Plex library,
for music appreciation and musical literacy. The framework must be general
enough that a second, unrelated surround is a new module in a registry rather
than a new subsystem.

**Not a new app.** There is no separate route to launch. Playback triggered by
WebSocket, timer, or URL goes through the path it goes through today; if the
item turns out to be enriched, the surround appears. If it isn't, playback is
byte-identical to current behavior.

## Naming

The concept is called a **surround** — it wraps the shrunken player.

`chrome` is already taken: `showOverlay(..., { chrome: 'media' })` in
`ScreenOverlayProvider` means the touch back/media buttons. Do not overload it.

## Architecture

Three layers, each anchored to something that already exists.

| Layer | What it is | Existing anchor |
|---|---|---|
| Data | `data/content/surround/` per-item sidecars | Mirrors `content-filter/overrides/{plexId}.yml`; `DataService.content` scope already exists (`DataService.mjs:290-330`) |
| Delivery | `qi.surround` attached in `toQueueItem()` | `backend/src/4_api/v1/routers/queue.mjs` already attaches optional `slideshow`, `titlecard`, `segment` blocks the same way |
| Render | `ScreenPlayer` wraps `Player` in a `SurroundFrame` when `surround` is present | `screen-framework/publishers/ScreenPlayer.jsx` is 32 lines and every screen-framework playback path routes through it |

### `Player.jsx` is not modified

It keeps rendering as it does now. It just happens to render inside a smaller
box. This is what makes the behavior automatic across every trigger source —
they all land in `ScreenActionHandler` → `ScreenPlayer`.

### Fail-soft is the default everywhere

No sidecar → no `qi.surround` → `ScreenPlayer` returns a bare `<Player>`.
A malformed sidecar, a missing asset, or a failed lookup takes the same path.
The surround is always additive; it can never be the reason something won't play.

## Data layer

### Location and shape

A new content domain alongside `singalong/`, `readalong/`, `music/`. It cannot
live in Plex — the Plex server can't serve it.

```text
data/content/surround/classical/
  beethoven/
    _composer.yml              # portrait, dates, birthplace, map ref — shared
    symphony-3-eroica.yml
    symphony-5.yml
  vivaldi/
    _composer.yml
    four-seasons-spring.yml
```

One folder per composer. Beyond keeping ~100 files navigable, it is where the
composer-static data lives — the right rail is mostly composer identity, and
that should be written once, not copied into all 41 Beethoven files. A piece
file inherits its folder's `_composer.yml` and overrides what it needs.

Composer folders are also the natural unit of work for the later bulk pipeline:
"backfill Bach" is one command, one review pass, one commit.

Backend adapter is `backend/src/1_adapters/content/surround/{SurroundAdapter,manifest}.mjs`,
mirroring the `readalong`/`singalong` adapter+manifest pair.

### Keying: slug filenames plus a `match:` block

`content-filter/overrides/` names files by ratingKey. Do **not** copy that here.
The Slow TV library may be rebuilt, and a Plex rescan mints new ratingKeys —
every sidecar would silently orphan with no error surfaced.

```yaml
# beethoven/symphony-3-eroica.yml
surround: concert-hall
match:
  contentId: plex:663134             # fast path
  title: "Beethoven: 3. Sinfonie"    # rebind fallback
piece:
  title: Symphony No. 3 in E-flat major, "Eroica"
  opus: Op. 55
  composed: 1803-1804
  city: Vienna
  premiered: 1805, Theater an der Wien
movements:
  - { n: 1, name: Allegro con brio, start: 0 }
  - { n: 2, name: "Marcia funebre: Adagio assai", start: 917 }
  - { n: 3, name: "Scherzo: Allegro vivace", start: 1810 }
  - { n: 4, name: "Finale: Allegro molto", start: 2158 }
facts:
  - "Beethoven originally dedicated it to Napoleon - then scratched the name out
     so hard he tore the page."
```

The manifest builds a `contentId → sidecar` index at load. On a miss, a title
match rebinds and logs a warning naming the stale id. A rescan degrades to
"slower lookup plus an actionable warning" instead of silent disappearance.

### Cache reload

Content adapters cache at startup. The manifest needs the same reload hook the
other content adapters use, or authoring iteration means a backend restart per
edit. This will bite immediately during PoC authoring if skipped.

## Asset companion tree

`media/img/{domain}/` is the established convention and is already mounted as a
static route (`app.mjs:1631` serves `configService.getPath('img')`), so assets
need no new backend serving code.

```text
media/img/surround/classical/
  beethoven/
    portrait.jpg
    vienna.jpg
  _maps/
    europe-1800.svg            # shared base; composers pin by coordinate
  _structure/
    sonata-form.svg            # reusable movement-map templates
```

Prefer shared assets over per-piece ones. One `europe-1800.svg` with composers
placed by coordinate in `_composer.yml` (`map: { base: europe-1800, x: 0.61, y: 0.44 }`)
beats 100 hand-cropped maps. Structure diagrams are templates — sonata form is
sonata form whether it is Mozart or Beethoven; the piece file supplies labels
and timings.

Assets are referenced by relative path resolved against `img/surround/`. A
missing file renders an empty slot rather than breaking the surround.

Wikimedia Commons covers portraits and city images for public-domain composers;
this repo already has a skill for pulling and cropping from it.

## Render layer

### Geometry

Two-column grid: main column plus a right rail at 20%. The main column stacks an
aspect-locked video box over a footer.

```text
+--------------------------------+--------+
|                                |        |
|           VIDEO 1536x864       | RAIL   |  composer portrait
|                                | 384px  |  name . dates
|                                |        |  piece . opus
+--------------------------------+ full   |  composed 1803 . Vienna
| movement map             60px  | height |  premiered 1805
+--------------------------------+        |  city / map
|  cue ticker             156px  |        |
+--------------------------------+--------+
```

**16:9 is a hard invariant.** The video box locks 16:9 and letterboxes rather
than ever distorting. The footer takes the vertical remainder after the rail
claims 20% and the video claims its height. On a non-16:9 panel the footer grows
or shrinks; below a floor (~90px) it collapses to the movement strip alone,
dropping the ticker rather than crushing both. Collapse order is declared in the
surround definition, so it is a design decision rather than a CSS accident.

The movement strip spans exactly the video's width and sits directly beneath it,
so it reads as that video's timeline rather than as page furniture. The rail runs
full height because it carries identity, not progress.

### Components

- **`SurroundFrame`** — slots only (`top`/`bottom`/`left`/`right`/`overlay`) plus
  the aspect-locked media box. A generalized `FitnessPlayerFrame`; contains no
  domain knowledge.
- **`MovementMap`** — takes `movements[]` and `position`; renders segments
  proportional to duration with a cursor. Uses an SVG template from `_structure/`
  when one is named, and plain proportional bars when not, so a piece without a
  template still works.
- **`ComposerCard`** — static identity from the inherited `_composer.yml`.
- **`CueTicker`** — the docked cue renderer (see below).

### The media clock

`useContentFilter` already runs a `requestVideoFrameCallback` ticker over the
media element with a `timeupdate` fallback, at roughly 40Hz, and it is
production-proven by the content filter.

Extract that driver into a shared `useMediaClock({ getMediaEl })` and have both
consume it. The filter's behavior is unchanged; the surround gets an accurate
position for free; there is no second timer competing with the first. Seeks land
immediately because the same events already drive it.

`ScreenPlayer` holds `playerRef`, so the media element reaches the surround
without new plumbing.

## Cue model

The docked ticker and the VH1-style pop-up are the same mechanism with different
placement. Placement is therefore a property of the cue, not a separate feature.

```yaml
cues:
  - at: 917
    render: docked             # -> the footer ticker region
    text: "Second movement - the funeral march."
  - at: 1204
    render: overlay            # -> floats over the video, VH1-style
    anchor: bottom-left
    text: "That oboe line is the same theme, inverted."
```

`render: docked` is phase one. `render: overlay` is phase two and requires no new
data model, no new clock, and no new authoring format — only a second consumer of
the same cue list drawing into `SurroundFrame`'s existing `overlay` slot.

`CueTicker` takes two input sources: timed cues when the piece has them, and the
untimed `facts[]` pool cycling on a timer when it does not. An untimed fact
yields to a timed cue when one fires — the composed moment beats filler.

## Module contract

The ticker is one option among many. A region hosts any module whose input is the
playhead. Every module receives exactly:

```js
{ position, duration, playing, seeking, data }
```

`position` from `useMediaClock`, `data` from the sidecar. No player handle, no
DOM access, no ability to control playback. Modules render; they do not drive. A
badly-behaved module can never affect what is playing.

Registration follows the existing widget registry pattern
(`screen-framework/widgets/registry.js`), and `PanelRenderer` already resolves a
region-to-widget map:

```js
registerSurroundModule('movement-map', MovementMap);
registerSurroundModule('cue-ticker', CueTicker);
registerSurroundModule('composer-card', ComposerCard);
```

The surround definition is then a thin declaration:

```yaml
# surrounds/concert-hall.yml
regions:
  right:  { width: 20%, module: composer-card }
  bottom:
    - { module: movement-map, height: 60 }
    - { module: cue-ticker, height: fill, collapse: first }
```

Future modules — a score follower, a waveform, an instrument-family highlighter,
a phrase-by-phrase translation, an inning-by-inning scoreboard for the NBA Finals
rips in that same Slow TV library — are registry entries, not framework changes.

This makes the classical layout declarative rather than a hardcoded React module.
That is affordable **only because `PanelRenderer` and the widget registry already
exist**. It is reuse, not a new layout DSL. Modules stay real React components.

## Config

Sidecar present means the surround renders. Authoring the sidecar *is* the
opt-in; no config edit is needed to light it up.

Screens override in `data/household/screens/{screen}.yml`:

```yaml
surround: auto              # default - render when enriched
# surround: off             # this screen never decorates
# surround: concert-hall    # force one regardless of sidecar
```

## Proof of concept

Two pieces, deliberately unalike. The library may be rebuilt, so do **not**
author the full corpus yet.

| Piece | Why |
|---|---|
| Vivaldi, "Spring" (`plex:663146`, 10 min, 3 mvts) | Short enough to watch end-to-end repeatedly. Program music - the birdsong and the thunderstorm are literally depicted, so cue content writes itself and mistimed cues are obvious. |
| Beethoven, "Eroica" (`plex:663134`, 54 min, 4 mvts) | Long-form stress test: cursor accuracy at minute 50, ticker staying interesting, framerate on an aged page. Also the best fact in the corpus. |

Two composers forces `_composer.yml` inheritance to be real on day one rather
than theoretical.

### Done means

- Both play on the living-room TV through the normal path — WebSocket, timer, or
  URL, with no special launch.
- Video locked 16:9 throughout.
- Movement cursor tracks correctly, including across seeks.
- Ticker cycles.
- Every un-enriched item in the library plays exactly as it does today.

### Risks to measure, not assume

1. **Kiosk framerate.** Aged pages in this house have degraded 60 to 10fps
   before. A 40Hz cursor on a 50-minute page needs measuring.
2. **ratingKey churn.** The `match:` fallback exists precisely because the
   library may be rebuilt.
3. **Sidecar cache.** Without a reload hook, every authoring edit costs a
   backend restart.

## Deferred

- The ~100-piece backfill pipeline (agent-generated, human-reviewed,
  YAML-committed, one composer folder at a time).
- Movement-timing extraction from source-video chapter markers, with agent
  estimation as fallback.
- `render: overlay` pop-ups.
- Audio cues.
- SVG structure templates beyond plain proportional bars.

## Library context

Slow TV is Plex section 25, composer-per-show: Bach 31 episodes, Beethoven 41,
Mozart 11, Sibelius 7, Wagner 5, Handel 4, Vivaldi 4. Episodes are individual
pieces, 8 to 72 minutes, with seasons already grouping by genre (symphonies vs.
sonatas). Roughly 100 classical pieces total.
