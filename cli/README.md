# dscli — DaylightStation CLI

Single-binary CLI exposing DaylightStation skills and services as composable shell subcommands. Built for AI coding agents, shell users, and ad-hoc automation. JSON-first output. No backend startup needed for most commands (direct-import application services).

See `docs/superpowers/specs/2026-05-02-dscli-design.md` for the full design.

## Card Game readiness

`piano-card-game.cli.mjs` is the live acceptance harness for the Pokémon piano card game. It
validates the deployed definition and corpus assets, then plays a complete battle through the
same MIDI bridge frames used by the PianoKiosk:

```bash
npm run piano:card-game:verify
node cli/piano-card-game.cli.mjs --headed --screenshot /tmp/card-game.png
```

## Usage

```bash
# Top-level help
dscli --help
dscli <subcommand> --help

# System
dscli system health
dscli system config devices

# Home Assistant
dscli ha state light.office_main
dscli ha list-devices --domain light --area office
dscli ha list-areas
dscli ha resolve "office main"

# Content
dscli content search "workout playlist" --take 5
dscli content resolve plex:642120
dscli content list-libraries

# Memory
dscli memory get notes
dscli memory list

# Finance
dscli finance accounts
dscli finance balance Fidelity
dscli finance transactions --from 2026-04-01 --to 2026-04-30 --tag Groceries
dscli finance accounts --direct  # bypass app server, hit Buxfer directly

# Concierge agent inspection (read-only)
dscli concierge satellites
dscli concierge transcripts --days 3
dscli concierge transcripts --satellite office
dscli concierge transcript <id>

# Write commands (require --allow-write per invocation)
dscli ha toggle "office main" on --allow-write
dscli ha call-service light turn_on light.office_main --data '{"brightness":128}' --allow-write
dscli memory write notes "remember to call dad" --allow-write
dscli memory delete notes --allow-write
dscli finance refresh --allow-write
dscli system reload --allow-write
dscli system reload --app concierge --allow-write
dscli content play plex:642120 --to livingroom-tv --shader dark --allow-write
```

All commands return JSON to stdout on success (exit 0) and a JSON error envelope to stderr on failure (exit 1+). Pipe to `jq` for reshaping.

## Write commands and policy

State-changing commands require the `--allow-write` flag on every invocation. Without it the command exits 2 with `{error: 'allow_write_required', command, message}`. This is a deliberate friction surface — agents and humans must explicitly opt into mutation per command.

Each successful write is appended as a JSON line to `data/household/cli-transcripts/YYYY-MM-DD.ndjson` (or `/tmp/dscli-cli-transcripts/` when the data path is unwritable, e.g. on dev hosts where the volume is Docker-owned). Sensitive arg keys (`token`, `password`, `apiKey`, `authorization`) are redacted in the audit entry.

```bash
# Read — works without --allow-write
dscli ha state light.office_main

# Write — needs --allow-write
dscli ha toggle light.office_main on --allow-write

# Inspect today's audit log
cat data/household/cli-transcripts/$(date -u +%Y-%m-%d).ndjson | jq .
# (or /tmp/dscli-cli-transcripts/ if running outside the container)
```

The CLI satellite identity (`id: cli`) lives in `data/household/config/concierge.yml.satellites`. Adjust `scopes_allowed` there to grant or revoke access; the CLI inherits whatever's listed.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, JSON to stdout |
| 1 | Operation failed (not found, denied) |
| 2 | Usage error (unknown subcommand, missing arg) |
| 3 | Config error (missing auth, dataDir not set) |
| 4 | Backend not reachable (only for commands that need the running backend) |

## Environment

| Variable | Purpose |
|---|---|
| `DAYLIGHT_BASE_PATH` | Path containing `data/` and `media/` (required for service-backed commands) |
| `DSCLI_BACKEND_URL` | Override backend base URL for `system health` etc. (default `http://localhost:3111`) |
| `BUXFER_EMAIL` / `BUXFER_PASSWORD` | Used by `dscli finance --direct` when set (no docker exec needed) |

## Installation

### Inside the project (dev/local)

```bash
node cli/dscli.mjs <subcommand> ...
# OR after npm install:
npx dscli <subcommand> ...
```

### Host-wide (prod host with Docker)

If `dscli` should be callable from anywhere on the host (and the data volume isn't readable as the current user — typical on the prod host), install the wrapper that exec's into the container:

```bash
sudo sh cli/scripts/install-host-wrapper.sh
dscli --help
```

The wrapper is a one-line `exec sudo docker exec -i daylight-station node /usr/src/app/cli/dscli.mjs "$@"`. It assumes `docker exec daylight-station` is sudo-allowed (see `/etc/sudoers.d/claude` on prod hosts).

## Concierge transcripts

The concierge agent writes one JSON transcript per request to `{mediaDir}/logs/concierge/YYYY-MM-DD/{satellite}/{ts}-{reqid}.json`. Inspect them with:

```bash
# List recent transcripts (default last 7 days)
dscli concierge transcripts --days 3 --satellite office | jq '.transcripts[].id'

# Dump one (recursive scan finds the most recent matching id)
dscli concierge transcript <id> | jq .
```

The full `concierge ask` (streaming agent invocation from the shell) is intentionally deferred — it requires `DAYLIGHT_BRAIN_TOKEN_<ID>` env vars to be provisioned for each satellite identity. Once those are in place, the streaming command can be added with the same Bearer-auth path the voice satellites use.

## Adding a new command

1. Create `cli/commands/<name>.mjs` exporting `default { name, description, requiresBackend, run(args, deps) }`.
2. Add the name to `KNOWN_SUBCOMMANDS` in `cli/dscli.mjs`.
3. If the command needs an application service, add a memoized factory to `cli/_bootstrap.mjs` and expose it via the `deps` bag in `cli/dscli.mjs`.
4. Add `tests/unit/cli/commands/<name>.test.mjs` following the `system.test.mjs` pattern (in-process, fake deps).

## Existing CLI tools

### Scripture

Scripture work has two distinct sources. Choose deliberately:

1. **DaylightStation readalong corpus** — authoritative text for content
   authoring in this repository. For the NIrV, read the chapter YAML directly
   from:

   ```text
   {dataDir}/content/readalong/scripture/{ot,nt}/nirv/
   ```

   Filenames are `<first-verse-id>-<book-slug>-<chapter>.yml`; for example,
   `17656-isaiah-1.yml`. Each row contains the canonical `verse_id`, printed
   verse number, formatting metadata, and exact translation text. Do not write
   a prompt or correct answer from memory: open this file and copy the
   answer-bearing phrase from its `text` field.

2. **Scripture database client** — the reusable lookup/search design in the
   sibling BoMOnlineWorkspace checkout:

   ```text
   ../BoMOnlineWorkspace/cli/scripture-client.mjs
   ```

   This is a MySQL-backed module, not a DaylightStation runtime dependency. It
   is the reference implementation for a general scripture client: reference
   parsing through `scripture-guide`, verse-id lookup, translation selection,
   text search, reference detection, and output sanitization.

#### Reading exact NIrV text

Set the data root once, then resolve the chapter by filename rather than
assuming its leading verse id:

```bash
SCRIPTURE_ROOT="$DAYLIGHT_BASE_PATH/data/content/readalong/scripture"
rg --files "$SCRIPTURE_ROOT/ot/nirv" | rg '/[0-9]+-isaiah-1\.yml$'
sed -n '1,120p' "$SCRIPTURE_ROOT/ot/nirv/17656-isaiah-1.yml"
```

The corpus preserves editorial layout markers such as `§`, `¶`, `▼`, and
`/_`. They are useful to renderers but are not part of an answer. Strip them
only for comparison or display; never silently paraphrase the underlying
words.

For course worksheets, the correct answer must be a contiguous phrase in the
cited verse or verse range. Distractors are authored, but must:

- be plausible members of the answer's category;
- not occur anywhere in that lesson's assigned reading;
- not repeat another answer or distractor in the lesson; and
- never encode a fixed answer position, because worksheet issuance shuffles
  choices.

#### Using the database client reference

The reference client exports functions rather than a command-line dispatcher:

| Export | Purpose |
|---|---|
| `lookup({ ref, version })` | Resolve an English reference and return verses |
| `lookupIds({ verseIds, version })` | Fetch canonical verse ids directly |
| `search({ query, version, book, volume })` | Search translation text |
| `detect(text)` | Find scripture references embedded in prose |
| `listVersions({ lang, volume })` | Inspect available translations |
| `closeConnection()` | Close the cached MySQL connection |

It reads `MYSQL_HOST`, `MYSQL_PORT2`/`MYSQL_PORT`,
`MYSQL_USER2`/`MYSQL_USER`, `MYSQL_PASSWORD2`/`MYSQL_PASSWORD`, and optionally
`SCRIPTURE_DB` (default `scripture.guide`). Example:

```js
import {
  lookup,
  search,
  closeConnection,
} from '../../BoMOnlineWorkspace/cli/scripture-client.mjs';

const passage = await lookup({ ref: 'Isaiah 1:16-18', version: 'NIRV' });
const matches = await search({ query: 'new heart', version: 'NIRV', book: 'Ezekiel' });
await closeConnection();
```

Use the database client for discovery and cross-version searches. Use the
checked-in/YAML readalong corpus as the final authority when authoring
DaylightStation content, so validation is reproducible without a database.

#### Printed-page tools

The NIrV text does not contain physical page numbers. Those belong to the
specific *NIrV Adventure Bible for Early Readers* printing and live in:

```text
{dataDir}/content/school/scripture/nirv-adventure-early-readers/page-index.yml
```

Available commands:

```bash
# Resolve references found in prose to printed pages
node cli/bible-lesson-pages.mjs "Isaiah 1:16-18 and Isaiah 2:2-4"

# Verify the complete physical page index against the NIrV corpus
NIRV_CORPUS="$DAYLIGHT_BASE_PATH/data/content/readalong/scripture" \
  node cli/bible-page-index-verify.mjs --verbose

# Typeset a printable chapter-to-page index
node cli/bible-page-index-pdf.mjs /tmp/nirv-page-index.pdf
```

Override the default edition index with `PAGE_INDEX=/path/to/page-index.yml`.

#### Worksheet authoring check

Course lessons use the worksheet pipeline:

```bash
DATA_DIR="$DAYLIGHT_BASE_PATH/data"

node cli/school.mjs worksheet validate \
  scripture/come-follow-me-ot-2026/<lesson-slug> \
  --data-dir "$DATA_DIR"

node cli/school.mjs worksheet issue \
  scripture/come-follow-me-ot-2026/<lesson-slug> \
  --data-dir "$DATA_DIR" --profile lower --seed review

node cli/school.mjs worksheet render \
  scripture/come-follow-me-ot-2026/<lesson-slug> \
  --data-dir "$DATA_DIR" --profile upper --seed review \
  --learner preview --learner-name Preview --out /tmp/scripture-review.pdf
```

`validate` proves the schema can issue both learner profiles. It does **not**
prove that questions are faithful, answers are extractive, or distractors are
pedagogically sound; those require a source-text audit and human review.

#### Decoy audit

`node cli/school.mjs decoys audit <subject/course>` is the read-only release
gate for answer/decoy length cues. It treats one question (not each of its
decoys) as the paired observation, uses deterministic two-sided sign
permutations, and reports every correct option that is at least 25% longer than
its longest decoy. A course passes only when both word and character tests have
`p >= 0.05`, neither unique-correct-longest rate exceeds 40%, and all banks
parse. Run with `--trials 200000` before approval; `all` defaults to 20,000 for
faster discovery. `decoys verify <subject/course>` also checks that the staged
`decoy-audit.yml` fingerprint matches the live choice pools.

### `cli/gaming-assets.cli.mjs`

Private game-art audit and preview tool for `media/games/_common`. It inventories PNG source facts and hashes, validates curated YAML manifests, renders categorized contact-sheet PNGs, creates frame-animation GIFs, and renders small YAML composition previews without starting the frontend.

```bash
npm run gaming:assets -- inventory --out /tmp/gaming-inventory.yml
npm run gaming:assets -- sheet --out /tmp/gaming-sheet.png --source sprites/Cute_Fantasy/Tiles
npm run gaming:assets -- frames --source assets/default/actors/npcs/premade/farmer-bob.png --cell 16x32 --out /tmp/farmer-grid.png
npm run gaming:assets -- organize-plan --source sprites --target assets --out /tmp/gaming-organization.yml
npm run gaming:assets -- validate --manifest /path/to/pack.yml
```

`sprites/` is retained as raw vendor provenance; `organize-apply` creates a collision-checked canonical `assets/` tree rather than renaming it. See [gaming-assets/README.md](gaming-assets/README.md) for the catalog format, animation, composition-preview, migration, and safety details.

`cli/buxfer.cli.mjs` is the original Buxfer-direct CLI; it stays as-is for now and will eventually be folded into `dscli finance --direct`.

### `cli/fitness.cli.mjs`

One entry point for every fitness session and Strava operation. It replaced thirteen
standalone scripts (`heal-fitness-sessions.cli.mjs`, `merge-fitness-sessions.cli.mjs`,
`strava.cli.mjs`, the `backfill-*` family, …) that each carried their own bootstrap, their
own argv parser, and — three times over — their own copy of the Strava OAuth refresh logic.

```bash
node cli/fitness.cli.mjs                          # groups and commands
node cli/fitness.cli.mjs <group>                  # one group's commands
node cli/fitness.cli.mjs <group> <cmd> --help     # full usage for one command
```

| Group | Covers |
|-------|--------|
| `session` | surgery on stored session YAML: `scan`, `heal`, `merge`, `split`, `reconstruct` |
| `media` | linking sessions to what was playing: `enrich-plex`, `backfill-memory`, `backfill-primary` |
| `strava` | API CRUD (`me`, `list`, `get`, `update`, `delete`, `create`, `streams`, `token`, `refresh`) plus reconciliation (`match-home`, `backfill-calories`, `backfill-enrichment`, `push`) |

A bare command name works when it is unique across groups, so `fitness.cli.mjs heal …` and
`fitness.cli.mjs session heal …` are equivalent.

**Every mutating command is dry-run by default** — pass `--write` or `--apply` (per the
command's own help) to commit. `session merge` is the exception worth knowing: it writes and
deletes source files, so preview it with `--dry-run` first.

Commands live in `cli/lib/fitness/`, one module per operation, each exporting
`{ spec, run(argv, ctx) }`. To add one:

1. Create `cli/lib/fitness/<name>.mjs` with a `spec` (`name`, `summary`, `usage`, `details`)
   and an `async run(argv, ctx)`.
2. Register it in the `GROUPS` map in `cli/fitness.cli.mjs`.
3. Parse flags with `parseArgs` from `./argv.mjs`; take paths and YAML helpers from `ctx`
   (never re-derive `baseDir` or call `dotenv.config()`); throw `CliError` instead of
   calling `process.exit()`.
4. Keep module import **side-effect free** — the dispatcher imports every module just to
   build help text, so all work belongs inside `run()`.
