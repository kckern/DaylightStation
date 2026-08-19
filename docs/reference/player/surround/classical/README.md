# Classical Surround — structure and authoring workflow

A **surround** is the presentation shell drawn around a shrunken player: when an
item has an authored sidecar, the video locks to a 16:9 box and the reclaimed
screen fills with modules synchronized to the playhead. This document covers the
`classical` domain — the Slow TV concert library — and the workflow for adding a
piece to it.

For the framework itself (seams, ports, module contract), see the design and spec
in `docs/_wip/plans/2026-08-18-player-surround-*.md`.

---

## Structure

Two parallel trees: data in the content corpus, pixels in the media tree.

```text
data/content/surround/                       media/img/surround/
  _surrounds/                                  classical/
    concert-hall.yml                             beethoven/
  classical/                                       portrait.jpg
    beethoven/                                     vienna.jpg
      _composer.yml                              vivaldi/
      works/                                       portrait.jpg
        symphony-3-eroica.yml                    _maps/
      symphony-3-eroica.hr-2016.yml                europe.geo.json
    vivaldi/
      _composer.yml
      works/
        four-seasons-spring.yml
      four-seasons-spring.plex663146.yml
```

Three levels of authoring, each holding what is true at exactly that level:

| File | Holds | True of |
|---|---|---|
| `_composer.yml` | portrait, dates, birthplace, map pin, composer facts | every piece the composer wrote |
| `works/<work>.yml` | title, opus, movement names, cues, facts | every recording of that piece of music |
| `<recording>.yml` | `match`, `starts`, `musicEndsAt`, `performance` | one performance, one video |

- The folder under the domain is the **composer slug**; `_`-prefixed files and
  folders are never treated as composer folders or piece files, and `works/` is
  never walked for sidecars.
- A recording inherits its work by naming it, and its composer by living in the
  folder. Overrides run outward-in: `_composer.yml` ← work ← recording, per key.
- Assets are referenced relative to `assetBase` (`surround/classical`) and served
  by the existing static route: `/api/v1/static/img/surround/classical/...`.
  A missing asset renders an empty slot; it never breaks the surround.

### Composer file

```yaml
# classical/beethoven/_composer.yml
name: Ludwig van Beethoven
born: 1770
died: 1827
birthplace: Bonn
portrait: beethoven/portrait.jpg
city_image: beethoven/vienna.jpg
map: { country: Austria, city: Vienna, lat: 48.21, lon: 16.37 }
facts:
  - "Beethoven said his hearing loss began in 1798, during a heated argument with a singer."
```

Everything here is inherited by **every piece that composer wrote** — author it once,
and all 41 Beethoven pieces have it. A piece may override any key via its own
`composer:` block (piece wins per key).

Two fields worth calling out:

- **`facts`** are about the *composer*, not the work, so they hold regardless of what
  is playing. `ComposerCard` cycles them in the rail on a 27 s timer — deliberately
  coprime with the footer ticker's 20 s, so the two panels coincide once every nine
  minutes instead of swapping in lockstep, which reads as a glitch. The rotation is
  time-driven, not playhead-driven: seeking does not reset it.
- **`map`** supplies the place-carousel's map slide (and the standalone `country-map`
  module, for definitions that use it directly — see "Modules" below). Give it the
  country name **exactly as the geodata spells it** (`United Kingdom`, `Czechia`)
  plus the city and its coordinates. An optional **`map.caption`** authors the
  sentence shown under the place-carousel's city photograph — e.g. "Venice — his
  lifelong home" — set as prose, not the tracked small-caps label a bare place name
  gets. Omit it and the caption falls back to `map.city` alone, set as a label.

### Work file

The music itself. Everything here is recording-independent, so it is written once
however many performances of the piece the library holds. **Movements carry no
`start`** — a timing belongs to a recording, not to a work.

```yaml
# classical/beethoven/works/symphony-3-eroica.yml
piece:
  title: Symphony No. 3 in E-flat major, "Eroica"
  opus: Op. 55
  composed: 1803-1804
  year: 1804
  city: Vienna
  premiered: Theater an der Wien, 7 April 1805
  period: "Classical to Romantic"
  period_note: "Written at the hinge — Classical forms stretched to Romantic scale."
movements:
  - n: 1
    name: "Allegro con brio"
    translation: "Fast, with spirit"          # optional
    listen:                                   # optional — what to listen for
      - "Two hammered E-flat chords, then the cellos sing the heroic theme."
  - { n: 2, name: "Marcia funebre. Adagio assai", translation: "Funeral march — very slow" }
cues:                               # optional, timed
  - { at: 976, render: docked, text: "The funeral march begins." }
facts:                              # optional, untimed pool
  - "The published title page reads: composed to celebrate the memory of a great man."
```

`render: docked` draws into the ticker region. `render: overlay` is reserved for
phase two (pop-up-video style, over the video) and needs no schema change.

### Recording sidecar

One video. It names its work and adds what only this performance can supply: the
Plex match, the measured movement starts, where the music stops, who played it.

```yaml
# classical/beethoven/symphony-3-eroica.hr-2016.yml
work: beethoven/symphony-3-eroica    # <composer>/<work>, or a bare <work> in this folder
surround: concert-hall               # required — definition id in _surrounds/
match:                               # required
  contentId: plex:663134             # exact-match fast path
  title: "Beethoven: 3. Sinfonie"    # rebind fallback (normalized substring)
performance: "hr-Sinfonieorchester · Andrés Orozco-Estrada · Alte Oper Frankfurt, 11 February 2016"
starts: [0, 976, 1925, 2278]         # one per movement, measured (see below)
musicEndsAt: 2955                    # last chord; applause follows
```

`work: beethoven/symphony-3-eroica` reads as
`classical/beethoven/works/symphony-3-eroica.yml`. A reference with no slash
resolves under the sidecar's own composer folder, which is the usual case;
naming another composer is legal, for a work the folders disagree about.

**`starts` and the work's `movements` are zipped index by index**, so they must
be the same length. They disagree only when one file was edited and the other was
not — exactly the situation that would put movement 2's text against movement 3's
music — so a mismatch excludes the recording and says so
(`starts-length-mismatch`). Nothing is ever mis-timed quietly.

### The simple form: one file

A work with one recording does not need two files. Omit `work:` and author
`piece`, `movements` (with `start` on each), `cues` and `facts` inline, exactly as
before. The store produces the identical payload either way, and the two shapes
sit side by side in the same composer folder — split a work only when a second
recording of it arrives.

```yaml
# classical/vivaldi/four-seasons-spring.yml — the flat shape, still supported
surround: concert-hall
match: { contentId: plex:663146, title: "Vivaldi: Spring" }
piece: { title: "Violin Concerto in E major, \"Spring\"", opus: Op. 8 No. 1 }
movements:
  - { n: 1, name: Allegro, start: 0 }
```

Inline `piece`/`movements`/`cues`/`facts` **beside** a `work:` key are ignored —
the work wins — and the store warns `inline-blocks-ignored` so a half-finished
migration cannot lose an edit in silence.

### Why `match` has two keys

Sidecars are keyed to Plex `contentId`s, and a library rescan mints new
ratingKeys. Without a fallback every sidecar would silently orphan — the surround
simply stops appearing, with no error. So the store also matches on a normalized
title (case, punctuation, guillemets `»«` and interpuncts `∙` stripped), because
live Plex titles carry orchestra suffixes the authored title does not:

```
authored:  Beethoven: 3. Sinfonie
live:      Beethoven: 3. Sinfonie (»Eroica«) ∙ hr-Sinfonieorchester ∙ Andrés Orozco-Estrada
```

When a rebind happens it logs `surround.match.rebound` (warn) naming the stale id
and the file, so the fix is a one-line edit rather than a mystery. **If two
sidecars match the same title the store refuses and logs
`surround.match.ambiguous`** rather than guessing — a wrong surround (Beethoven's
facts over a Vivaldi video) is worse than none.

---

## Authoring workflow

### 1. Find the piece

```bash
node cli/plex.cli.mjs search "Eroica" --deep
node cli/plex.cli.mjs info 663134 --json
```

The Plex **summary is often authoritative for movement names** — the hr-Sinfonieorchester
uploads list them in order — and also carries the performers, venue, and concert
date, which belong on the composer card.

### 2. Derive movement timings from the audio

Neither PoC file had chapter markers, so timings come from spectral analysis of
the media itself. **Run this on the media host**, never on a workstation: the
files live on a Dropbox mount and pulling a 54-minute video across it is
expensive and slow.

```bash
# per-second RMS, full band and >9kHz, plus a spectrogram to eyeball
F="/path/to/Concert.mp4"
ffmpeg -v error -y -i "$F" -af "aresample=8000,asetnsamples=8000,\
astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=/tmp/rms.txt" -f null -
ffmpeg -v error -y -i "$F" -af "aresample=32000,highpass=f=9000,asetnsamples=32000,\
astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=/tmp/hf.txt" -f null -
ffmpeg -v error -y -i "$F" -lavfi "showspectrumpic=s=2400x500:legend=1:gain=3" /tmp/spec.png
```

Then read the spectrogram — movement boundaries are visible as texture changes,
and applause is an unmistakable broadband block — and confirm numerically:

| Signal | Rule | Why |
|---|---|---|
| **Applause** | HF-ratio (`hf − full`) above ~−26 dB, sustained ≥5 s, **and** preceded within 5 s by a dip below −50 dB | The dip is what makes it work. Without it, bright violin passages give 14 false positives on Spring instead of 3 true ones. Physically: a movement ends with the music stopping. |
| **Movement start** | After applause decays to its floor, the first second back above −45 dB | Taking the first second after the run ends lands mid-decay, ~7 s early. |
| **Symphony boundaries** | Sustained runs below −55 dB — no applause at all | Audiences don't applaud between symphony movements. Concertos in this library do. Handle both. |
| **Final applause** | 15 s window standard deviation ≈0.3–0.4 dB vs 2–11 dB for music | An orchestra never sustains a flat wash. Use this so the last movement's bar doesn't run to `duration`. |

**Always sanity-check against canonical proportions.** A detector that returns
four plausible numbers can still be wrong; a Scherzo that isn't ~5 minutes or a
Finale that isn't ~11 is a signal to look again.

Measured for the two reference pieces:

| Piece | Duration | Movement starts | Lengths | Applause from |
|---|---|---|---|---|
| Vivaldi, Spring (`plex:663146`) | 628 s | 0, 225, 385 | 3m45 / 2m40 / 4m03 | ~613 s |
| Beethoven, Eroica (`plex:663134`) | 3223 s | 0, 976, 1925, 2278 | 15m26 / 15m06 / 5m33 / 11m17 | ~2955 s |

The measured numbers go in the **recording** file, as `starts` and `musicEndsAt`.
Re-measure per recording: two orchestras never take the same tempo, and the
whole reason work and recording are separate files is that only the timings
differ between them.

### 3. Write the sidecar and assets

Portraits and city images: Wikimedia Commons for public-domain composers (the
repo has a `wikimedia-commons-images` skill). Re-encode as **baseline** JPEG, not
progressive — progressive files render blocky in the kiosk Firefox.

### 4. Verify without restarting anything

The store watches mtimes and rebuilds within ~2 s of an edit — sidecars,
`works/`, and `_composer.yml` alike — so authoring is edit-and-refresh. Check
that it took:

```bash
curl -s "http://{host}:{backend_port}/api/v1/play/plex:663146" | jq '.surround.id'
```

`null` means no sidecar matched. Look at the warnings before touching code —
they name the file and the reason:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:surround AND _time:1h' -d 'limit=50'
```

| Event | Meaning |
|---|---|
| `surround.sidecar.invalid` | Malformed YAML or a missing required key. Carries `file`, one `reason`, and the full `reasons` list so a whole file is fixable in one pass. Work-resolution problems also carry `work`, the path that was looked for. |
| `surround.definition.missing` | The `surround:` id has no file in `_surrounds/`. The piece is excluded rather than shipping half a payload. |
| `surround.sidecar.duplicate` | Two sidecars claim one contentId. Names both files; last one walked wins. |
| `surround.titles.ambiguous` | Two authored titles could match the same live title. Emitted at index time so you learn before a playback trips it. |
| `surround.match.rebound` | A rescan invalidated a contentId and the title rebound it. Fix the id in the named file. |
| `surround.lookup.miss` | An item played and nothing matched — the first thing to check when a surround doesn't appear. |

The `reason` vocabulary for the two-file shape:

| Reason | Meaning | Effect |
|---|---|---|
| `work-not-found` | The `work:` reference resolved to a path that does not exist or will not parse. `work` names it. | Recording excluded |
| `starts-length-mismatch` | `starts` and the work's `movements` differ in length. Payload names both counts. | Recording excluded |
| `work-not-a-string` | `work:` is a mapping, a list, or blank. | Recording excluded |
| `inline-blocks-ignored` | `piece`/`movements`/`cues`/`facts` authored beside a `work:`. | Work wins; recording indexes |
| `starts-not-a-list` | `starts:` is not a list — usually an indentation slip. | Reads as zero starts |
| `work-*-not-a-list`, `work-piece-not-a-mapping` | The wrong-typed block is in the **work** file, not the sidecar the warning names. | Coerced to empty |
| `missing-piece` | A sidecar with neither `work:` nor `piece:` — nothing to say about the music. | Indexes, renders empty |

---

## Modules

The `concert-hall` definition's regions resolve to named modules from
`SURROUND_BUILTIN_MODULES` (`frontend/src/modules/Surround/builtins.js`):

| Module | Region | Draws |
|---|---|---|
| `work-placard` | top | The floating stone plate: piece title, composer, opus, premiere. |
| `composer-card` | right (rail) | The header row — portrait plate and brass nameplate — and, below it, the rotating composer fact. |
| `place-carousel` | right (rail) | The foot of the rail: the composer's city photograph and the regional map, one at a time. See below. |
| `country-map` | right, bottom | The regional map component itself (see below). |
| `movement-map` | bottom | The engraved-score progress band. |
| `cue-ticker` | bottom | The docked cue/fact ticker under the movement map. |

The `concert-hall` definition authors `place-carousel`, not `country-map`, in the
rail: the map is one of the carousel's two slides, so a piece's regional map and
its city photograph share one slot and one dwell cycle instead of each getting a
cramped half-column. The `country-map` **registration stays live** — it is a
legitimate module for any definition that wants a bare, non-cycling map in a
region of its own, and `place-carousel` shares its payload-to-props step
(`mapPinFrom`) rather than re-deriving the pin.

## The country map

`country-map` draws an inline SVG map, highlights the composer's country, and
stars their city. It is **data-driven and auto-framing**: it computes the
bounding box of the highlighted landmass and derives the viewBox from it, so
Finland fills the frame exactly as well as Austria does with no per-country
configuration and no per-composer asset.

Geodata: `media/img/surround/_maps/europe.geo.json` — Natural Earth 1:110m, public
domain, trimmed to Europe plus Mediterranean/Caucasus neighbours, 41 KB, fetched
lazily and cached at module scope. No mapping library is used; the Mercator
projection is about fifteen lines.

Two things learned building it, both worth preserving:

- **Frame on the landmass containing the city, not the country's raw bounding box.**
  Natural Earth includes overseas territories, so a raw bbox makes France 116° wide,
  Norway 145°, and Russia 450° — wider than the planet, so the map wraps and Paris
  becomes a speck in an ocean. Selecting the part that contains the sidecar's own
  coordinate fixes all three with still-zero configuration.
- **Keep degrees and radians straight in the projection.** The Mercator `y` term
  returns radians while `x` stays in degrees — roughly 57× smaller — and any uniform
  scale then stretches the map vertically. Convert with `180/π`.

An unmapped composer (no `map:` block) renders nothing and triggers no fetch. A
country name absent from the geodata logs `surround.map.country-missing` (warn) —
that is the event that tells an author they mistyped a country.

The module sizes its city label against a ~420 px render width. It is fluid, but
placing it much narrower than the rail drops that label below the design's
ten-foot legibility floor.

## Facts and accuracy

This exists for music literacy, so a wrong fact is the failure that matters most.
Prefer facts that are checkable and specific — a date, a place, a documented
incident — over atmosphere.

**Verify against the local Wikipedia rather than writing from memory.** The
household runs an offline Wikipedia service; see `CLAUDE.local.md` for how to
reach it. It is fast, works offline, and it has already caught a real error here:
the Eroica's headline fact was originally written as "Beethoven scratched the name
off the title page so hard he tore through the paper," which conflates two
different artifacts. Ries's actual account is that Beethoven **tore the title page
in half and threw it on the floor**; separately, a surviving score copy bears the
dedication *scratched out*, twice, in two languages. Both are true; the popular
version merges them.

```bash
curl -s "http://{wikipedia_host}/search?q=Eroica%20Symphony&limit=5" | jq -r '.[].title'
curl -s "http://{wikipedia_host}/article/Symphony%20No.%203%20(Beethoven)" | jq -r '.text'
```

It is also a useful independent check on the audio analysis: the article gives
per-movement durations, and all four measured Eroica movements fell inside them.

## Scale

The Slow TV classical library is roughly 100 pieces across seven composers (Bach
31, Beethoven 41, Mozart 11, Sibelius 7, Wagner 5, Handel 4, Vivaldi 4). The
composer folder is the natural unit of work: one command, one review pass, one
commit per composer, rather than one 100-piece batch.
