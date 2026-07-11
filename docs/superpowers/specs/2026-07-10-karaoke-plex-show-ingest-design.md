# Karaoke Plex Show — Setlist-Driven yt-dlp Ingest

**Date:** 2026-07-10
**Status:** Approved design → ready for implementation plan

## Goal

Build out a Plex TV show named **Karaoke** (under `Slow TV/`) whose **seasons are
categories** and whose **episodes are individual karaoke songs**, ingested from YouTube
via `yt-dlp`. A curated setlist file drives everything; a CLI tool turns each setlist row
into a properly-named, Plex-ready `.mp4` with embedded metadata. The library grows over
time both by the user adding songs and by an opportunistic discovery step that harvests
sibling tracks from the same high-quality karaoke channels/playlists.

Curation (taste) and mechanics (download/transcode/name) are cleanly decoupled: the tool
never invents songs to download — it only processes rows in the setlist — but it *does*
propose candidate additions for human/agent review.

## Karaoke Style Profile (curation rubric)

Used by the discovery step and by the agent when promoting candidates. The show is a
crowd-pleasing sing-along collection.

**Include** — songs people love to *belt*:
- Big theatrical crooners & standards (Sinatra, Elvis, Etta James)
- Piano-driven singer-songwriter epics (Elton John, Billy Joel)
- Sweeping power ballads (70s–80s arena rock: Journey, Foreigner, Styx, Starship)
- Broadway & Disney showstoppers (Lloyd Webber, Menken)
- Deeply emotional torch/soul ballads (Adele, Unchained Melody)
- Anthems of hope & resilience (Hey Jude, Bridge Over Troubled Water, You'll Never Walk Alone)
- Universal pub/crowd sing-alongs (Sweet Caroline, Friends in Low Places)
- Nostalgic pop throwbacks that are fun to sing (Gwen Stefani "Cool", Viva la Vida)

Common thread: strong melody, big/emotional/triumphant chorus, broadly known, works
stripped to a backing track.

**Exclude:** rap/hip-hop-forward, heavy/screamo, obscure deep cuts, novelty songs, tracks
that don't work as karaoke, explicit material.

## Architecture — three phases

### Phase A — Setlist (source of truth, editorial)

A single TSV the user edits (spreadsheet-friendly), stored **on the media mount** next to
the show:

```
/media/kckern/Media/Slow TV/Karaoke/setlist.tsv
```

Columns:

| Column | Meaning |
|--------|---------|
| `season` | Season number (category). Drives `SxxExx`. |
| `artist` | Performer / source (for search + title). |
| `song` | Song title (for search + title). |
| `search_hint` | Optional extra query terms or a pinned `youtube.com/watch?v=…` URL to force a specific video. |
| `status` | `pending` → `downloaded` / `failed`. |
| `video_id` | Filled by the tool: the YouTube id it actually grabbed (audit + re-pick handle). |

The tool reads and rewrites this file (updating `status`/`video_id`). Clearing `video_id`
and setting `status=pending` forces a re-pick. A separate `season_map.tsv` (or a header
block) maps season number → season name.

The existing freeform `ultimate_theatrical_karaoke_setlist.tsv` is the seed; a one-time
conversion produces the structured `setlist.tsv` using the refined season scheme below.

### Phase B — Ingest CLI (mechanical, idempotent)

For each `pending` row (and where the output file is absent):

1. **Build query.** `"{song} {artist} karaoke"`, or use `search_hint`/pinned URL when present.
2. **Search.** `yt-dlp "ytsearchN:<query>" -J --flat-playlist` (N ≈ 12) → candidate list with
   `id`, `title`, `channel`, `view_count`, `duration`.
3. **Rank & pick** (pure function — unit-tested; see algorithm below).
4. **Download.** `yt-dlp` best video+audio, merged to `.mp4`, preferring H.264/AAC ≤1080p so
   Plex direct-plays. Remux/transcode via `ffmpeg` only if the container/codecs aren't
   Plex-friendly.
5. **Embed metadata.** Container `title` = `"{song} ({artist})"`, `comment`/`description` =
   source channel + original video title + `Category: {season name}`.
6. **Name & place.** `Karaoke - S{season:02}E{episode:02} - {song} ({artist}).mp4` in the show
   root (flat layout, matching sibling Slow TV shows). Episode number = next sequential slot
   within that season.
7. **Record.** Update the row: `status=downloaded`, `video_id=<id>`.
8. **Refresh Plex** (batch, after the run): trigger a targeted scan of the Slow TV library
   section so new episodes appear.

Re-running is safe: `downloaded` rows with an existing file are skipped. `--force` re-does a row.

### Phase C — Discovery / expansion (proposes, never auto-adds)

After (or on demand), for the channels/playlists that produced good matches:

1. `yt-dlp --flat-playlist -J` the channel's uploads / the source playlist.
2. Filter to karaoke-style tracks (title contains karaoke/instrumental, sane duration) not
   already in the setlist.
3. Guess `artist`/`song` from the title, capture `view_count`, `channel`, `url`.
4. Write to `candidates.tsv` (never the setlist directly).

The user — or the agent applying the Style Profile — reviews `candidates.tsv`, assigns a
season, and promotes chosen rows into `setlist.tsv` as `pending`. Next `ingest` run picks
them up. Taste stays a human/agent decision; the CLI only surfaces options.

## Ranking algorithm (pure, unit-tested)

Input: list of candidate `{id, title, channel, view_count, duration}`. Output: chosen
candidate or `null` (no acceptable match → mark row `failed`).

Score each candidate:
- **Hard filter (drop):** title lacks "karaoke"/"instrumental" signal; or matches
  reject terms (`reaction`, `tutorial`, `how to`, `cover` when not karaoke, `live`,
  `lesson`); or duration outside ~1.5–8 min.
- **Song/artist match:** require the song title tokens to appear in the video title
  (fuzzy, case/punctuation-insensitive); bonus if artist also present.
- **Channel quality bonus:** soft bonus for known HQ karaoke channels (configurable
  allowlist, e.g. Sing King, KaraFun, Stingray Karaoke, ZZang, Karafun). Not required —
  "no need to stick to a single channel."
- **Popularity:** primary tiebreak = higher `view_count` (log-scaled).
- Prefer instrumental-with-on-screen-lyrics phrasing when detectable, but view
  count/quality wins when the popular version differs.

Pick the highest score above a floor; else `null`.

## Configuration

Small module/YAML (co-located with the CLI): media path, show name, channel allowlist +
weights, reject terms, search N, duration bounds, score floor, `yt-dlp`/`ffmpeg` format
selectors. No secrets required for public YouTube search.

## CLI

Lives in the repo's `cli/` convention: `cli/karaoke-ingest.cli.mjs` + a `cli/karaoke-ingest/`
module (parser, ranker, downloader, discovery, plex-refresh — each independently testable).
Node ESM, shells out to `yt-dlp`/`ffmpeg` (argv arrays, never shell-interpolated — mirrors
`YtDlpAdapter` security note). Subcommands:

- `ingest [--season N] [--limit N] [--force] [--dry-run]` — process pending rows.
- `discover [--season N] [--limit N]` — harvest sibling candidates → `candidates.tsv`.
- `plan` / `--dry-run` — print planned picks + filenames without downloading.
- `refresh-plex` — trigger the Slow TV section scan.
- `convert-seed` — one-time: seed TSV → structured `setlist.tsv` under the refined seasons.

## Season scheme (refined seed — editable in the setlist)

| S | Season | Seed members |
|---|--------|--------------|
| 01 | Crooners & Standards | Sinatra, Elvis, Louis Armstrong, Etta James, Ben E. King, Righteous Brothers |
| 02 | Piano Men | Elton John, Billy Joel |
| 03 | Stage & Screen | Lloyd Webber, Menken, Disney, Newsies |
| 04 | Emotional Ballads | Adele, Make You Feel My Love, At Last, Unchained Melody |
| 05 | Arena Power Ballads | Journey, Foreigner, REO Speedwagon, Styx, Nothing's Gonna Stop Us Now |
| 06 | Epic Anthems | Queen, Purple Rain, Fix You, Viva la Vida |
| 07 | Anthems of Hope | You'll Never Walk Alone, Bridge Over Troubled Water, Lean on Me, Hey Jude, Let It Be |
| 08 | Sing-Along Crowd-Pleasers | Sweet Caroline, Friends in Low Places, Born to Run, Walking in Memphis |
| 09 | Pop Throwbacks | Gwen Stefani "Cool", + future modern pop |

## Error handling

- No acceptable match → `status=failed`, logged with the attempted query; run continues.
- Download/transcode failure → `failed` (leave `video_id` for debugging), continue.
- Partial/temp files written to a temp name; renamed to the final Plex name only on success
  (no half-written episodes visible to Plex).
- yt-dlp/network flakiness → bounded retries (reuse `YtDlpAdapter` retry posture).

## Testing

- **Ranker** (pure): candidate fixtures → expected pick, incl. reject-term drops, duration
  bounds, channel bonus, view tiebreak, "no match → null".
- **Filename builder:** season/episode/song/artist → exact Plex string; special chars
  sanitized.
- **Setlist parser/serializer:** round-trip; status/video_id updates preserve other columns.
- **Query builder:** row + hint/pinned-URL → argv.
- **Integration (`--dry-run`):** end-to-end plan with `yt-dlp` mocked; no network, no writes
  to the media tree.

## Out of scope (v1) / phase 2

- **Season & show posters** (`poster.jpg`, `Season 0X.jpg`). Reuse existing Slow TV poster
  conventions later.
- **Auto re-pick** of low-confidence matches — v1 marks `failed` for manual attention.
- Non-YouTube sources.

## Open items

- Season names/splits are a starting draft — expected to shift as the setlist grows.
- Plex refresh mechanism (section id + token from the data volume) to be confirmed against
  the running Plex during implementation.
