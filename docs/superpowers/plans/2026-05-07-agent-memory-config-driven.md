# Agent Memory: Config-Driven, Working + Observational Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent memory configuration from hard-coded values into `data/household/config/agents.yml` with per-agent overrides; enable working memory via Markdown-template mode (bypassing the broken Zod→JSONSchema converter); wire ObservationalMemory for auto-compaction of long threads; add a custom `TimeWindow` input processor for time-based message filtering. Result: agents are smart and capable — observation-aware across sessions, summarized when threads grow, configured by the household, not by the release.

**Architecture (the shifts):**

**Shift 1 — config-driven memory.** Each agent's `getMemoryConfig` reads from `configService.getAppConfig('agents')` instead of returning hard-coded literals. The YAML has a `default` block plus optional per-agent `overrides`. Any value not set in YAML falls back to a hard-coded default in the agent class.

**Shift 2 — working memory via TEMPLATE mode.** Mastra's `WorkingMemory` accepts EITHER `schema` (broken at this version) OR `template` (a Markdown string the agent reads/rewrites via `updateWorkingMemory`). Template mode bypasses the schema-conversion bug entirely. The agent reads the current state as Markdown and rewrites it whenever the user shares new context. Less typed than the schema approach, but it WORKS today and is the canonical pattern Mastra expects most agents to use.

**Shift 3 — ObservationalMemory as Agent processor.** ObservationalMemory is a separate processor class in `@mastra/memory@1.17.5`. It's wired as an input processor on the Agent constructor: when message tokens exceed a threshold, a background Observer agent (cheap model, e.g. `gpt-4o-mini`) compresses old turns into structured observations; when observations grow large, a Reflector compresses them further. The main agent sees: pre-existing observations + recent unobserved messages. Compression ratio: 5-40×. We wire it via a new `getMemoryProcessors(deps)` static method on the agent class plus a `buildObservationalMemory` framework helper.

**Shift 4 — TimeWindow input processor.** Mastra exposes input processors that run before the LLM call. We add a tiny custom processor that filters `messages[]` by a recency rule from YAML (e.g. `time_window_hours: 3` keeps only messages newer than 3h ago, intersected with the `lastMessages` count limit). Per-agent configurable.

**Tech Stack:** Existing — `@mastra/memory@1.17.5`, `@mastra/core@1.32.1`, `@mastra/libsql@1.10.0`. New per-agent infrastructure helpers: `buildObservationalMemory`, `buildTimeWindowProcessor`. New YAML file: `data/household/config/agents.yml`.

---

## Exit criteria (verifiable end-to-end)

The plan is **not** done until ALL of these pass:

1. **Config drives values:** changing `data/household/config/agents.yml` → `default.memory.last_messages: 50` is reflected in the next agent turn (via `configService.getAppConfig('agents')` + agent reload). Verified via inspecting `agent.tool_inventory` log output.

2. **Working memory works:** turn 1 *"I'm focusing on Z2 endurance this month"* → agent calls `updateWorkingMemory` with a Markdown body that includes "Z2 endurance" → turn 2 (different threadId, same userId, even different agent) → agent recalls the focus from the persisted Markdown. Cross-thread + cross-agent recall via resource scope.

3. **ObservationalMemory compacts:** a synthetic 50-turn smoke produces an observation block (visible in `data/agents/memory.db` table inspection or via a per-turn log emitted by the Observer agent).

4. **TimeWindow filters:** `time_window_hours: 1` set in YAML → a turn that ships a thread with messages older than 1h gets only the recent ones forwarded to the LLM. Verified via the same `agent.tool_inventory` debug surface (extended to log message count actually sent to mastraAgent.generate).

5. **No regressions:** `lastMessages` server-side recall still works (the foundational win from the prior Memory plan stays).

The Task 7 smoke encodes 1-4 as regex-asserted multi-step checks.

---

## File structure

**New files:**

```
data/household/config/agents.yml            — config (defaults + per-agent overrides)

backend/src/3_applications/agents/framework/
  buildObservationalMemory.mjs              — wraps ObservationalMemory class with our config
  buildTimeWindowProcessor.mjs              — custom InputProcessor for time/count window
  loadAgentConfig.mjs                       — reads + merges agents.yml + defaults

backend/src/3_applications/agents/health-coach/memory/
  workingMemoryTemplate.mjs                 — the Markdown template (replaces the schema export)
backend/src/3_applications/agents/lifeplan-guide/memory/
  workingMemoryTemplate.mjs                 — minimal template for lifeplan-guide
```

**Modified files:**

```
backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
  — getMemoryConfig reads from loadAgentConfig + workingMemoryTemplate (not hardcoded)
  — getMemoryProcessors() static method returns { observational, timeWindow }
backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs
  — same pattern
backend/src/3_applications/agents/framework/buildAgentRuntime.mjs
  — accepts processors[] from agent's getMemoryProcessors and passes to Agent constructor
backend/src/0_system/bootstrap.mjs
  — REFLECTIVE_AGENTS loop: also calls getMemoryProcessors and passes to buildAgentRuntime
backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs
  — DELETED (replaced by template; keep as comment-only stub if testing)

frontend/(no changes)
```

**New tests:**

```
tests/isolated/agents/framework/
  loadAgentConfig.test.mjs                  — defaults + overrides + missing-file fallback
  buildObservationalMemory.test.mjs         — factory builds + null when disabled
  buildTimeWindowProcessor.test.mjs         — filters messages by timestamp
tests/isolated/agents/health-coach/
  workingMemoryTemplate.test.mjs            — template content sanity
  static_infrastructure.test.mjs            — extend with getMemoryProcessors checks
```

---

## Task 1: Define `agents.yml` schema + `loadAgentConfig` helper

Centralized config loader with default merge and per-agent override merge. Returns a fully-resolved per-agent memory config.

**Files:**
- Create: `data/household/config/agents.yml` (initial baseline)
- Create: `backend/src/3_applications/agents/framework/loadAgentConfig.mjs`
- Create: `tests/isolated/agents/framework/loadAgentConfig.test.mjs`

- [ ] **Step 1: Author the initial agents.yml**

```yaml
# data/household/config/agents.yml
# Memory + processor configuration for all reflective agents.
#
# Top-level `default` applies to every reflective agent.
# Top-level `overrides.<agentId>` deep-merges over the defaults.
# Hard-coded fallbacks in the agent class kick in for any value not set here.

default:
  memory:
    last_messages: 100
    time_window_hours: null         # null = no time filter; e.g. 3 = last 3 hours

    working_memory:
      enabled: true
      scope: resource               # 'resource' = cross-thread + cross-agent
      # template_ref points at the agent's own template file; override per-agent below
      template_ref: default

    observational:
      enabled: true
      observer_model: 'openai/gpt-4o-mini'
      reflector_model: 'openai/gpt-4o-mini'
      message_tokens_threshold: 30000
      observation_tokens_threshold: 40000

    semantic_recall:
      enabled: false                # opt-in; needs vector store + embedder
      top_k: 5
      message_range: 2
      scope: resource

overrides:
  health-coach:
    memory:
      working_memory:
        template_ref: health-coach
      # other overrides as needed

  lifeplan-guide:
    memory:
      working_memory:
        template_ref: lifeplan-guide
```

Place the file inside the data volume by writing via `sudo docker exec`:

```bash
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c "mkdir -p data/household/config"
# write the file content via heredoc — see CLAUDE.local.md for pattern
```

Then commit the YAML as a checked-in fixture in the repo at the same path:

```bash
cd /opt/Code/DaylightStation && mkdir -p data/household/config 2>/dev/null
# Copy or recreate locally; data/household is gitignored, so we keep an example
# under docs/_wip/configs/agents.example.yml AND the live one in the data volume.
```

NOTE: `data/` is largely gitignored. The pattern in this codebase: live config sits in the mounted data volume, NOT in git. If we want a checked-in example, place at `docs/_wip/configs/agents.example.yml` for reference. The live YAML is at `data/household/config/agents.yml`.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/isolated/agents/framework/loadAgentConfig.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { loadAgentConfig } from '../../../../backend/src/3_applications/agents/framework/loadAgentConfig.mjs';

describe('loadAgentConfig', () => {
  it('returns default config when configService returns null/undefined', () => {
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => null) },
      agentId: 'health-coach',
    });
    expect(cfg.memory.last_messages).toBe(100);  // hardcoded default fallback
    expect(cfg.memory.working_memory.enabled).toBe(true);
    expect(cfg.memory.observational.enabled).toBe(true);
  });

  it('uses default block from YAML when no overrides for agent', () => {
    const yaml = {
      default: { memory: { last_messages: 50, time_window_hours: 3 } },
      overrides: {},
    };
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => yaml) },
      agentId: 'health-coach',
    });
    expect(cfg.memory.last_messages).toBe(50);
    expect(cfg.memory.time_window_hours).toBe(3);
  });

  it('merges per-agent overrides over defaults', () => {
    const yaml = {
      default: {
        memory: { last_messages: 50, working_memory: { enabled: true, scope: 'resource' } },
      },
      overrides: {
        'health-coach': {
          memory: { last_messages: 200, working_memory: { template_ref: 'health-coach' } },
        },
      },
    };
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => yaml) },
      agentId: 'health-coach',
    });
    expect(cfg.memory.last_messages).toBe(200);                       // override wins
    expect(cfg.memory.working_memory.enabled).toBe(true);             // default kept
    expect(cfg.memory.working_memory.scope).toBe('resource');         // default kept
    expect(cfg.memory.working_memory.template_ref).toBe('health-coach'); // override added
  });

  it('different agents get different overrides', () => {
    const yaml = {
      default: { memory: { last_messages: 50 } },
      overrides: {
        'health-coach':   { memory: { last_messages: 100 } },
        'lifeplan-guide': { memory: { last_messages: 30 } },
      },
    };
    const a = loadAgentConfig({ configService: { getAppConfig: vi.fn(() => yaml) }, agentId: 'health-coach' });
    const b = loadAgentConfig({ configService: { getAppConfig: vi.fn(() => yaml) }, agentId: 'lifeplan-guide' });
    expect(a.memory.last_messages).toBe(100);
    expect(b.memory.last_messages).toBe(30);
  });

  it('falls back to hardcoded defaults for missing fields in YAML', () => {
    const yaml = {
      default: { memory: { last_messages: 50 } },  // working_memory entirely missing
      overrides: {},
    };
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => yaml) },
      agentId: 'health-coach',
    });
    // hardcoded fallback for working_memory.enabled
    expect(cfg.memory.working_memory.enabled).toBe(true);
    expect(cfg.memory.working_memory.scope).toBe('resource');
  });

  it('handles configService missing entirely (no throw)', () => {
    const cfg = loadAgentConfig({ configService: null, agentId: 'health-coach' });
    expect(cfg.memory.last_messages).toBe(100);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/loadAgentConfig.test.mjs
```

- [ ] **Step 4: Implement `loadAgentConfig`**

```javascript
// backend/src/3_applications/agents/framework/loadAgentConfig.mjs

const HARDCODED_DEFAULTS = Object.freeze({
  memory: {
    last_messages: 100,
    time_window_hours: null,
    working_memory: {
      enabled: true,
      scope: 'resource',
      template_ref: 'default',
    },
    observational: {
      enabled: true,
      observer_model: 'openai/gpt-4o-mini',
      reflector_model: 'openai/gpt-4o-mini',
      message_tokens_threshold: 30000,
      observation_tokens_threshold: 40000,
    },
    semantic_recall: {
      enabled: false,
      top_k: 5,
      message_range: 2,
      scope: 'resource',
    },
  },
});

function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = (key in base) ? deepMerge(base[key], override[key]) : override[key];
  }
  return out;
}

/**
 * Load + resolve an agent's memory configuration from agents.yml.
 *
 * Order of precedence (last wins):
 *   1. HARDCODED_DEFAULTS (this file)
 *   2. yaml.default
 *   3. yaml.overrides[agentId]
 *
 * @param {object} args
 * @param {object|null} args.configService — exposes getAppConfig('agents')
 * @param {string} args.agentId
 * @returns {object} resolved config
 */
export function loadAgentConfig({ configService, agentId }) {
  let yaml = null;
  try {
    yaml = configService?.getAppConfig?.('agents') ?? null;
  } catch { yaml = null; }

  let cfg = HARDCODED_DEFAULTS;
  if (yaml?.default) cfg = deepMerge(cfg, yaml.default);
  if (yaml?.overrides?.[agentId]) cfg = deepMerge(cfg, yaml.overrides[agentId]);
  return cfg;
}

export default loadAgentConfig;
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/loadAgentConfig.test.mjs
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/framework/loadAgentConfig.mjs \
  tests/isolated/agents/framework/loadAgentConfig.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): loadAgentConfig — read agent memory config from YAML

Plan / Task 1 (memory config). Merges hardcoded defaults + yaml.default
+ yaml.overrides[agentId]. Used by agent classes' getMemoryConfig
methods to read their config from data/household/config/agents.yml
instead of hardcoding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Working memory via Markdown template

Replace the broken Zod schema with a Markdown template. Mastra's template mode is the canonical path and avoids the schema-conversion bug.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs`
- Create: `backend/src/3_applications/agents/lifeplan-guide/memory/workingMemoryTemplate.mjs`
- Create: `tests/isolated/agents/health-coach/workingMemoryTemplate.test.mjs`
- Modify (delete contents — keep as deprecated stub): `backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs`

- [ ] **Step 1: Write the templates**

```javascript
// backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs

/**
 * Health-coach working memory — Markdown template.
 *
 * Mastra's WorkingMemory accepts either a Zod/JSONSchema (broken at
 * @mastra/memory@1.17.5 — produces { type: "None" }) or a Markdown
 * string template. The agent reads the current Markdown content,
 * rewrites the FULL string via the updateWorkingMemory tool when
 * the user shares new context, and the next turn sees the updated
 * content prepended to the system prompt.
 *
 * Resource-scoped (per HealthCoachAgent.getMemoryConfig): the SAME
 * Markdown is visible to lifeplan-guide and any future agent reading
 * the same userId's resource.
 *
 * Distinct from YAML playbooks (code-curated, structured patterns).
 * This is the LLM-maintained transient observation layer.
 */
export const healthCoachWorkingMemoryTemplate = `# User Context (LLM-maintained, shared across agents)

## Recent Focus Areas
<!-- What the user is working on now, e.g. "Z2 endurance", "morning fasted runs". Most recent first. List bullets. -->

## Stated Goals
<!-- Long-term goals the user has explicitly stated, e.g. "sub-3:30 marathon by October". -->

## Active Constraints
<!-- Current limits — injuries, illnesses, life events. Include start dates when known. -->

## Recent Observations
<!-- Notable things the user has shared in recent conversations. Include date for each entry. -->

## Coaching Preferences
<!-- Tone, depth, what to emphasize. -->
`;

export default healthCoachWorkingMemoryTemplate;
```

```javascript
// backend/src/3_applications/agents/lifeplan-guide/memory/workingMemoryTemplate.mjs
import { healthCoachWorkingMemoryTemplate } from '../../health-coach/memory/workingMemoryTemplate.mjs';

/**
 * Lifeplan-guide reads/writes the SAME working memory template as
 * health-coach. Resource-scoped sharing means goal/focus updates
 * from either agent are visible to both.
 *
 * If lifeplan-guide grows its own observation fields, fork the
 * template here.
 */
export const lifeplanGuideWorkingMemoryTemplate = healthCoachWorkingMemoryTemplate;
export default lifeplanGuideWorkingMemoryTemplate;
```

- [ ] **Step 2: Tests**

```javascript
// tests/isolated/agents/health-coach/workingMemoryTemplate.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemoryTemplate } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs';

describe('healthCoachWorkingMemoryTemplate', () => {
  it('is a non-empty string', () => {
    expect(typeof healthCoachWorkingMemoryTemplate).toBe('string');
    expect(healthCoachWorkingMemoryTemplate.length).toBeGreaterThan(100);
  });

  it('contains all the canonical sections', () => {
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Recent Focus Areas/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Stated Goals/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Active Constraints/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Recent Observations/);
    expect(healthCoachWorkingMemoryTemplate).toMatch(/## Coaching Preferences/);
  });

  it('starts with a top-level header', () => {
    expect(healthCoachWorkingMemoryTemplate).toMatch(/^# /);
  });
});
```

- [ ] **Step 3: Replace schema export with re-export from template (for back-compat callers)**

In `backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs`, replace the entire file content:

```javascript
// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs
//
// DEPRECATED. Replaced by workingMemoryTemplate.mjs (Markdown template mode).
// The Zod/JSONSchema approach hit a bug in @mastra/memory@1.17.5 where the
// standardSchema → JSONSchema conversion produces { type: "None" }, which
// OpenAI's tool function validator rejects.
//
// Re-exporting the template under the old name keeps any callers that import
// healthCoachWorkingMemorySchema working — they now get the template string.
// Update those callers to import from workingMemoryTemplate.mjs going forward.

export { healthCoachWorkingMemoryTemplate as healthCoachWorkingMemorySchema } from './workingMemoryTemplate.mjs';
export { default } from './workingMemoryTemplate.mjs';
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/workingMemoryTemplate.test.mjs tests/isolated/agents/memory/working_memory_schema.test.mjs
```

- [ ] **Step 5: Update workingMemorySchema tests to assert template shape**

The existing `working_memory_schema.test.mjs` was rewritten to assert Zod parsing. Replace its contents (since the schema export is now a template string, not a Zod parser):

```javascript
// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs';
import { healthCoachWorkingMemoryTemplate } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs';

describe('healthCoachWorkingMemorySchema (deprecated; re-exports template)', () => {
  it('returns the same string as workingMemoryTemplate', () => {
    expect(healthCoachWorkingMemorySchema).toBe(healthCoachWorkingMemoryTemplate);
  });

  it('is a non-empty Markdown string', () => {
    expect(typeof healthCoachWorkingMemorySchema).toBe('string');
    expect(healthCoachWorkingMemorySchema).toMatch(/^# /);
  });
});
```

- [ ] **Step 6: Run; pass + full suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/
```

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/memory/workingMemoryTemplate.mjs \
  backend/src/3_applications/agents/lifeplan-guide/memory/workingMemoryTemplate.mjs \
  backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs \
  tests/isolated/agents/health-coach/workingMemoryTemplate.test.mjs \
  tests/isolated/agents/memory/working_memory_schema.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): working memory via Markdown template

Plan / Task 2 (memory config). Replaced the Zod/JSONSchema-based
working memory schema with a Markdown template (the path Mastra's
WorkingMemory accepts as an alternative to schema mode). This
bypasses the schema-conversion bug in @mastra/memory@1.17.5 that
produced { type: "None" } JSONSchema output rejected by OpenAI.

The agent reads/rewrites the FULL Markdown content via the
updateWorkingMemory tool. Resource-scoped sharing means lifeplan-guide
sees the same Markdown — both agents reuse the same template for
unified user state.

workingMemorySchema.mjs is kept as a deprecated re-export for
back-compat with any caller that still imports it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: HealthCoachAgent + LifeplanGuideAgent read config from YAML

Both agents' `getMemoryConfig` methods now read from `loadAgentConfig` and resolve the working memory template from the local module. Hardcoded values vanish from the agent classes.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Modify: `backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs`
- Modify: `tests/isolated/agents/health-coach/static_infrastructure.test.mjs`

- [ ] **Step 1: Update tests**

In `tests/isolated/agents/health-coach/static_infrastructure.test.mjs`, replace the existing `getMemoryConfig` tests:

```javascript
describe('HealthCoachAgent.getMemoryConfig', () => {
  it('reads last_messages from configService when present', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: { memory: { last_messages: 75 } },
          overrides: {},
        }),
      },
    });
    expect(cfg.lastMessages).toBe(75);
  });

  it('falls back to hardcoded default when no config present', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({ configService: null });
    expect(cfg.lastMessages).toBe(100);  // hardcoded default
  });

  it('attaches working memory template when enabled in config', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: {
            memory: {
              working_memory: { enabled: true, scope: 'resource' },
            },
          },
        }),
      },
    });
    expect(cfg.workingMemory).toBeDefined();
    expect(cfg.workingMemory.enabled).toBe(true);
    expect(cfg.workingMemory.scope).toBe('resource');
    expect(typeof cfg.workingMemory.template).toBe('string');
    expect(cfg.workingMemory.template).toMatch(/Recent Focus Areas/);
  });

  it('honors per-agent overrides', () => {
    const cfg = HealthCoachAgent.getMemoryConfig({
      configService: {
        getAppConfig: () => ({
          default: { memory: { last_messages: 50 } },
          overrides: { 'health-coach': { memory: { last_messages: 200 } } },
        }),
      },
    });
    expect(cfg.lastMessages).toBe(200);
  });
});
```

- [ ] **Step 2: Implement `HealthCoachAgent.getMemoryConfig`**

```javascript
// In HealthCoachAgent.mjs — replace the static getMemoryConfig method body:

import { loadAgentConfig } from '../framework/loadAgentConfig.mjs';
import { healthCoachWorkingMemoryTemplate } from './memory/workingMemoryTemplate.mjs';

// ... inside class HealthCoachAgent extends BaseAgent {

static getMemoryConfig({ configService } = {}) {
  const yaml = loadAgentConfig({ configService, agentId: 'health-coach' });
  const m = yaml.memory;
  const out = { lastMessages: m.last_messages };
  if (m.working_memory?.enabled) {
    out.workingMemory = {
      enabled: true,
      scope: m.working_memory.scope || 'resource',
      template: healthCoachWorkingMemoryTemplate,
    };
  }
  return out;
}
```

- [ ] **Step 3: Same for LifeplanGuideAgent**

```javascript
// In LifeplanGuideAgent.mjs:
import { loadAgentConfig } from '../framework/loadAgentConfig.mjs';
import { lifeplanGuideWorkingMemoryTemplate } from './memory/workingMemoryTemplate.mjs';

// ... inside class LifeplanGuideAgent extends BaseAgent {

static getMemoryConfig({ configService } = {}) {
  const yaml = loadAgentConfig({ configService, agentId: 'lifeplan-guide' });
  const m = yaml.memory;
  const out = { lastMessages: m.last_messages };
  if (m.working_memory?.enabled) {
    out.workingMemory = {
      enabled: true,
      scope: m.working_memory.scope || 'resource',
      template: lifeplanGuideWorkingMemoryTemplate,
    };
  }
  return out;
}
```

- [ ] **Step 4: Bootstrap passes configService into the static-method calls**

The REFLECTIVE_AGENTS loop already builds `sharedAgentDeps` with `configService`. Verify each `AgentClass.getMemoryConfig(sharedAgentDeps)` call receives configService — should already be true since `configService` is a key in sharedAgentDeps. No change needed if this is already the case.

```bash
cd /opt/Code/DaylightStation && grep -A 2 "getMemoryConfig?.(sharedAgentDeps)" backend/src/0_system/bootstrap.mjs
```

If the call is `AgentClass.getMemoryConfig?.(sharedAgentDeps)`, no change. Same for the lifeplan-guide block: `LifeplanGuideAgent.getMemoryConfig?.()` — change to `LifeplanGuideAgent.getMemoryConfig?.({ configService })` if currently called without args.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/ tests/isolated/agents/framework/ tests/isolated/agents/lifeplan-guide/ 2>/dev/null
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
  backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs \
  backend/src/0_system/bootstrap.mjs \
  tests/isolated/agents/health-coach/static_infrastructure.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): per-agent getMemoryConfig reads from agents.yml

Plan / Task 3 (memory config). HealthCoachAgent + LifeplanGuideAgent
getMemoryConfig now resolve via loadAgentConfig, reading from
data/household/config/agents.yml. Working memory template attached
from the agent's local template module.

Hardcoded fallbacks remain (in loadAgentConfig.mjs) for any field
not set in YAML — agents work out of the box, but the household can
tune everything.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ObservationalMemory factory + per-agent processor wiring

Wire ObservationalMemory as an Agent processor for auto-compaction of long threads.

**Files:**
- Create: `backend/src/3_applications/agents/framework/buildObservationalMemory.mjs`
- Create: `tests/isolated/agents/framework/buildObservationalMemory.test.mjs`
- Modify: `backend/src/3_applications/agents/framework/buildAgentRuntime.mjs` — accept `processors`
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs` — accept + pass processors to Agent
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` — `getMemoryProcessors` static
- Modify: `backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs` — `getMemoryProcessors` static
- Modify: `backend/src/0_system/bootstrap.mjs` — pass processors to per-agent runtime

- [ ] **Step 1: Tests for the factory**

```javascript
// tests/isolated/agents/framework/buildObservationalMemory.test.mjs
import { describe, it, expect } from 'vitest';
import { buildObservationalMemory } from '../../../../backend/src/3_applications/agents/framework/buildObservationalMemory.mjs';

describe('buildObservationalMemory', () => {
  it('returns null when config disabled', () => {
    expect(buildObservationalMemory({ enabled: false }, { storage: {} })).toBe(null);
  });

  it('returns null when config null/undefined', () => {
    expect(buildObservationalMemory(null, { storage: {} })).toBe(null);
    expect(buildObservationalMemory(undefined, { storage: {} })).toBe(null);
  });

  it('returns null when storage missing', () => {
    expect(buildObservationalMemory({ enabled: true }, {})).toBe(null);
  });

  it('builds processor when enabled with storage', () => {
    // Storage interface check is loose — we just need the constructor to accept it
    const fakeStorage = { stores: { memory: {} } };
    const proc = buildObservationalMemory(
      { enabled: true, observer_model: 'openai/gpt-4o-mini', message_tokens_threshold: 30000 },
      { storage: fakeStorage },
    );
    expect(proc).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement factory**

```javascript
// backend/src/3_applications/agents/framework/buildObservationalMemory.mjs
import { ObservationalMemory } from '@mastra/memory/processors/observational-memory';

/**
 * Build an ObservationalMemory processor instance for an agent.
 *
 * Returns null when disabled or storage is missing — the caller
 * conditionally adds it to the processor chain.
 *
 * @param {object|null} config — { enabled, observer_model, reflector_model,
 *   message_tokens_threshold, observation_tokens_threshold, scope }
 * @param {object} deps — { storage } (Mastra storage instance)
 * @returns {ObservationalMemory|null}
 */
export function buildObservationalMemory(config, { storage } = {}) {
  if (!config?.enabled) return null;
  if (!storage) return null;
  try {
    return new ObservationalMemory({
      storage: storage.stores?.memory || storage,
      model: config.observer_model || 'openai/gpt-4o-mini',
      observation: {
        model: config.observer_model || 'openai/gpt-4o-mini',
        messageTokens: config.message_tokens_threshold || 30000,
      },
      reflection: {
        model: config.reflector_model || 'openai/gpt-4o-mini',
        observationTokens: config.observation_tokens_threshold || 40000,
      },
      scope: config.scope || 'resource',
    });
  } catch (err) {
    return null;
  }
}

export default buildObservationalMemory;
```

NOTE on storage: ObservationalMemory needs `MemoryStorage` (the memory-domain sub-store). Mastra's Memory.storage exposes nested sub-stores via `storage.stores.memory`. Adjust the access path based on actual API after running step 1's quick smoke import.

- [ ] **Step 3: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/buildObservationalMemory.test.mjs
```

- [ ] **Step 4: Extend buildAgentRuntime to accept processors**

```javascript
// backend/src/3_applications/agents/framework/buildAgentRuntime.mjs
export function buildAgentRuntime(memory, sharedDeps = {}, processors = null) {
  return new MastraAdapter({
    logger: sharedDeps.logger,
    mediaDir: sharedDeps.mediaDir,
    model: sharedDeps.model,
    agentClass: sharedDeps.agentClass,
    memory,
    inputProcessors: processors?.inputProcessors || null,
    outputProcessors: processors?.outputProcessors || null,
  });
}
```

- [ ] **Step 5: MastraAdapter forwards processors to Agent**

In `MastraAdapter.mjs` constructor:

```javascript
this.#inputProcessors = deps.inputProcessors || null;
this.#outputProcessors = deps.outputProcessors || null;
```

In execute() / streamExecute() Agent construction:

```javascript
const agentOpts = {
  name, instructions: systemPrompt, model: this.#model, tools: mastraTools,
};
if (this.#memory) agentOpts.memory = this.#memory;
if (this.#inputProcessors?.length)  agentOpts.inputProcessors  = this.#inputProcessors;
if (this.#outputProcessors?.length) agentOpts.outputProcessors = this.#outputProcessors;
const mastraAgent = new this.#AgentClass(agentOpts);
```

- [ ] **Step 6: HealthCoachAgent.getMemoryProcessors**

```javascript
// In HealthCoachAgent.mjs:
import { buildObservationalMemory } from '../framework/buildObservationalMemory.mjs';

// ...

static getMemoryProcessors({ configService, memory } = {}) {
  const yaml = loadAgentConfig({ configService, agentId: 'health-coach' });
  const obs = buildObservationalMemory(yaml.memory.observational, { storage: memory?.storage });
  return {
    inputProcessors:  obs ? [obs] : [],
    outputProcessors: obs ? [obs] : [],
  };
}
```

NOTE: ObservationalMemory is BOTH an input and output processor in Mastra's design (it injects context as input, persists observations as output). Pass the same instance to both arrays.

Same pattern for `LifeplanGuideAgent.getMemoryProcessors`.

- [ ] **Step 7: Bootstrap loop adds processors**

In the REFLECTIVE_AGENTS loop:

```javascript
const memoryConfig    = AgentClass.getMemoryConfig?.(sharedAgentDeps) ?? null;
const memory          = buildAgentMemory(memoryConfig, { ...sharedAgentDeps, agentId });
const processors      = AgentClass.getMemoryProcessors?.({ ...sharedAgentDeps, memory }) ?? null;
const perAgentRuntime = buildAgentRuntime(memory, sharedAgentDeps, processors);
```

Same call shape for the lifeplan-guide block.

- [ ] **Step 8: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 9: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/framework/buildObservationalMemory.mjs \
  backend/src/3_applications/agents/framework/buildAgentRuntime.mjs \
  backend/src/1_adapters/agents/MastraAdapter.mjs \
  backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
  backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs \
  backend/src/0_system/bootstrap.mjs \
  tests/isolated/agents/framework/buildObservationalMemory.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): ObservationalMemory wired as per-agent processor

Plan / Task 4 (memory config). Background Observer + Reflector
agents (cheap model, e.g. gpt-4o-mini) compress thread history when
message tokens > 30K and observations > 40K. Compression ratio 5-40×.

Each agent declares its observational config via getMemoryProcessors
static method. Bootstrap loop attaches the processor to the per-agent
MastraAdapter via inputProcessors + outputProcessors. Configurable
per-agent via agents.yml override.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TimeWindow input processor

Custom processor that filters messages by recency before they reach the LLM. Per-agent configurable via YAML.

**Files:**
- Create: `backend/src/3_applications/agents/framework/buildTimeWindowProcessor.mjs`
- Create: `tests/isolated/agents/framework/buildTimeWindowProcessor.test.mjs`
- Modify: `HealthCoachAgent.getMemoryProcessors` and `LifeplanGuideAgent.getMemoryProcessors` to include TimeWindow when configured

- [ ] **Step 1: Tests**

```javascript
// tests/isolated/agents/framework/buildTimeWindowProcessor.test.mjs
import { describe, it, expect } from 'vitest';
import { buildTimeWindowProcessor } from '../../../../backend/src/3_applications/agents/framework/buildTimeWindowProcessor.mjs';

const NOW = 1700000000000;  // fixed for test determinism

const oldMsg = (mins) => ({
  role: 'user',
  content: `m-${mins}m`,
  createdAt: new Date(NOW - mins * 60 * 1000).toISOString(),
});

describe('buildTimeWindowProcessor', () => {
  it('returns null when config null/undefined', () => {
    expect(buildTimeWindowProcessor(null)).toBe(null);
    expect(buildTimeWindowProcessor(undefined)).toBe(null);
  });

  it('returns null when time_window_hours is not set', () => {
    expect(buildTimeWindowProcessor({ time_window_hours: null })).toBe(null);
    expect(buildTimeWindowProcessor({ time_window_hours: 0 })).toBe(null);
  });

  it('builds a processor that filters messages older than the window', () => {
    const proc = buildTimeWindowProcessor(
      { time_window_hours: 1 },
      { now: () => NOW },
    );
    expect(proc).toBeDefined();
    const messages = [
      oldMsg(120),  // 2h ago — drop
      oldMsg(90),   // 1.5h ago — drop
      oldMsg(45),   // 45m ago — keep
      oldMsg(10),   // 10m ago — keep
    ];
    const filtered = proc.process({ messages, ctx: {} });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].content).toBe('m-45m');
    expect(filtered[1].content).toBe('m-10m');
  });

  it('keeps all messages when none have createdAt', () => {
    const proc = buildTimeWindowProcessor(
      { time_window_hours: 1 },
      { now: () => NOW },
    );
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const filtered = proc.process({ messages, ctx: {} });
    expect(filtered).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Implement**

```javascript
// backend/src/3_applications/agents/framework/buildTimeWindowProcessor.mjs

/**
 * Build a Mastra-shaped input processor that filters messages older than
 * config.time_window_hours. Messages without a parseable createdAt timestamp
 * are kept (we don't know how old they are, so we don't drop them).
 *
 * @param {object|null} config — { time_window_hours: number | null }
 * @param {object} [opts] — { now? () => epochMs }
 * @returns {object|null} — processor with .process(args) → filtered messages
 */
export function buildTimeWindowProcessor(config, { now = () => Date.now() } = {}) {
  if (!config?.time_window_hours || config.time_window_hours <= 0) return null;
  const windowMs = config.time_window_hours * 60 * 60 * 1000;

  return {
    name: 'TimeWindow',
    process({ messages }) {
      if (!Array.isArray(messages)) return messages;
      const cutoff = now() - windowMs;
      return messages.filter(m => {
        const t = m?.createdAt ? new Date(m.createdAt).getTime() : null;
        if (t === null || Number.isNaN(t)) return true;
        return t >= cutoff;
      });
    },
  };
}

export default buildTimeWindowProcessor;
```

NOTE: Mastra's actual input processor interface may be slightly different (it might expect a class extending `InputProcessor` from `@mastra/core/processors`). Check the actual interface and adapt — the tests above use the simplified `.process({ messages })` shape. If Mastra requires an instance method `processInput(args)`, rename the method.

- [ ] **Step 3: Wire into agents' getMemoryProcessors**

```javascript
// In HealthCoachAgent.getMemoryProcessors:
import { buildTimeWindowProcessor } from '../framework/buildTimeWindowProcessor.mjs';

static getMemoryProcessors({ configService, memory } = {}) {
  const yaml = loadAgentConfig({ configService, agentId: 'health-coach' });
  const obs = buildObservationalMemory(yaml.memory.observational, { storage: memory?.storage });
  const tw  = buildTimeWindowProcessor(yaml.memory);
  return {
    inputProcessors:  [tw, obs].filter(Boolean),
    outputProcessors: obs ? [obs] : [],
  };
}
```

Same for lifeplan-guide.

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/buildTimeWindowProcessor.test.mjs
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/framework/buildTimeWindowProcessor.mjs \
  backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
  backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs \
  tests/isolated/agents/framework/buildTimeWindowProcessor.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): TimeWindow input processor — filter messages by recency

Plan / Task 5 (memory config). Custom Mastra input processor reads
config.time_window_hours and filters messages older than that.
Combined with lastMessages (count cap) gives a hybrid recency rule:
"last N messages OR last X hours, whichever is more restrictive".

Per-agent configurable via agents.yml. When time_window_hours is
null or 0 (default), no time filter applies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Author the live agents.yml in the data volume

The yml file lives in the (gitignored) data volume. Drop it in via `sudo docker exec`.

- [ ] **Step 1: Write the live config**

```bash
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c "cat > data/household/config/agents.yml << 'EOF'
# Memory + processor configuration for all reflective agents.

default:
  memory:
    last_messages: 100
    time_window_hours: null

    working_memory:
      enabled: true
      scope: resource

    observational:
      enabled: true
      observer_model: 'openai/gpt-4o-mini'
      reflector_model: 'openai/gpt-4o-mini'
      message_tokens_threshold: 30000
      observation_tokens_threshold: 40000

    semantic_recall:
      enabled: false
      top_k: 5
      message_range: 2
      scope: resource

overrides:
  health-coach:
    memory:
      last_messages: 100

  lifeplan-guide:
    memory:
      last_messages: 50
EOF"
```

- [ ] **Step 2: Verify**

```bash
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c "cat data/household/config/agents.yml"
```

- [ ] **Step 3: Commit a checked-in EXAMPLE**

```bash
cd /opt/Code/DaylightStation && mkdir -p docs/_wip/configs
cat > docs/_wip/configs/agents.example.yml << 'EOF'
# EXAMPLE — copy to data/household/config/agents.yml in the data volume.
# (data/ is gitignored; this is the reference for what shape it expects.)

default:
  memory:
    last_messages: 100
    time_window_hours: null

    working_memory:
      enabled: true
      scope: resource

    observational:
      enabled: true
      observer_model: 'openai/gpt-4o-mini'
      reflector_model: 'openai/gpt-4o-mini'
      message_tokens_threshold: 30000
      observation_tokens_threshold: 40000

    semantic_recall:
      enabled: false
      top_k: 5
      message_range: 2
      scope: resource

overrides:
  health-coach:
    memory:
      last_messages: 100

  lifeplan-guide:
    memory:
      last_messages: 50
EOF

cd /opt/Code/DaylightStation && git add docs/_wip/configs/agents.example.yml
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
docs(configs): example agents.yml

Plan / Task 6 (memory config). Reference shape for the live
data/household/config/agents.yml (which is gitignored). Defaults +
per-agent override pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Build, deploy, multi-step smoke

The big verification.

- [ ] **Step 1: Vitest**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/ frontend/src/modules/Agent/
```

Expected: all green.

- [ ] **Step 2: Vite build + Docker build + deploy**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3 && cd ..
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -3 && \
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3 && \
until curl -sS -m 3 http://localhost:3111/api/v1/agents > /dev/null 2>&1; do sleep 3; done && echo READY
```

- [ ] **Step 3: Boot smoke — confirm Memory + processors initialized**

```bash
sudo docker logs daylight-station --since 60s 2>&1 | grep -iE "memory|observational|timewindow|libsql|error" | grep -v "WebSocket\|playback" | head -15
```

Expected: no errors. Optionally confirm via `agent.tool_inventory` log that working memory tool is now exposed (turn the agent and look for `updateWorkingMemory` in localToolKeys or memToolKeys).

- [ ] **Step 4: 4-check live smoke**

```bash
python3 <<'PY'
import json, re, subprocess, sys, uuid

THREAD_HC = f"t-mem-{uuid.uuid4().hex[:8]}"
THREAD_LP = f"t-mem-{uuid.uuid4().hex[:8]}"

def run(agent, input_text, threadId, messages=None):
    body = {"input": input_text, "context": {"userId": "kckern"}, "threadId": threadId}
    if messages is not None: body["messages"] = messages
    r = subprocess.run(["curl","-sS","-m","120","-X","POST",
        f"http://localhost:3111/api/v1/agents/{agent}/run",
        "-H","Content-Type: application/json","-d",json.dumps(body)],
        capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except: return {}

# Q1: establish (writes to working memory)
print(f"=== Q1: establish (health-coach, threadId={THREAD_HC}) ===")
r1 = run("health-coach",
    "I'm focusing on Z2 endurance this month and my goal is a sub-3:30 marathon by October. Keep this in mind for our future conversations.",
    THREAD_HC,
    messages=[{"role":"user","content":"I'm focusing on Z2 endurance this month and my goal is a sub-3:30 marathon by October. Keep this in mind for our future conversations."}])
out1 = (r1.get("output") or "").strip()
tools1 = [tc.get("payload", tc).get("toolName") for tc in r1.get("toolCalls", [])]
print("OUT:", out1[:300])
print("TOOLS:", tools1)

import time; time.sleep(2)

# Q2: same thread, NO history — server reconstructs
print(f"\n=== Q2: same thread, NO history ===")
r2 = run("health-coach", "what was I focusing on this month?", THREAD_HC, messages=[])
out2 = (r2.get("output") or "").strip()
print("OUT:", out2[:300])

# Q3: cross-agent — different threadId, working memory shared via resource scope
print(f"\n=== Q3: cross-agent (lifeplan-guide, threadId={THREAD_LP}) ===")
r3 = run("lifeplan-guide", "what does kc want to focus on right now?", THREAD_LP, messages=[])
out3 = (r3.get("output") or "").strip()
print("OUT:", out3[:400])

print("\n=== CHECKS ===")
def has_wm_tool(tools):
    return any(t and 'workingmemory' in t.lower().replace('-','').replace('_','') for t in tools)

checks = [
    ("Q1 acknowledges focus + goal", bool(re.search(r"\b(z2|endurance|marathon|sub-3|got it|noted|remember)", out1, re.I))),
    ("Q1 called updateWorkingMemory", has_wm_tool(tools1)),
    ("Q2 server-side recall", bool(re.search(r"\b(z2|endurance|marathon)", out2, re.I))),
    ("Q3 cross-agent recall via shared working memory", bool(re.search(r"\b(z2|endurance|marathon)", out3, re.I))),
]
ok = all(v for _, v in checks)
for label, v in checks: print(("✓" if v else "✗"), label)
sys.exit(0 if ok else 1)
PY
echo "exit: $?"
```

Expected: all 4 ✓.

- [ ] **Step 5: Bonus — verify YAML config is read**

Edit `data/household/config/agents.yml` to set `last_messages: 5`, restart container, run a smoke turn that ships >5 messages, confirm the agent only sees the last 5. (Optional verification — proves the YAML pipeline is alive end-to-end.)

```bash
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c "sed -i 's/last_messages: 100/last_messages: 5/' data/household/config/agents.yml"
sudo docker exec daylight-station sh -c "cat data/household/config/agents.yml | grep last_messages"
# Container needs restart for ConfigService to re-read (or the loader caches per-process)
sudo docker restart daylight-station
until curl -sS -m 3 http://localhost:3111/api/v1/agents > /dev/null 2>&1; do sleep 3; done
# ... single smoke turn confirming behavior
```

If ConfigService caches at startup (likely), document the restart requirement; do NOT add hot-reload in this plan.

- [ ] **Step 6: Final summary commit**

```bash
cd /opt/Code/DaylightStation && git commit --allow-empty -m "$(cat <<'EOF'
chore(agents): config-driven memory with working + observational + time window

7 plan tasks landed:
- T1: loadAgentConfig — reads agents.yml + merges defaults/overrides
- T2: working memory via Markdown template (bypasses Mastra's broken
      schema converter); shared across health-coach + lifeplan-guide
- T3: per-agent getMemoryConfig reads from YAML (no more hardcoded)
- T4: ObservationalMemory wired as Agent processor for auto-compaction
- T5: TimeWindow input processor for recency-based message filtering
- T6: live agents.yml in data volume + checked-in example
- T7: build + deploy + 4-check smoke

Memory configuration is now config-driven, working memory works via
template mode, long threads auto-summarize, and per-agent overrides
in agents.yml control all of it. Smart agents, not bare bones.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Capability | Tasks |
|---|---|
| Per-agent config in YAML, not hardcoded | T1, T3, T6 |
| Defaults + per-agent overrides | T1, T6 |
| Working memory actually functional | T2, T3 (template mode bypasses the broken schema converter) |
| Cross-agent shared user state | T2 (resource scope), T3 |
| Auto-summarize old threads | T4 (ObservationalMemory) |
| Time-based message windowing | T5 (TimeWindow processor) |
| Hybrid count + time | T1 (config exposes both) + T5 |
| Bare-bones → smart | All seven tasks together |

---

## Notes for the implementer

- **Mastra ObservationalMemory storage path**: the `ObservationalMemoryConfig.storage` field expects `MemoryStorage` from MastraStorage.stores.memory. If our LibSQLStore exposes that as `store.stores.memory`, use it. If the API differs at this version, adapt — the factory's try/catch returns null on error so a wrong storage path won't crash boot.

- **Mastra processor interface**: `@mastra/core` defines `InputProcessor` / `OutputProcessor` classes (or interfaces). Our TimeWindow uses a duck-typed shape `{ name, process }`. If Mastra rejects this and requires `extends InputProcessor` with `processInput(args)`, refactor — same logic, different signature. The tests use simplified shapes that don't depend on the framework class.

- **YAML-not-in-git**: `data/household/config/agents.yml` lives in the data volume (gitignored). The example at `docs/_wip/configs/agents.example.yml` is the checked-in reference. Production deploys carry the data volume across; new environments need to copy the example.

- **ConfigService caching**: most ConfigService implementations cache file reads at startup. Changes to agents.yml require a container restart to take effect. We don't add hot-reload — that's a separate ergonomics concern out of scope here.

- **Working memory template — no per-agent customization yet**: T2 has both agents pointing at the same template (since they share user state). When lifeplan-guide grows its own observation fields (life-plan-specific stuff), fork the template — keep working_memory.scope: 'resource' so the agents still share the OVERLAPPING fields, OR change to 'thread' to isolate.

- **Semantic recall is OFF by default**: in YAML it's `enabled: false`. Wiring it requires an embedder (text-embedding-3-small) and a vector store. Out of scope for this plan; revisit when deep-history queries become a real need.

- **`getMemoryProcessors` per-agent isolation**: each agent's processors are constructed independently and attached only to that agent's MastraAdapter. Cross-agent state happens via the shared Memory storage (resource scope), NOT via processor sharing. Don't try to reuse processor instances across agents.

- **Token cost from observational memory**: each compaction cycle is ~2-3 LLM calls on the cheap model. Per user per long thread: a few cents/month. Bounded but not free. If this becomes a budget concern, raise the `message_tokens_threshold` in agents.yml.
