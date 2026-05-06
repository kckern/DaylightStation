# Agent Framework Convergence — Overview

**Goal:** Unify the concierge and health-coach agent stacks into one extensible, reusable framework. Eliminate duplication. Get the architecture right while we're still pre-prod and nothing depends on the current divergence.

**Why now:** We're early enough that we can refactor freely. The audit at [`docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`](../../_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md) catalogs 7 high-severity DRY violations, 6 medium, and 4 frontend duplications. Most of these compound: the concierge stack reimplements `BaseAgent`, has its own transcript class, its own memory port, its own composition root, and its own HTTP wire — all of which would need to be replicated if a third agent shipped on the concierge model. The convergence makes a third agent free.

**Audit reference:** [`docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`](../../_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md)

---

## Four-phase plan

The migration is split across four sequenced phase files. Each phase produces working, testable software on its own — no half-converted intermediate states. Phases 1–3 must run sequentially; Phase 4 can run in parallel with 2 or 3 (it's pure frontend) but is sequenced last for cleaner troubleshooting.

| Phase | File | Tasks | Lines | Risk | Depends on |
|---|---|---|---|---|---|
| **1. Foundations** | [`2026-05-06-agent-framework-phase-1-foundations.md`](2026-05-06-agent-framework-phase-1-foundations.md) | 10 | 1,736 | Low | — |
| **2. Concierge Migration** | [`2026-05-06-agent-framework-phase-2-concierge-migration.md`](2026-05-06-agent-framework-phase-2-concierge-migration.md) | 12 | 2,152 | High | Phase 1 |
| **3. HTTP Unification** | [`2026-05-06-agent-framework-phase-3-http-unification.md`](2026-05-06-agent-framework-phase-3-http-unification.md) | 12 | 2,939 | Medium | Phase 2 |
| **4. Frontend Convergence** | [`2026-05-06-agent-framework-phase-4-frontend-convergence.md`](2026-05-06-agent-framework-phase-4-frontend-convergence.md) | 11 | 2,327 | Medium | Independent |

**Total:** 45 tasks across ~9,154 lines of plan documentation. Each task is a TDD bite-sized step (write failing test → run-fail → implement → run-pass → commit). Roughly 90–120 commits when fully executed.

---

## Phase 1 — Foundations (no behavior change)

**Substrate for the rest.** Five pure refactors inside the existing framework — no observable change to any agent. Verified by the existing 1583-test suite passing throughout.

What changes:
- `safeClone` hoisted to a shared util (audit DRY-M3)
- `AgentTranscript` extended with optional fields: `policyDecision` per tool, `setRequestBody`, `setSatelliteSnapshot`, injectable `filePathStrategy` (audit DRY-H5 setup)
- **Decorator chain** introduced in `MastraAdapter`: `applyDecorators([UserIdInjector, CallLimiter, TranscriptRecorder])` replaces the inline 70-line `#translateTools` (audit DRY-H2 setup)
- `BaseAgent.buildPromptSections(context, memory)` hook — overridable section list (audit DRY-H3 setup)
- `EchoAgent extends BaseAgent` cleanup (audit Q7)

After Phase 1, every substrate concierge needs is in place:
- A 4th decorator slot for `PolicyDecorator`
- An overridable prompt-section list for the 6 concierge sections
- An `AgentTranscript` capable of recording satellite + raw body + per-tool policy decisions

Phase 1 has zero risk of regression — no behavior changes.

---

## Phase 2 — Concierge Migration

**Where ConciergeAgent stops reimplementing BaseAgent.** Concierge migrates onto the framework while keeping its OpenAI-Chat-Completions HTTP wire (Plan C handles HTTP). End state: concierge is a `BaseAgent` subclass registered via `agentOrchestrator.register(ConciergeAgent, deps)` like every other agent.

What changes:
- New `ToolBundle` interface (replaces `ISkill`) with optional `getPromptFragment(context)` (audit DRY-M1)
- New `PolicyDecorator` joining the framework chain — generic mechanism, concierge-specific wiring (audit §5)
- `MemorySkill`, `HomeAutomationSkill`, `MediaSkill` migrated to `ToolBundle` shape using `createTool({...defaultPolicy?, getScopesFor?})` (audit DRY-M2)
- 4 unwired skills (Calendar/Finance/Fitness/LifelogReadSkill) — investigate, default to delete (audit Q6)
- `ConciergeAgent extends BaseAgent` — overrides `buildPromptSections` (6 sections) and `buildToolDecorators` (adds PolicyDecorator). Drops `runChat`/`streamChat` for inherited `run`/`runStream` (audit DRY-H2)
- `ConciergeApplication` deleted — bootstrap registers via `agentOrchestrator.register` (audit §7 step 6)
- Two `MastraAdapter` instances collapse to one (the orchestrator's). MediaJudge sub-runtime stays as a separately-configured adapter request from MediaSkill (audit DRY-H1, Q10)
- `OpenAIChatCompletionsTranslator` rewired internally to call `orchestrator.run/streamExecute('concierge', ...)` (HTTP wire format unchanged — Plan C handles that)
- `ConciergeTranscript` deleted — `AgentTranscript` writes via `setRequestBody`/`setSatelliteSnapshot` and the optional `filePathStrategy` from Phase 1 (audit DRY-H5)
- `IConciergeMemory` and `YamlConciergeMemoryAdapter` deleted — concierge uses `IWorkingMemory` directly with `userId='household'`. `MemorySkill.remember_note` mutates `context.memory` (a `WorkingMemoryState`) — no per-tool I/O (audit DRY-H4, Q9)

**Risk:** highest of the four phases. End-to-end testing against a synthetic HA Voice request in Phase 2's Task 12 is the gate.

---

## Phase 3 — HTTP Unification

**One mountAgentHttp helper, two wire formats.** After Phase 2, concierge runs through the orchestrator just like every other agent — but its HTTP surface is still `createConciergeRouter` + `OpenAIChatCompletionsTranslator`. Health-coach et al. use `createAgentsRouter` + `createAgentsStreamRouter`. Both consume the same `orchestrator.run` / `orchestrator.streamExecute` chunks; the wire format differs.

What changes:
- New `mountAgentHttp(app, { orchestrator, agentId, mountPath, wireFormat, authMiddleware?, contextExtractor? })` helper (audit §4A-1)
- Two wire-format presets:
  - `'native'` — current `/api/v1/agents/:agentId/run` and `/run-stream` (text-delta + tool-start + tool-end + finish + done + error events on SSE)
  - `'openai-chat-completions'` — current `/v1/chat/completions` (chat.completion + chat.completion.chunk envelopes, tool events suppressed, `[DONE]` terminator, X-Accel-Buffering header preserved)
- Memory CRUD endpoints (`:agentId/memory/:userId[/:key]`) split out into a separate small router mounted once
- Agents listing endpoint (`GET /api/v1/agents`) split out similarly
- Bootstrap calls `mountAgentHttp` once per registered agent. Concierge can stack two mounts (e.g., `/v1/chat/completions` for HA Voice + optional `/api/v1/agents/concierge/run` for in-app testing)
- Deleted: `agents.mjs`, `agents-stream.mjs`, `concierge.mjs`, `OpenAIChatCompletionsTranslator.mjs`

**Risk:** byte-exact HA Voice wire compatibility. Phase 3 captures a baseline SSE response in Task 0 (before any refactor), tests against it in Task 7 with a golden-master assertion, keeps the legacy translator until the new wire-format module is verified green, and runs a live smoke against the deployed `/v1/chat/completions` with bearer auth in Task 9.

---

## Phase 4 — Frontend Convergence

**One AgentChatSurface component, deleting the rest.** Three coexisting frontend chat surfaces today:
- `Health/CoachChat/index.jsx` — assistant-ui v0.x primitives, mature
- `Chat/ChatPanel.jsx` + `useChatEngine.js` — Mantine, **broken** (wrong URL prefix — confirmed in audit Q4)
- `Life/views/coach/CoachChat.jsx` — wraps the broken Chat/ChatPanel for lifeplan-guide

What changes:
- `parseSSE` lifted from `Health/CoachChat/parseSSE.js` to `frontend/src/lib/sse/parseSSE.js`
- `MarkdownText` + `ToolCallAttribution` lifted to `frontend/src/modules/Agent/`
- `runtime.js` becomes `createAgentRuntime(agentId)` factory at `frontend/src/modules/Agent/runtime.js`
- New `<AgentChatSurface agentId, userId, mentions?, variant?>` component at `frontend/src/modules/Agent/AgentChatSurface.jsx`
- `Health/CoachChat/index.jsx` becomes a thin wrapper passing health-specific mentions config
- `Life/views/coach/CoachChat.jsx` becomes `<AgentChatSurface agentId='lifeplan-guide' />` (incidentally fixes the broken lifeplan UI)
- Deleted: `Chat/ChatPanel.jsx`, `Chat/useChatEngine.js`, the entire `frontend/src/modules/Chat/` directory, `Health/CoachChat/parseSSE.js`/`runtime.js`/`MarkdownText.jsx`/`ToolCallAttribution.jsx` (after the lifts)

**Risk:** medium. Health-coach UI must remain pixel-byte-identical (HealthApp consumer). `<AgentChatSurface>` rendered with the overlay variant is byte-equivalent to today's `<CoachChat variant="overlay">`. AiMark cross-module concern (Health/AiMark used by ToolCallAttribution after lift) is documented and deferred.

---

## Execution recommendations

- **One phase at a time.** Don't start Phase 2 until Phase 1 is fully merged and verified. Don't start Phase 3 until Phase 2 ships.
- **Phase 4 in parallel.** Once Phase 1 lands, Phase 4 can run alongside Phases 2/3 (different code surfaces). Sequencing it last is the safer default for solo execution.
- **Subagent-driven execution.** Each phase plan is structured for the `superpowers:subagent-driven-development` flow: dispatch implementer per task → spec-compliance review → code-quality review → mark complete → next.
- **Test gate per phase.** Each phase ends with a verification task (full vitest suite + vite build + live smoke). If any of these fail, stop and fix before the next phase.
- **Deploy between phases.** Each phase produces a deployable end state. Deploy after Phase 1 (no behavior change — verifies the substrate ships clean), again after Phase 2 (concierge migration — exercise HA Voice), again after Phase 3 (HTTP convergence — exercise both wires), again after Phase 4 (frontend cleanup).
- **45 tasks total, 90–120 commits.** Single contributor working sequentially: roughly 4–7 days of focused work. With subagent-driven execution and parallel reviews: 2–4 days.

---

## What this convergence unlocks

After all four phases land, adding a third agent is **plug-in scale work**:

1. Write a `BaseAgent` subclass — register tools via `addToolFactory(new XToolBundle({...}))`, return prompt sections from `buildPromptSections` (or inherit the default), optionally add decorators via `buildToolDecorators`.
2. Bootstrap: `agentOrchestrator.register(NewAgent, newAgentDeps)`.
3. HTTP: `mountAgentHttp(app, { orchestrator, agentId: 'new-agent', mountPath: '/api/v1/agents', wireFormat: 'native' })`.
4. Frontend: `<AgentChatSurface agentId='new-agent' userId={userId} />`.

That's it. No bespoke composition root, no parallel transcript, no parallel HTTP wire, no parallel chat UI. The framework absorbs every cross-cutting concern; the new agent contributes only its domain — tools, prompts, deps.

The audit's executive summary called out that "the duplication is mostly *structural* — both code paths solve the same problems with different abstractions." This convergence consolidates the abstractions. Each agent becomes about its domain, not about its plumbing.
