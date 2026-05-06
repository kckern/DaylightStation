# dscli Phase E — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the dscli surface — per-command `--format=text` formatters, schema contract tests that catch unintended JSON-shape breakage, and README enrichment. Optional TAB completion is included as the last task and may be skipped if not desired.

**Architecture:** Each command module gains a sibling `formatText(value)` function that converts the JSON output into a human-readable form. The `--format` flag is parsed in the dispatcher and threaded through `deps`. Schema contract tests live in `tests/unit/cli/contracts/` and snapshot the JSON shape (not the values) returned by each command.

**Tech Stack:** Same as foundation. The contract tests use vitest's `toMatchInlineSnapshot` (built-in to vitest, no new dep).

**Spec:** [docs/superpowers/specs/2026-05-02-dscli-design.md](../specs/2026-05-02-dscli-design.md) — Phase E (line 408-413), Output contract (lines 196-258).

**Prerequisites:** Phase A (foundation) merged. Phase B (read-only commands) merged. Phase C and D MAY be merged but this plan does NOT depend on them — text formatters added here will retroactively cover Phase C/D commands as they land.

---

## Pattern overview

Three independent feature areas:

**1. Text formatters.** Each command module adds a `formatText(value)` helper. The dispatcher passes `args.flags.format` (or env `DSCLI_FORMAT`) through `deps`; each `actionXxx` checks `deps.format === 'text'` and emits text via `formatText` instead of `printJson`. Default remains JSON. Text format is best-effort — malformed values fall back to `JSON.stringify` rather than throwing.

**2. Schema contract tests.** A new test file per command at `tests/unit/cli/contracts/<command>.contract.test.mjs` runs each action with a deterministic fake and snapshots the *shape* of the returned JSON (using a `shapeOf` helper that replaces leaf values with their type names). Snapshots live inline and break the build on unintended shape changes.

**3. README enrichment.** Document `--format=text`, link to the contract test directory, add an "AI agent integration" section with a compact reference for tool-using LLMs.

**4. (Optional) TAB completion.** Generate `--complete bash|zsh` output; install instructions in README.

---

## Task 1: Wire `--format` flag into the dispatcher

**Files:**
- Modify: `cli/dscli.mjs` — read `--format` flag, pass to deps
- Modify: `tests/unit/cli/dscli.test.mjs` — add a test asserting flag plumbing

The dispatcher needs to look at top-level `args.flags.format` (or `DSCLI_FORMAT` env) and add `format: 'json' | 'text'` to the deps bag. Default `'json'`.

- [ ] **Step 1: Append failing test** to `tests/unit/cli/dscli.test.mjs` inside the existing describe block:

```javascript
  // We can't easily subprocess-test the format-flag plumbing because the existing
  // commands ignore deps.format until Task 2+. Instead, add a stub command and
  // verify the flag reaches it. The simplest way is to test the dispatcher's
  // arg parsing surface — see tests/unit/cli/_argv.test.mjs already covers
  // --key value parsing. So this test stays minimal: confirm `--format text`
  // doesn't break the no-op help path.
  it('accepts --format text without breaking help', async () => {
    const { exitCode, stdout } = await runDscli(['--help', '--format', 'text']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Subcommands/);
  });
```

- [ ] **Step 2: Run; should already pass** since `--help` shortcuts before the deps bag is built. Verify:

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/dscli.test.mjs
```

- [ ] **Step 3: Modify `cli/dscli.mjs`** to compute and pass `format`:

In the deps construction block, add:

```javascript
  const format = parsed.flags.format || process.env.DSCLI_FORMAT || 'json';
  if (format !== 'json' && format !== 'text') {
    process.stderr.write(`dscli: unknown --format value: ${format} (must be 'json' or 'text')\n`);
    process.exit(EXIT_USAGE);
  }
```

Then in the deps bag itself:

```javascript
  const deps = {
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    format,
    getConfigService: bootstrap.getConfigService,
    // ... other factories
  };
```

- [ ] **Step 4: Add a second test** asserting bad format value exits 2:

```javascript
  it('exits 2 on unknown --format value', async () => {
    const { exitCode, stderr } = await runDscli(['system', 'health', '--format', 'yaml']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/format/i);
  });
```

- [ ] **Step 5: Run; confirm both pass.**

- [ ] **Step 6: Commit**

```bash
git add cli/dscli.mjs tests/unit/cli/dscli.test.mjs
git commit -m "feat(dscli): --format flag plumbed through dispatcher (json|text)"
```

---

## Task 2: Text formatter for `system health` (template)

**Files:**
- Modify: `cli/commands/system.mjs` — add `formatHealthText`, use when `deps.format === 'text'`
- Modify: `tests/unit/cli/commands/system.test.mjs` — add text-format test

Establishes the per-command formatter pattern. Subsequent tasks repeat for each command.

- [ ] **Step 1: Append failing test** inside the `describe('health action', ...)` block:

```javascript
    it('emits human-readable text when deps.format is "text"', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => ({
        ok: true, status: 200,
        async json() { return { version: 'abc123', commit: 'abc123' }; },
      });
      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch, format: 'text' },
      );
      expect(result.exitCode).toBe(0);
      const out = stdout.read();
      expect(out).toMatch(/backend:/i);
      expect(out).toMatch(/abc123/);
      expect(out).toMatch(/200/);
      // Should NOT be JSON
      expect(() => JSON.parse(out)).toThrow();
    });
```

- [ ] **Step 2: Run; confirm 1 failure.**

- [ ] **Step 3: Modify `cli/commands/system.mjs`**:

Add a private formatter near the top:

```javascript
function formatHealthText(value) {
  const b = value.backend || {};
  const lines = [
    `backend: ${b.reachable ? 'reachable' : 'unreachable'} (${b.url ?? 'unknown url'})`,
    `status: ${b.status ?? 'n/a'}`,
    `version: ${b.version ?? 'unknown'}`,
  ];
  return lines.join('\n') + '\n';
}
```

In `actionHealth`, replace the printJson call with format-aware emit. After the success-path `printJson`:

```javascript
  const value = {
    ok: true,
    backend: { ...body, reachable: true, status: response.status, url, version: body.version ?? body.commit ?? null },
  };
  if (deps.format === 'text') {
    deps.stdout.write(formatHealthText(value));
  } else {
    printJson(deps.stdout, value);
  }
  return { exitCode: EXIT_OK };
```

- [ ] **Step 4: Run tests; confirm all health tests pass (existing 4 + new 1).**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/system.mjs tests/unit/cli/commands/system.test.mjs
git commit -m "feat(dscli): text formatter for system health"
```

---

## Task 3: Text formatters for `ha state` and `ha list-devices`

**Files:**
- Modify: `cli/commands/ha.mjs` — add `formatStateText`, `formatDevicesText`
- Modify: `tests/unit/cli/commands/ha.test.mjs` — add text-format tests

- [ ] **Step 1: Append failing tests** to `ha.test.mjs`:

```javascript
  describe('text format', () => {
    it('formats state action as text', async () => {
      const { stdout, stderr } = makeBuffers();
      const fake = { async getState() { return { entityId: 'light.x', state: 'off', attributes: { friendly_name: 'X' } }; } };
      const r = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.x'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fake, format: 'text' },
      );
      expect(r.exitCode).toBe(0);
      const out = stdout.read();
      expect(out).toMatch(/light\.x/);
      expect(out).toMatch(/off/);
      expect(() => JSON.parse(out)).toThrow();
    });

    it('formats list-devices as text table', async () => {
      const { stdout, stderr } = makeBuffers();
      const sample = [
        { entityId: 'light.a', state: 'off', attributes: { friendly_name: 'A', area_id: 'office' } },
        { entityId: 'switch.b', state: 'on', attributes: { friendly_name: 'B', area_id: 'kitchen' } },
      ];
      const r = await ha.run(
        { subcommand: 'ha', positional: ['list-devices'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async listAllStates() { return sample; } }), format: 'text' },
      );
      expect(r.exitCode).toBe(0);
      const out = stdout.read();
      expect(out).toMatch(/light\.a/);
      expect(out).toMatch(/switch\.b/);
      expect(out).toMatch(/kitchen/);
      expect(() => JSON.parse(out)).toThrow();
    });
  });
```

- [ ] **Step 2: Run; confirm 2 failures.**

- [ ] **Step 3: Add formatters and dispatch**:

```javascript
function formatStateText(value) {
  const lines = [
    `${value.entity_id}: ${value.state}`,
    `  friendly_name: ${value.attributes?.friendly_name ?? '(none)'}`,
    `  last_changed: ${value.last_changed ?? '(unknown)'}`,
  ];
  return lines.join('\n') + '\n';
}

function formatDevicesText(value) {
  if (!value.devices.length) return '(no devices)\n';
  const rows = value.devices.map((d) => `  ${d.entity_id.padEnd(40)} ${(d.area_id ?? '-').padEnd(15)} ${d.state}`);
  return `${value.count} devices:\n` + rows.join('\n') + '\n';
}
```

In each action, wrap the `printJson` call. Pattern:

```javascript
  if (deps.format === 'text') {
    deps.stdout.write(formatStateText(value));
  } else {
    printJson(deps.stdout, value);
  }
```

Apply to `actionState`'s success path AND `actionListDevices`'s success path.

- [ ] **Step 4: Run all ha tests; confirm 21 passing (19 from B + 2 new).**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/ha.mjs tests/unit/cli/commands/ha.test.mjs
git commit -m "feat(dscli): text formatters for ha state + list-devices"
```

---

## Task 4: Text formatters for `content search` and `finance balances`

**Files:**
- Modify: `cli/commands/content.mjs` — add `formatSearchText`
- Modify: `cli/commands/finance.mjs` — add `formatAccountsText`, `formatBalanceText`
- Modify: corresponding test files

These are the highest-value text outputs (most-used commands per the spec). Repeat the Task 3 pattern.

- [ ] **Step 1: Add tests** for content search text format and finance accounts/balance text format. Use the same shape as Task 3's tests (assert presence of titles/names + that output is NOT valid JSON).

- [ ] **Step 2: Run; confirm failures.**

- [ ] **Step 3: Add formatters**:

```javascript
// content.mjs
function formatSearchText(value) {
  if (!value.results.length) return '(no results)\n';
  const rows = value.results.map((r, i) => `  ${(i + 1).toString().padStart(3)}. [${r.source}:${r.localId}] ${r.title}`);
  return `${value.count} result${value.count === 1 ? '' : 's'}:\n` + rows.join('\n') + '\n';
}

// finance.mjs
function formatAccountsText(value) {
  const rows = value.accounts.map((a) => `  ${a.name.padEnd(30)} ${a.balance.toFixed(2).padStart(12)}`);
  return `${value.count} accounts:\n` + rows.join('\n') + `\n  ${'TOTAL'.padEnd(30)} ${value.total.toFixed(2).padStart(12)}\n`;
}

function formatBalanceText(value) {
  return `${value.account.name}: ${value.account.balance.toFixed(2)}\n`;
}
```

Wire into `actionSearch`, `actionAccounts`, `actionBalance` with the `deps.format === 'text'` check.

- [ ] **Step 4: Run all tests; confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/content.mjs cli/commands/finance.mjs tests/unit/cli/commands/
git commit -m "feat(dscli): text formatters for content search + finance accounts/balance"
```

---

## Task 5: Memory text formatters (skippable if minimal value)

**Files:**
- Modify: `cli/commands/memory.mjs` — add formatters for `get` and `list`
- Modify: `tests/unit/cli/commands/memory.test.mjs` — add tests

`get` text: just `<key>: <value>` (with JSON-stringify of complex values). `list` text: keys + count summary, omit values (they can be huge).

- [ ] **Step 1: Tests + impl following Task 3 pattern.**

```javascript
function formatGetText(value) {
  const v = typeof value.value === 'object' ? JSON.stringify(value.value, null, 2) : String(value.value);
  return `${value.key}: ${v}\n`;
}

function formatListText(value) {
  if (!value.keys.length) return '(no keys)\n';
  return `${value.count} keys:\n` + value.keys.map((k) => `  ${k}`).join('\n') + '\n';
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(dscli): text formatters for memory get + list"
```

---

## Task 6: Schema contract tests

**Files:**
- Create: `tests/unit/cli/contracts/system.contract.test.mjs`
- Create: `tests/unit/cli/contracts/ha.contract.test.mjs`
- Create: `tests/unit/cli/contracts/content.contract.test.mjs`
- Create: `tests/unit/cli/contracts/finance.contract.test.mjs`
- Create: `tests/unit/cli/contracts/memory.contract.test.mjs`
- Create: `tests/unit/cli/_lib/shapeOf.mjs` — shared shape-extraction helper

Schema contract tests snapshot the *shape* of each command's JSON output. Shape = same JSON tree but with leaf values replaced by their type names (`'string'`, `'number'`, `'array<object>'`, etc.). This way:
- Adding a new field BREAKS the snapshot (good — forces explicit ack)
- Renaming a field BREAKS (good)
- Changing a value's type BREAKS (good)
- Changing a string from `'on'` to `'off'` does NOT break (those are values, not shape)

- [ ] **Step 1: Create the helper** `tests/unit/cli/_lib/shapeOf.mjs`:

```javascript
/**
 * Replace every leaf value with its type name (or '<type>[]' / 'object').
 * Used by schema contract tests to assert on JSON shape, not values.
 *
 * shapeOf({ ok: true, items: [{ a: 1 }, { a: 2 }] })
 *   → { ok: 'boolean', items: ['array<object>'] }
 *
 * shapeOf({ entity_id: 'light.x', attributes: { friendly_name: 'X' } })
 *   → { entity_id: 'string', attributes: { friendly_name: 'string' } }
 */
export function shapeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array<empty>';
    const inner = shapeOf(value[0]);
    return Array.isArray(inner) ? `array<${typeof inner === 'string' ? inner : 'object'}>` : `array<${typeof inner}>`;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = shapeOf(v);
    }
    return out;
  }
  return typeof value;
}
```

- [ ] **Step 2: Write contract test for system**

`tests/unit/cli/contracts/system.contract.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import system from '../../../../cli/commands/system.mjs';
import { shapeOf } from '../_lib/shapeOf.mjs';

function captureStdout(streamRef) {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
  stream.read = () => Buffer.concat(chunks).toString('utf8');
  return stream;
}

describe('system contract', () => {
  it('health output shape', async () => {
    const stdout = captureStdout();
    const fakeFetch = async () => ({
      ok: true, status: 200,
      async json() { return { version: 'v1' }; },
    });
    await system.run(
      { subcommand: 'system', positional: ['health'], flags: {}, help: false },
      { stdout, stderr: captureStdout(), fetch: fakeFetch },
    );
    const value = JSON.parse(stdout.read().trim());
    expect(shapeOf(value)).toMatchInlineSnapshot(`
      {
        "backend": {
          "reachable": "boolean",
          "status": "number",
          "url": "string",
          "version": "string",
        },
        "ok": "boolean",
      }
    `);
  });

  it('config output shape', async () => {
    const stdout = captureStdout();
    const fakeCfg = {
      getDataDir: () => '/data',
      getMediaDir: () => '/media',
      getTimezone: () => 'America/Los_Angeles',
    };
    await system.run(
      { subcommand: 'system', positional: ['config', 'system'], flags: {}, help: false },
      { stdout, stderr: captureStdout(), getConfigService: async () => fakeCfg },
    );
    const value = JSON.parse(stdout.read().trim());
    expect(shapeOf(value)).toMatchInlineSnapshot(`
      {
        "config": {
          "dataDir": "string",
          "mediaDir": "string",
          "timezone": "string",
        },
        "namespace": "string",
      }
    `);
  });
});
```

- [ ] **Step 3: Run; populate the inline snapshots**

The first run with `--update` populates the snapshots:

```bash
npx vitest run tests/unit/cli/contracts/system.contract.test.mjs --update
```

Then re-run without `--update` to verify they match:

```bash
npx vitest run tests/unit/cli/contracts/system.contract.test.mjs
```

- [ ] **Step 4: Repeat for the other 4 command modules**

For each (`ha`, `content`, `memory`, `finance`), create `tests/unit/cli/contracts/<name>.contract.test.mjs` with one snapshot per action. Use realistic fake data (matching what the real adapters return) so the shape is meaningful.

- [ ] **Step 5: Run full suite; confirm all snapshots match.**

```bash
npx vitest run tests/unit/cli/
```

- [ ] **Step 6: Commit**

```bash
git add tests/unit/cli/_lib/ tests/unit/cli/contracts/
git commit -m "feat(dscli): schema contract tests for all command outputs"
```

---

## Task 7: README enrichment

**Files:**
- Modify: `cli/README.md`

Add three sections:

1. **`--format=text`** — short blurb explaining default JSON vs human text.
2. **AI agent integration** — concise snippet showing how an agent would shell out: e.g. `const result = JSON.parse(execSync('dscli ha state light.office_main'))`. List the exit code contract again here.
3. **Schema contracts** — link to `tests/unit/cli/contracts/` and explain that breaking changes show up in PR diffs.

- [ ] **Step 1: Edit `cli/README.md`** to add three sections (concrete examples, no fluff). After the Usage section, add:

```markdown
## Output format

All commands default to JSON on stdout. Add `--format=text` for human-readable output:

```bash
dscli ha state light.office_main           # JSON
dscli ha state light.office_main --format=text   # one-liner per field
```

Set `DSCLI_FORMAT=text` to make text the default for your shell session.

## AI agent integration

Agents can shell out and parse JSON directly:

```javascript
import { execSync } from 'child_process';

function dscli(...args) {
  const out = execSync(`dscli ${args.join(' ')}`, { encoding: 'utf8' });
  return JSON.parse(out);
}

const state = dscli('ha', 'state', 'light.office_main');
console.log(state.entity_id, '→', state.state);
```

Exit codes are the contract: `0` = success (parse stdout); `1+` = failure (parse stderr for `{error, message}`).

## Schema contracts

The output shape of every command is locked by snapshot tests in `tests/unit/cli/contracts/`. Breaking changes show up in PR diffs. If you intentionally change an output shape, run:

```bash
npx vitest run tests/unit/cli/contracts/ --update
```
and ensure consumers (other agents, scripts) are updated.
```

- [ ] **Step 2: Commit**

```bash
git add cli/README.md
git commit -m "docs(dscli): document --format, AI agent usage, schema contracts"
```

---

## Task 8 (optional): TAB completion

**Files:**
- Create: `cli/_completion.mjs` — generates bash/zsh completion scripts
- Modify: `cli/dscli.mjs` — add `--complete bash|zsh` handling

Skippable. The plan ships if Tasks 1-7 land and the user doesn't ask for completion.

- [ ] **Step 1: Add `--complete` handling early in `cli/dscli.mjs`'s `main()`**, before the subcommand dispatch:

```javascript
  if (parsed.flags.complete) {
    const { generateCompletion } = await import('./_completion.mjs');
    process.stdout.write(generateCompletion(parsed.flags.complete, KNOWN_SUBCOMMANDS));
    process.exit(EXIT_OK);
  }
```

- [ ] **Step 2: Write `cli/_completion.mjs`**:

```javascript
export function generateCompletion(shell, subcommands) {
  if (shell === 'bash') {
    return `# Add to ~/.bashrc: eval "$(dscli --complete bash)"
_dscli_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ \${COMP_CWORD} -eq 1 ]; then
    opts="${subcommands.join(' ')} --help"
    COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
  fi
  return 0
}
complete -F _dscli_completions dscli
`;
  }
  if (shell === 'zsh') {
    return `# Add to ~/.zshrc: eval "$(dscli --complete zsh)"
_dscli() {
  local -a subcommands
  subcommands=(${subcommands.map((s) => `'${s}'`).join(' ')})
  _arguments '1: :->cmd' && return
  case $state in
    cmd) _values 'subcommand' "\${subcommands[@]}" ;;
  esac
}
compdef _dscli dscli
`;
  }
  return `# unknown shell: ${shell}\n`;
}
```

- [ ] **Step 3: Add a test** `tests/unit/cli/_completion.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateCompletion } from '../../../cli/_completion.mjs';

describe('generateCompletion', () => {
  it('emits bash completion script with all subcommands', () => {
    const out = generateCompletion('bash', ['system', 'ha']);
    expect(out).toMatch(/_dscli_completions/);
    expect(out).toMatch(/system ha/);
    expect(out).toMatch(/complete -F _dscli_completions dscli/);
  });

  it('emits zsh completion script', () => {
    const out = generateCompletion('zsh', ['system', 'ha']);
    expect(out).toMatch(/_dscli/);
    expect(out).toMatch(/'system' 'ha'/);
  });

  it('returns a comment for unknown shell', () => {
    expect(generateCompletion('fish', [])).toMatch(/unknown shell/);
  });
});
```

- [ ] **Step 4: Run tests, smoke `node cli/dscli.mjs --complete bash`, commit**

```bash
git add cli/_completion.mjs cli/dscli.mjs tests/unit/cli/_completion.test.mjs
git commit -m "feat(dscli): TAB completion for bash and zsh via --complete"
```

---

## Out of scope (deliberately)

- Per-text-format styling (colors, bold, ANSI). Pure plain text only.
- YAML output format (`--format=yaml`). JSON suffices for any consumer that can parse YAML.
- Markdown output format. Same reasoning.
- Programmatic completion of dynamic values (entity IDs, account names) — would require connecting to the live HA / Buxfer mid-completion. Heavy, low-value.

---

## Self-review notes

**Spec coverage check (Phase E line 408-413):**
- Per-command text formatters → Tasks 2-5
- Schema contract tests → Task 6
- README enrichment → Task 7
- Optional TAB completion → Task 8

**Dependencies between tasks:** Task 1 (flag plumbing) blocks Tasks 2-5 (formatters). Task 6 (contracts) is independent of formatters. Task 7 documents Tasks 1-2-3-4-5. Task 8 is fully independent.

**Test counts:** Foundation 72 + Phase B ~25 + Phase E ~15 (formatters) + ~12 (contracts) + ~3 (completion) = ~127 if everything lands.
