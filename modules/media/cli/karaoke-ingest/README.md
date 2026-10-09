# karaoke-ingest

Builds the **Karaoke** Plex show (`Slow TV/Karaoke/`) from a curated setlist.
Seasons = categories, episodes = songs. See the design spec:
`docs/superpowers/specs/2026-07-10-karaoke-plex-show-ingest-design.md`.

## Setlist

`setlist.tsv` (on the media mount) is the source of truth:

    season  episode  artist  song  search_hint  status  video_id

- `episode` / `video_id` are tool-managed. `status`: `pending` → `downloaded` / `failed`.
- `search_hint`: extra query terms, or a full `youtube.com/watch?v=…` URL to pin a video.
- Season names come from `config.mjs` `SEASONS`.

## Commands

    node cli/karaoke-ingest.cli.mjs convert-seed --dry-run   # preview seed → setlist
    node cli/karaoke-ingest.cli.mjs plan                     # dry-run: what would download
    node cli/karaoke-ingest.cli.mjs ingest --limit 5         # download 5 pending
    node cli/karaoke-ingest.cli.mjs discover --limit 3       # harvest siblings → candidates.tsv
    node cli/karaoke-ingest.cli.mjs refresh-plex --section <id> --token <tkn>

Re-runs skip `downloaded` rows with an existing file; `--force` re-does them.
Curate `candidates.tsv` by hand into `setlist.tsv` using the style profile in the spec.
