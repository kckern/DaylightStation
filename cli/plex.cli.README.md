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
