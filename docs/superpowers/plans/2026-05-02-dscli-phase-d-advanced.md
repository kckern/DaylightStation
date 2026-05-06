# dscli Phase D — Concierge & Advanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ This plan covers 5 INDEPENDENT sub-projects.** They are sequenced for thematic grouping but have NO inter-dependencies. **Strongly consider splitting this plan into 5 separate plans before execution** — each sub-project produces working software on its own and is the natural unit of review.

**Goal:** Round out dscli with the high-value, higher-complexity capabilities: stream concierge agent invocations from the shell, read and replay transcripts, list satellite identities, play content on devices via the running backend, install the host wrapper for prod-host shell access, and fold the legacy `cli/buxfer.cli.mjs` into a `--direct` flag on `dscli finance`.

**Architecture:** Each sub-project is its own command surface area. The concierge ask command uses raw `fetch()` against the backend's existing `/v1/chat/completions` SSE endpoint and reformats SSE events as NDJSON for shell consumption. Transcripts are JSON files at a known household path. The host wrapper is a shell script that exec's into the container. `finance --direct` short-circuits the bootstrap factory and calls Buxfer's API directly.

**Tech Stack:** Same as foundation. Raw `fetch()` body-stream reading for SSE — no `eventsource` dep needed. Shell wrapper is plain POSIX sh. No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-02-dscli-design.md](../specs/2026-05-02-dscli-design.md) — Phase D (lines 401-406), Container vs host execution (lines 261-301), concierge subcommand catalog (lines 168-181).

**Prerequisites:** Phase A foundation merged. Phases B and C SHOULD be merged (this plan's `concierge ask` benefits from the policy infrastructure in C, and the host wrapper assumes Phase B commands work).

---

## ⚠️ Decisions locked in by this plan

The spec left these open. The plan commits to these. **Implementer must consult user before deviating.**

### Decision 1: `concierge ask` output is NDJSON by default; no batch-only mode

Each SSE event from the backend's `/v1/chat/completions` becomes one JSON object on its own line on stdout. Pipe to `jq -s '.'` to collect into a single array. `--final-only` flag: print only the last `{"type":"finish",...}` event for callers that don't want streaming. (Per spec recommendation.)

### Decision 2: `concierge ask` impersonation via `--as <satellite_id>` is allowed

Defaults to `cli` (per Phase C). `--as office` lets you re-issue voice commands from the shell using that satellite's policy/scopes. Each invocation logs the impersonation in the audit transcript. Impersonation is a debugging tool, not a production interface — there is no further auth check at the dscli layer; the backend's existing `Authorization: Bearer` check (using `DSCLI_BACKEND_TOKEN` from env) is the gate.

### Decision 3: `concierge replay <id>` creates a NEW transcript, does not overwrite

The replay reads the original transcript file, extracts the user's input + satellite identity, re-issues that exact `concierge ask` call, captures the result in a NEW transcript file at the same path with `-replay-<short-hash>` appended. The original is preserved as the source-of-truth.

### Decision 4: Host wrapper is a manual install step

A script `cli/install-host-wrapper.sh` writes `/usr/local/bin/dscli` (requires sudo). It is NOT run automatically. The README documents the install command. No CI / deploy automation here.

### Decision 5: `finance --direct` is opt-in at first; doesn't deprecate `cli/buxfer.cli.mjs` yet

`dscli finance accounts --direct` short-circuits the bootstrap factory and uses the same path the legacy `cli/buxfer.cli.mjs` does (env vars or docker-exec for credentials, direct Buxfer API). The legacy CLI stays in tree as-is; deprecation is a separate decision deferred to a follow-up plan.

### Decision 6: `content play` returns once the play request is ACK'd, NOT when playback completes

`content play` POSTs to `/api/v1/play` (or whatever the existing play endpoint is — verify in Sub-project 4 Task 1). Backend ACKs synchronously; whether playback actually starts is a backend concern. The CLI exits 0 on ACK, exits 4 on backend unreachable, exits 1 if the backend returns an error envelope.

---

## Sub-project organization

Each sub-project is independently executable. Pick any order. Numbering is for reference only.

| Sub-project | Tasks | Lines of work | Risk |
|---|---|---|---|
| 1. `concierge ask` (NDJSON streaming) | 4 | ~300 | High (novel streaming code) |
| 2. `concierge transcript / replay / satellites` | 3 | ~150 | Medium (file-IO + replay semantics) |
| 3. `content play` | 2 | ~80 | Low (HTTP wrapper) |
| 4. Host wrapper install script | 1 | ~30 | Low (shell + docs) |
| 5. `finance --direct` (Buxfer direct) | 2 | ~120 | Low (refactor of existing buxfer.cli.mjs logic) |

If executing as one plan, do them in the order above (1 → 5) for thematic flow. If splitting into separate plans, each sub-project header below already maps cleanly to its own plan file.

---

# Sub-project 1: `dscli concierge ask` (NDJSON streaming)

## Files

- Modify: `cli/_bootstrap.mjs` — add `getConciergeClient()` factory (or use `getHttpClient()` directly with manual SSE parsing — see Decision below)
- Create: `cli/commands/concierge.mjs` — new command module with `actionAsk`
- Create: `tests/unit/cli/commands/concierge.test.mjs` — in-process tests with a fake fetch returning a streaming Response
- Modify: `cli/dscli.mjs` — add `'concierge'` to `KNOWN_SUBCOMMANDS`

## Sub-decision: SSE parser

We do NOT pull in `eventsource`. The backend's SSE format is straightforward: lines starting with `data: ` are JSON payloads; events are separated by blank lines; `data: [DONE]` ends the stream. We parse it inline (~30 lines).

## Task 1.1: Skeleton + `actionAsk` for non-streaming case

- [ ] **Step 1: Add `'concierge'` to `KNOWN_SUBCOMMANDS`** in `cli/dscli.mjs`. Update top-level help text to list it.

- [ ] **Step 2: Write the failing test** — `tests/unit/cli/commands/concierge.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { Readable } from 'node:stream';
import concierge from '../../../../cli/commands/concierge.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

/**
 * Build a fake fetch Response with a body that streams the given lines
 * separated by newlines. Mimics the backend's SSE response.
 */
function fakeStreamingResponse(lines) {
  const text = lines.join('\n') + '\n';
  const encoder = new TextEncoder();
  const buf = encoder.encode(text);
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: buf };
          },
        };
      },
    },
  };
}

describe('cli/commands/concierge', () => {
  describe('ask action', () => {
    it('exits 2 when prompt is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['ask'], flags: {}, help: false },
        { stdout, stderr },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/prompt/i);
    });

    it('exits 4 when backend unreachable', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['ask', 'hello'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );
      expect(r.exitCode).toBe(4);
    });

    it('streams NDJSON for SSE events', async () => {
      const { stdout, stderr } = makeBuffers();
      const sse = [
        'data: {"type":"text-delta","text":"Hello "}',
        '',
        'data: {"type":"text-delta","text":"world"}',
        '',
        'data: {"type":"finish","reason":"stop"}',
        '',
        'data: [DONE]',
      ];
      const fakeFetch = async () => fakeStreamingResponse(sse);
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['ask', 'hi'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );
      expect(r.exitCode).toBe(0);
      const lines = stdout.read().trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0])).toEqual({ type: 'text-delta', text: 'Hello ' });
      expect(JSON.parse(lines[2])).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('--final-only emits only the last event', async () => {
      const { stdout, stderr } = makeBuffers();
      const sse = [
        'data: {"type":"text-delta","text":"hi"}',
        '',
        'data: {"type":"finish","reason":"stop","usage":{"in":5,"out":3}}',
        '',
        'data: [DONE]',
      ];
      const fakeFetch = async () => fakeStreamingResponse(sse);
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['ask', 'hi'], flags: { 'final-only': true }, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );
      expect(r.exitCode).toBe(0);
      const lines = stdout.read().trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('finish');
      expect(parsed.usage).toEqual({ in: 5, out: 3 });
    });

    it('--as <satellite_id> sets the satellite identity in request body', async () => {
      const { stdout, stderr } = makeBuffers();
      let capturedBody;
      const fakeFetch = async (url, opts) => {
        capturedBody = opts?.body ? JSON.parse(opts.body) : null;
        return fakeStreamingResponse(['data: [DONE]']);
      };
      await concierge.run(
        { subcommand: 'concierge', positional: ['ask', 'hi'], flags: { as: 'office' }, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );
      expect(capturedBody).toBeTruthy();
      // Backend uses 'satellite' OR 'user' field for identity — verify the implementer
      // sets whatever the existing /v1/chat/completions handler reads. Adjust if needed.
      expect(capturedBody.satellite || capturedBody.user || capturedBody.metadata?.satellite).toBe('office');
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage', async () => {
      const { stdout } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(r.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/ask/);
    });
  });
});
```

- [ ] **Step 3: Run; confirm 6 failures.**

- [ ] **Step 4: Implement `cli/commands/concierge.mjs`**

```javascript
/**
 * dscli concierge — interact with the running backend's agent.
 *
 * Actions:
 *   dscli concierge ask "<prompt>" [--as <satellite_id>] [--final-only]
 *
 * Streams responses as NDJSON to stdout. Each SSE event becomes one JSON line.
 */

import { printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_BACKEND } from '../_output.mjs';

const HELP = `
dscli concierge — agent interaction

Usage:
  dscli concierge <action> [args] [flags]

Actions:
  ask "<prompt>" [--as <satellite_id>] [--final-only]
              Send a prompt to the running backend's agent.
              Streams NDJSON to stdout (one JSON line per SSE event).
              --as defaults to 'cli'. --final-only emits only the terminal event.

Examples:
  dscli concierge ask "play workout playlist"
  dscli concierge ask "what's the office light?" --as office
  dscli concierge ask "summarize today" --final-only | jq .
`.trimStart();

function backendUrl() {
  return process.env.DSCLI_BACKEND_URL || 'http://localhost:3111';
}

async function* parseSSE(response) {
  // Yields parsed JSON objects from SSE `data: {...}` lines, skipping blank
  // lines and stopping on `data: [DONE]`.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload);
      } catch {
        // Skip malformed events
      }
    }
  }
}

async function actionAsk(args, deps) {
  const prompt = args.positional.slice(1).join(' ').trim();
  if (!prompt) {
    deps.stderr.write('dscli concierge ask: missing required <prompt>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  const satellite = args.flags.as || 'cli';
  const finalOnly = args.flags['final-only'] === true;
  const url = backendUrl() + '/v1/chat/completions';
  const fetchFn = deps.fetch || globalThis.fetch;

  const body = {
    model: 'concierge', // backend ignores; concierge is the only choice
    stream: true,
    messages: [{ role: 'user', content: prompt }],
    // Identity passthrough — adjust the field name if the existing handler
    // expects something different (e.g. 'user' or 'metadata.satellite').
    satellite,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.DSCLI_BACKEND_TOKEN) {
    headers.Authorization = `Bearer ${process.env.DSCLI_BACKEND_TOKEN}`;
  }

  let response;
  try {
    response = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    printError(deps.stderr, { error: 'backend_unreachable', url, message: err.message });
    return { exitCode: EXIT_BACKEND };
  }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url, status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let lastEvent = null;
  let count = 0;
  try {
    for await (const event of parseSSE(response)) {
      count++;
      lastEvent = event;
      if (!finalOnly) {
        deps.stdout.write(JSON.stringify(event) + '\n');
      }
    }
  } catch (err) {
    printError(deps.stderr, { error: 'concierge_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (finalOnly && lastEvent) {
    deps.stdout.write(JSON.stringify(lastEvent) + '\n');
  }

  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  ask: actionAsk,
};

export default {
  name: 'concierge',
  description: 'Agent interaction (streaming)',
  requiresBackend: true,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }
    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli concierge: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }
    return ACTIONS[action](args, deps);
  },
};
```

- [ ] **Step 5: Run tests; confirm 6 passing.**

- [ ] **Step 6: Verify the satellite identity field name matches what the backend expects**

```bash
grep -rn "satellite\|req.body.satellite\|message.satellite" /opt/Code/DaylightStation/backend/src/4_api/v1/routers/ | grep -i chat | head -5
```

If the backend reads `req.body.user` instead of `req.body.satellite`, update the body construction in `actionAsk` accordingly. Re-run the impersonation test to confirm.

- [ ] **Step 7: Live smoke (optional)**

```bash
node cli/dscli.mjs concierge ask "what's 2+2?" --final-only | jq .
```
Expected: a single JSON line with `type: 'finish'` (or whatever the backend's terminal event type is). If the backend rejects with auth, set `DSCLI_BACKEND_TOKEN` from infisical / `.env`.

- [ ] **Step 8: Commit**

```bash
git add cli/dscli.mjs cli/commands/concierge.mjs tests/unit/cli/commands/concierge.test.mjs
git commit -m "feat(dscli): concierge ask action — NDJSON streaming + --as / --final-only"
```

---

# Sub-project 2: `concierge transcript / replay / satellites`

## Files

- Modify: `cli/commands/concierge.mjs` — add `actionTranscript`, `actionReplay`, `actionSatellites`
- Modify: `tests/unit/cli/commands/concierge.test.mjs` — append tests
- Modify: `cli/_bootstrap.mjs` — add `getTranscriptDir()` factory (resolves the path where transcripts live)

## Task 2.1: `concierge satellites` — list configured satellites

- [ ] **Step 1: Add `getConciergeConfig()` factory** to `cli/_bootstrap.mjs` (lazy-load `cfg.getHouseholdAppConfig(null, 'concierge')` — already exists per ConfigService API).

```javascript
let _conciergeConfig = null;
let _conciergeConfigPromise = null;

export async function getConciergeConfig() {
  if (_conciergeConfig) return _conciergeConfig;
  if (_conciergeConfigPromise) return _conciergeConfigPromise;
  _conciergeConfigPromise = (async () => {
    const cfg = await getConfigService();
    const cfgValue = cfg.reloadHouseholdAppConfig?.(null, 'concierge')
                    ?? cfg.getHouseholdAppConfig?.(null, 'concierge');
    if (!cfgValue) {
      throw new Error('Concierge config not found (data/household/config/concierge.yml).');
    }
    _conciergeConfig = cfgValue;
    return _conciergeConfig;
  })();
  return _conciergeConfigPromise;
}
```

Add to `_resetForTests()` and to `dscli.mjs` deps bag (`getConciergeConfig: bootstrap.getConciergeConfig`).

- [ ] **Step 2: Add `actionSatellites`** to `cli/commands/concierge.mjs`:

```javascript
async function actionSatellites(args, deps) {
  let cfg;
  try { cfg = await deps.getConciergeConfig(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  const satellites = (cfg.satellites || []).map((s) => ({
    id: s.id,
    area: s.area ?? null,
    media_player_entity: s.media_player_entity ?? null,
    allowed_skills: s.allowed_skills ?? [],
    scopes_allowed: s.scopes_allowed ?? [],
  }));
  printJson(deps.stdout, { satellites, count: satellites.length });
  return { exitCode: EXIT_OK };
}
```

Register `satellites: actionSatellites`. Update HELP. Note: also import `EXIT_CONFIG` and `printJson` if not already.

- [ ] **Step 3: Add tests** — at minimum: success path with 2 satellites, factory throws → EXIT_CONFIG.

- [ ] **Step 4: Commit**

```bash
git add cli/_bootstrap.mjs cli/dscli.mjs cli/commands/concierge.mjs tests/unit/cli/commands/concierge.test.mjs
git commit -m "feat(dscli): concierge satellites action + getConciergeConfig factory"
```

## Task 2.2: `concierge transcript <id>` — dump a transcript file

- [ ] **Step 1: Find where transcripts are written**

```bash
grep -rn "ConciergeTranscript\|transcripts.*write\|conversation_id" /opt/Code/DaylightStation/backend/src/3_applications/agents/ 2>/dev/null | head -5
```

The transcript path is whatever the agent application service writes to. Likely `data/household/concierge-transcripts/<conversation_id>.json`. **Verify before writing the action**; if the path differs, update the factory.

- [ ] **Step 2: Add `getTranscriptDir()` factory** to `cli/_bootstrap.mjs`:

```javascript
let _transcriptDir = null;
let _transcriptDirPromise = null;

export async function getTranscriptDir() {
  if (_transcriptDir) return _transcriptDir;
  const cfg = await getConfigService();
  // Adjust path if your codebase uses a different location.
  _transcriptDir = await import('node:path')
    .then(m => m.join(cfg.getDataDir(), 'household', 'concierge-transcripts'));
  return _transcriptDir;
}
```

Add to `_resetForTests()` and `dscli.mjs` deps.

- [ ] **Step 3: Tests + impl for `actionTranscript`**:

Tests assert: missing id → EXIT_USAGE; nonexistent file → EXIT_FAIL not_found; existing file → JSON dump.

Impl reads the file, parses JSON, emits to stdout:

```javascript
async function actionTranscript(args, deps) {
  const id = args.positional[1];
  if (!id) {
    deps.stderr.write('dscli concierge transcript: missing required <id>\n');
    return { exitCode: EXIT_USAGE };
  }

  let dir;
  try { dir = await deps.getTranscriptDir(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(dir, `${id}.json`);

  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') {
      printError(deps.stderr, { error: 'not_found', id });
      return { exitCode: EXIT_FAIL };
    }
    printError(deps.stderr, { error: 'transcript_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    printError(deps.stderr, { error: 'transcript_error', message: 'malformed JSON: ' + err.message });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, parsed);
  return { exitCode: EXIT_OK };
}
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(dscli): concierge transcript <id> action"
```

## Task 2.3: `concierge replay <id>` — re-run a past prompt

- [ ] **Step 1: Tests** — assert: missing id → EXIT_USAGE; transcript not found → EXIT_FAIL; valid transcript → calls `actionAsk` with the same prompt + satellite, captures output to a new file.

- [ ] **Step 2: Implement**

```javascript
async function actionReplay(args, deps) {
  const id = args.positional[1];
  if (!id) {
    deps.stderr.write('dscli concierge replay: missing required <id>\n');
    return { exitCode: EXIT_USAGE };
  }

  // Reuse actionTranscript-like logic to load the source transcript
  let dir;
  try { dir = await deps.getTranscriptDir(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(dir, `${id}.json`);

  let original;
  try { original = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') { printError(deps.stderr, { error: 'not_found', id }); return { exitCode: EXIT_FAIL }; }
    printError(deps.stderr, { error: 'transcript_error', message: err.message }); return { exitCode: EXIT_FAIL };
  }

  // Extract prompt + satellite. Adjust property names to match your transcript schema.
  const prompt = original.input?.prompt ?? original.messages?.find(m => m.role === 'user')?.content;
  const satellite = original.satellite ?? original.metadata?.satellite ?? 'cli';
  if (!prompt) {
    printError(deps.stderr, { error: 'transcript_error', message: 'no user prompt found in transcript' });
    return { exitCode: EXIT_FAIL };
  }

  // Re-issue via actionAsk, but capture output to a buffer instead of stdout
  // so we can write it to a new transcript file.
  const { Writable } = await import('node:stream');
  const captured = [];
  const buffStdout = new Writable({ write(c, _e, cb) { captured.push(c); cb(); } });
  const askResult = await actionAsk(
    { positional: ['ask', prompt], flags: { as: satellite }, help: false },
    { ...deps, stdout: buffStdout, fetch: deps.fetch },
  );

  // Build the new transcript object
  const events = Buffer.concat(captured).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const newId = `${id}-replay-${Date.now().toString(36)}`;
  const newTranscript = {
    id: newId,
    replayedFrom: id,
    timestamp: new Date().toISOString(),
    satellite,
    input: { prompt },
    events,
  };

  await fs.writeFile(path.join(dir, `${newId}.json`), JSON.stringify(newTranscript, null, 2), 'utf8');

  printJson(deps.stdout, { ok: askResult.exitCode === 0, replayId: newId, originalId: id, eventCount: events.length });
  return { exitCode: askResult.exitCode };
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dscli): concierge replay <id> — re-runs prompt, writes new transcript"
```

---

# Sub-project 3: `dscli content play` — play content on a device

## Files

- Modify: `cli/commands/content.mjs` — add `actionPlay`
- Modify: `tests/unit/cli/commands/content.test.mjs` — append tests

The backend has an existing endpoint to load content on a device — the spec says "uses the HA gateway to actually start playback". The exact endpoint must be verified.

## Task 3.1: Verify endpoint, then implement

- [ ] **Step 1: Find the endpoint**

Per CLAUDE.md memory: `GET /api/v1/device/livingroom-tv/load?queue=plex:642120&shader=dark` is the documented endpoint for full wake+prepare+load. Verify:

```bash
grep -rn "device.*load\|/load.*queue" /opt/Code/DaylightStation/backend/src/4_api/v1/routers/ | head -5
```

The shape is `GET /api/v1/device/<deviceId>/load?queue=<source>:<id>&shader=<name>&shuffle=1`.

- [ ] **Step 2: Tests + impl**

`actionPlay`:
- positional: `[ 'play', '<source>:<id>' ]`
- required flag: `--to <deviceId>` (e.g. `livingroom-tv`)
- optional flags: `--enqueue play|add`, `--shader dark`, `--shuffle`
- requires `--allow-write` (per Phase C convention) since this mutates device state
- exit 4 if backend unreachable, exit 0 on ACK

```javascript
async function actionPlay(args, deps) {
  const key = args.positional[1];
  const device = args.flags.to;
  if (!key || !device) {
    deps.stderr.write('dscli content play: usage: dscli content play <source>:<id> --to <deviceId> [--shader X] [--shuffle] --allow-write\n');
    return { exitCode: EXIT_USAGE };
  }
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'content play', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  const url = new URL(`${backendUrl()}/api/v1/device/${encodeURIComponent(device)}/load`);
  url.searchParams.set('queue', key);
  if (args.flags.shader) url.searchParams.set('shader', args.flags.shader);
  if (args.flags.shuffle) url.searchParams.set('shuffle', '1');
  if (args.flags.enqueue) url.searchParams.set('enqueue', args.flags.enqueue);

  const fetchFn = deps.fetch || globalThis.fetch;
  let response;
  try { response = await fetchFn(url.toString()); }
  catch (err) { printError(deps.stderr, { error: 'backend_unreachable', url: url.toString(), message: err.message }); return { exitCode: EXIT_BACKEND }; }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url: url.toString(), status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let body = {};
  try { body = await response.json(); } catch {}

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'content', action: 'play', args: { key, device, ...args.flags }, result: body });
  } catch {}

  printJson(deps.stdout, { ok: true, device, key, ...body });
  return { exitCode: EXIT_OK };
}
```

(Add `EXIT_BACKEND`, `printError` to imports if not present, and a local `backendUrl()` helper or pull from a shared module.)

Register `play: actionPlay`. Update HELP.

- [ ] **Step 3: Tests** — mirror `finance refresh` test shape: missing args → EXIT_USAGE, missing --allow-write → EXIT_USAGE, unreachable → EXIT_BACKEND, success → exit 0.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(dscli): content play — POST device load endpoint with --to and --shader"
```

---

# Sub-project 4: Host wrapper install script

## Files

- Create: `cli/install-host-wrapper.sh` — the install script (bash, gets installed to `/usr/local/bin/dscli`)
- Create: `cli/host-wrapper-template.sh` — the actual wrapper content (copied to /usr/local/bin/dscli)
- Modify: `cli/README.md` — document the install command

## Task 4.1: Write the wrapper + install script

- [ ] **Step 1: Write `cli/host-wrapper-template.sh`**:

```sh
#!/bin/sh
# dscli host wrapper — exec into the running daylight-station container.
# Generated by cli/install-host-wrapper.sh; edit there, not here.
exec sudo docker exec -i daylight-station node /usr/src/app/cli/dscli.mjs "$@"
```

- [ ] **Step 2: Write `cli/install-host-wrapper.sh`**:

```sh
#!/bin/sh
# Install /usr/local/bin/dscli that wraps `docker exec daylight-station ...`.
# Run with: sudo sh cli/install-host-wrapper.sh
#
# After installation, `dscli` is callable from anywhere on the host:
#   dscli system health
#   dscli ha state light.office_main

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root (sudo)." >&2
  exit 1
fi

WRAPPER_PATH="/usr/local/bin/dscli"
TEMPLATE_PATH="$(dirname "$0")/host-wrapper-template.sh"

if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "Error: template not found at $TEMPLATE_PATH" >&2
  exit 1
fi

if [ -e "$WRAPPER_PATH" ]; then
  echo "Note: $WRAPPER_PATH already exists. Overwriting."
fi

cp "$TEMPLATE_PATH" "$WRAPPER_PATH"
chmod +x "$WRAPPER_PATH"

echo "Installed: $WRAPPER_PATH"
echo "Test with: dscli --help"
```

- [ ] **Step 3: Make both scripts executable + add a test**

Test: `tests/unit/cli/install-host-wrapper.test.mjs` — minimal: confirm both files exist, are executable, have valid shebangs, and the template references the docker command.

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('host wrapper install', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  it('install script exists and starts with shebang', async () => {
    const text = await fs.readFile(path.join(root, 'cli/install-host-wrapper.sh'), 'utf8');
    expect(text.startsWith('#!/bin/sh')).toBe(true);
    expect(text).toMatch(/sudo/);
  });
  it('template references docker exec daylight-station', async () => {
    const text = await fs.readFile(path.join(root, 'cli/host-wrapper-template.sh'), 'utf8');
    expect(text).toMatch(/docker exec.*daylight-station/);
  });
});
```

- [ ] **Step 4: Update `cli/README.md`**

Add a new "Installation" section near the top:

```markdown
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
sudo sh cli/install-host-wrapper.sh
dscli --help
```

The wrapper is a one-line `exec sudo docker exec -i daylight-station node /usr/src/app/cli/dscli.mjs "$@"`. It assumes `docker exec daylight-station` is sudo-allowed (see `/etc/sudoers.d/claude` on prod hosts).
```

- [ ] **Step 5: Commit**

```bash
chmod +x cli/install-host-wrapper.sh cli/host-wrapper-template.sh
git add cli/install-host-wrapper.sh cli/host-wrapper-template.sh cli/README.md tests/unit/cli/install-host-wrapper.test.mjs
git commit -m "feat(dscli): host wrapper install script + docs"
```

---

# Sub-project 5: `dscli finance --direct` (Buxfer direct, no backend)

## Files

- Modify: `cli/_bootstrap.mjs` — add `getBuxferDirect()` (independent of `getConfigService()`; uses env vars or docker-exec for credentials)
- Modify: `cli/commands/finance.mjs` — accept `--direct` flag and route to the alternate factory
- Modify: `tests/unit/cli/commands/finance.test.mjs` — add `--direct` tests

This folds the standalone `cli/buxfer.cli.mjs` pattern into `dscli` without removing the original (Decision 5 above). When `--direct` is set, the factory bypasses ConfigService entirely and pulls credentials via:
1. `BUXFER_EMAIL` + `BUXFER_PASSWORD` env vars, OR
2. `sudo docker exec daylight-station cat data/household/auth/buxfer.yml` (mirrors `cli/buxfer.cli.mjs` line 70-79)

## Task 5.1: `getBuxferDirect()` factory

- [ ] **Step 1: Add factory** to `cli/_bootstrap.mjs`:

```javascript
import { execSync } from 'node:child_process';

let _buxferDirect = null;

function readBuxferCredsDirect() {
  if (process.env.BUXFER_EMAIL && process.env.BUXFER_PASSWORD) {
    return { email: process.env.BUXFER_EMAIL, password: process.env.BUXFER_PASSWORD };
  }
  let raw;
  try {
    raw = execSync(`sudo docker exec daylight-station sh -c 'cat data/household/auth/buxfer.yml'`,
                   { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error('Cannot read Buxfer credentials (set BUXFER_EMAIL+BUXFER_PASSWORD or ensure docker container is reachable).');
  }
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(email|password):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  if (!out.email || !out.password) throw new Error('Buxfer creds parsed but missing email/password.');
  return out;
}

export async function getBuxferDirect() {
  if (_buxferDirect) return _buxferDirect;
  const auth = readBuxferCredsDirect();
  const { BuxferAdapter } = await import('#adapters/finance/BuxferAdapter.mjs');
  _buxferDirect = new BuxferAdapter(
    { email: auth.email, password: auth.password },
    { httpClient: getHttpClient() },
  );
  return _buxferDirect;
}
```

Add `_buxferDirect = null;` to `_resetForTests()`. Add to `dscli.mjs` deps bag.

- [ ] **Step 2: Tests** — mock `execSync` (vitest's `vi.spyOn` works; or refactor to inject `readCreds`). Test:
  - env vars present → uses them
  - env vars missing + execSync succeeds → parses YAML
  - both fail → throws

For the spy approach:

```javascript
import { vi } from 'vitest';
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
```

Or refactor `readBuxferCredsDirect` into a separate exported testable function that takes a `readFile` injectable.

## Task 5.2: Wire `--direct` flag in `actionAccounts` and other finance actions

- [ ] **Step 1: Modify the finance actions** to check `args.flags.direct`:

```javascript
async function actionAccounts(args, deps) {
  const factory = args.flags.direct ? deps.getBuxferDirect : deps.getBuxfer;
  let buxfer;
  try { buxfer = await factory(); }
  catch (err) { printError(deps.stderr, { error: 'config_error', message: err.message }); return { exitCode: EXIT_CONFIG }; }
  // ... rest unchanged
}
```

Apply the same pattern to `actionBalance`, `actionTransactions`, `actionRefresh` (Phase B/C actions). For `actionRefresh`, `--direct` doesn't make sense (refresh always goes through the backend); document as ignored.

- [ ] **Step 2: Tests** — add a test per action with `flags: { direct: true }` asserting `getBuxferDirect` is called instead of `getBuxfer`.

- [ ] **Step 3: Update HELP** to document the `--direct` flag:

```
  --direct      Bypass the bootstrap factory and call Buxfer directly
                (uses BUXFER_EMAIL/BUXFER_PASSWORD env vars or
                 docker exec to read data/household/auth/buxfer.yml).
                Useful when the backend isn't running.
```

- [ ] **Step 4: README note** — add a section explaining the `--direct` flag and that `cli/buxfer.cli.mjs` is preserved as-is.

- [ ] **Step 5: Commit (single)**

```bash
git add cli/_bootstrap.mjs cli/dscli.mjs cli/commands/finance.mjs tests/unit/cli/commands/finance.test.mjs cli/README.md
git commit -m "feat(dscli): finance --direct flag — Buxfer-direct path without backend"
```

---

## Final aggregate: smoke + README sync

- [ ] **Step 1: Run all tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/
```
Expected: ~150+ tests if all sub-projects landed.

- [ ] **Step 2: Smoke each new command's --help**

```bash
node cli/dscli.mjs concierge --help     # ask, transcript, replay, satellites
node cli/dscli.mjs content --help       # search, resolve, list-libraries, play
node cli/dscli.mjs finance --help       # accounts, balance, transactions, refresh, with --direct documented
```

- [ ] **Step 3: Live smoke (optional)**

```bash
node cli/dscli.mjs concierge satellites | jq '.satellites[].id'   # should list dev, office, cli
node cli/dscli.mjs concierge ask "ping" --final-only | jq .       # should stream and print final event
```

- [ ] **Step 4: README final pass**

Make sure `cli/README.md` has:
- All Phase D commands in Usage
- Installation section with the host wrapper
- A note about `--direct` for finance
- A note about `--allow-write` and audit logs (carried over from Phase C)

```bash
git add cli/README.md
git commit -m "docs(dscli): README pass for Phase D commands"
```

---

## Out of scope (deliberately)

- WebSocket-based real-time events (e.g. for live transcript viewing). NDJSON over HTTP/SSE is sufficient.
- Image / audio attachments in `concierge ask`. Text-only in foundation.
- Cross-machine `dscli` (e.g. SSH'ing into a remote host to run commands). The host wrapper handles single-machine; multi-machine is a separate thing.
- Replay-with-tweaks (e.g. "replay this prompt but with `--as office` instead of original satellite"). Out of scope; current replay preserves the original satellite identity.
- TUI for transcript browsing. JSON dump only.
- Folding `cli/ingest-health-archive.cli.mjs` into dscli. That CLI is sufficiently different in shape; leave it.

---

## Self-review notes

**Spec coverage (Phase D):**
- `dscli concierge ask` → Sub-project 1
- `dscli concierge transcript <id>` → Sub-project 2 Task 2.2
- `dscli concierge replay <id>` → Sub-project 2 Task 2.3
- `dscli concierge satellites` → Sub-project 2 Task 2.1
- `dscli content play` → Sub-project 3
- Host wrapper at `/usr/local/bin/dscli` → Sub-project 4
- Folding `cli/buxfer.cli.mjs` into `dscli finance --direct` → Sub-project 5

**Decisions** (top of plan): 6 explicit choices the user MUST review at execution time if they want to deviate from the recommendation.

**Verification steps required during execution:**
1. Sub-project 1 Step 6: confirm the satellite identity field name in `/v1/chat/completions` body
2. Sub-project 2 Task 2.2 Step 1: confirm transcript file location
3. Sub-project 3 Task 3.1 Step 1: confirm `/api/v1/device/<id>/load` endpoint exists and matches the documented shape

If any of these come back different from the assumption, update the corresponding code section before continuing.

**Test counts (estimate):** Phase C ends around ~120 tests. Phase D adds:
- Sub-project 1: ~6
- Sub-project 2: ~8
- Sub-project 3: ~4
- Sub-project 4: ~2
- Sub-project 5: ~5
Total after D: ~145+ tests.

**Splitting recommendation:** if executing, treat each Sub-project as its own plan. Each commit lands a self-contained capability. If anything goes sideways in Sub-project 1 (concierge ask streaming is the highest-novelty work), the other 4 sub-projects can still ship.
