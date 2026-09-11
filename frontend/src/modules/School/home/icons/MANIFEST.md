# School Subject Icons — household set via SVG Repo

Source: user-curated icons from [SVG Repo](https://www.svgrepo.com/) (ingested
2026-07-22 from `media/tmp/`), normalized to the shared inline-icon contract:
`width="1em" height="1em"`, all fills/strokes `currentColor` — set color via
CSS `color:`.

Filenames are the subject ids from `../subjects.js`, so a tile finds its icon
by id. Swap any file freely (keep `currentColor` + `1em`); no code change
needed.

| Subject id | Shelf | File | SVG Repo source |
|------------|-------|------|-----------------|
| english | English & Literature | `svg/english.svg` | books |
| writing | Writing & Typing | `svg/writing.svg` | keyboard |
| language | Language & Culture | `svg/language.svg` | language-alphabet-translation |
| math | Math & Money | `svg/math.svg` | math-finance |
| science | Science & Nature | `svg/science.svg` | science (atom, stroke-based) |
| skills | Life & Skills | `svg/skills.svg` | plant-leaf |
| civilization | Civilization | `svg/civilization.svg` | globe-stand |
| scripture | Scripture & Gospel | `svg/scripture.svg` | sunlight |
| arts | Arts & Culture | `svg/arts.svg` | art-palette |
| geography | Geography | `svg/geography.svg` | placeholder line-art (globe) — swap later |
| states | Geography | `svg/states.svg` | placeholder line-art (map grid) — swap later |
| capitals | Geography | `svg/capitals.svg` | placeholder line-art (star) — swap later |
| flags | Geography | `svg/flags.svg` | placeholder line-art (flag) — swap later |
| countries | Geography | `svg/countries.svg` | placeholder line-art (globe+pin) — swap later |

## Sentence-ladder rungs

Ingested 2026-09-11 from SVG Repo. Named `rung-<id>` so the ladder finds an
icon by rung id, the same way a subject tile finds one by subject id.

| Rung | File | Source | Style |
|------|------|--------|-------|
| `repetition` | `svg/rung-repetition.svg` | speaker | **filled** |
| `dictation` | `svg/rung-dictation.svg` | keyboard-alt-1 | stroke, 1.5 |
| `recording` | `svg/rung-recording.svg` | microphone-alt-1 | stroke, 1.5 |
| `interpretation` | `svg/rung-interpretation.svg` | language (문/A) | **filled** |

Note `rung-interpretation` is NOT `language.svg` — that name was already taken
by the Language & Culture subject tile, which is a different mark for a
different thing.

The two stroke icons arrived at `stroke-width="2"` and were normalized to the
set's existing `1.5` (cf. `svg/record.svg`); at the same size a heavier stroke
reads as a different set. **The four are still not one family** — two are
filled and two are outlines, so they carry visibly different weight when drawn
side by side in the rung rail. Swapping the two filled ones for outline
equivalents would settle it; the files are drop-in (keep `currentColor` + `1em`)
and need no code change.

## Action marks

The set also carries icons named for what a control DOES rather than for a
subject — transport (`play`, `pause`, `next`, `prev`, `rewind`, `restart`),
`print`, `close`, `forward`, the `kind-*` material marks, and:

| Name | File | Used by |
|------|------|---------|
| `back` | `svg/back.svg` | the launch card's "Go back" |
| `piano` | `svg/piano.svg` | the launch card's "Learn at the piano" |
| `book-starting` | `svg/book-starting.svg` | the reading shelf's "I'm just starting it" door (SVG Repo 521767, next) |
| `book-partway` | `svg/book-partway.svg` | the reading shelf's "I'm partway through" door (SVG Repo 521655, fast-forward) |
| `physical-education` | `svg/physical-education.svg` | the status board's workout disc (SVG Repo 390333, fitness-watch-pulse-smartwatch). Named for a SUBJECT that has no shelf: physical education is credited from fitness sessions, never assigned, so the id exists here and nowhere in `subjects.js` |
| `book-finished` | `svg/book-finished.svg` | the reading shelf's "I already finished it" door (SVG Repo 521562, circle-checkmark) |
| `power` | `svg/power.svg` | the locked panel's "Turn off screen" control (standby glyph, drawn to the contract above) |
| `plus` | `svg/plus.svg` | the reading shelf's add card, in the empty book slot |
| `bookmark` | `svg/bookmark.svg` | the reading shelf's set-aside mark, beside `book-finished`'s check |
| `record` | `svg/record.svg` | the Sentence Ladder recording rung's start tile — "Listen, then record" (SVG Repo 524865, record-circle-1; strokes → currentColor) |
| `stop` | `svg/stop.svg` | the recording rung's live-mic tile — a rounded square, red, the only red on that stage (drawn to the contract) |
| `record-again` | `svg/record-again.svg` | the recording rung's "Record again" (SVG Repo 506292, redo-circle; strokes → currentColor) |
| `keep` | `svg/keep.svg` | the recording rung's "Keep it" (SVG Repo 425941, accept; its `<style>`/class moved onto the path as `fill-rule`, per the warning below) |

⚠️ **Normalise to the contract, don't just drop the download in.** `piano.svg`
arrived from SVG Repo carrying `<style>.st0{fill:currentColor}</style>` and a
`class="st0"` path. It renders in Chromium — and vanishes entirely under jsdom,
which mis-parses a `<style>` inside foreign content and swallows the rest of the
SVG. An icon that is invisible to every test in this repo while looking fine in
a browser is the worst of both. Fills go on the element, always.
