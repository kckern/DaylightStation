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

## Action marks

The set also carries icons named for what a control DOES rather than for a
subject — transport (`play`, `pause`, `next`, `prev`, `rewind`, `restart`),
`print`, `close`, `forward`, the `kind-*` material marks, and:

| Name | File | Used by |
|------|------|---------|
| `back` | `svg/back.svg` | the launch card's "Go back" |
| `piano` | `svg/piano.svg` | the launch card's "Learn at the piano" |

⚠️ **Normalise to the contract, don't just drop the download in.** `piano.svg`
arrived from SVG Repo carrying `<style>.st0{fill:currentColor}</style>` and a
`class="st0"` path. It renders in Chromium — and vanishes entirely under jsdom,
which mis-parses a `<style>` inside foreign content and swallows the rest of the
SVG. An icon that is invisible to every test in this repo while looking fine in
a browser is the worst of both. Fills go on the element, always.
