# Singalong YAML format audit

**Date:** 2026-08-16
**Scope:** `{dataDir}/content/singalong/{hymn,primary}/*.yml` — 652 files (hymn 413, primary 239)
**Trigger:** hymn #1036 renders literal `###` on screen and scrolls at the wrong speed.

## Expected shape

```yaml
title: <string>
hymn_num: <int>      # hymn/  (primary/ uses song_number)
verses:
  - - line
    - line
  - - line
    - line
```

`verses` is a list of stanzas; each stanza is a list of plain strings. Verse+chorus merged into
one stanza is the house convention (see 0227, 0251, 0336) and is **not** a defect.

Consumers:
- `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs` passes `metadata.verses` through untouched.
- `frontend/src/modules/Player/renderers/SingalongScroller.jsx` does `data.map(stanza => stanza.map(line => <p>{line}</p>))`
  and computes scroll pacing as `yStartTime = duration / verses.length / 1.8`.

So **stanza count is a timing input, not just layout** — a song collapsed into one stanza scrolls
at roughly `verses.length`× too slow.

## Findings

| # | Defect | Files | Effect |
|---|--------|-------|--------|
| 1 | `###` stanza terminator left in the text | **41** | literal `###` painted on screen; whole song collapsed into 1 stanza |
| 2 | `- # text` pseudo-comment → null lines | 9 | blank ghost stanzas |
| 3 | …same, swallowing a following real verse into a nested array | 5 (subset of #2) | a real verse never renders as lines |
| 4 | Entire `verses:` block commented out → `verses: null` | 1 | song renders empty |
| 5 | `verses: []` on songs that do have lyrics | 4 | song renders empty |
| 6 | Literal `'[Chorus]'` line | 2 | marker painted on screen |
| 7 | Raw `<em>` tags in lyric text | 1 | tags painted on screen |
| 8 | Trailing empty-string stanza | 1 | blank stanza + skews pacing |
| 9 | Dropbox conflicted-copy file | 1 | duplicate entry in listings |

`hymn_num` / `song_number` match the filename prefix in all 652 files. No parse errors.

---

### 1. `###` stanza terminator left in the text — 41 files

`###` marks end-of-stanza in whatever source these were imported from. The importer never split on
it, so every one of these songs is a single stanza with `###` embedded in the last line of each
would-be verse.

Repair is deterministic: split after each line matching `/###\s*$/`, strip the marker. Simulated
across all 41 — every split lands on even stanzas, no leftovers, no mid-line `###`:

**hymn/ (16)** — all multi-stanza, so pacing is wrong too:

| file | 1 → n stanzas | lines/stanza |
|---|---|---|
| 1032-look-unto-christ | 4 | 8,8,8,8 |
| 1033-oh-how-great-is-our-joy | 3 | 8,8,8 |
| 1034-im-a-pioneer-too | 3 | 8,8,8 |
| 1036-read-the-book-of-mormon-and-pray | 2 | 10,10 |
| 1037-im-gonna-live-so-god-can-use-me | 4 | 4,4,4,4 |
| 1038-the-lords-my-shepherd | 5 | 6,6,6,6,6 |
| 1040-his-voice-as-the-sound | 3 | 8,8,8 |
| 1041-o-lord-who-gave-thy-life-for-me | 4 | 6,6,6,6 |
| 1042-thou-gracious-god-whose-mercy-lends | 5 | 4,4,4,4,4 |
| 1043-help-us-remember | 4 | 4,4,4,4 |
| 1044-how-did-the-savior-minister | 3 | 8,8,8 |
| 1046-can-you-count-the-stars-in-heaven | 3 | 8,8,8 |
| 1047-he-cares-for-me | 3 | 8,8,8 |
| 1049-joseph-prayed-in-faith | 3 | 4,4,5 |
| 1050-stand-by-me | 3 | 4,4,4 |
| 1051-this-day-is-a-good-day-lord | 3 | 6,6,6 |

**primary/ (25)** — 8 multi-stanza (pacing also wrong), 17 single-stanza (cosmetic only):

multi: 0025 (2), 0040 (2), 0073 (3), 0086 (4), 0150 (2), 0197 (2), 0198 (2), 0241 (2)
single: 0020, 0021, 0022, 0023, 0027, 0028, 0030, 0122, 0126, 0128, 0145, 0206, 0253, 0254, 0267, 0275, 0284

Note `primary/0021` and `primary/0040` are rounds and use `①②③④` entry markers — those are
deliberate, leave them.

### 2–3. `- # text` pseudo-comments — 9 files

Someone commented out optional verses by putting `#` *after* the dash instead of before the whole
line:

```yaml
  - - # Jesus, the very thought of thee     # ← WRONG: parses as a null list item
    - # With sweetness fills my breast;
```

The correct style (used in e.g. `hymn/0002`) comments the whole line:

```yaml
  #- - Jesus, the very thought of thee
  #  - With sweetness fills my breast;
```

The broken form leaves a stanza of `null`s that renders as empty `<p>` tags. Worse, a trailing
`- #` line has no scalar value, so YAML absorbs the *next* more-indented block as its value — which
silently pulls a real following verse into a nested array where `stanza.map()` renders it as one
run-on blob.

| file | renders | blank ghost stanzas | real verses swallowed |
|---|---|---|---|
| hymn/0006-redeemer-of-israel | 4 | 1 | 1 |
| hymn/0072-praise-to-the-lord-the-almighty | 3 | 1 | 1 |
| hymn/0134-i-believe-in-christ | 3 | 1 | 1 |
| hymn/0141-jesus-the-very-thought-of-thee | 3 | 2 | 1 |
| hymn/0227-there-is-sunshine-in-my-soul-today | 3 | 1 | 1 |
| hymn/0202-oh-come-all-ye-faithful | 3 | 1 | 0 |
| hymn/0294-love-at-home | 3 | 1 | 0 |
| hymn/1021-i-know-that-my-savior-loves-me | 4 | 1 | 0 |
| hymn/1207-still-still-still | 3 | 1 | 0 |

### 4. Fully commented-out song — 1 file

`hymn/1035-as-i-keep-the-sabbath-day.yml` — every verse line is `#`-prefixed, so `verses` parses to
`null`. The adapter's `metadata.verses || []` turns that into an empty song. Its commented body also
carries `###` markers and smart-quote-wrapped lines (`'As I keep the Sabbath day. ###'` opened with
`‘`), so it needs the #1 treatment when uncommented. Note this is the only gap in the otherwise
contiguous 1032–1051 block, i.e. it belongs to the same bad import.

### 5. `verses: []` on songs that have lyrics — 4 files

`primary/0201-when-grandpa-comes`, `0229-god-is-watching-over-all`, `0238-springtime-is-coming`,
`0265-be-happy`.

Not to be confused with `primary/0288`–`0299` (Impromptu, To a Wild Rose, Andante, O Rest in the
Lord, Air from Orpheus, Supplication, Prelude in F, Distant Bells, Each Sunday Morning, In Quietude,
Loving Shepherd) — that's the Children's Songbook quiet-music section, instrumental by design.
`verses: []` is correct there.

### 6. Literal `[Chorus]` line — 2 files

`hymn/0280-welcome-welcome-sabbath-morning`, `hymn/0336-school-thy-feelings`. Both have a
`- '[Chorus]'` line in verse 1 only; later verses inline the chorus with no marker. Drop the line.

### 7. Raw HTML in lyric text — 1 file

`primary/0241-birds-in-the-tree` uses `<em>` on the action words. `SingalongScroller` renders text
content, so these paint as literal tags. Strip them (or, if the emphasis matters, it needs renderer
support — no other file uses it).

### 8. Trailing empty stanza — 1 file

`hymn/1039-because` ends with a 9th stanza `[""]`. Drop it — it also inflates `verses.length` and
slows the scroll by ~12%.

### 9. Dropbox conflicted copy — 1 file

`hymn/0340-the-star-spangled-banner (MacBook-Pro.kornet's conflicted copy 2026-07-05).yml`

`SingalongAdapter.getList` matches files on `/^0*(\d+)/`, so this is picked up as a second hymn 340.
Its content differs from the live file (1 merged stanza vs 3). Delete the conflicted copy.

## Remediation — applied 2026-08-16

Backup of the pre-fix tree (654 files): scratchpad `singalong-backup-20260816/`.

| # | Defect | Status |
|---|--------|--------|
| 1 | `###` terminator | **fixed** — 41 files split + stripped |
| 2 | `- #` pseudo-comments | **fixed** — 9 files rewritten to `#- -` |
| 3 | swallowed verses | **fixed** — 5 verses recovered as real stanzas |
| 4 | `hymn/1035` fully commented out | **fixed** — uncommented, split, quotes stripped |
| 5 | `verses: []` on 4 primary songs | **fixed** — transcribed from the engraved scores |
| 6 | `'[Chorus]'` lines | **fixed** — 2 files |
| 7 | `<em>` tags | **fixed** — `primary/0241` |
| 8 | trailing empty stanza | **fixed** — `hymn/1039` (also trimmed 2 trailing-space lines) |
| 9 | Dropbox conflicted copy | **fixed** — moved to `_deleteme/` |

Both rewrites were text-level (formatting and quoting style preserved) and self-verifying: each
file was reparsed and the flattened line sequence compared against the original before the write
was allowed. Every file passed; no file was written on a failed check.

One extra fix found while repairing #3: `hymn/0006` had `How long we have wandered` as a 7th line
of verse 2 rather than the opening line of verse 3, giving 6/7/5 line stanzas. Moved — now 6/6/6,
matching the hymn.

Re-audit after the work: 651 files, zero findings other than #4 and #5.

`FileIO.mjs` caches directory listings by mtime but reads YAML content fresh per request, so no
backend restart is needed — including for the removed conflicted copy, since the directory mtime
changed.

### `hymn/1035` (defect 4)

Every line was commented out, so the song rendered empty. The lyrics were sitting in the file the
whole time. Uncommented, split on the `###` markers the comment body also carried, and stripped the
spurious smart quotes that wrapped three lines (`‘As I keep the Sabbath day. ###’` — the importer
quoted those lines to escape the ` #` comment hazard, using curly quotes). Now 3 stanzas of 8.

### The four empty primary songs (defect 5)

Not a data-entry oversight — a systematic gap with a single cause. All four are Children's Songbook
entries whose text the Church is **not licensed to publish online**: their pages carry "Due to
licensing limitations, the Church cannot publish this music in this format," and every downstream
site (singpraises.net, ldshymnology, primary-singing blogs) reproduces at most an opening couplet.
Whatever scrape built this collection hit those four pages and got nothing. Sources and rights
holders:

| # | Song | Words / music | Rights |
|---|---|---|---|
| 201 | When Grandpa Comes | Marian Major | *Our Singing World* © 1949/57/59 Silver, Burdett & Ginn |
| 229 | God Is Watching Over All | Nellie Poorman / Schubert | *The World of Music* lyrics © 1936 Silver, Burdett & Ginn |
| 238 | Springtime Is Coming | Fanny Giralda Pheatt / Alsatian folk tune | *The World of Music* © 1936 Silver, Burdett & Ginn |
| 265 | Be Happy! | Alice Jean Cleator / Arthur Wilton | © 1914, renewed 1942, arr. © 1989 Rodeheaver Co. (WORD) |

The lyrics were transcribed from the engraved Children's Songbook pages (PDFs of the printed page
are mirrored at `latterdaysaintmusicians.com`; the text layer is not extractable, so the scores were
read directly). Line breaks follow the printed vocal line; stanza structure follows the numbered
verses on the score.

- **201** — one stanza of 8. The score marks `*Alternate word: grandma`; kept as printed rather than
  synthesizing a second "Grandma" stanza the songbook doesn't have.
- **229** — 2 stanzas of 4.
- **238** — 2 stanzas of 2.
- **265** — 2 stanzas of 8, the shared refrain inlined per verse (house convention).

Note these four pages carry "MAKING COPIES OF THIS MATERIAL IS PROHIBITED", which the other 647 do
not. Fine for a private household display; do not redistribute this collection.

## Defect 10 — commented-out verses the recording still plays (open)

Found 2026-08-16 while checking a report that hymn 277 was missing verse 2.

23 hymns carry verses commented out in the `#- -` convention, which trims them from the display.
That is a deliberate authoring pattern, correctly written — the format audit above does not flag it.
The problem is that **the accompaniment recordings still play those verses**, so the words on screen
run a verse short and the scroll pacing drifts.

Both effects follow from `SingalongScroller`: the omitted verse's music plays with no words on
screen, and `yStartTime = duration / verses.length / 1.8` is computed from the *displayed* count, so
the whole scroll is stretched.

Population evidence — median seconds per verse over hymns with a matching MP3:

| group | n | s / displayed verse | s / (displayed + commented) |
|---|---|---|---|
| no commented verses (baseline) | 382 | **48.0** | — |
| has commented verses | 23 | 65.2 | **46.6** |

The commented group only matches the baseline when the commented verses are counted, i.e. the audio
is singing them.

Per-file confirmation via `silencedetect` (strophic hymns break into an intro block plus one block
per verse). Six of the 23 give an unambiguous block structure; five of those six show the audio
carrying every verse:

| hymn | displayed | commented | blocks | reading |
|---|---|---|---|---|
| 0001 the-morning-breaks | 3 | 2 | 6 = intro + 5×41s | audio has all 5 |
| 0035 for-the-strength-of-the-hills | 3 | 1 | 5 = intro + 4×44s | audio has all 4 |
| 0227 there-is-sunshine-in-my-soul | 3 | 1 | 5 = intro + 4×40s | audio has all 4 |
| 0277 as-i-search-the-holy-scriptures | 3 | 1 | 5 × ~25s | audio has all 4 |
| 1207 still-still-still | 2 | 1 | 4 = intro + 3×34s | audio has all 3 |
| 0070 sing-praise-to-him | 4 | 1 | 5 = intro + 4×42s | audio matches display |

**hymn/0277** specifically: verse 2 (`As I search the holy scriptures, / Touch my spirit, Lord, I
pray. / May life’s myst’ries be unfolded / As I study day by day.`) is present but commented out.
The 137 s recording is five ~25 s passes of the tune (23.9, 24.6, 24.8, 25.4, 26.0) against four
verses of text and three displayed stanzas — so the display is short by at least one verse under
either reading (intro + 4 verses, or 5 passes). Both the plain and `_ldsgc` tracks are instrumental
(MacWhisper large-v3 returns nothing but `♪♪` for both), so the mismatch is musical, not lyrical.

The remaining 14 hymns have block structures too irregular for this method (repeats, fermatas,
internal refrains) and 3 have no detectable gaps at all. They need a listen, not a measurement.

### Resolved for the five confirmed cases

Restored 2026-08-16 (uncommented back to live stanzas; the recordings are the fixed artifact, so the
text moves to match them). 0070 left alone — its audio genuinely matches its display.

| hymn | before | after | lines/stanza |
|---|---|---|---|
| 0001 the-morning-breaks | 3 | 5 | 5,5,5,5,5 |
| 0035 for-the-strength-of-the-hills | 3 | 4 | 8,8,8,8 |
| 0227 there-is-sunshine-in-my-soul | 3 | 4 | 8,8,8,8 |
| 0277 as-i-search-the-holy-scriptures | 3 | 4 | 4,4,4,4 |
| 1207 still-still-still | 2 | 3 | 6,6,6 |

Two independent checks corroborate the restoration:

1. **Uniform stanza lengths.** Every file came out perfectly regular. A restored verse that didn't
   belong would show up as an odd stanza out.
2. **`blocks = verses + 1` now holds for all five.** The collection's recordings follow a strict
   intro-plus-one-block-per-verse convention with no outro block — verified against clean 4-verse
   hymns that have nothing commented (0005, 0021, 0025, 0027 are all 5 blocks = intro + 4). Before
   the restoration none of the five satisfied it; after, all do. This also rules out the competing
   reading of 0277's five blocks as intro + 3 verses + outro, since no hymn in the collection has a
   separate outro block.

Do not read per-file `s/verse` against the global 48.0 s median as a check — it varies with stanza
length. 0277 sits at 34.1 s/verse because its stanzas are four short lines, not because a verse is
spurious; the block structure is the direct evidence.

### Still open

The remaining 17 hymns with commented-out verses (14 with irregular block structure, 3 with no
detectable gaps) need a listen rather than a measurement:

0002, 0006, 0024, 0070*, 0072, 0085, 0090, 0100, 0113, 0134, 0141, 0147, 0202, 0228, 0294, 1009,
1010, 1021 — (*0070 confirmed as correct, no action needed.)

## Regression guard

`tests/unit/content/singalongStoredShape.test.mjs` (vitest) asserts the contract over the live tree:
`verses` is `Array<Array<non-empty trimmed string>>`, number key matches the filename prefix, and no
`###`, bare `[Marker]`, HTML, null line, nested array, or Dropbox conflicted copy. `verses: []` is
allowed only for the eleven quiet-music pieces in an explicit `EMPTY_BY_DESIGN` allowlist, so a
song silently losing its lyrics fails rather than passing as "intentionally instrumental".

Verified both directions: passes on the repaired tree, and reports 174 problems when pointed at the
pre-fix backup via `DAYLIGHT_DATA_PATH`. It joins the `scripts/gate-vitest.mjs` population
automatically (any `tests/unit/**` file importing vitest).

## Guardrail worth adding

None of this would have shipped with a validator. A test over the singalong tree asserting
`verses` is `array<array<non-empty string>>` with no `###`, no `[...]` marker, and no HTML would
catch all nine categories, and it's cheap — the audit script above is already most of it.
