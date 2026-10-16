# plex.cli.mjs

Command-line tool for Plex library work: list libraries and their items, search,
fetch metadata, verify rating keys, edit metadata, manage collections, playlists
and posters, trigger scans, and audit/repair cover art. Many commands write to
Plex; most writing ones accept `--dry-run`. See `node cli/plex.cli.mjs --help`
for the full list (this page covers the most-used ones). Credentials setup is
under [Configuration](#configuration).

## Running it

From the project root:

```bash
node cli/plex.cli.mjs <command> [args] [flags]
```

Shorthand aliases are accepted for every command (shown in parens below).

## Commands

### `libraries` (alias: `libs`)

List all library sections with their keys, types, and agents.

```bash
node cli/plex.cli.mjs libraries
node cli/plex.cli.mjs libraries --json
```

### `search <query>` (alias: `s`)

Search one or all library sections by title.

```bash
# Shallow: top-level items (shows, movies, artists)
node cli/plex.cli.mjs search "yoga"

# Deep: hub search, includes episodes, tracks, etc.
node cli/plex.cli.mjs search "ninja warrior" --deep

# Limit to a specific library section
node cli/plex.cli.mjs search "ninja" --section 14

# Machine-readable output
node cli/plex.cli.mjs search "yoga" --json
node cli/plex.cli.mjs search "yoga" --ids-only
```

### `info <id>` (alias: `i`)

Show metadata for a specific rating key.

```bash
node cli/plex.cli.mjs info 673634
node cli/plex.cli.mjs info 673634 --json      # full Plex metadata object
```

### `verify <id> [id2…]` (alias: `v`)

Check whether one or more rating keys still exist in Plex. Handy for sanity-
checking references stored in YAML (media_memory, watchlists, etc.).

```bash
node cli/plex.cli.mjs verify 606037 11570 11571
node cli/plex.cli.mjs verify 606037 --json
```

Exit code is `0` even if some IDs are missing — check the output. Use `--json`
and parse `.[].exists` for scripting.

### `refresh (--section <id> | --path <folder> | --all)`

Ask Plex to scan a library section, or just one folder (the section is the library whose
location contains the folder). Requires exactly one target so it never triggers an accidental
full scan. `--dry-run` shows what would be scanned; `--json` prints `{"refreshed":[...],"dryRun":bool}`.

```bash
node cli/plex.cli.mjs refresh --path "/data/media/video/movies/Forrest Gump (1994)"
node cli/plex.cli.mjs refresh --section 6
```

`--force` adds `force=1` so the scanner re-reads files it would otherwise skip as "nothing has
changed" (a folder whose directory mtime didn't move, or one where a first pass hit read errors).

> **Music libraries and tags.** A scan only refreshes *file* info for tracks Plex already has.
> Embedded tags (artist, disc) are read once, when a track is first added, and are not re-read by
> `refresh`, `--force`, or `refresh-metadata` on libraries using the legacy "Personal Media" agent
> (`com.plexapp.agents.none`). To change them on existing tracks either write the field with `set`
> / `set-from-yaml` (artist is `originalTitle`; track number is `index`), or give the files new paths
> so Plex adds them fresh. Plex ignores `parentIndex` (disc) edits.

### `refresh-metadata <id> [id2…]` (alias: `refresh-meta`)

Ask Plex to refresh metadata for items and everything under them. `--dry-run` / `--json` supported.

```bash
node cli/plex.cli.mjs refresh-metadata 98390 --dry-run
```

### `leaves <id>`

List every track under an artist, album, show or season: rating key, title, album, album id,
artist field, and file path. Works at the **artist** level (not on a single album). Use `--json`
for the full list, e.g. to diff Plex against files on disk.

```bash
node cli/plex.cli.mjs leaves 98390 --json > nt-tracks.json
```

### `merge <primaryId> <dupId> [dupId…]`

Merge duplicate items into a primary (Plex "Merge"). Refuses unless every item has the same type,
title and parent. A scan that hits read errors can split an artist or album in two; merge the artist
first, then its duplicate albums.

```bash
node cli/plex.cli.mjs merge 98390 707769 --dry-run      # artist
node cli/plex.cli.mjs merge 532225 707770 707772        # albums
```

### `empty-trash --section <id>`

Remove "unavailable" items (files that no longer exist) from one library section. It clears
**every** unavailable item in that section, so check first that nothing is only temporarily
missing (NFS flicker). `--dry-run` / `--json` supported.

```bash
node cli/plex.cli.mjs empty-trash --section 19 --dry-run
```

### `seasons` / `albums` / `movies` `--section <id>`

Read-only listings of every season (in a show library), album (music library) or
movie (movie library) with its rating key. Default output is tab-separated, one
row per item, with a count on stderr; `--json` prints objects.

| Command | Columns |
|---------|---------|
| `seasons` | id, season index, show title, season title |
| `albums` | id, sort title, artist, album title |
| `movies` | id, year, studio, title |

```bash
node cli/plex.cli.mjs seasons --section 4
node cli/plex.cli.mjs albums --section 5 --json
```

### Cover art: `audit`, `rematch`, `select-thumbs`

All three take a scope: `section <id>`, `collection <id>`, `playlist <id>`,
`item <id>`, or `all` (every section, no id). `--depth 0|1|all` controls how far
to descend into children (artist→album→track, show→season→episode). Each item is
processed independently: a failed request is counted as an error and the run
continues, so one bad item can't abort a long sweep.

- **`audit <scope> <id>`** (read-only) reports items whose cover renders blank:
  no poster candidates, or a selected thumb that fails to load. Default depth 0.
  `--ids-only` prints just the rating keys, `--all-items` lists healthy items
  too, `--json` prints the report.
- **`rematch <scope> <id>`** asks the library agent for matches on items with no
  poster candidates and applies the best one scoring at least `--min-score`
  (default 85), so the agent fetches art. Lower scores are listed for manual
  review. `--force` also re-matches items that already have art. Default depth 0.
- **`select-thumbs <scope> <id>`** selects a poster candidate Plex already has
  for items with none selected (e.g. episodes whose extracted frames were never
  picked). It prefers local/embedded art, then agent art, then the middle frame.
  `--slot N` picks candidate N instead (items with fewer candidates are left
  alone), `--type episode` limits it to one item type, `--force` re-selects even
  when a poster is already selected. Default depth `all`.

`rematch` and `select-thumbs` accept `--dry-run`. Both exit non-zero if any item
errored.

```bash
node cli/plex.cli.mjs audit section 4 --depth 1 --ids-only
node cli/plex.cli.mjs rematch section 4 --dry-run
node cli/plex.cli.mjs select-thumbs item 1234 --type episode --slot 1 --force --dry-run
```

Requests time out after 30 s; reads are retried on network errors, timeouts,
5xx and 429.

## Flags

| Flag | Applies to | Effect |
|------|-----------|--------|
| `--json` | all | Print the raw JSON response |
| `--ids-only` | `search`, `audit` | Print only matching rating keys, one per line |
| `--deep` | `search` | Use hub search (catches episodes/tracks, not just top-level items) |
| `--section <id>` | `search`, `seasons`, `albums`, `movies`, `refresh`, `empty-trash` | Library section (see `libraries`) |
| `--dry-run` | write commands | Report what would change without calling Plex |
| `--depth 0\|1\|all` | `audit`, `rematch`, `select-thumbs` | How far to descend into children |
| `--all-items` | `audit` | Include healthy items in the report |
| `--min-score <n>` | `rematch` | Lowest agent match score to apply (default 85) |
| `--slot <n>` | `select-thumbs` | Select candidate n from the item's poster list |
| `--type <t>` | `select-thumbs` | Only act on items of this type |
| `--force` | `refresh`, `rematch`, `select-thumbs` | See each command above |

## Typical workflows

**Find an episode's rating key:**

```bash
node cli/plex.cli.mjs search "cold start" --deep --ids-only
```

**Verify a batch of IDs from a YAML file:**

```bash
grep -oE '[0-9]+' data/household/common/watchlist.yml \
  | sort -u \
  | xargs node cli/plex.cli.mjs verify --json \
  | jq '.[] | select(.exists | not) | .id'
```

**Read full metadata for debugging:**

```bash
node cli/plex.cli.mjs info 8744 --json | jq '.Media[].Part[].file'
```

## Configuration

The CLI is self-contained (no app server bootstrap):

1. **Token:** `PLEX_TOKEN`, else `token:` from `household/auth/plex.yml` in the
   data tree.
2. **Host:** `PLEX_HOST` (a base URL), else the `plex:` map in
   `system/config/services.yml`, keyed by `DAYLIGHT_ENV`, then the machine's
   hostname, then the fallback entries.

The data tree is `DAYLIGHT_DATA_PATH`, else `$DAYLIGHT_BASE_PATH/data`
(`DAYLIGHT_BASE_PATH` may come from the repo `.env`). If neither file is found
locally, the CLI tries reading it from the app container with `docker exec`.
Setting both `PLEX_TOKEN` and `PLEX_HOST` skips all file lookups.

## Playlists

Playlist editing is built in: see the `playlist` subcommands in `--help`
(`list`, `items`, `create`, `add`, `remove`, `set`, `rename`, `delete`). Removal
is by rating key; the CLI looks up each item's `playlistItemID` for you.
Media files are never touched; these commands only change playlist membership.
