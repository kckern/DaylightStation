# dscli — DaylightStation CLI

Single-binary CLI exposing DaylightStation skills and services as composable shell subcommands. Built for AI coding agents, shell users, and ad-hoc automation. JSON-first output. No backend startup needed for most commands (direct-import application services).

See `docs/superpowers/specs/2026-05-02-dscli-design.md` for the full design.

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

# Write commands (require --allow-write per invocation)
dscli ha toggle "office main" on --allow-write
dscli ha call-service light turn_on light.office_main --data '{"brightness":128}' --allow-write
dscli memory write notes "remember to call dad" --allow-write
dscli memory delete notes --allow-write
dscli finance refresh --allow-write
dscli system reload --allow-write
dscli system reload --app concierge --allow-write
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

## Adding a new command

1. Create `cli/commands/<name>.mjs` exporting `default { name, description, requiresBackend, run(args, deps) }`.
2. Add the name to `KNOWN_SUBCOMMANDS` in `cli/dscli.mjs`.
3. If the command needs an application service, add a memoized factory to `cli/_bootstrap.mjs` and expose it via the `deps` bag in `cli/dscli.mjs`.
4. Add `tests/unit/cli/commands/<name>.test.mjs` following the `system.test.mjs` pattern (in-process, fake deps).

## Existing CLI tools

`cli/buxfer.cli.mjs` is the original Buxfer-direct CLI; it stays as-is for now and will eventually be folded into `dscli finance --direct`.
