# dscli — DaylightStation CLI Design

**Date:** 2026-05-02
**Status:** Spec — review before plan
**Related:** [docs/_wip/audits/2026-05-02-concierge-agentic-architecture-audit.md](../../_wip/audits/2026-05-02-concierge-agentic-architecture-audit.md) Part 12

---

## Goal

A single `dscli` command that exposes DaylightStation skills and services as composable shell subcommands. Built so AI coding agents (Claude Code, mastracode), shell users, and ad-hoc automation can drive the same domain logic that powers voice satellites — without going through HTTP, without the backend running, with first-class JSON output.

---

## Why this exists

Today the DS backend is consumable in two ways:

1. **HTTP API** — `/api/v1/*` and `/v1/chat/completions`. Designed for HA Voice satellites and the frontend. Heavy: requires the backend running, OpenAI-compat envelope, bearer auth.
2. **Direct external API** — `cli/buxfer.cli.mjs` bypasses the backend and talks straight to Buxfer. Self-contained but only works for commands where DS adds no value beyond the external API.

Neither path is good for an AI coding agent that wants to introspect or operate the household:
- HTTP requires bringing up the server, then translating natural language → API calls
- Direct external API loses our domain logic (policy, caching, composition)

A CLI fixes both. Subcommands map to skills/services. Output is structured (JSON), composable (`| jq`, `| grep`), discoverable (`--help`). Token-efficient for agent consumption — no schema preloaded into context, just standard shell idioms LLMs already know.

The AI-agent tradeoff is settled in the literature: **CLIs win the inner loop, MCP wins the outer loop**. DS is inner-loop work (interactive, fast iteration, single-household scope). CLI-first is the right shape.

---

## Non-goals

- **Not an MCP server.** No persistent connection, no schema preload. We may add MCP later for specific outer-loop integrations; this isn't it.
- **Not a replacement for the HTTP API.** Voice satellites keep using `/v1/chat/completions`. The frontend keeps using `/api/v1/*`. CLI is an additional adapter, not a substitute.
- **Not a TUI.** No interactive prompts, no curses, no live UI. Pure stdin/stdout/stderr. Shell-composable.
- **Not a replacement for `cli/buxfer.cli.mjs` immediately.** That pattern (self-contained external API access) stays valid for some cases. We'll fold it in over time.

---

## Architecture

### DDD shape

The CLI is a new adapter in DDD terms. It sits at the same layer as the HTTP routers (`4_api/v1/routers/*`) but with a different transport:

```
                   ┌─── 4_api/v1/routers/ ──── HTTP / OpenAI-compat ─── voice satellites, frontend
3_applications ────┤
                   └─── cli/dscli.mjs ─────── shell subcommands ─────── agents, shell, automation
```

Both adapters call the same application services (`ContentQueryService`, `IHomeAutomationGateway`, etc.) using the same composition root primitives.

### Direct-import (option 3 from the audit discussion)

CLI subcommands construct only the application services they need, importing them directly via the `#applications/...` and `#adapters/...` path aliases that already exist in `package.json` `imports`. No HTTP hop, no need for the backend to be running.

This works because our DDD discipline already separates application logic from transport:

- `ContentQueryService` doesn't know it's being called from HTTP — it's a service
- `IHomeAutomationGateway` is an interface; both HTTP and CLI hand it the same `HomeAssistantAdapter` implementation
- ConfigService, DataService, the YAML adapters — all reusable

### Lazy bootstrap per subcommand

A naïve approach would bootstrap the entire app per CLI invocation (calling `createConciergeServices` etc.). That's slow and brittle. Instead, each subcommand file constructs the minimum service tree for its command:

- `dscli ha state X` → only ConfigService + HomeAssistantAdapter
- `dscli content search "X"` → only ConfigService + ContentRegistry + ContentQueryService
- `dscli concierge ask "X"` → falls through to the running backend's HTTP API (the only command that needs the full agent stack)

A small `_bootstrap.mjs` file exposes named factories: `buildConfigService()`, `buildHaGateway()`, `buildContentQuery()`, etc. Each subcommand calls only what it needs.

---

## File structure

```
cli/
├── dscli.mjs                    # entry: parses subcommand, dispatches to commands/<name>.mjs
├── _bootstrap.mjs               # lazy named factories (buildConfigService, buildHaGateway, ...)
├── _output.mjs                  # output helpers (json, table, error)
├── _argv.mjs                    # tiny arg parser (subcommand, --flags, positional)
├── commands/
│   ├── content.mjs              # content search / play / resolve / list-libraries
│   ├── ha.mjs                   # ha state / toggle / list-areas / list-devices / call-service
│   ├── memory.mjs               # memory get / write / list / delete
│   ├── finance.mjs              # finance balance / transactions / refresh / accounts
│   ├── calendar.mjs             # calendar today / upcoming / between
│   ├── concierge.mjs            # concierge ask / transcript / replay / satellites
│   └── system.mjs               # system config / reload / health
├── buxfer.cli.mjs               # EXISTING — self-contained Buxfer-direct (kept as-is for now)
└── README.md                    # usage docs (optional but nice)
```

`dscli.mjs` resolves the subcommand and dynamically imports `commands/<subcommand>.mjs`. Dynamic import keeps startup time scoped — `dscli ha state X` doesn't pay the import cost of the finance command.

### Why a single entry vs separate scripts

A single `dscli` entry with subcommands matches `git`, `kubectl`, `docker`, `gh` — it's the convention agents and humans both expect. `dscli --help` lists all subcommands; `dscli ha --help` lists all ha-domain commands. Discoverability is built in.

Separate scripts (`dscli-ha`, `dscli-content`) work too, but discovery becomes brittle (which scripts exist? which has --help?).

---

## Subcommand catalog (v1)

Each subcommand returns JSON by default. `--format text` flips to human-readable. All commands accept `--help`.

### content

```bash
dscli content search "workout playlist" [--source plex] [--take 5]
dscli content resolve plex:642120
dscli content play plex:642120 --to livingroom-tv [--enqueue play|add] [--shader dark]
dscli content list-libraries [--source plex]
```

Backed by `ContentQueryService` + `ContentRegistry`. The `play` subcommand requires the backend to be running because it uses the HA gateway to actually start playback on a device — but `search` / `resolve` / `list-libraries` don't.

### ha

```bash
dscli ha state light.office_main
dscli ha toggle "office lights" on
dscli ha list-areas
dscli ha list-devices [--area kitchen] [--domain light]
dscli ha call-service light turn_on light.office_main [--data '{"brightness":128}']
dscli ha resolve "big room lights"   # name → entity_id via friendly_name_aliases + fuzzy
```

Backed by `HomeAssistantAdapter`. Auth pulled from `data/household/auth/homeassistant.yml` via the same path the backend uses.

### memory

```bash
dscli memory get notes
dscli memory get preferences --key dietary
dscli memory write notes "remember to call dad tomorrow"
dscli memory list
dscli memory delete notes <id>
```

Backed by `YamlConciergeMemoryAdapter`. Read/write the same store the concierge uses — useful for seeding preferences from the shell, dumping memory state for debugging.

### finance

```bash
dscli finance balance Fidelity
dscli finance balances [--refresh]
dscli finance transactions --from 2026-01-01 --to 2026-03-01 [--account Fidelity]
dscli finance refresh
dscli finance accounts
```

Two flavors: `--direct` flag uses the existing Buxfer-direct pattern (no backend), default uses `BuxferAdapter` via the application service (with our caching + categorization). Subsumes `cli/buxfer.cli.mjs` over time.

### calendar

```bash
dscli calendar today
dscli calendar upcoming [--days 7]
dscli calendar between 2026-05-01 2026-05-31
```

Backed by whatever calendar adapter ships first (currently a stub).

### concierge

```bash
dscli concierge ask "play workout playlist" [--as office]
dscli concierge transcript <conversation_id>   # dump the JSON transcript file
dscli concierge replay <conversation_id>       # re-run the same input through current code
dscli concierge satellites                      # list configured satellites
```

`ask` is the killer subcommand. It hits the running backend's `/v1/chat/completions` (this one IS HTTP-fronting because the agent stack is heavy and stateful) with a CLI satellite identity (or `--as office` to impersonate). Streaming output to stdout. Tool calls + responses both visible.

`transcript` and `replay` operate on the JSON files our `ConciergeTranscript` writes. `replay` is invaluable for regression testing and debugging — same input, current code.

### system

```bash
dscli system config <namespace>           # dump a config file (concierge, devices, screens, etc.)
dscli system reload                       # POST /api/v1/system/reload
dscli system health                       # backend reachability + version + skills
```

Backed by ConfigService + the system router.

---

## Output contract

### JSON (default)

Every command emits a single JSON value to stdout on success. Examples:

```bash
$ dscli ha state light.office_main
{"entity_id":"light.office_main","state":"off","attributes":{"friendly_name":"Office Main","brightness":null}}

$ dscli content search "workout playlist" --take 2
{"results":[{"source":"plex","localId":"642120","title":"Workout Mix","type":"playlist","mediaType":"audio","metadata":{...}},{"source":"plex","localId":"642121","title":"Workout Vol 2","type":"playlist","mediaType":"audio","metadata":{...}}],"count":2}

$ dscli memory get notes
{"notes":[{"id":"abc","text":"call dad","ts":"2026-05-01T..."}]}
```

Errors go to stderr as JSON too, with non-zero exit:

```bash
$ dscli ha state light.does_not_exist
{"error":"not_found","entity_id":"light.does_not_exist"}    # stderr
# exit code 1
```

This is the contract that lets agents reason about results — they can `JSON.parse(stdout)` and check `err.error` if non-zero exit.

### Text (`--format=text`)

Optional human-readable formatter per command. For `ha state`:

```
$ dscli ha state light.office_main --format=text
light.office_main: off
  friendly_name: Office Main
```

For `content search`, a brief table. Text format is best-effort — JSON is the contract.

### Streaming output (concierge ask)

`dscli concierge ask` streams chunks from the backend's SSE response. Each chunk is one JSON object per line (NDJSON):

```bash
$ dscli concierge ask "play workout playlist" --as office
{"type":"text-delta","text":"Putting on "}
{"type":"text-delta","text":"the workout mix"}
{"type":"tool-start","toolName":"play_media","args":{"query":"workout playlist"}}
{"type":"tool-end","toolName":"play_media","result":{"ok":true,"playable":{...}}}
{"type":"text-delta","text":". Enjoy!"}
{"type":"finish","reason":"stop","usage":{...}}
```

Pipe to `jq -s '.'` to collect into a single array.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, JSON written to stdout |
| `1` | Operation failed (tool error, not found, policy denied) — JSON error to stderr |
| `2` | Usage error (unknown subcommand, missing required arg) — text error to stderr |
| `3` | Configuration error (missing auth, unreachable service) |
| `4` | Backend unreachable (only for commands that require the running backend) |

---

## Container vs host execution

The `claude` user can't read the data volume directly on the prod host (permissions). Two execution modes:

### Inside the container (production)

`dscli` is installed inside the container at `/usr/src/app/cli/dscli.mjs` (already there as part of the source tree). A host-level wrapper makes it shell-callable from anywhere on the host:

```sh
# /usr/local/bin/dscli (host wrapper)
#!/bin/sh
exec sudo docker exec -i daylight-station node /usr/src/app/cli/dscli.mjs "$@"
```

Now from the host: `dscli ha state X` works. The wrapper is set up once, then forgotten.

### On the host directly (dev mode)

When running against the local source tree (e.g. on a dev laptop, or for code-mod testing on the prod host before rebuilding the container):

```sh
node /opt/Code/DaylightStation/cli/dscli.mjs ha state X
```

Or via the package.json bin field after `npm install`:

```sh
npx dscli ha state X
```

The dev path uses the host's process env and reads data files via the `DAYLIGHT_BASE_PATH` env var that already drives the backend's data path resolution.

### Decision per environment

| Environment | Execution path |
|---|---|
| Prod host (kckern-server) | Inside container via `/usr/local/bin/dscli` wrapper |
| Dev laptop (kckern-macbook) | Host direct, against local source |
| Inside an agent (Claude Code, mastracode) | Inside container via the host wrapper |
| CI / scripts | Whichever matches the env they're running in |

---

## Authentication

Most subcommands need the same secrets the backend uses (HA token, Plex token, Buxfer creds, etc.). Three sources, in order of preference:

1. **`DAYLIGHT_BASE_PATH` + ConfigService** — read auth files from the configured data path. Same code path as the backend. Works inside the container; requires `DAYLIGHT_BASE_PATH` to point at the data volume on host.
2. **Environment variables** — if a subcommand declares `requiresEnv(['HA_TOKEN'])` and the env var is set, use it directly. Useful for dev / CI without the data volume.
3. **Backend HTTP fallback** — for `dscli concierge ask` and `dscli system reload`, hit the local backend with bearer auth from `DAYLIGHT_CLI_TOKEN` env var. Treats the CLI as an additional satellite identity.

For commands that operate on shared household state (memory, calendar) but don't need a satellite identity, the CLI uses the household-level auth files directly.

---

## Error handling

- **Validation errors** (missing arg, bad format) → exit 2, text error to stderr, no JSON
- **Service errors** (HA timeout, Buxfer 401, Plex search miss) → exit 1, JSON error to stderr
- **Config errors** (auth file missing) → exit 3, text error to stderr explaining what's missing and where to set it
- **Backend errors** (only for `concierge ask` etc.) → exit 4 if backend unreachable, exit 1 if backend returns error

No silent failures, no swallowed exceptions. Every error path explains what went wrong and how to fix it.

---

## Observability

Each invocation logs to the same logging framework the backend uses (so traces appear in the same log stream when running inside the container). Events:

- `dscli.invoke` (info) — subcommand, args shape (no values), satellite identity if applicable
- `dscli.complete` (info) — exit code, latencyMs
- `dscli.error` (error) — error message, stack if available

This lets us trace agent invocations in the same Grafana/ELK stack the backend uses, and correlate CLI calls with backend calls when they cross over.

---

## Testing strategy

### Unit tests per command

Each `commands/*.mjs` file gets a sibling test in `tests/unit/cli/commands/<name>.test.mjs`. Tests:

- Mock the application services (use the existing in-memory adapters or fakes)
- Invoke the command function with a parsed args object
- Assert exit code + JSON output structure

Example:

```javascript
describe('dscli ha state', () => {
  it('returns JSON for an existing entity', async () => {
    const fakeGateway = { getState: async () => ({ state: 'off', attributes: {} }) };
    const { exitCode, stdout } = await runCommand('ha state light.office_main', { gateway: fakeGateway });
    assert.strictEqual(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.strictEqual(result.state, 'off');
  });
});
```

### Integration smoke test

A single test that runs `dscli system health` against the actual running container in `npm run test:live`. Confirms the wrapper, container exec, JSON output all work end-to-end. Skipped if backend isn't running.

### Schema contract tests

For each subcommand, snapshot the JSON output shape. Schema changes show up in PR diffs. Prevents accidental breaking changes that would break agents consuming the CLI.

---

## Migration / rollout

### Phase A — scaffold

- `cli/dscli.mjs` entry + `_bootstrap.mjs` + `_argv.mjs` + `_output.mjs`
- Command stubs that print `not implemented yet` for each subcommand
- `dscli --help` and `dscli <subcommand> --help` working
- One real subcommand end-to-end as a template: `dscli system health`

### Phase B — read-only commands

- `dscli ha state / list-areas / list-devices`
- `dscli content search / list-libraries / resolve`
- `dscli memory get / list`
- `dscli finance balance / accounts / transactions`
- `dscli system config <namespace>`

These are the most agent-useful commands and have minimal blast radius.

### Phase C — write commands

- `dscli ha toggle / call-service`
- `dscli memory write / delete`
- `dscli finance refresh`
- `dscli system reload`

Adds policy gating — write commands respect the same scopes as voice. The CLI satellite identity has its own scope grants in `concierge.yml.satellites`.

### Phase D — concierge & advanced

- `dscli concierge ask / transcript / replay / satellites`
- `dscli content play` (requires running backend)
- Host wrapper installed at `/usr/local/bin/dscli` on prod
- Folding `cli/buxfer.cli.mjs` into `dscli finance --direct`

### Phase E — polish

- Text formatters per command
- Schema contract tests
- README / man-pages-style help
- Optional: TAB completion via `--complete` flag (zsh / bash)

---

## Risks and open questions

### Risk: lazy bootstrap leaks complexity

If subcommands need cross-cutting services (e.g. memory needs ConfigService, but so does HA, finance, content), the lazy factories might end up building the same things repeatedly. Mitigation: factories memoize within a single CLI invocation. ConfigService instantiated once, shared across factories called from the same dispatch.

### Risk: data volume access on the host

The `claude` user can't read the data volume directly. Tested mitigations:
- Container exec wrapper (recommended)
- Run as root (rejected — too broad)
- Bind-mount the data volume into a `claude`-readable location (option for dev environments)

### Risk: backend running vs not running

Some commands need the backend (`concierge ask`, `content play`). Others don't (`ha state`, `content search`). Mitigation: each command declares `requiresBackend: boolean`. The dispatcher checks before invoking and exits 4 with a clear message.

### Risk: CLI satellite identity in policy

Today `concierge.yml.satellites` lists `dev` and `office`. The CLI needs its own identity (call it `cli`) with explicit scope grants. Whether to allow write operations from CLI by default vs requiring `--allow-write` confirmation is a security choice. Recommendation: CLI satellite has read-only scopes by default; write commands require explicit `--allow-write` flag (which gets logged in the transcript).

### Open questions

1. **Argument parser:** roll our own (zero deps, ~100 lines), or pull in `commander` / `yargs`? Recommendation: roll our own — the surface is small, no dep, fits the project's "minimal external deps" pattern in `cli/`.

2. **Concierge ask streaming format:** NDJSON (one chunk per line) or final-only JSON with `--stream` flag for chunks? Recommendation: NDJSON by default. Easier for agents to parse incrementally.

3. **Satellite impersonation policy:** should `dscli concierge ask --as office` be allowed at all? Or should CLI always use a `cli` satellite? Recommendation: allow impersonation when the running user has the necessary auth — this is a debugging tool, not a production interface. Log every impersonation in the transcript.

4. **MCP later?** If we ever need to expose DS to non-shell agents (e.g. some platform that only speaks MCP), we can add a thin MCP server that wraps the same application services — same direct-import pattern, different transport. Spec'ing it out is premature.

---

## Success criteria

- An AI coding agent (Claude Code / mastracode) can run `dscli ha state light.office_main` and get usable JSON within 500ms
- A developer can run `dscli concierge ask "play workout playlist" --as office` and reproduce a voice command from the shell, see streaming output, see tool calls
- Schema contract tests catch breaking changes in PR diffs
- The CLI subsumes `cli/buxfer.cli.mjs` without losing any of its capability
- New commands take ~50–100 lines to add, including tests

---

## Out of scope (deliberately)

- TUI / interactive mode
- A REST/GraphQL replacement for the existing HTTP API
- Cross-machine CLI (no remote-DS support — host wrapper handles that via SSH if needed)
- Auto-installation / package distribution (it's a project-internal tool, not a published package)
- MCP server (future, if/when justified by a specific consumer)
