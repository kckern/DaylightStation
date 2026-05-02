# Brain Policy with Teeth — Design

**Status:** Spec  
**Date:** 2026-05-01  
**Sub-project of:** Brain Roles Architecture (F1 of F1/F2/F3 + R1-R4 decomposition)  
**Replaces:** `PassThroughBrainPolicy` (no-op gate that allows everything)

---

## Goal

Make `IBrainPolicy.evaluateToolCall` actually enforce per-satellite, per-tool, per-args governance — so a satellite can be granted "fitness data yes, finance data no" with a config rule, not by hoping the LLM honors a prompt.

## Non-goals (deferred to a Phase 2 policy spec)

- `evaluateRequest` — pre-flight gates (quiet hours, satellite cooldowns).
- `shapeResponse` — output redaction.
- Time-of-day or context-of-day rules.
- Named permission profiles for many satellites with shared shapes.
- Tool-defined predicates (Q3 option (b) — rejected as needless indirection at scale of 7 skills).

These remain **deliberately empty** until a concrete need surfaces. The interface keeps all three injection points; only `evaluateToolCall` gains real behavior in v1.

---

## Decisions locked during brainstorming

| # | Question | Answer |
|---|---|---|
| 1 | Which `IBrainPolicy` injection points get teeth? | Just `evaluateToolCall` |
| 2 | Default when a tool has no policy rule? | Per-tool default declared by the skill itself |
| 3 | How are rules expressed? | Scope-based — tools emit hierarchical scope strings, satellite config allow/deny by glob |
| 4 | What does a deny look like to the user? | Tool returns `{ok: false, reason: 'policy_denied:<scope>'}`; LLM speaks a contextual refusal |
| 5 | Where does config live? | Household-wide defaults + per-satellite overrides in `brain.yml`; deny is non-overridable downward |

---

## Architecture

A new `BrainPolicyEvaluator` service lives in `3_applications/brain/services/`. SkillRegistry's existing tool wrapper (which already calls `policy.evaluateToolCall`) just gets a real implementation injected instead of `PassThroughBrainPolicy`. No new wiring layer; no Mastra runtime interceptor.

Each tool that needs gating self-declares two optional fields. Each satellite declares glob lists of allowed and denied scopes. The evaluator merges household and satellite rules and returns `BrainDecision.allow()` or `BrainDecision.deny(reason)` per call.

## Components

### 1. `ITool` extension (optional fields, fully backward-compatible)

```js
{
  name: 'remember_note',
  description: '…',
  parameters: { … },
  execute: async (args, ctx) => { … },

  // NEW — both optional. Tools that omit both behave exactly as today.
  defaultPolicy: 'open' | 'restricted',          // default 'open'
  getScopesFor: (args) => string[],               // default: ['<skill>:<tool>']
}
```

**Scope string convention:** lowercase, colon-separated, hierarchical from broadest to most specific. Examples:

| Tool | Args | Emitted scopes |
|---|---|---|
| `read_data_file` (helpdesk, future) | `{path: 'common/calendar.yml'}` | `['data:calendar:calendar.yml']` |
| `read_data_file` | `{path: 'common/finances/budget.yml'}` | `['data:finances:budget.yml']` |
| `ha_run_script` | `{name: 'office_chill_activate'}` | `['ha:scripts:office:office_chill_activate']` |
| `ha_toggle_entity` | `{name: 'living_room_lights', action: 'turn_off'}` | `['ha:lights:living_room:turn_off']` |
| `play_media` | `{query: 'starship'}` | `['media:audio:plex']` (broad) |
| `remember_note` | `{content: '…'}` | `['memory:write:notes']` |
| `recall_note` | `{}` | `['memory:read:notes']` |

The evaluator never inspects what scopes "mean" — it just glob-matches. Tools own the meaning.

### 2. `brain.yml` schema additions

```yaml
# Household-wide policy. Applies to ALL satellites.
#   scopes_denied  — absolute. Non-overridable downward. The safety net for
#                    "this is sensitive, no exception."
#   scopes_allowed — universal grants every satellite inherits. Optional;
#                    rarely used (most allows are satellite-specific).
policy:
  scopes_denied:
    - data:auth:*
    - data:finances:*
  # scopes_allowed:
  #   - memory:*    # uncomment to grant memory access to every satellite

satellites:
  - id: office
    media_player_entity: media_player.…
    allowed_skills: [memory, home_automation, media, helpdesk]   # existing — coarse skill gate
    scopes_allowed:                                              # NEW
      - data:fitness:*
      - data:calendar:*
      - data:weather:*
      - memory:*
      - ha:office:*
      - ha:kitchen:*
      - media:*
    scopes_denied: []                                            # NEW (rare — additional satellite-only deny)
    token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_OFFICE
```

The household `policy:` section is optional. Satellite `scopes_allowed` / `scopes_denied` are optional — when both omitted, every tool's `defaultPolicy` controls.

### 3. `BrainPolicyEvaluator` service

Path: `backend/src/3_applications/brain/services/BrainPolicyEvaluator.mjs` (~80 lines).

```js
new BrainPolicyEvaluator({ householdPolicy, logger })
  // householdPolicy = { scopes_denied: string[], scopes_allowed?: string[] }

evaluator.evaluateToolCall(satellite, toolName, args, tool) → BrainDecision
```

Algorithm:

1. Compute scopes for the call. If `tool.getScopesFor` exists, call it. Otherwise default to `['<skill>:<tool>']` where `<skill>` is the registering skill name (already known to SkillRegistry).
2. If scopes is empty, treat as the fallback `['<skill>:<tool>']` — never silently allow with zero check.
3. For each scope, check in order:
   - **a.** Match against `householdPolicy.scopes_denied`. If hit → `deny('household:<matched-rule>')`. Stop.
   - **b.** Match against `satellite.scopes_denied`. If hit → `deny('satellite:<matched-rule>')`. Stop.
4. After all scopes survive both deny lists, check coverage:
   - **a.** Every scope must match at least one entry in `householdPolicy.scopes_allowed ∪ satellite.scopes_allowed` to be considered "covered". (Either or both may be empty.)
   - **b.** If all scopes covered → `allow()`.
   - **c.** If any uncovered AND `tool.defaultPolicy === 'open'` (or undefined) → `allow('default_open')`.
   - **d.** If any uncovered AND `tool.defaultPolicy === 'restricted'` → `deny('uncovered:<scope>')`.

### 4. Glob matching

Two-token glob, identical to many config-file matchers:

| Pattern | Matches | Doesn't match |
|---|---|---|
| `data:fitness:*` | `data:fitness:strava.yml` | `data:fitness:cardio:peloton.yml`, `data:weather:*` |
| `data:fitness:**` | both of the above | `data:weather:*` |
| `ha:office:**` | `ha:office:lights:turn_on`, `ha:office:scripts:vent` | `ha:kitchen:*` |

Implementation: split both on `:`, walk segments. `*` matches one segment, `**` matches one or more. No regex, no character classes.

### 5. Audit trail

Every policy decision lands in the per-request transcript already written by `BrainTranscript`:

```json
{
  "name": "read_data_file",
  "args": { "path": "common/finances/budget.yml" },
  "policyDecision": {
    "allowed": false,
    "scopes": ["data:finances:budget.yml"],
    "deniedBy": "household:data:finances:*"
  },
  "result": { "ok": false, "reason": "policy_denied:data:finances:*" },
  "ok": false,
  "latencyMs": 0,
  "ts": "…"
}
```

`BrainTranscript.recordTool` already exists; we just thread the decision through.

---

## Data flow

```
LLM emits tool call
  │
  ▼
SkillRegistry.#wrap.execute(args, ctx)
  │
  ├─► BrainPolicyEvaluator.evaluateToolCall(satellite, toolName, args, tool)
  │     │
  │     ├─ Tool.getScopesFor(args)? → emits scopes
  │     ├─ Walk scopes vs household.scopes_denied → deny? short-circuit
  │     ├─ Walk scopes vs satellite.scopes_denied → deny? short-circuit
  │     ├─ All covered by allow lists? → allow
  │     └─ Else: tool.defaultPolicy decides
  │
  ├─ allow → tool.execute(args, ctx) → real result back to LLM
  │
  └─ deny → return {ok: false, reason: 'policy_denied:<rule>'}
            transcript.recordTool({ …, policyDecision, result })
            LLM sees the tool error → speaks contextual refusal
```

---

## Errors and edge cases

| Case | Handling |
|---|---|
| Tool missing `getScopesFor` | Fall back to scope `['<skill>:<tool>']`. Coarse-grained gating still works. |
| Tool missing `defaultPolicy` | Treat as `'open'` — no behavior change for the 7 existing skills. |
| `getScopesFor` throws | Catch, log `brain.policy.scopes_emit_failed`, deny the call (fail-closed on bugs). |
| `getScopesFor` returns non-array | Treat as fallback scope. Log warn. |
| Empty array returned | Treat as fallback scope. Never silently allow. |
| Malformed glob in `brain.yml` | Boot-time validation. Throw at startup. Same fail-loud principle as `judge_model`. |
| Satellite has no `scopes_allowed` and no `scopes_denied` | Per-tool defaults govern. (Most permissive case for `defaultPolicy: 'open'` tools.) |
| Household has no `policy:` block | No deny floor; only satellite-level deny applies. |

---

## Testing

All pure logic — fully unit-testable, no live system needed.

### `BrainPolicyEvaluator.test.mjs`

Matrix of scenarios in a single suite:

| Group | Cases |
|---|---|
| Default-open tool, no rules | allow |
| Default-open tool, satellite allow matches | allow |
| Default-open tool, household deny matches | deny (household) |
| Default-restricted tool, no rules | deny (uncovered) |
| Default-restricted tool, satellite allow matches all scopes | allow |
| Default-restricted tool, satellite allow covers some scopes | deny (uncovered) |
| Tool emits multiple scopes, one denied | deny (household or satellite) |
| Tool emits multiple scopes, all covered by union of household+satellite allows | allow |
| Satellite tries to allow a scope household denies | deny (deny is non-overridable) |
| Tool's `getScopesFor` throws | deny (fail-closed) |
| Tool's `getScopesFor` returns `[]` | fallback scope used |
| Tool missing `getScopesFor` | fallback scope `<skill>:<tool>` used |
| Glob: `data:fitness:*` matches `data:fitness:x.yml` | match |
| Glob: `data:fitness:*` does NOT match `data:fitness:cardio:x.yml` | no match |
| Glob: `data:fitness:**` matches both | match |
| Glob: malformed pattern | boot-time throw |

### Integration smoke

A wired-up integration test in `tests/unit/applications/brain/policy-integration.test.mjs`:
- Construct a fake satellite with `scopes_allowed: ['memory:*']`, household `scopes_denied: ['data:finances:*']`.
- Construct a fake `read_data_file` tool with `defaultPolicy: 'restricted'` and `getScopesFor({path}) → ['data:' + path.split('/')[0] + ':' + path.split('/').slice(1).join(':')]`.
- Construct a `MemorySkill`-style tool with `defaultPolicy: 'open'`.
- Call each tool through SkillRegistry → BrainPolicyEvaluator chain.
- Assert: `read_data_file('finances/budget.yml')` → `{ok: false, reason: ~/policy_denied/}`. `remember_note(...)` → executes. Transcript records both decisions.

### What's intentionally NOT tested

- Live brain endpoint behavior — covered already by existing brain integration tests; policy is a substitution behind the same interface.
- Policy YAML loading — `ConfigService.reloadHouseholdAppConfig` already tested; we just consume its output.

---

## Migration

| Tool | Today | After F1 ships |
|---|---|---|
| `MemorySkill` (`remember_note`, `recall_note`) | implicitly allowed | `defaultPolicy: 'open'` (explicit, same behavior) |
| `HomeAutomationSkill` (`ha_*`) | implicitly allowed | `defaultPolicy: 'open'` (Phase 2 may add scope rules per area) |
| `MediaSkill` (`play_media`) | implicitly allowed | `defaultPolicy: 'open'` |
| `*ReadSkill` stubs (calendar/lifelog/finance/fitness) | not registered | when adapter wired, `defaultPolicy: 'restricted'`, scope `data:<domain>:*` |
| Future `read_data_file` (helpdesk) | doesn't exist | ships with `defaultPolicy: 'restricted'` from day one |

No existing satellite needs YAML edits to keep working. Every existing tool defaults to open. The new behavior only activates when a satellite declares `scopes_allowed` / `scopes_denied`, or when a new restricted-by-default tool is registered.

---

## File locations (per `docs/reference/core/layers-of-abstraction/ddd-reference.md`)

| File | Purpose |
|---|---|
| `backend/src/3_applications/brain/services/BrainPolicyEvaluator.mjs` | The new evaluator implementation |
| `backend/src/3_applications/brain/services/PassThroughBrainPolicy.mjs` | Stays — used in tests and for satellites with no policy at all |
| `backend/src/3_applications/brain/ports/IBrainPolicy.mjs` | Unchanged (interface already exists) |
| `backend/src/3_applications/brain/services/SkillRegistry.mjs` | One change: pass the registering skill's name through to the evaluator (currently captured but not exposed in the args). Tool `getScopesFor` + `defaultPolicy` read here. |
| `backend/src/3_applications/brain/services/BrainTranscript.mjs` | Add `policyDecision` field to the tool-invocation record |
| `backend/src/0_system/bootstrap.mjs` (`createBrainServices`) | Read `brain.yml.policy` + `satellite.scopes_*`, construct `BrainPolicyEvaluator`, inject into BrainApplication instead of `PassThroughBrainPolicy` |
| `backend/tests/unit/applications/brain/services/BrainPolicyEvaluator.test.mjs` | New |
| `backend/tests/unit/applications/brain/policy-integration.test.mjs` | New |

---

## Out of scope (Phase 2 of the policy work)

These are intentionally deferred. The interface keeps room for them:

- `evaluateRequest` — quiet hours, satellite cooldowns, request-rate limits.
- `shapeResponse` — output-side redaction (e.g. "summarize but never quote dollar amounts").
- Per-tool predicate primitives (Q3 option b).
- Named permission profiles for many satellites (Q5 option c).
- Time-of-day or context-of-day scope rules.
- Per-user (vs per-satellite) policy when satellites get user identification.

---

## Spec coverage check

| Concern | Addressed by |
|---|---|
| "Fitness yes, finance no" stated example | Household `scopes_denied: [data:finances:*]` + satellite `scopes_allowed: [data:fitness:*]` |
| Generic browse protocol shared between Help Desk and HA Operator | F2 spec (separate); this F1 spec just provides the gating mechanism that makes those browses safe |
| Fail-loud config | Boot-time glob validation; `brain.policy.scopes_emit_failed` for tool-side bugs |
| Backward compatibility | All 7 existing skills default to `'open'`; behavior unchanged unless explicitly configured |
| Auditability | Per-decision record in `BrainTranscript` |
| DDD compliance | Generic evaluator in `3_applications/brain/services/`; no use-case names leaking; voice/help-desk/HA scope strings owned by the tools, not the evaluator |
