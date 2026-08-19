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

Knowledge and performance live in **separate trees**, and the pixels in a third.
The split is deliberate: the corpus is subject-neutral reference data that a future
School music-appreciation projection reads on the same terms the player does, and
one work commonly has more than one recording. See
`docs/_wip/plans/2026-08-19-classical-library-corpus-design.md` for the rationale.

```text
data/content/library/classical/            THE CORPUS — knowledge only
  beethoven/
    _composer.yml                          bio, dates, map, portrait refs, facts
    symphony-3-eroica.yml                  the WORK: movements, listen notes, facts, themes
  vivaldi/
    _composer.yml
    four-seasons-spring.yml

data/content/surround/classical/           PERFORMANCES — owned by the player
  beethoven/
    symphony-3-eroica.hr-2016.yml          work ref + match + timings
  vivaldi/
    four-seasons-spring.plex663146.yml

data/content/surround/_surrounds/          presentation definitions (chrome)
  concert-hall.yml

media/img/library/classical/<composer>/    corpus assets (portrait.jpg, <city>.jpg)
media/img/library/_maps/europe.geo.json    shared geodata
```

- Both trees use the same shape — `<domain>/<composer>/<file>.yml` — and the same
  rule: `_`-prefixed files and folders are never walked as composer folders or as
  work/performance files. `_composer.yml` and `_surrounds/` are reserved by name.
- **A work with no performance sidecar is valid.** Most works will be authored
  before any recording is ingested; the corpus never mentions Plex.
- Assets are referenced relative to `assetBase`, which the store sets to
  `library/<domain>` (so, `library/classical`), and served by the generic static
  image route: `/api/v1/static/img/library/classical/beethoven/portrait.jpg`.
  That route is generic over the media image tree — nothing hardcodes a surround
  prefix. A missing asset renders an empty slot; it never breaks the surround.

### The work file

`library/classical/<composer>/<work-slug>.yml` — everything true about the music,
independent of any recording. Abridged from the real Eroica file:

```yaml
title: Symphony No. 3 in E-flat major, "Eroica"
short_title: "Beethoven's Third Symphony"   # the work's own alternate name
opus: Op. 55                          # or BWV / K. / RV / HWV — whatever the catalog uses
composed: 1803-1804
year: 1804
period: "Classical to Romantic"
period_note: "Written at the hinge — Classical forms stretched to Romantic scale and feeling."
city: Vienna
premiered: Theater an der Wien, 7 April 1805
set: symphonies                       # groups works into a cycle
set_index: 3
tier: flagship                        # flagship | key | catalog
movements:
  - n: 1
    name: "Allegro con brio"
    translation: "Fast, with spirit"
    listen:                           # per-movement appreciation bullets
      - "Two hammered E-flat chords, then the cellos sing the heroic theme — built from a plain broken chord."
      - "Huge off-beat chords batter against the bar line — the music fighting its own meter."
  - n: 2
    name: "Marcia funebre. Adagio assai"
    translation: "Funeral march — very slow"
    listen:
      - "Basses mutter like muffled drums beneath the violins' grief — a state funeral in sound."
    note: "The funeral march. Beethoven puts a death at the centre of a symphony — nobody had done that before."
facts:                                # untimed pool about the WORK
  - "Beethoven meant to dedicate this symphony to Napoleon. When his secretary brought word that Napoleon had declared himself Emperor, Beethoven tore the title page in half and threw it on the floor."
themes: [heroism, napoleon, deafness] # cross-work threads for future curricula
```

Notes that save a debugging pass:

- **No `start:` on a movement.** Timings are a property of a recording, not of the
  music, and live in the performance sidecar's `starts:` array. The store writes
  `start` onto each movement at resolve time.
- **`note:` becomes a cue.** A movement with a `note` and a paired start second is
  synthesized into a docked cue at that second. That is the whole mechanism —
  there is no per-movement cue syntax.
- **`short_title:` is the work's own alternate name**, not an abbreviation of the
  title. It is the standing label over the listening band's left register —
  "Beethoven's Third Symphony" — and the band prints no label at all rather than
  cutting a long `title` down to pretend to be one. Author it or leave it out.
- **A movement reaches the payload whole**, so `translation:` and `listen:` are
  read by the player: `MovementMap` sets the translation as a gloss under the
  movement's name, and `CueTicker` cycles that movement's `listen` bullets in the
  "now" zone while it is playing, falling back to the work's `facts` for a
  movement nobody has written notes for yet.
- **Work-level fields are allowlisted, and `themes:`, `set:`, `set_index:` and
  `tier:` are not on the list.** They are corpus fields, authored now for the
  School projection. `piece` is exactly the store's `PIECE_FIELDS` (`title`,
  `short_title`, `opus`, `composed`, `year`, `period`, `period_note`, `city`,
  `premiered`), plus
  `movements`, `facts` and an optional `composer:` override block. **Adding a
  work-level field and not adding it to that allowlist is silent** — the region
  simply renders without it. Movement-level fields need no allowlist.
- A `movements:` or `facts:` key that is present but not a list logs
  `surround.work.invalid` and is coerced to empty; the rest of the work still
  indexes.

### The composer file

`library/classical/<composer>/_composer.yml` — identity shared by every work that
composer wrote. Author it once and all 41 Beethoven works have it.

```yaml
name: Ludwig van Beethoven
born: 1770
died: 1827
birthplace: Bonn
period: Classical
period_note: "Clear forms and balanced phrases — the Classical style prized proportion above display."
portrait: beethoven/portrait.jpg
city_image: beethoven/vienna.jpg
map: { country: Austria, city: Vienna, lat: 48.21, lon: 16.37, caption: "Vienna — his adopted city from the age of twenty-one" }
facts:
  - "Beethoven said his hearing loss began in 1798, during a heated argument with a singer."
```

The composer slug is taken from the sidecar's `work:` ref (the segment before the
slash), so a performance always inherits the composer of the work it names.

Two fields worth calling out:

- **`facts`** are about the *composer*, not the work, so they hold regardless of what
  is playing. `ComposerCard` cycles them in the rail on a 27 s timer — deliberately
  coprime with the footer ticker's 20 s, so the two panels coincide once every nine
  minutes instead of swapping in lockstep, which reads as a glitch. The rotation is
  time-driven, not playhead-driven: seeking does not reset it.
- **`map`** supplies the place-carousel's map slide (and the standalone
  `country-map` module, for definitions that use it directly — see "Modules").
  Give it the country name **exactly as the geodata spells it** (`United Kingdom`,
  `Czechia`) plus the city and its coordinates. An optional **`map.caption`**
  authors the sentence under the carousel's city photograph — "Venice — his
  lifelong home" — set as prose, not the tracked small-caps label a bare place
  name gets. Omit it and the caption falls back to `map.city` alone, as a label.

### The performance sidecar

`surround/classical/<composer>/<work-slug>.<performance-tag>.yml` — one file per
recording, meaningless without a video, and it never restates the work's content.
The filename and the composer folder are convention only — nothing parses them.
`work:` is what binds the file to the corpus (the composer slug is read from the
ref, not from the folder), so the performance tag can be whatever identifies the
recording: `hr-2016`, `plex663146`. The **domain** folder does matter — it is what
sets `assetBase` to `library/<domain>`. The real Eroica sidecar in full:

```yaml
work: beethoven/symphony-3-eroica     # required — corpus ref, <composer>/<work-slug>
surround: concert-hall                # required — definition id in _surrounds/
match:                                # required
  contentId: plex:663134              # exact-match fast path
  title: "Beethoven: 3. Sinfonie"     # rebind fallback (normalized substring)
performance: "hr-Sinfonieorchester · Andrés Orozco-Estrada · Alte Oper Frankfurt, 11 February 2016"
starts: [0, 976, 1925, 2278]          # movement start seconds, positional
musicEndsAt: 2955                     # where the music stops and the applause starts
```

| Key | Required | Meaning |
|---|---|---|
| `work` | yes | Corpus ref. A ref that does not resolve logs `surround.work.missing` and the sidecar is excluded. |
| `surround` | yes | Definition stem in `_surrounds/`. Missing definition logs `surround.definition.missing`. |
| `match.contentId` | yes | See "Why `match` has two keys" below. |
| `match.title` | soft | Absent logs `surround.sidecar.invalid` with reason `missing-match-title` and gives up the rebind lane; the sidecar still works by id. |
| `performance` | no | Free-text performers/venue/date. Reaches the payload as `piece.performance`; no shipped module renders it yet. |
| `starts` | no | Seconds from the top of the media, positional — `starts[i]` is `movements[i]`'s start. |
| `musicEndsAt` | no | Reaches the payload as `piece.musicEndsAt`; `MovementMap` uses it so the last movement's bar stops at the music rather than running to `duration`. |
| `cues` | no | Performance-specific extras only, `{ at, render, text }`. Movement notes already produce their own. |
| `composer` / `piece` | no | Per-key overrides applied last. Use sparingly — an override that belongs to the music belongs in the corpus. |

A `starts` entry that is not a non-negative finite number (a quoted timestamp, a
placeholder `null`, a negative from arithmetic against the wrong reference) is
dropped to `undefined` and logs the soft reason `starts-entry-invalid`. Positions
are preserved rather than compacted, so one bad entry costs one movement's timing
instead of shifting every later movement by one — the movement keeps its name,
its translation and its listening notes, which are true whatever this transfer's
timing says. The band then **declines to draw** that movement on the rule
(`surround.movements.unplaceable`) rather than anchoring it to second zero, so
one bad entry costs a segment and never an out-of-order rail.

A first movement that starts late — a transfer that opens on the conductor's
walk-on, applause and a settling hall, `starts: [45, …]` — is a supported and
expected recording; so is the applause after the last chord, which `musicEndsAt`
puts outside every movement. **Nothing sounding is a designed state, not a gap.**
In it the rail draws every movement as still to come (before the first) or as
played (after the last), no segment carries the sounding state, the bond is out
on both halves at once, and the NOW register is blank — no movement name, no
borrowed fact. It borrows nothing because that register is about what is playing,
and nothing is. The band does not change height for it: every box in it is
reserved, so the state is quiet rather than visible as a reflow.

`render: docked` draws into the ticker region. `render: overlay` is reserved for
phase two (pop-up-video style, over the video) and needs no schema change.

### The presentation definition

`_surrounds/<id>.yml` — where the chrome goes, for every recording that names it.
It says nothing about any particular piece; it is the layout the corpus is poured
into. The shipped one:

```yaml
id: concert-hall
regions:
  top:
    module: work-placard
  right:                                # width/side ride the FIRST entry
    - module: composer-card
      width: "33%"
      side: left
    - module: place-carousel            # no height: both rail regions split evenly
  bottom:
    - { module: movement-map, height: 64 }
    - { module: cue-ticker, height: fill, collapse: first }
collapse:
  footerFloor: 90
band:
  nowSide: right                        # right | left | dynamic
  nowHeading: auto                      # auto | always | never
  railDensity: names                    # names | bars
```

A slot takes either one module or a list of them. `height` is pixels, or `fill`
for the region that claims the band's slack. `collapse: first` marks the region
dropped when the whole band falls under `collapse.footerFloor`. A module in a
slot it was not registered for still renders and logs
`surround.module.misplaced`.

`band:` is the third thing a definition says about a frame, beside `regions` and
`collapse` — how the listening band and the movement rail are laid out relative
to each other. Every key defaults, and an unauthored, misspelled or wrong-typed
value degrades to its default rather than reaching a module.

| Key | Default | Meaning |
|---|---|---|
| `band.nowSide` | `right` | Which half of the band carries the NOW register. `dynamic` follows the playhead — the register sits on the same side of the band as the sounding segment, so the bond joining them stays short — and swaps once, at half way, with hysteresis so a scrub cannot flap it. |
| `band.nowHeading` | `auto` | Whether the NOW register prints the sounding movement's name. `auto` prints it exactly when the rail does not, because the rail's own names are that heading; `always` and `never` override. |
| `band.railDensity` | `names` | What the rail prints. `names` is the shipped rail; `bars` is the rule, its barlines and the playhead with no type under them — for a band too short to carry names, and what makes `nowHeading: auto` resolve the other way. |

### How the two resolve

`YamlSurroundStore` loads the corpus first (composers and works, keyed
`<composer>/<work-slug>`), then walks the performance tree. For each sidecar:

- **Precedence is composer ← work ← performance**, later wins per key, applied
  separately to the `composer` block and the `piece` block. So `_composer.yml`
  supplies the base identity, a work's optional `composer:` block narrows it, and
  the sidecar's optional `composer:` block wins. The merge is deep, so a `map:`
  override can supply just `caption:` and keep the inherited coordinates — but
  **lists are replaced wholesale, and `key: null` cannot clear an inherited
  value** (it reads as absent). To suppress an inherited fact list, override it
  with an empty list.
- `piece` is the work's allowlisted fields, then `performance` and `musicEndsAt`
  from the sidecar, then any `piece:` override block.
- `movements` are the work's, each gaining `start: starts[i]`.
- `cues` are the synthesized movement-note cues plus the sidecar's explicit `cues`,
  the whole list sorted by `at`.
- `facts` in the payload are the **work's** facts. Composer facts stay under
  `composer.facts`; the two rotate in different panels. A `facts:` key on a
  performance sidecar is ignored.
- `assetBase` is `library/<domain>`.

The resolved payload shape is unchanged from before the corpus split, which is why
the frontend modules needed no edits. The mtime watcher covers both trees, so
edit-and-refresh authoring works on a work file exactly as it does on a sidecar.

### Authoring ahead of Plex

Most works will be written before any recording is ingested. The work file alone is
complete and valid — write it and stop. When you want the sidecar in place first
(so the performance tag, `surround:` and `work:` ref are already reviewed), give
`match.contentId` a placeholder of the form `pending:<slug>`:

```yaml
work: beethoven/symphony-5
surround: concert-hall
match:
  contentId: pending:beethoven-symphony-5
  title: "Beethoven: 5. Sinfonie"
```

It passes validation — `contentId` only has to be present — and no live item will
ever carry that id, so the fast path never fires until a real `plex:NNNNNN`
replaces it. Nothing else in the file needs to change at that point.

Note the one thing a placeholder does *not* suppress: the sidecar is still indexed
in the title lane described below, so if the recording lands and its live title
overlaps the authored `match.title`, the surround appears anyway and logs
`surround.match.rebound` naming the placeholder as the stale id. That is the
signal to go fill in the real id.

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

Those numbers are a property of the recording, so they go in the **performance
sidecar** — the movement starts as `starts:` in movement order, the applause point
as `musicEndsAt:`. A second recording of the same work gets its own sidecar with
its own `starts:` and reuses the work file untouched.

### 3. Write the work file, the sidecar, and the assets

Two YAML files, in that order, plus the images. The work file is the slow one —
movement names, `listen:` bullets, `note:` lines, facts — and it is what a second
performance later reuses. The sidecar is six lines.

Portraits and city images: Wikimedia Commons for public-domain composers (the
repo has a `wikimedia-commons-images` skill). They belong to the composer, so they
land under `media/img/library/classical/<composer>/` and are referenced from
`_composer.yml` relative to `assetBase` (`beethoven/portrait.jpg`, not a full
path). Re-encode as **baseline** JPEG, not progressive — progressive files render
blocky in the kiosk Firefox.

### 4. Verify without restarting anything

The store watches mtimes and rebuilds within ~2 s of an edit, so authoring is
edit-and-refresh. Check that it took:

```bash
curl -s "http://{host}:{backend_port}/api/v1/play/plex:663146" | jq '.surround.id'
```

`null` means no sidecar matched. `surround.index.built` (info) is the other quick
check: it carries `pieces`, `skipped`, `composers` and `definitions`, so a corpus
folder that failed to load shows up as a count that is one too low. Look at the
warnings before touching code — they name the file and the reason:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:surround AND _time:1h' -d 'limit=50'
```

| Event | Meaning |
|---|---|
| `surround.sidecar.invalid` | Malformed YAML or a missing required key in a performance sidecar. Carries `file`, one `reason`, and the full `reasons` list so a whole file is fixable in one pass. Blocking reasons: `yaml-unparseable`, `not-a-mapping`, `missing-surround`, `missing-work`, `missing-match`, `match-not-a-mapping`, `missing-match-contentId`. Soft ones (the sidecar still loads): `missing-match-title`, `starts-not-a-list`, `starts-entry-invalid`, `cues-not-a-list`, `composer-not-a-mapping`, `piece-not-a-mapping`. |
| `surround.work.missing` | The sidecar's `work:` ref names no file in the corpus. The sidecar is excluded. Carries the ref, the sidecar `file`, and `expected` — the corpus path that was looked for — so the fix is either to create that file or to correct the slug, without re-deriving the path. Usually a typo, or a work file that never got written. |
| `surround.work.invalid` | A **corpus** work file has a present-but-non-array `movements` or `facts` — a mapping written where a list belongs. Warn and continue: the key is coerced to empty and the work still indexes. |
| `surround.starts.mismatch` | `starts` length ≠ movement count. The sidecar still resolves; the unpaired movements get no timing. Does not fire when there are no `starts` at all — a work whose timings have not been derived yet is a normal state, not an error. |
| `surround.definition.missing` | The `surround:` id has no file in `_surrounds/`. The piece is excluded rather than shipping half a payload. |
| `surround.sidecar.duplicate` | Two sidecars claim one contentId. Names both files; last one walked wins. |
| `surround.titles.ambiguous` | Two authored titles could match the same live title. Emitted at index time so you learn before a playback trips it. |
| `surround.match.rebound` | A rescan invalidated a contentId and the title rebound it. Fix the id in the named file. |
| `surround.match.ambiguous` | The title lane matched more than one sidecar at lookup time, so the store refused. Names the live title and every candidate file. |
| `surround.lookup.miss` | An item played and nothing matched — the first thing to check when a surround doesn't appear. |
| `surround.movements.unplaceable` | The rail declined to draw one or more movements: this recording gave them no usable start, or a start that runs backwards. Names how many were authored, how many were placed, and which numerals were dropped. Always paired with a `starts-entry-invalid` or `starts.mismatch` from the store — this one says what the screen did about it. |
| `surround.module.missing` | A definition names a module the registry does not have. The region renders empty and the rest of the frame is unaffected — usually a typo in `_surrounds/`. |
| `surround.module.misplaced` | A module is authored into a slot it was not registered for (a rail module in the band). It still renders; the warn names the slot and the slots the module declared. |

---

## Modules

The `concert-hall` definition's regions resolve to named modules from
`SURROUND_BUILTIN_MODULES` (`frontend/src/modules/Surround/builtins.js`):

| Module | Region | Draws |
|---|---|---|
| `work-placard` | top | The floating stone plate: piece title, opus, composed, premiere. The composer is never named here — the person lives on brass in the rail, and the plate is stone, which carries only the work. |
| `composer-card` | right (rail) | The header row — portrait plate and brass nameplate — and, below it, the rotating composer fact. |
| `place-carousel` | right (rail) | The foot of the rail, one slide at a time: the composer's city photograph, the country in continental context, the country at city zoom, and the era timeline. |
| `country-map` | right, bottom | The regional map component itself (see below). |
| `movement-map` | bottom | The engraved-score progress band, with each movement's translation glossed under its name. |
| `cue-ticker` | bottom | The docked ticker: the playing movement's `listen` notes on one side, cues and facts on the other. |

### The band's notes are never cut

There is no ellipsis in the listening band, at any screen size, ever. A television
has no "read more", no scroll and no pointer, so a note that stops mid-sentence is
a claim the viewer cannot complete.

The note's box is whatever vertical run its register has left over — a constant,
because it does not depend on which note is showing — and the TYPE is fitted to
the text by measurement. The ladder, in order: tighten the leading toward its
floor, then step the size down toward its floor. Both floors are derived against
the vendored face's own metrics and neither is crossed. The fit is solved once per
piece, against every string either register can ever show (all the work's facts,
every placed movement's `listen` notes, every docked cue), so it cannot change at
a movement boundary and the two registers are always set in one size.

| Bound | Value | Why |
|---|---|---|
| Prose size floor | `0.88rem` | The frame's ten-foot floor for LABELS is `0.72rem`; a label is a short tracked small-cap string read as a shape, and continuous prose is read glyph by glyph. EB Garamond's x-height is 0.42em, so this buys 5.91px of x-height against the label floor's 4.84px on a fleet running at device pixel ratio 1. |
| Prose size ceiling | `1.5rem` | Where a programme note starts competing with the work's own title on the plate. |
| Leading floor | `1.25` | EB Garamond's ink extent is exactly 1.00em ascender-to-descender, so this leaves a quarter of the type size of clear air between lines — 80% of what the face's own `line-height: normal` (1.31) reserves. Below it the failure is line tracking at distance, not collision. |
| Leading, loose | `1.35` | What the band is set at wherever it can afford it. |

**A note that cannot be set whole at both floors is an authoring failure, not a
render problem.** It is dropped from the rotation and logged as
`surround.note.unfittable` with the register, the character count, the character
budget and the measured overflow — everything needed to shorten it. The band shows
only the notes it can show whole; it never truncates one and never sets one below
the floors. Author facts to the budget of the smallest band they must appear on.

### The bond, and the band's two design rules

The sounding movement's panel on the rail, a thin waist along the band's seam, and
the NOW register's panel are ONE shape in one colour — that is what lets the
register stop reprinting the movement name the rail set six inches above it. The
waist spans the HULL of the segment and the panel, so the panel's whole top edge
and the segment's whole bottom edge are both welded along a real interval; the
parts never meet at a corner. When the segment already sits over the panel the
waist collapses onto it and the two simply merge.

- **Borders: nothing in the band is edged.** The two registers are divided by the
  bond's own silhouette — a lit ground against an unlit one — not by a rule drawn
  on it. The score's barlines and the frame's region seams are not borders.
- **Corners: one radius token.** Every corner on the outside of the bond's
  silhouette carries it; every corner where two of its parts weld is square, so
  the joins are invisible. Nothing else in the band is rounded.

The whole shape moves on ONE clock: the segment widths, the playhead, the bond and
its waist are all published from a single interpolated vector in a single render,
so a movement boundary is one move rather than a resize followed by a slide. Under
`prefers-reduced-motion` the vector commits in one frame.

The `concert-hall` definition authors `place-carousel`, not `country-map`, in the
rail: the map is one of the carousel's four slides, so a piece's regional map and
its city photograph share one slot and one dwell cycle instead of each getting a
cramped half-column. The `country-map` registration stays live — it is a
legitimate module for any definition that wants a bare, non-cycling map in a
region of its own, and `place-carousel` shares its payload-to-props step
(`mapPinFrom`) rather than re-deriving the pin.

## The country map

`country-map` is a surround module that draws an inline SVG map, highlights the
composer's country, and stars their city. It is **data-driven and auto-framing**:
it computes the bounding box of the highlighted landmass and derives the viewBox
from it, so Finland fills the frame exactly as well as Austria does with no
per-country configuration and no per-composer asset.

Geodata: `media/img/library/_maps/europe.geo.json` — Natural Earth 1:110m, public
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

The corpus is sized for more than that. Only media-backed works get a performance
sidecar; work files are written for the long tail too, so the composer count under
`library/classical/` grows well past the seven with recordings. That asymmetry is
the point of the split — a composer folder with no video in the house is still
worth authoring.
