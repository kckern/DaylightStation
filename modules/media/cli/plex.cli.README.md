# plex.cli.mjs

Command-line tool for Plex library inspection: list libraries, search for items,
fetch metadata, and verify rating keys exist. Reads Plex credentials from
household auth (`data/household/auth/plex.yml`) via `ConfigService` — no extra
setup needed when running on a host that has the data volume mounted.

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

## Flags

| Flag | Applies to | Effect |
|------|-----------|--------|
| `--json` | all | Print the raw JSON response |
| `--ids-only` | `search` | Print only matching rating keys, one per line |
| `--deep` | `search` | Use hub search (catches episodes/tracks, not just top-level items) |
| `--section <id>` | `search` | Limit to a single library section (see `libraries`) |

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

Auth is resolved by `ConfigService.getHouseholdAuth('plex')`, which reads
`data/household/auth/plex.yml` (must contain `token:`). The server URL comes
from either:

1. `auth.server_url` in the same file, or
2. `process.env.plex.host` / `process.env.plex.port`

On the prod host, the server is `http://plex:32400` (internal docker network).

## What this CLI does *not* do

**Playlist mutation is not in the CLI yet.** `plex.cli.mjs` is read-only. For
surgical playlist editing (remove one item, add items, reorder), use the app's
Plex proxy directly — it passes through every HTTP method to Plex with the
server's credentials already attached:

```bash
# List items in a playlist (each item has a `playlistItemID`)
curl -s "http://localhost:3111/api/v1/proxy/plex/playlists/<playlistId>/items" \
     -H "Accept: application/json" \
  | jq '.MediaContainer.Metadata[] | {playlistItemID, ratingKey, title, grandparentTitle}'

# Remove one item (uses playlistItemID, NOT ratingKey)
curl -s -X DELETE \
  "http://localhost:3111/api/v1/proxy/plex/playlists/<playlistId>/items/<playlistItemID>"

# Add items (URI format: server://<machineId>/com.plexapp.plugins.library/library/metadata/<ratingKeys>)
curl -s -X PUT \
  "http://localhost:3111/api/v1/proxy/plex/playlists/<playlistId>/items?uri=<urlEncodedUri>"

# Move an item (omit `after` to move to top)
curl -s -X PUT \
  "http://localhost:3111/api/v1/proxy/plex/playlists/<playlistId>/items/<playlistItemID>/move?after=<targetItemID>"
```

The gotcha: **removes target `playlistItemID`, not `ratingKey`**. The same
media item can appear in many playlists; each appearance has its own
`playlistItemID`. Look it up via the items list above before calling DELETE.

Media files are never touched — these endpoints only modify playlist membership.
