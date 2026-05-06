# dscli Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `dscli` foundation — entry point, argument parser, output helpers, lazy bootstrap, and one read-only command from each major service domain (system, ha, content, memory, finance) — proving the patterns end-to-end so the remaining commands in each domain become trivial follow-ups.

**Architecture:** A single CLI entry (`cli/dscli.mjs`) parses a subcommand and dynamically imports `cli/commands/<subcommand>.mjs`. Each command exports `{ name, requiresBackend, run(args, deps) }`. Production runs use a lazy memoized bootstrap module (`cli/_bootstrap.mjs`) that builds only the application services each command needs (no full backend startup). Tests inject fake `deps` directly. Output is JSON to stdout on success, JSON error to stderr with non-zero exit on failure.

**Tech Stack:** Node ESM, vitest, the existing `#system/*`, `#adapters/*`, `#apps/*` path aliases in `package.json`. No new runtime dependencies. Tests follow the subprocess pattern in `tests/unit/cli/ingest-health-archive.test.mjs`.

**Spec:** [docs/superpowers/specs/2026-05-02-dscli-design.md](../specs/2026-05-02-dscli-design.md) — this plan covers Phase A (scaffold + system health) plus a representative slice of Phase B (one read-only command per domain). Phases C (write commands), D (concierge / streaming), and E (polish) are out of scope and will get follow-up plans.

---

## File structure

Files this plan creates:

```
cli/
├── dscli.mjs                    # Entry: parse subcommand, dispatch to commands/<name>.mjs, exit
├── _argv.mjs                    # parseArgv(argv) → { subcommand, args, flags, help }
├── _output.mjs                  # printJson(stream, value); printError(stream, errObj); EXIT_*
├── _bootstrap.mjs               # Lazy memoized factories: getConfigService, getHttpClient, getHaGateway, getContentQuery, getMemory, getBuxfer
└── commands/
    ├── system.mjs               # Subcommand: health, config <namespace>
    ├── ha.mjs                   # Subcommand: state <entityId>
    ├── content.mjs              # Subcommand: search "<query>"
    ├── memory.mjs               # Subcommand: get <key>, list
    └── finance.mjs              # Subcommand: accounts

tests/unit/cli/
├── _argv.test.mjs               # In-process unit test of argv parser
├── _output.test.mjs             # In-process unit test of output helpers
├── dscli.test.mjs               # Subprocess test: --help, exit codes, unknown subcommands
└── commands/
    ├── system.test.mjs          # In-process tests of system.run(); subprocess test for `system health` with mocked fetch
    ├── ha.test.mjs              # In-process tests of ha.run() with fake gateway
    ├── content.test.mjs         # In-process tests of content.run() with fake query service
    ├── memory.test.mjs          # In-process tests of memory.run() with fake memory adapter
    └── finance.test.mjs         # In-process tests of finance.run() with fake buxfer adapter
```

Files this plan modifies:

- `package.json` — add `"bin": { "dscli": "./cli/dscli.mjs" }` so `npx dscli` works after install.
- (None of the existing application services / adapters change — CLI is purely additive.)

---

## Architectural conventions established here

These are locked in by Tasks 1–5 and re-used by Tasks 6–10. Subagents executing later tasks should follow them exactly:

**Program against ports, not adapters.** The CLI is a new transport adapter at the same layer as the HTTP routers. Like the HTTP layer, it must consume application-layer **port interfaces**, never concrete provider adapters. Concretely:

- `cli/_bootstrap.mjs` factories construct concrete adapters (e.g. `HomeAssistantAdapter`) but their return type is the port interface (e.g. `IHomeAutomationGateway`). The factory verifies the contract via the interface's `assert*` helper before returning, so a future swap to a different provider (Hubitat, etc.) is invisible to the CLI commands.
- Command modules call only port methods (`gateway.getState(id)`, etc.), never adapter-specific methods.

For Task 6 the relevant port is `IHomeAutomationGateway` at `backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs`. Read it before implementing — the file documents the full method surface (`getState`, `getStates`, `getHistory`, `callService`, `activateScene`, `runScript`, `waitForState`, `isConnected`, `getProviderName`) and exports `assertHomeAutomationGateway(obj)` and `createNoOpGateway()` helpers we use directly.

**Command module shape** — every `cli/commands/<name>.mjs` exports a default object:

```javascript
export default {
  name: 'system',                  // Top-level subcommand
  description: 'System operations: health, config',
  requiresBackend: false,           // Top-level default; per-action override possible
  async run(args, deps) {
    // args is the parsed { positional: string[], flags: Record<string, string|boolean> }
    // deps is the injected dependency bag — bootstrap factories or test fakes
    // MUST return { exitCode: number, stdout?: string, stderr?: string }
    // OR write directly to deps.stdout/stderr and return { exitCode }
  },
};
```

**Returning vs writing.** `run()` may either return `{ exitCode, stdout, stderr }` or write to streams via `deps.stdout` / `deps.stderr`. The dispatcher handles both. In tests we use string-buffer streams so we can assert on output without a subprocess.

**Exit codes** — defined as constants in `_output.mjs`, used everywhere:

| Constant | Code | Meaning |
|---|---|---|
| `EXIT_OK` | 0 | Success, JSON to stdout |
| `EXIT_FAIL` | 1 | Operation failed (not found, denied) — JSON error to stderr |
| `EXIT_USAGE` | 2 | Usage error (unknown sub-action, missing arg) — text error to stderr |
| `EXIT_CONFIG` | 3 | Config error (auth missing, dataDir not set) |
| `EXIT_BACKEND` | 4 | Required backend not reachable |

**`deps` keys provided by `_bootstrap.mjs` to every command:**
- `stdout` — `process.stdout` (real) or a `BufferStream` (tests)
- `stderr` — `process.stderr` (real) or a `BufferStream` (tests)
- `getConfigService()` — async lazy factory
- `getHttpClient()` — sync lazy factory
- `getHaGateway()` — async lazy factory
- `getContentQuery()` — async lazy factory
- `getMemory()` — async lazy factory
- `getBuxfer()` — async lazy factory
- `fetch` — `globalThis.fetch` by default; tests can pass a stub for HTTP-touching commands

In tests, only the keys the command actually uses must be provided — missing keys cause `TypeError` if accessed, which is what we want.

**Command file size discipline.** Each `cli/commands/<name>.mjs` should stay under ~200 lines. If a command file grows past that, split into subcommand-action modules (out of scope for this plan).

---

## Task 1: Argv parser

**Files:**
- Create: `cli/_argv.mjs`
- Test: `tests/unit/cli/_argv.test.mjs`

We need a tiny, dependency-free parser that handles `dscli <subcommand> <action?> <positional...> --flag value --bool`. We're not using `yargs` or `commander` — the surface is small enough that ~80 lines is faster to read and debug than a dependency.

- [ ] **Step 1: Write the failing test**

Write `tests/unit/cli/_argv.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseArgv } from '../../../cli/_argv.mjs';

describe('parseArgv', () => {
  it('returns help=true for empty argv', () => {
    const r = parseArgv([]);
    expect(r.help).toBe(true);
    expect(r.subcommand).toBe(null);
  });

  it('returns help=true for --help', () => {
    expect(parseArgv(['--help']).help).toBe(true);
    expect(parseArgv(['-h']).help).toBe(true);
  });

  it('parses subcommand and action positionals', () => {
    const r = parseArgv(['ha', 'state', 'light.office']);
    expect(r.subcommand).toBe('ha');
    expect(r.positional).toEqual(['state', 'light.office']);
    expect(r.help).toBe(false);
  });

  it('parses --key value flags', () => {
    const r = parseArgv(['content', 'search', 'workout', '--source', 'plex', '--take', '5']);
    expect(r.subcommand).toBe('content');
    expect(r.positional).toEqual(['search', 'workout']);
    expect(r.flags).toEqual({ source: 'plex', take: '5' });
  });

  it('parses --bool flags as true when no value follows', () => {
    const r = parseArgv(['finance', 'accounts', '--refresh']);
    expect(r.flags.refresh).toBe(true);
  });

  it('treats subcommand-level --help as help-for-subcommand', () => {
    const r = parseArgv(['ha', '--help']);
    expect(r.subcommand).toBe('ha');
    expect(r.help).toBe(true);
  });

  it('stops flag parsing after --', () => {
    const r = parseArgv(['memory', 'write', 'notes', '--', '--literal-text']);
    expect(r.positional).toEqual(['write', 'notes', '--literal-text']);
    expect(r.flags).toEqual({});
  });

  it('preserves negative-number positionals (not flags)', () => {
    const r = parseArgv(['finance', 'add', '732539', '-50.00', 'Lunch']);
    expect(r.positional).toEqual(['add', '732539', '-50.00', 'Lunch']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/_argv.test.mjs`
Expected: FAIL — `Cannot find module '../../../cli/_argv.mjs'`

- [ ] **Step 3: Write minimal implementation**

Write `cli/_argv.mjs`:

```javascript
/**
 * Tiny dependency-free argv parser for dscli.
 *
 * Returns: { subcommand, positional, flags, help }
 *   - subcommand: first non-flag token, or null if none
 *   - positional: remaining non-flag tokens (action + args)
 *   - flags: { [key]: string | true } — `--key value` or `--key` (bool)
 *   - help: true if argv was empty or contained --help / -h at any position
 *
 * Conventions:
 *   - `--` ends flag parsing; everything after is positional
 *   - tokens that look like negative numbers (-50, -50.00) are positional
 *   - subcommand-level --help (e.g. `ha --help`) sets help=true with subcommand set
 */

export function parseArgv(argv) {
  const flags = {};
  const positional = [];
  let subcommand = null;
  let help = false;
  let stopFlagParsing = false;

  if (!argv || argv.length === 0) {
    return { subcommand: null, positional: [], flags: {}, help: true };
  }

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    if (!stopFlagParsing && tok === '--') {
      stopFlagParsing = true;
      continue;
    }

    if (!stopFlagParsing && (tok === '--help' || tok === '-h')) {
      help = true;
      continue;
    }

    // Treat tokens like "-50", "-50.00" as positional, not flags
    const isNumericLooking = /^-?\d+(\.\d+)?$/.test(tok);

    if (!stopFlagParsing && tok.startsWith('--') && !isNumericLooking) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--') || next === '-h') {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
      continue;
    }

    if (subcommand === null) {
      subcommand = tok;
    } else {
      positional.push(tok);
    }
  }

  return { subcommand, positional, flags, help };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/_argv.test.mjs`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/_argv.mjs tests/unit/cli/_argv.test.mjs
git commit -m "feat(dscli): tiny argv parser for CLI dispatcher"
```

---

## Task 2: Output helpers and exit codes

**Files:**
- Create: `cli/_output.mjs`
- Test: `tests/unit/cli/_output.test.mjs`

Centralizes the output contract from the spec — JSON to stdout, structured error JSON to stderr, named exit codes. Every command imports from here so the contract stays consistent.

- [ ] **Step 1: Write the failing test**

Write `tests/unit/cli/_output.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import {
  printJson,
  printError,
  EXIT_OK,
  EXIT_FAIL,
  EXIT_USAGE,
  EXIT_CONFIG,
  EXIT_BACKEND,
} from '../../../cli/_output.mjs';

function makeBuffer() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  stream.read = () => Buffer.concat(chunks).toString('utf8');
  return stream;
}

describe('exit code constants', () => {
  it('matches the contract in the spec', () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_FAIL).toBe(1);
    expect(EXIT_USAGE).toBe(2);
    expect(EXIT_CONFIG).toBe(3);
    expect(EXIT_BACKEND).toBe(4);
  });
});

describe('printJson', () => {
  it('writes a single JSON value followed by newline', () => {
    const buf = makeBuffer();
    printJson(buf, { hello: 'world' });
    expect(buf.read()).toBe('{"hello":"world"}\n');
  });

  it('serializes numbers, arrays, nested objects', () => {
    const buf = makeBuffer();
    printJson(buf, { count: 2, items: [{ a: 1 }, { a: 2 }] });
    expect(JSON.parse(buf.read().trim())).toEqual({ count: 2, items: [{ a: 1 }, { a: 2 }] });
  });
});

describe('printError', () => {
  it('writes a JSON error envelope to the given stream', () => {
    const buf = makeBuffer();
    printError(buf, { error: 'not_found', entity_id: 'light.x' });
    const parsed = JSON.parse(buf.read().trim());
    expect(parsed).toEqual({ error: 'not_found', entity_id: 'light.x' });
  });

  it('coerces an Error instance into { error: message }', () => {
    const buf = makeBuffer();
    printError(buf, new Error('boom'));
    const parsed = JSON.parse(buf.read().trim());
    expect(parsed.error).toBe('boom');
  });

  it('coerces a string into { error: <string> }', () => {
    const buf = makeBuffer();
    printError(buf, 'something went wrong');
    expect(JSON.parse(buf.read().trim())).toEqual({ error: 'something went wrong' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/_output.test.mjs`
Expected: FAIL — `Cannot find module '../../../cli/_output.mjs'`

- [ ] **Step 3: Write minimal implementation**

Write `cli/_output.mjs`:

```javascript
/**
 * Output contract for dscli.
 *
 * Success: single JSON value on stdout, newline-terminated, exit 0.
 * Error:   single JSON envelope on stderr, newline-terminated, non-zero exit.
 *
 * Exit codes match the spec at docs/superpowers/specs/2026-05-02-dscli-design.md.
 */

export const EXIT_OK      = 0;
export const EXIT_FAIL    = 1;
export const EXIT_USAGE   = 2;
export const EXIT_CONFIG  = 3;
export const EXIT_BACKEND = 4;

export function printJson(stream, value) {
  stream.write(JSON.stringify(value) + '\n');
}

export function printError(stream, errOrEnvelope) {
  let envelope;
  if (errOrEnvelope instanceof Error) {
    envelope = { error: errOrEnvelope.message };
  } else if (typeof errOrEnvelope === 'string') {
    envelope = { error: errOrEnvelope };
  } else if (errOrEnvelope && typeof errOrEnvelope === 'object') {
    envelope = errOrEnvelope.error ? errOrEnvelope : { error: 'unknown', ...errOrEnvelope };
  } else {
    envelope = { error: String(errOrEnvelope) };
  }
  stream.write(JSON.stringify(envelope) + '\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/_output.test.mjs`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/_output.mjs tests/unit/cli/_output.test.mjs
git commit -m "feat(dscli): output helpers and named exit codes"
```

---

## Task 3: Lazy bootstrap module

**Files:**
- Create: `cli/_bootstrap.mjs`
- Test: `tests/unit/cli/_bootstrap.test.mjs`

The lazy factory pattern is the heart of the spec's "no full backend startup" promise. A subcommand for HA never imports content code; a subcommand for finance never imports HA code. Each factory memoizes within a single CLI invocation so multiple commands in the same process don't double-instantiate.

For Task 3 we ship only `getConfigService()` and `getHttpClient()` — the prerequisites everything else needs. Later tasks add `getHaGateway()`, `getContentQuery()`, `getMemory()`, `getBuxfer()` in the same file.

- [ ] **Step 1: Write the failing test**

Write `tests/unit/cli/_bootstrap.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import yaml from 'js-yaml';

describe('cli/_bootstrap.mjs', () => {
  let tmpRoot;
  let originalBasePath;
  let bootstrap;

  beforeEach(async () => {
    // Build a minimal but valid data tree so ConfigService can initialize.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dscli-boot-'));
    const dataDir = path.join(tmpRoot, 'data');
    const sysDir = path.join(dataDir, 'system', 'config');
    await fs.mkdir(sysDir, { recursive: true });
    await fs.writeFile(path.join(sysDir, 'system.yml'), yaml.dump({
      system: {
        dataDir,
        baseDir: tmpRoot,
        defaultHouseholdId: 'household',
        timezone: 'America/Los_Angeles',
      },
      secrets: { provider: 'yaml' },
    }));
    // Minimal household so validators don't reject the tree.
    await fs.mkdir(path.join(dataDir, 'household', 'config'), { recursive: true });

    originalBasePath = process.env.DAYLIGHT_BASE_PATH;
    process.env.DAYLIGHT_BASE_PATH = tmpRoot;

    // Reset the ConfigService singleton between tests so each gets a clean init.
    const cfgMod = await import('#system/config/index.mjs');
    cfgMod.resetConfigService();

    // Re-import bootstrap fresh so its memoization is reset.
    const bustQuery = `?t=${Date.now()}_${Math.random()}`;
    bootstrap = await import('../../../cli/_bootstrap.mjs' + bustQuery);
  });

  afterEach(async () => {
    process.env.DAYLIGHT_BASE_PATH = originalBasePath;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('getConfigService() initializes from DAYLIGHT_BASE_PATH', async () => {
    const cfg = await bootstrap.getConfigService();
    expect(cfg).toBeTruthy();
    expect(typeof cfg.getDataDir).toBe('function');
    expect(cfg.getDataDir()).toBe(path.join(tmpRoot, 'data'));
  });

  it('getConfigService() memoizes — second call returns same instance', async () => {
    const a = await bootstrap.getConfigService();
    const b = await bootstrap.getConfigService();
    expect(a).toBe(b);
  });

  it('getHttpClient() returns an object with a request method', () => {
    const http = bootstrap.getHttpClient();
    expect(http).toBeTruthy();
    expect(typeof http.request).toBe('function');
  });

  it('getHttpClient() memoizes', () => {
    expect(bootstrap.getHttpClient()).toBe(bootstrap.getHttpClient());
  });

  it('getConfigService() throws EXIT_CONFIG-mapped error when DAYLIGHT_BASE_PATH is unset', async () => {
    delete process.env.DAYLIGHT_BASE_PATH;
    const { resetConfigService } = await import('#system/config/index.mjs');
    resetConfigService();
    const bustQuery = `?t=${Date.now()}_${Math.random()}`;
    const fresh = await import('../../../cli/_bootstrap.mjs' + bustQuery);
    await expect(fresh.getConfigService()).rejects.toThrow(/DAYLIGHT_BASE_PATH/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/_bootstrap.test.mjs`
Expected: FAIL — `Cannot find module '../../../cli/_bootstrap.mjs'`

- [ ] **Step 3: Write minimal implementation**

Write `cli/_bootstrap.mjs`:

```javascript
/**
 * Lazy memoized factories for dscli command implementations.
 *
 * Each factory returns the same instance on repeated calls within one CLI
 * invocation. Commands import only the factories they need — `dscli ha state`
 * never pays the cost of constructing the content registry.
 *
 * To add a new factory: declare a module-level cache var, write an exported
 * async function that initializes once, and wire any cross-cutting deps from
 * the existing factories.
 */

import path from 'node:path';
import { initConfigService, getConfigService as getInstance, resetConfigService } from '#system/config/index.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';

let _configService = null;
let _configInitPromise = null;
let _httpClient = null;

/**
 * Resolve the data directory the same way backend/index.js does:
 *   - In Docker: hard-coded /usr/src/app/data
 *   - Otherwise: $DAYLIGHT_BASE_PATH/data
 */
function resolveDataDir() {
  // Heuristic: in Docker, /usr/src/app exists; outside it usually doesn't.
  // Honor an explicit override first.
  if (process.env.DAYLIGHT_BASE_PATH) {
    return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  }
  // Last resort: assume Docker layout.
  return '/usr/src/app/data';
}

export async function getConfigService() {
  if (_configService) return _configService;
  if (_configInitPromise) return _configInitPromise;

  if (!process.env.DAYLIGHT_BASE_PATH && !process.env.DAYLIGHT_DATA_PATH) {
    // Allow Docker case (no env, but /usr/src/app exists) — but for tests and
    // host-direct usage, demand DAYLIGHT_BASE_PATH so we fail loud, not silent.
    const fs = await import('node:fs');
    if (!fs.existsSync('/usr/src/app/data')) {
      throw new Error(
        'DAYLIGHT_BASE_PATH not set and /usr/src/app/data does not exist. ' +
        'Set DAYLIGHT_BASE_PATH to point at the directory containing data/ and media/.'
      );
    }
  }

  _configInitPromise = (async () => {
    try {
      // If a previous init left the singleton populated, reuse it.
      _configService = getInstance();
      return _configService;
    } catch {
      // Not initialized yet — do it now.
      const dataDir = resolveDataDir();
      _configService = await initConfigService(dataDir);
      return _configService;
    }
  })();

  return _configInitPromise;
}

export function getHttpClient() {
  if (_httpClient) return _httpClient;
  _httpClient = new HttpClient();
  return _httpClient;
}

/**
 * Reset all memoized state. For tests only.
 */
export function _resetForTests() {
  _configService = null;
  _configInitPromise = null;
  _httpClient = null;
  resetConfigService();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/_bootstrap.test.mjs`
Expected: PASS — all 5 tests green.

If `HttpClient` constructor signature differs from `new HttpClient()` (no-arg), check `backend/src/0_system/services/HttpClient.mjs` and adjust — pass an empty options object or whatever it requires. The contract from this task is just "memoized object with a `.request` method".

- [ ] **Step 5: Commit**

```bash
git add cli/_bootstrap.mjs tests/unit/cli/_bootstrap.test.mjs
git commit -m "feat(dscli): lazy memoized bootstrap (config + http)"
```

---

## Task 4: Entry + dispatcher

**Files:**
- Create: `cli/dscli.mjs`
- Test: `tests/unit/cli/dscli.test.mjs`

The entry parses argv with the parser from Task 1, dispatches to a command module via dynamic import (so `dscli ha state X` doesn't pay the cost of importing finance code), and exits with the command's exit code. With no command yet implemented, this task wires up `--help` and the unknown-subcommand path.

- [ ] **Step 1: Write the failing test**

Write `tests/unit/cli/dscli.test.mjs`:

```javascript
// @vitest-environment node
/**
 * Subprocess test of the dscli entry. Spawns `node cli/dscli.mjs ...` and
 * asserts on exit code + stdout + stderr. Mirrors the pattern in
 * tests/unit/cli/ingest-health-archive.test.mjs.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'dscli.mjs');

async function runDscli(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      cwd: REPO_ROOT,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    return { exitCode: err.code ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('cli/dscli.mjs entry', () => {
  it('prints help and exits 0 with no args', async () => {
    const { exitCode, stdout } = await runDscli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/dscli/);
    expect(stdout).toMatch(/Usage/i);
  });

  it('prints help and exits 0 with --help', async () => {
    const { exitCode, stdout } = await runDscli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Subcommands/i);
  });

  it('exits 2 with usage error on unknown subcommand', async () => {
    const { exitCode, stderr } = await runDscli(['nonsense-subcommand']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/unknown subcommand/i);
    expect(stderr).toMatch(/nonsense-subcommand/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/dscli.test.mjs`
Expected: FAIL — `Cannot find module 'cli/dscli.mjs'`

- [ ] **Step 3: Write minimal implementation**

Write `cli/dscli.mjs`:

```javascript
#!/usr/bin/env node
/**
 * dscli — DaylightStation CLI.
 *
 * Entry point. Parses argv, dispatches to cli/commands/<subcommand>.mjs via
 * dynamic import, exits with the command's returned exit code.
 *
 * See docs/superpowers/specs/2026-05-02-dscli-design.md for the full contract.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './_argv.mjs';
import { printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './_output.mjs';
import * as bootstrap from './_bootstrap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, 'commands');

// Subcommands wired up so far. Add to this list as new command modules land.
const KNOWN_SUBCOMMANDS = ['system', 'ha', 'content', 'memory', 'finance'];

function printTopLevelHelp(stdout) {
  stdout.write([
    'dscli — DaylightStation CLI',
    '',
    'Usage:',
    '  dscli <subcommand> [action] [args...] [--flags]',
    '  dscli --help',
    '  dscli <subcommand> --help',
    '',
    'Subcommands:',
    '  system    Health, config, reload',
    '  ha        Home Assistant entity state and control',
    '  content   Search and resolve media content',
    '  memory    Read concierge memory state',
    '  finance   Buxfer accounts and transactions',
    '',
    'Output:',
    '  JSON to stdout on success (exit 0).',
    '  JSON error to stderr on failure (exit 1+).',
    '',
    'See docs/superpowers/specs/2026-05-02-dscli-design.md for the full contract.',
    '',
  ].join('\n'));
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgv(argv);

  // Top-level --help or no args
  if (!parsed.subcommand) {
    printTopLevelHelp(process.stdout);
    process.exit(EXIT_OK);
  }

  if (!KNOWN_SUBCOMMANDS.includes(parsed.subcommand)) {
    process.stderr.write(`dscli: unknown subcommand: ${parsed.subcommand}\n`);
    process.stderr.write(`Run \`dscli --help\` for the list of subcommands.\n`);
    process.exit(EXIT_USAGE);
  }

  // Dynamic import scopes startup cost to only the command being run.
  let mod;
  try {
    mod = await import(path.join(COMMANDS_DIR, `${parsed.subcommand}.mjs`));
  } catch (err) {
    printError(process.stderr, { error: 'subcommand_load_failed', subcommand: parsed.subcommand, message: err.message });
    process.exit(EXIT_FAIL);
  }

  const command = mod.default;
  if (!command || typeof command.run !== 'function') {
    printError(process.stderr, { error: 'invalid_command_module', subcommand: parsed.subcommand });
    process.exit(EXIT_FAIL);
  }

  // Build deps bag: real streams + bootstrap factories + global fetch.
  const deps = {
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    getConfigService: bootstrap.getConfigService,
    getHttpClient: bootstrap.getHttpClient,
    // Later tasks add: getHaGateway, getContentQuery, getMemory, getBuxfer
  };

  try {
    const result = await command.run(parsed, deps);
    const code = (result && typeof result.exitCode === 'number') ? result.exitCode : EXIT_OK;
    process.exit(code);
  } catch (err) {
    printError(process.stderr, err);
    process.exit(EXIT_FAIL);
  }
}

main();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/dscli.test.mjs`
Expected: PASS — 3 tests green.

Also try a manual smoke:
```bash
node cli/dscli.mjs --help
node cli/dscli.mjs nope
echo "exit: $?"
```
Expected: help text, then "unknown subcommand" with exit 2.

- [ ] **Step 5: Commit**

```bash
git add cli/dscli.mjs tests/unit/cli/dscli.test.mjs
git commit -m "feat(dscli): entry point with subcommand dispatcher"
```

---

## Task 5: `dscli system health` — first real command

**Files:**
- Create: `cli/commands/system.mjs`
- Test: `tests/unit/cli/commands/system.test.mjs`

The first command end-to-end. `system health` hits the local backend's existing `GET /api/v1/system/version` (or equivalent — check what's there) and emits JSON. It exercises the full path: argv parsing → dispatch → command run → JSON output → exit code. No application services needed; just `fetch`.

The exact backend endpoint may differ. Before writing the implementation, **find the correct URL**: grep `backend/src/4_api/v1/routers` for routes that report version / health / status. Use whichever exists. If none does, the command should still work — it should just report `{ ok: false, error: '...' }` with exit 4.

- [ ] **Step 1: Discover the actual backend health URL**

Run: `grep -rn 'router\\.get.*\\/version\\|router\\.get.*\\/health\\|router\\.get.*\\/status' backend/src/4_api/v1/routers/ | head -10`

Pick the most appropriate route. If multiple exist, prefer `/api/v1/system/version` or similar. Note the URL — you'll embed it in the command implementation. If nothing matches, use `/api/v1/health` as the assumed endpoint and document the gap in the commit message; the command will return exit 4 if it 404s, which is the correct behavior.

- [ ] **Step 2: Write the failing test**

Write `tests/unit/cli/commands/system.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import system from '../../../../cli/commands/system.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) { stdoutChunks.push(chunk); cb(); },
  });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({
    write(chunk, _enc, cb) { stderrChunks.push(chunk); cb(); },
  });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/system', () => {
  describe('health action', () => {
    it('emits JSON with backend reachability info on success', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => ({
        ok: true,
        status: 200,
        async json() { return { version: 'abc123', commit: 'abc123' }; },
      });

      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.ok).toBe(true);
      expect(out.backend.reachable).toBe(true);
      expect(out.backend.version).toBe('abc123');
    });

    it('exits 4 (EXIT_BACKEND) when fetch throws (backend unreachable)', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };

      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );

      expect(result.exitCode).toBe(4);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('backend_unreachable');
    });

    it('exits 4 when backend responds non-2xx', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => ({ ok: false, status: 503, async json() { return {}; } });

      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );

      expect(result.exitCode).toBe(4);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('backend_unhealthy');
      expect(err.status).toBe(503);
    });

    it('honors DSCLI_BACKEND_URL env var as base URL', async () => {
      const { stdout } = makeBuffers();
      let capturedUrl;
      const fakeFetch = async (url) => {
        capturedUrl = url;
        return { ok: true, status: 200, async json() { return { version: 'x' }; } };
      };

      const original = process.env.DSCLI_BACKEND_URL;
      process.env.DSCLI_BACKEND_URL = 'http://example.invalid:9999';
      try {
        await system.run(
          { subcommand: 'system', positional: ['health'], flags: {}, help: false },
          { stdout, stderr: makeBuffers().stderr, fetch: fakeFetch },
        );
        expect(capturedUrl.startsWith('http://example.invalid:9999/')).toBe(true);
      } finally {
        if (original === undefined) delete process.env.DSCLI_BACKEND_URL;
        else process.env.DSCLI_BACKEND_URL = original;
      }
    });
  });

  describe('unknown action', () => {
    it('exits 2 with usage error', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['fly'], flags: {}, help: false },
        { stdout, stderr },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/system/i);
      expect(stdout.read()).toMatch(/health/i);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/commands/system.test.mjs`
Expected: FAIL — `Cannot find module 'cli/commands/system.mjs'`

- [ ] **Step 4: Write minimal implementation**

Write `cli/commands/system.mjs`:

```javascript
/**
 * dscli system — system-level operations against the running backend.
 *
 * Actions:
 *   dscli system health   — Check backend reachability and version.
 *
 * The backend URL defaults to http://localhost:3111 (matching the configured
 * app port). Override with DSCLI_BACKEND_URL.
 */

import { printJson, printError, EXIT_OK, EXIT_USAGE, EXIT_BACKEND } from '../_output.mjs';

const HELP = `
dscli system — system operations

Usage:
  dscli system <action> [flags]

Actions:
  health    Check backend reachability + version
            Returns: { ok, backend: { reachable, status, version } }

Environment:
  DSCLI_BACKEND_URL    Base URL of the running backend (default: http://localhost:3111)
`.trimStart();

function backendUrl() {
  return process.env.DSCLI_BACKEND_URL || 'http://localhost:3111';
}

async function actionHealth(args, deps) {
  const url = backendUrl() + '/api/v1/system/version';
  const fetchFn = deps.fetch || globalThis.fetch;

  let response;
  try {
    response = await fetchFn(url);
  } catch (err) {
    printError(deps.stderr, { error: 'backend_unreachable', url, message: err.message });
    return { exitCode: EXIT_BACKEND };
  }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url, status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    // Some endpoints return text; tolerate that.
  }

  printJson(deps.stdout, {
    ok: true,
    backend: {
      reachable: true,
      status: response.status,
      url,
      version: body.version ?? body.commit ?? null,
      ...body,
    },
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  health: actionHealth,
};

export default {
  name: 'system',
  description: 'System operations: health',
  requiresBackend: true,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli system: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/commands/system.test.mjs`
Expected: PASS — 6 tests green.

Also re-run the dispatcher test to confirm nothing regressed:
```bash
npx vitest run tests/unit/cli/dscli.test.mjs
```
Expected: PASS — 3 tests green.

- [ ] **Step 6: Manual smoke test against running backend**

If the backend is running on this host:
```bash
node cli/dscli.mjs system health | jq .
```
Expected: JSON with `ok: true`, `backend.reachable: true`, and a version string. Exit 0.

If the backend isn't running:
```bash
node cli/dscli.mjs system health
echo "exit: $?"
```
Expected: JSON error envelope to stderr, exit 4.

- [ ] **Step 7: Commit**

```bash
git add cli/commands/system.mjs tests/unit/cli/commands/system.test.mjs
git commit -m "feat(dscli): system health subcommand (backend reachability + version)"
```

---

## Task 6: `dscli ha state <entityId>` + HA gateway factory

**Files:**
- Modify: `cli/_bootstrap.mjs` — add `getHaGateway()` factory
- Create: `cli/commands/ha.mjs`
- Test: `tests/unit/cli/commands/ha.test.mjs`

Adds the first command that uses an application-layer service (the HA gateway), establishing the pattern for all future direct-import commands. Read `backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs` first — it documents the port surface and exports the `assertHomeAutomationGateway` / `isHomeAutomationGateway` / `createNoOpGateway` helpers used below.

The thin fakes used in the command tests (`{ async getState() {...} }`) intentionally do NOT satisfy the full port — they're scoped to just the methods this command touches. The dedicated bootstrap test in this task verifies the port-discipline contract separately so a future command that calls `gateway.callService(...)` against an under-stubbed fake will be caught when its own tests are written.

- [ ] **Step 1: Add `getHaGateway()` to `_bootstrap.mjs`**

The factory returns an `IHomeAutomationGateway` (the port from `backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs`). It constructs a `HomeAssistantAdapter` (which implements that port), runs it through `assertHomeAutomationGateway()` to verify the contract, then returns it. Commands then only call port-level methods and never depend on provider-specific quirks.

Edit `cli/_bootstrap.mjs`. Add at the imports:

```javascript
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';
import { assertHomeAutomationGateway } from '#apps/home-automation/ports/IHomeAutomationGateway.mjs';
```

Add a cache var near the others:

```javascript
let _haGateway = null;
let _haInitPromise = null;
```

Add the factory function before `_resetForTests`:

```javascript
/**
 * Build the household's Home Assistant gateway.
 *
 * Returns an IHomeAutomationGateway (the port interface — never the concrete
 * adapter). Throws if HA isn't configured; commands map that to EXIT_CONFIG.
 *
 * Future improvement: when integration is missing, return createNoOpGateway()
 * instead of throwing, so `dscli ha state X` can degrade to a clean
 * "provider not configured" response. Out of scope for the foundation.
 */
export async function getHaGateway() {
  if (_haGateway) return _haGateway;
  if (_haInitPromise) return _haInitPromise;

  _haInitPromise = (async () => {
    const cfg = await getConfigService();
    const integration = cfg.getHouseholdIntegration(null, 'homeassistant');
    if (!integration) {
      throw new Error('Home Assistant integration not configured for default household.');
    }
    const auth = cfg.getHouseholdAuth('homeassistant');
    if (!auth?.token) {
      throw new Error('Home Assistant auth token missing (data/household/auth/homeassistant.yml).');
    }
    const baseUrl = integration.host || integration.baseUrl || integration.url;
    if (!baseUrl) {
      throw new Error('Home Assistant baseUrl missing in integration config.');
    }
    const gateway = new HomeAssistantAdapter(
      { baseUrl, token: auth.token },
      { httpClient: getHttpClient() },
    );
    // Verify the constructed adapter satisfies the port contract once at
    // bootstrap time — catches programmer error early, near construction,
    // instead of at the first `gateway.callService(...)` call.
    assertHomeAutomationGateway(gateway);
    _haGateway = gateway;
    return _haGateway;
  })();

  return _haInitPromise;
}
```

Add `_haGateway = null; _haInitPromise = null;` to `_resetForTests()`.

> **Important:** the integration config field name (`host` vs `baseUrl` vs `url`) and auth field name vary by codebase convention. **Before writing this code, grep for how the existing backend constructs `HomeAssistantAdapter`** — see `backend/src/0_system/bootstrap.mjs` `createHomeAutomationAdapters` (around line 1476) for the gateway-passing pattern, and `backend/src/app.mjs` for how the adapter itself is built from integration config. Mirror the exact field names there. The factory above is the correct shape; field names may need a small tweak.

- [ ] **Step 2: Add `getHaGateway` to the deps bag in `dscli.mjs`**

Edit `cli/dscli.mjs`. In the `deps` object construction, add the line:

```javascript
    getHaGateway: bootstrap.getHaGateway,
```

so it becomes:

```javascript
  const deps = {
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    getConfigService: bootstrap.getConfigService,
    getHttpClient: bootstrap.getHttpClient,
    getHaGateway: bootstrap.getHaGateway,
  };
```

- [ ] **Step 3: Write the failing test**

Write `tests/unit/cli/commands/ha.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import ha from '../../../../cli/commands/ha.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/ha', () => {
  describe('state action', () => {
    it('emits JSON for an existing entity', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeGateway = {
        async getState(id) {
          if (id === 'light.office_main') {
            return {
              entityId: 'light.office_main',
              state: 'off',
              attributes: { friendly_name: 'Office Main' },
              lastChanged: '2026-05-02T00:00:00Z',
            };
          }
          return null;
        },
      };

      const result = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.office_main'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.entity_id).toBe('light.office_main');
      expect(out.state).toBe('off');
      expect(out.attributes.friendly_name).toBe('Office Main');
    });

    it('exits 1 with not_found for a missing entity', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeGateway = { async getState() { return null; } };

      const result = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.does_not_exist'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway },
      );

      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.entity_id).toBe('light.does_not_exist');
    });

    it('exits 2 (EXIT_USAGE) when entity_id is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: ['state'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async getState() { return null; } }) },
      );

      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/entity_id/i);
    });

    it('exits 3 (EXIT_CONFIG) when getHaGateway() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.x'], flags: {}, help: false },
        {
          stdout,
          stderr,
          getHaGateway: async () => { throw new Error('integration not configured'); },
        },
      );

      expect(result.exitCode).toBe(3);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('config_error');
      expect(err.message).toMatch(/integration not configured/);
    });

    it('test fakes that satisfy the IHomeAutomationGateway port pass isHomeAutomationGateway()', async () => {
      // Sanity check on the port-vs-adapter discipline: the fake we use in
      // these tests should look like a real gateway from the port's perspective.
      // If isHomeAutomationGateway() rejects it, our fake is too thin and
      // command code calling other port methods would silently misbehave.
      const { isHomeAutomationGateway } = await import('#apps/home-automation/ports/IHomeAutomationGateway.mjs');
      const fakeGateway = {
        async getState() { return null; },
        async getStates() { return new Map(); },
        async getHistory() { return new Map(); },
        async callService() { return { ok: true }; },
        async activateScene() { return { ok: true }; },
      };
      expect(isHomeAutomationGateway(fakeGateway)).toBe(true);
    });
  });

  describe('unknown action', () => {
    it('exits 2 with usage error', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: ['fly'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/state/);
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/commands/ha.test.mjs`
Expected: FAIL — `Cannot find module 'cli/commands/ha.mjs'`

- [ ] **Step 5: Write minimal implementation**

Write `cli/commands/ha.mjs`:

```javascript
/**
 * dscli ha — Home Assistant operations.
 *
 * Actions:
 *   dscli ha state <entity_id>   — Get current state + attributes for one entity.
 *
 * Auth + base URL come from the household's homeassistant integration
 * (data/household/config/integrations.yml + data/household/auth/homeassistant.yml).
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli ha — Home Assistant operations

Usage:
  dscli ha <action> [args] [flags]

Actions:
  state <entity_id>    Get current state + attributes
                       Returns: { entity_id, state, attributes, last_changed }

Examples:
  dscli ha state light.office_main
  dscli ha state binary_sensor.front_door
`.trimStart();

/**
 * `dscli ha state <entity_id>` — get current state via the home automation port.
 *
 * `gateway` is an IHomeAutomationGateway (port), not a concrete adapter. We only
 * call port methods (getState here) so the command stays provider-agnostic.
 *
 * @param {{ positional: string[], flags: Record<string, string|boolean> }} args
 * @param {Object} deps - getHaGateway() returns Promise<IHomeAutomationGateway>
 */
async function actionState(args, deps) {
  const entityId = args.positional[1];
  if (!entityId) {
    deps.stderr.write('dscli ha state: missing required <entity_id>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let gateway;
  try {
    gateway = await deps.getHaGateway();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const state = await gateway.getState(entityId);
  if (!state) {
    printError(deps.stderr, { error: 'not_found', entity_id: entityId });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, {
    entity_id: state.entityId,
    state: state.state,
    attributes: state.attributes,
    last_changed: state.lastChanged ?? null,
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  state: actionState,
};

export default {
  name: 'ha',
  description: 'Home Assistant entity state',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli ha: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/commands/ha.test.mjs tests/unit/cli/_bootstrap.test.mjs tests/unit/cli/dscli.test.mjs`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add cli/_bootstrap.mjs cli/dscli.mjs cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): ha state subcommand + HomeAssistantAdapter bootstrap factory"
```

---

## Task 7: `dscli content search "<query>"` + content query factory

**Files:**
- Modify: `cli/_bootstrap.mjs` — add `getContentQuery()`
- Create: `cli/commands/content.mjs`
- Test: `tests/unit/cli/commands/content.test.mjs`

`ContentQueryService` requires a `ContentSourceRegistry` that's populated with the configured adapters. Reuse the existing `createContentRegistry` factory from `backend/src/0_system/bootstrap.mjs` rather than rewiring all the adapters by hand.

- [ ] **Step 1: Add `getContentQuery()` to `_bootstrap.mjs`**

Edit `cli/_bootstrap.mjs`. Add cache vars:

```javascript
let _contentQuery = null;
let _contentInitPromise = null;
```

Add the factory:

```javascript
export async function getContentQuery() {
  if (_contentQuery) return _contentQuery;
  if (_contentInitPromise) return _contentInitPromise;

  _contentInitPromise = (async () => {
    const cfg = await getConfigService();
    // Reuse the same wiring the backend uses so adapters are configured identically.
    const { createContentRegistry } = await import('#system/bootstrap.mjs');
    const { ContentQueryService } = await import('#apps/content/ContentQueryService.mjs');
    const registry = createContentRegistry(
      { configService: cfg, httpClient: getHttpClient() },
      {},
    );
    _contentQuery = new ContentQueryService({ registry });
    return _contentQuery;
  })();

  return _contentInitPromise;
}
```

> **Important:** `createContentRegistry` may take a different parameter shape — check `backend/src/0_system/bootstrap.mjs` around line 451 and mirror exactly what's there. If it requires `mediaProgressMemory` or other deps for full functionality, pass `null`/`undefined` for the optional ones in the CLI path; search-only mode should not require them. If the factory throws when called without the full bag, the test in step 5 will fail loudly and you can iterate.

Add `_contentQuery` and `_contentInitPromise` to `_resetForTests()`.

Add to `dscli.mjs` deps bag:

```javascript
    getContentQuery: bootstrap.getContentQuery,
```

- [ ] **Step 2: Write the failing test**

Write `tests/unit/cli/commands/content.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import content from '../../../../cli/commands/content.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/content', () => {
  describe('search action', () => {
    it('emits JSON with results array and count', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeQuery = {
        async search(query) {
          return {
            items: [
              { source: 'plex', localId: '642120', title: 'Workout Mix', type: 'playlist' },
              { source: 'plex', localId: '642121', title: 'Workout Vol 2', type: 'playlist' },
            ],
            total: 2,
            sources: ['plex'],
          };
        },
      };

      const result = await content.run(
        { subcommand: 'content', positional: ['search', 'workout'], flags: { take: '5' }, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.results).toHaveLength(2);
      expect(out.count).toBe(2);
      expect(out.results[0].title).toBe('Workout Mix');
    });

    it('passes query text to the service unchanged', async () => {
      const { stdout, stderr } = makeBuffers();
      let capturedQuery;
      const fakeQuery = {
        async search(q) {
          capturedQuery = q;
          return { items: [], total: 0, sources: [] };
        },
      };

      await content.run(
        { subcommand: 'content', positional: ['search', 'plex:', 'workout', 'mix'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );

      // Should join positional[1..] with spaces
      expect(capturedQuery).toBe('plex: workout mix');
    });

    it('exits 2 when query text is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await content.run(
        { subcommand: 'content', positional: ['search'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async search() { return {}; } }) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/query/i);
    });

    it('exits 0 with empty results array on no matches', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeQuery = { async search() { return { items: [], total: 0, sources: [] }; } };

      const result = await content.run(
        { subcommand: 'content', positional: ['search', 'nothing'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.results).toEqual([]);
      expect(out.count).toBe(0);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await content.run(
        { subcommand: 'content', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/search/);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/commands/content.test.mjs`
Expected: FAIL — `Cannot find module 'cli/commands/content.mjs'`

- [ ] **Step 4: Write minimal implementation**

Write `cli/commands/content.mjs`:

```javascript
/**
 * dscli content — content search and resolution.
 *
 * Actions:
 *   dscli content search "<query>" [--take N]   — Search across all configured sources.
 *
 * Returns: { results: [...], count, sources }
 */

import { printJson, printError, EXIT_OK, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli content — content search

Usage:
  dscli content <action> [args] [flags]

Actions:
  search "<query>" [--take N]
              Search media content across configured sources.
              Returns: { results, count, sources }

Examples:
  dscli content search "workout playlist"
  dscli content search "plex: cartoon" --take 3
`.trimStart();

async function actionSearch(args, deps) {
  // positional[0] is "search"; remainder is the query (joined with spaces
  // so unquoted multi-word queries still work).
  const query = args.positional.slice(1).join(' ').trim();
  if (!query) {
    deps.stderr.write('dscli content search: missing required query text\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let queryService;
  try {
    queryService = await deps.getContentQuery();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const result = await queryService.search(query);
  const items = Array.isArray(result?.items) ? result.items : [];
  const take = parseInt(args.flags.take, 10);
  const results = Number.isFinite(take) && take > 0 ? items.slice(0, take) : items;

  printJson(deps.stdout, {
    results,
    count: results.length,
    sources: result?.sources ?? [],
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  search: actionSearch,
};

export default {
  name: 'content',
  description: 'Content search across media sources',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli content: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/commands/content.test.mjs`
Expected: PASS — 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add cli/_bootstrap.mjs cli/dscli.mjs cli/commands/content.mjs tests/unit/cli/commands/content.test.mjs
git commit -m "feat(dscli): content search subcommand + ContentQueryService bootstrap factory"
```

---

## Task 8: `dscli memory get <key>` + `dscli memory list` + memory factory

**Files:**
- Modify: `cli/_bootstrap.mjs` — add `getMemory()`
- Create: `cli/commands/memory.mjs`
- Test: `tests/unit/cli/commands/memory.test.mjs`

`YamlConciergeMemoryAdapter` exposes `get(key)`, `set(key, value)`, `merge(key, partial)`. It does NOT expose a `list()` for keys — to provide `dscli memory list`, the CLI command needs to enumerate keys from the underlying YAML file. The simplest way is to dump the underlying state object via the working memory adapter the concierge memory wraps. **For this task we implement `list` as "dump the entire memory object" — listing all keys is implicit in that.** A future plan can refine this with a real key-enumeration API.

- [ ] **Step 1: Add `getMemory()` to `_bootstrap.mjs`**

Add cache vars:

```javascript
let _memory = null;
let _memoryInitPromise = null;
```

Add the factory:

```javascript
export async function getMemory() {
  if (_memory) return _memory;
  if (_memoryInitPromise) return _memoryInitPromise;

  _memoryInitPromise = (async () => {
    await getConfigService();
    const { dataService } = await import('#system/config/index.mjs');
    const { YamlWorkingMemoryAdapter } = await import('#adapters/persistence/yaml/YamlWorkingMemoryAdapter.mjs');
    const { YamlConciergeMemoryAdapter } = await import('#adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs');
    const workingMemory = new YamlWorkingMemoryAdapter({ dataService });
    _memory = new YamlConciergeMemoryAdapter({ workingMemory });
    // Also expose the raw working memory so the `list` action can dump everything.
    _memory.__workingMemory = workingMemory;
    return _memory;
  })();

  return _memoryInitPromise;
}
```

> **Important:** the constructors of `YamlWorkingMemoryAdapter` may need a `logger` parameter. Check `backend/src/0_system/bootstrap.mjs` around line 3190 (`createConciergeServices`) and mirror the call. Use `console` as the logger if simpler.

Add to `_resetForTests()` and the `dscli.mjs` deps bag:

```javascript
    getMemory: bootstrap.getMemory,
```

- [ ] **Step 2: Write the failing test**

Write `tests/unit/cli/commands/memory.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import memory from '../../../../cli/commands/memory.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

function fakeMemory(initialState = {}) {
  const state = { ...initialState };
  const workingMemory = {
    async loadAll() { return state; },
  };
  return {
    async get(key) { return state[key] ?? null; },
    async set(key, value) { state[key] = value; },
    __workingMemory: workingMemory,
  };
}

describe('cli/commands/memory', () => {
  describe('get action', () => {
    it('emits JSON wrapping the value for an existing key', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({ notes: ['call dad', 'pick up groceries'] });

      const result = await memory.run(
        { subcommand: 'memory', positional: ['get', 'notes'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.key).toBe('notes');
      expect(out.value).toEqual(['call dad', 'pick up groceries']);
    });

    it('exits 1 with not_found when key is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({});

      const result = await memory.run(
        { subcommand: 'memory', positional: ['get', 'unknown_key'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.key).toBe('unknown_key');
    });

    it('exits 2 when key is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await memory.run(
        { subcommand: 'memory', positional: ['get'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => fakeMemory({}) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/key/i);
    });
  });

  describe('list action', () => {
    it('emits JSON with all keys and a values dump', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({ notes: ['a'], preferences: { dietary: 'low-carb' } });

      const result = await memory.run(
        { subcommand: 'memory', positional: ['list'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.keys).toEqual(expect.arrayContaining(['notes', 'preferences']));
      expect(out.count).toBe(2);
      expect(out.values).toEqual({ notes: ['a'], preferences: { dietary: 'low-carb' } });
    });

    it('emits empty list for empty memory', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({});

      const result = await memory.run(
        { subcommand: 'memory', positional: ['list'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.keys).toEqual([]);
      expect(out.count).toBe(0);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await memory.run(
        { subcommand: 'memory', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/get/);
      expect(stdout.read()).toMatch(/list/);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/commands/memory.test.mjs`
Expected: FAIL — `Cannot find module 'cli/commands/memory.mjs'`

- [ ] **Step 4: Write minimal implementation**

Write `cli/commands/memory.mjs`:

```javascript
/**
 * dscli memory — read concierge memory state.
 *
 * Actions:
 *   dscli memory get <key>   — Get value for one memory key.
 *   dscli memory list        — Dump all memory keys + values.
 *
 * Reads from the YAML-backed concierge memory store the agent uses.
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli memory — concierge memory state

Usage:
  dscli memory <action> [args]

Actions:
  get <key>    Read value for one memory key.
               Returns: { key, value }
  list         Dump all memory keys + values.
               Returns: { keys, count, values }
`.trimStart();

async function actionGet(args, deps) {
  const key = args.positional[1];
  if (!key) {
    deps.stderr.write('dscli memory get: missing required <key>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let memory;
  try {
    memory = await deps.getMemory();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const value = await memory.get(key);
  if (value === null || value === undefined) {
    printError(deps.stderr, { error: 'not_found', key });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, { key, value });
  return { exitCode: EXIT_OK };
}

async function actionList(args, deps) {
  let memory;
  try {
    memory = await deps.getMemory();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const workingMemory = memory.__workingMemory;
  const state = workingMemory && typeof workingMemory.loadAll === 'function'
    ? await workingMemory.loadAll()
    : {};
  const values = (state && typeof state === 'object' && !Array.isArray(state)) ? state : {};
  const keys = Object.keys(values);

  printJson(deps.stdout, { keys, count: keys.length, values });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  get: actionGet,
  list: actionList,
};

export default {
  name: 'memory',
  description: 'Read concierge memory state',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli memory: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
```

> **Note:** the `list` action assumes `YamlWorkingMemoryAdapter` exposes a `loadAll()` method that returns the full state object. Check `backend/src/1_adapters/persistence/yaml/YamlWorkingMemoryAdapter.mjs` for the actual method name. If it's named differently (e.g. `read()`, `getAll()`, `getState()`), adjust both the bootstrap factory's `__workingMemory` exposure and the `actionList` reference. The fake in the test mirrors whatever you choose, so name them consistently.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/commands/memory.test.mjs`
Expected: PASS — 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add cli/_bootstrap.mjs cli/dscli.mjs cli/commands/memory.mjs tests/unit/cli/commands/memory.test.mjs
git commit -m "feat(dscli): memory get/list subcommands + YamlConciergeMemoryAdapter bootstrap factory"
```

---

## Task 9: `dscli finance accounts` + Buxfer factory

**Files:**
- Modify: `cli/_bootstrap.mjs` — add `getBuxfer()`
- Create: `cli/commands/finance.mjs`
- Test: `tests/unit/cli/commands/finance.test.mjs`

Returns the list of Buxfer accounts (id, name, balance) as JSON. The standalone `cli/buxfer.cli.mjs` will eventually be folded into `dscli finance --direct` (Phase D) but stays as-is for this plan.

- [ ] **Step 1: Add `getBuxfer()` to `_bootstrap.mjs`**

Add cache vars:

```javascript
let _buxfer = null;
let _buxferInitPromise = null;
```

Add the factory:

```javascript
export async function getBuxfer() {
  if (_buxfer) return _buxfer;
  if (_buxferInitPromise) return _buxferInitPromise;

  _buxferInitPromise = (async () => {
    const cfg = await getConfigService();
    const auth = cfg.getHouseholdAuth('buxfer');
    if (!auth?.email || !auth?.password) {
      throw new Error('Buxfer credentials missing (data/household/auth/buxfer.yml).');
    }
    const { BuxferAdapter } = await import('#adapters/finance/BuxferAdapter.mjs');
    _buxfer = new BuxferAdapter(
      { email: auth.email, password: auth.password },
      { httpClient: getHttpClient() },
    );
    return _buxfer;
  })();

  return _buxferInitPromise;
}
```

> **Important:** verify the auth field names. `data/household/auth/buxfer.yml` is documented in CLAUDE.local.md as containing `email` + `password`. Confirm by grepping `BuxferAdapter` for how it reads auth, and adjust the factory if needed.

Add to `_resetForTests()` and the `dscli.mjs` deps bag:

```javascript
    getBuxfer: bootstrap.getBuxfer,
```

- [ ] **Step 2: Write the failing test**

Write `tests/unit/cli/commands/finance.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import finance from '../../../../cli/commands/finance.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/finance', () => {
  describe('accounts action', () => {
    it('emits JSON with accounts array and a total balance', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeBuxfer = {
        async getAccounts() {
          return [
            { id: 732539, name: 'Fidelity', balance: 12345.67 },
            { id: 732537, name: 'Capital One', balance: -250.00 },
          ];
        },
      };

      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.accounts).toHaveLength(2);
      expect(out.count).toBe(2);
      expect(out.total).toBeCloseTo(12095.67, 2);
      expect(out.accounts[0].name).toBe('Fidelity');
    });

    it('returns empty array when adapter returns nothing', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeBuxfer = { async getAccounts() { return []; } };

      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.accounts).toEqual([]);
      expect(out.count).toBe(0);
      expect(out.total).toBe(0);
    });

    it('exits 3 (EXIT_CONFIG) when getBuxfer() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => { throw new Error('Buxfer credentials missing'); } },
      );
      expect(result.exitCode).toBe(3);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('config_error');
      expect(err.message).toMatch(/credentials/);
    });

    it('exits 1 (EXIT_FAIL) when adapter throws (auth or API failure)', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeBuxfer = { async getAccounts() { throw new Error('401 Unauthorized'); } };

      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );
      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toMatch(/buxfer_error|401/i);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await finance.run(
        { subcommand: 'finance', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/accounts/);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/commands/finance.test.mjs`
Expected: FAIL — `Cannot find module 'cli/commands/finance.mjs'`

- [ ] **Step 4: Write minimal implementation**

Write `cli/commands/finance.mjs`:

```javascript
/**
 * dscli finance — finance operations via Buxfer.
 *
 * Actions:
 *   dscli finance accounts   — List Buxfer accounts with balances.
 *
 * Auth from data/household/auth/buxfer.yml.
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

const HELP = `
dscli finance — finance operations

Usage:
  dscli finance <action> [flags]

Actions:
  accounts    List Buxfer accounts with balances.
              Returns: { accounts, count, total }
`.trimStart();

async function actionAccounts(args, deps) {
  let buxfer;
  try {
    buxfer = await deps.getBuxfer();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let accounts;
  try {
    accounts = await buxfer.getAccounts();
  } catch (err) {
    printError(deps.stderr, { error: 'buxfer_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  accounts = Array.isArray(accounts) ? accounts : [];
  const total = accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0);

  printJson(deps.stdout, {
    accounts,
    count: accounts.length,
    total,
  });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  accounts: actionAccounts,
};

export default {
  name: 'finance',
  description: 'Finance operations via Buxfer',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli finance: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/commands/finance.test.mjs`
Expected: PASS — 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add cli/_bootstrap.mjs cli/dscli.mjs cli/commands/finance.mjs tests/unit/cli/commands/finance.test.mjs
git commit -m "feat(dscli): finance accounts subcommand + BuxferAdapter bootstrap factory"
```

---

## Task 10: Add `dscli system config <namespace>` action

**Files:**
- Modify: `cli/commands/system.mjs` — add `actionConfig`
- Modify: `tests/unit/cli/commands/system.test.mjs` — add config action tests

A second action under `system` that proves the multi-action pattern works for the same subcommand. Reads a config namespace via ConfigService and dumps it as JSON.

Supported namespaces (initial set, easily extendable):
- `system` → `cfg.getSystem ? cfg.getSystem() : { dataDir: cfg.getDataDir(), mediaDir: cfg.getMediaDir(), timezone: cfg.getTimezone() }`
- `devices` → `cfg.getHouseholdDevices()`
- `integrations` → `cfg.getIntegrationsConfig()`
- `<appName>` → `cfg.getHouseholdAppConfig(null, appName)` (catch-all fallback)

- [ ] **Step 1: Write failing tests for the config action**

Append to `tests/unit/cli/commands/system.test.mjs` (inside the existing `describe('cli/commands/system', () => {})` block, before the closing brace):

```javascript
  describe('config action', () => {
    function fakeConfigService() {
      return {
        getDataDir: () => '/data',
        getMediaDir: () => '/media',
        getTimezone: () => 'America/Los_Angeles',
        getHouseholdDevices: () => ({ devices: { 'office-tv': { type: 'linux-pc' } } }),
        getIntegrationsConfig: () => ({ homeassistant: { host: 'http://hass:8123' } }),
        getHouseholdAppConfig: (_hid, appName) => {
          if (appName === 'fitness') return { mode: 'cycle' };
          return null;
        },
      };
    }

    it('returns system namespace with derived values', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'system'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.namespace).toBe('system');
      expect(out.config.dataDir).toBe('/data');
      expect(out.config.timezone).toBe('America/Los_Angeles');
    });

    it('returns devices namespace', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'devices'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.namespace).toBe('devices');
      expect(out.config.devices['office-tv'].type).toBe('linux-pc');
    });

    it('returns app namespace (fitness) via catch-all path', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'fitness'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.namespace).toBe('fitness');
      expect(out.config.mode).toBe('cycle');
    });

    it('exits 1 (not_found) for unknown namespace', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'nope'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.namespace).toBe('nope');
    });

    it('exits 2 when namespace arg missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/namespace/i);
    });
  });
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `npx vitest run tests/unit/cli/commands/system.test.mjs`
Expected: FAIL — the 5 new "config action" tests fail (action doesn't exist).

- [ ] **Step 3: Add `actionConfig` to `cli/commands/system.mjs`**

Edit `cli/commands/system.mjs`. Update `HELP` to include the config action:

```javascript
const HELP = `
dscli system — system operations

Usage:
  dscli system <action> [args] [flags]

Actions:
  health                 Check backend reachability + version
                         Returns: { ok, backend: { reachable, status, version } }
  config <namespace>     Dump a config namespace as JSON.
                         Namespaces: system | devices | integrations | <appName>
                         Returns: { namespace, config }

Environment:
  DSCLI_BACKEND_URL    Base URL of the running backend (default: http://localhost:3111)
`.trimStart();
```

Add the action function before `const ACTIONS`:

```javascript
async function actionConfig(args, deps) {
  const namespace = args.positional[1];
  if (!namespace) {
    deps.stderr.write('dscli system config: missing required <namespace>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let cfg;
  try {
    cfg = await deps.getConfigService();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: 3 /* EXIT_CONFIG */ };
  }

  let config;
  switch (namespace) {
    case 'system':
      config = {
        dataDir: cfg.getDataDir(),
        mediaDir: cfg.getMediaDir(),
        timezone: cfg.getTimezone?.() ?? null,
      };
      break;
    case 'devices':
      config = cfg.getHouseholdDevices?.() ?? null;
      break;
    case 'integrations':
      config = cfg.getIntegrationsConfig?.() ?? null;
      break;
    default:
      // Catch-all: assume namespace is an app name.
      config = cfg.getHouseholdAppConfig?.(null, namespace) ?? null;
  }

  if (config === null || config === undefined) {
    printError(deps.stderr, { error: 'not_found', namespace });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, { namespace, config });
  return { exitCode: EXIT_OK };
}
```

Update the imports to add `EXIT_FAIL`:

```javascript
import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_BACKEND } from '../_output.mjs';
```

Update the `ACTIONS` map:

```javascript
const ACTIONS = {
  health: actionHealth,
  config: actionConfig,
};
```

Update the command's `description`:

```javascript
  description: 'System operations: health, config',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/commands/system.test.mjs`
Expected: PASS — all original 6 tests + 5 new tests = 11 green.

- [ ] **Step 5: Commit**

```bash
git add cli/commands/system.mjs tests/unit/cli/commands/system.test.mjs
git commit -m "feat(dscli): system config <namespace> action"
```

---

## Task 11: Wire `bin` field + cli/README.md

**Files:**
- Modify: `package.json` — add `bin` field
- Create: `cli/README.md`

Makes `dscli` callable as a single command after `npm install` (or `npm link`), without needing `node cli/dscli.mjs ...` everywhere. README documents the contract for users and agents.

- [ ] **Step 1: Add `bin` field to `package.json`**

Edit `package.json`. Add a top-level `"bin"` field next to `"scripts"`:

```json
  "bin": {
    "dscli": "./cli/dscli.mjs"
  },
```

- [ ] **Step 2: Make `cli/dscli.mjs` executable**

Run:
```bash
chmod +x cli/dscli.mjs
```

- [ ] **Step 3: Verify the shebang is present**

Open `cli/dscli.mjs`. The first line must be:
```
#!/usr/bin/env node
```
(Already added in Task 4 — confirm it's there. If not, add it as line 1.)

- [ ] **Step 4: Smoke test as a bin**

Run:
```bash
npx --no-install dscli --help
```
Expected: top-level help. (If it fails because `dscli` isn't in the path, run `npm link` once first, then retry.)

- [ ] **Step 5: Write `cli/README.md`**

Write `cli/README.md`:

````markdown
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

# Content
dscli content search "workout playlist" --take 5

# Memory
dscli memory get notes
dscli memory list

# Finance
dscli finance accounts
```

All commands return JSON to stdout on success (exit 0) and a JSON error envelope to stderr on failure (exit 1+). Pipe to `jq` for reshaping.

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
````

- [ ] **Step 6: Commit**

```bash
git add package.json cli/README.md cli/dscli.mjs
git commit -m "feat(dscli): add bin field, executable shebang, README"
```

---

## Task 12: Aggregate test pass + manual smoke

**Files:** none (verification only)

A final pass to confirm the whole CLI works end-to-end before considering the foundation done.

- [ ] **Step 1: Run all CLI tests**

Run: `npx vitest run tests/unit/cli/`
Expected: ALL tests green. Counts: `_argv` 8, `_output` 6, `_bootstrap` 5, `dscli` 3, `system` 11, `ha` 7, `content` 5, `memory` 6, `finance` 5 = ~56 tests passing.

- [ ] **Step 2: Manual smoke test of every subcommand's --help**

Run each:
```bash
node cli/dscli.mjs --help
node cli/dscli.mjs system --help
node cli/dscli.mjs ha --help
node cli/dscli.mjs content --help
node cli/dscli.mjs memory --help
node cli/dscli.mjs finance --help
```
Expected: each prints usage and exits 0.

- [ ] **Step 3: Manual smoke against the running backend (if available)**

If a backend is running on this host (check `lsof -i :3111` or `lsof -i :3112` first):
```bash
DSCLI_BACKEND_URL=http://localhost:3111 node cli/dscli.mjs system health | jq .
```
Expected: `{"ok": true, "backend": {"reachable": true, ...}}`, exit 0.

- [ ] **Step 4: Manual smoke against the data path (if accessible)**

If on a machine where `claude` can read the data directory:
```bash
DAYLIGHT_BASE_PATH=/path/to/dropbox/data-parent node cli/dscli.mjs system config system | jq .
```
Expected: JSON with `dataDir`, `mediaDir`, `timezone`. Exit 0.

If the data directory isn't accessible from this user (e.g. on `kckern-server` where only the docker container can read the data volume), document the scenario in the commit message — host-wrapper integration is Phase D.

- [ ] **Step 5: Final tag commit**

If anything was tweaked during smoke, commit; otherwise this task ends here.

```bash
git status   # should be clean
```

---

## Out of scope (deferred to follow-up plans)

These appeared in the spec but are NOT in this plan. Each is a candidate for a future plan:

- **Phase B remaining commands:** `ha list-areas`, `ha list-devices`, `content resolve`, `content list-libraries`, `memory delete`, `finance balance <name>`, `finance balances`, `finance transactions`. Each follows the established pattern from this plan — adding them is mostly mechanical.
- **Phase C (write commands):** `ha toggle`, `ha call-service`, `memory write`, `finance refresh`, `system reload`. These require policy-gating decisions (CLI satellite identity, `--allow-write` flag, scope grants) — better as a focused plan.
- **Phase D (concierge + advanced):** `dscli concierge ask` (NDJSON streaming via the backend's `/v1/chat/completions`), `dscli concierge transcript`, `dscli content play` (requires running backend + HA gateway), host wrapper at `/usr/local/bin/dscli`, folding `cli/buxfer.cli.mjs` into `dscli finance --direct`.
- **Phase E (polish):** `--format=text` formatters per command, schema contract / snapshot tests, TAB completion.
- **Logging integration:** the spec wants CLI invocations logged via the existing `createLogger({ source: 'cli', app: 'dscli' })` framework so traces appear in the same stream as backend traces. Out of scope for this foundation; add when the CLI moves to production usage.

---

## Self-review notes

**Spec coverage check (Phase A + representative Phase B slice):**
- Entry + dispatcher → Task 4
- `_argv.mjs`, `_output.mjs`, `_bootstrap.mjs` → Tasks 1, 2, 3
- `dscli system health` → Task 5
- `dscli ha state` (representative HA command) → Task 6
- `dscli content search` (representative content command) → Task 7
- `dscli memory get / list` (representative memory commands) → Task 8
- `dscli finance accounts` (representative finance command) → Task 9
- `dscli system config <namespace>` → Task 10
- JSON output contract + exit codes → Task 2
- Container vs host execution → README documents `DAYLIGHT_BASE_PATH`; host wrapper deferred
- Authentication via ConfigService → Tasks 6, 8, 9 (per-factory in `_bootstrap.mjs`)
- Error handling per spec exit codes → all command tasks
- Testing strategy (unit per command + subprocess for entry) → Tasks 4, 5 (subprocess), 6–10 (in-process)
- `bin` field for `npx dscli` → Task 11

**Type/name consistency check:**
- `parseArgv()` returns `{ subcommand, positional, flags, help }` — used identically in Tasks 4 and all command tasks ✓
- `printJson(stream, value)`, `printError(stream, errOrEnvelope)` — same signature throughout ✓
- Exit code constants `EXIT_OK=0, EXIT_FAIL=1, EXIT_USAGE=2, EXIT_CONFIG=3, EXIT_BACKEND=4` — used consistently ✓
- Command default export `{ name, description, requiresBackend, run(args, deps) }` — same shape in all 5 commands ✓
- `deps` bag keys (`stdout, stderr, fetch, getConfigService, getHttpClient, getHaGateway, getContentQuery, getMemory, getBuxfer`) — populated incrementally in dispatcher; tests provide subsets ✓
- Bootstrap factory naming `getXxx()` — consistent across all factories ✓

**Placeholder scan:** no "TBD", "implement later", or "similar to Task N" without the full code. Every step has either complete code or a precise verification command.

**Known acceptable indirection:** Tasks 6–9 each include an `Important` callout reminding the implementer to verify integration field names / constructor signatures against the existing backend bootstrap before locking in the factory code. This is intentional — the field names vary across adapters and the truth is in the source, not the spec.
